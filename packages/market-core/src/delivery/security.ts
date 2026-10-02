/**
 * 远端请求安全边界。所有远端读者经同一条 WHATWG Fetch/Undici 路径；
 * URL/DNS/重定向检查在每一跳执行，响应大小和请求时限由读者继续约束。
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { desktopHttpsFetch } from './https-reader.ts'

export interface HttpProxyConfiguration {
  /** 只接受 HTTP(S) 代理 URL；认证可写在 URL 中，但绝不写入诊断或进度。 */
  readonly httpProxy?: string
  readonly httpsProxy?: string
  /** 逗号分隔的主机名/IP/可选端口；支持 *、.domain、*.domain。 */
  readonly noProxy?: string
}

export interface RemoteSecurityOptions {
  readonly allowPrivateHosts?: boolean
  readonly maxRedirects?: number
  /** 兼容旧调用方：一次安全请求及其响应正文的总时间上限。 */
  readonly timeoutMs?: number
  /** DNS 检查、连接、TLS 与拿到响应头的预算。 */
  readonly headersTimeoutMs?: number
  /** 流式正文连续无数据的上限。 */
  readonly bodyIdleTimeoutMs?: number
  readonly lookup?: (hostname: string) => Promise<readonly string[]>
  /** 网络配置只由 Host 注入，不从目录或前端数据读取。 */
  readonly proxy?: HttpProxyConfiguration
  /** 返回 Undici 兼容的 per-request dispatcher；不修改全局 dispatcher。 */
  readonly dispatcherForProxy?: (proxyUrl: URL) => unknown
}

export interface SafeFetchOptions extends RemoteSecurityOptions {
  readonly headers?: Record<string, string>
  readonly fetch?: typeof fetch
  readonly signal?: AbortSignal | undefined
  /** 目录读者可进一步要求每跳都属于维护者登记的确切 URL。 */
  readonly validateRedirect?: (url: URL) => void
  /** Cache only: allow a small number of non-2xx protocol responses for validation. */
  readonly allowStatuses?: readonly number[]
}

export class DeliverySecurityError extends Error {
  readonly code: string
  readonly status?: number
  readonly retryAfterMs?: number
  constructor(code: string, message: string, details: { readonly status?: number; readonly retryAfterMs?: number } = {}) {
    super(message)
    this.name = 'DeliverySecurityError'
    this.code = code
    if (details.status !== undefined) this.status = details.status
    if (details.retryAfterMs !== undefined) this.retryAfterMs = details.retryAfterMs
  }
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a = -1, b = -1] = parts
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? ''
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7)
    return isIP(mapped) === 4 ? isPrivateIpv4(mapped) : true
  }
  const first = normalized.split(':')[0] ?? ''
  const numeric = Number.parseInt(first, 16)
  if (!Number.isFinite(numeric)) return true
  return (numeric & 0xfe00) === 0xfc00 || (numeric & 0xffc0) === 0xfe80 ||
    (numeric & 0xff00) === 0xff00 || normalized.startsWith('2001:db8:')
}

export function isPrivateAddress(address: string): boolean {
  const unwrapped = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address
  const kind = isIP(unwrapped)
  if (kind === 4) return isPrivateIpv4(unwrapped)
  if (kind === 6) return isPrivateIpv6(unwrapped)
  return true
}

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

function assertSafeHostname(hostname: string): void {
  const lower = normalizedHostname(hostname)
  if (
    lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') ||
    lower.endsWith('.internal') || lower.endsWith('.home.arpa')
  ) {
    throw new DeliverySecurityError('delivery/private-host', `不允许访问本机或私有主机 ${hostname}`)
  }
}

export async function assertSafeRemoteUrl(input: string | URL, options: RemoteSecurityOptions = {}): Promise<URL> {
  let url: URL
  try { url = input instanceof URL ? new URL(input.href) : new URL(input) }
  catch { throw new DeliverySecurityError('delivery/invalid-url', '远端来源地址无效') }
  if (url.protocol !== 'https:') throw new DeliverySecurityError('delivery/insecure-url', '远端来源必须使用 HTTPS')
  if (url.username || url.password) throw new DeliverySecurityError('delivery/credential-url', 'URL 不得内嵌用户名或密码')
  assertSafeHostname(url.hostname)
  if (options.allowPrivateHosts) return url
  if (isIP(normalizedHostname(url.hostname))) {
    if (isPrivateAddress(url.hostname)) throw new DeliverySecurityError('delivery/private-address', '不允许下载到本机或私网地址')
    return url
  }
  const resolveHost = options.lookup ?? (async (hostname: string) =>
    (await lookup(hostname, { all: true })).map((item: { readonly address: string }) => item.address))
  let addresses: readonly string[]
  try { addresses = await resolveHost(normalizedHostname(url.hostname)) }
  catch { throw new DeliverySecurityError('delivery/dns-failed', `无法解析来源主机 ${url.hostname}`) }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new DeliverySecurityError('delivery/private-address', '来源主机解析到本机或私网地址')
  }
  return url
}

/** 中止等待也用于 DNS 和自定义 Reader；取消后不能继续尝试镜像。 */
export async function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  signal.throwIfAborted()
  let abort: () => void = () => undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new DOMException('已取消', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  try { return await Promise.race([operation, cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}

function combinedSignal(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const present = signals.filter((signal): signal is AbortSignal => signal !== undefined)
  return present.length === 0 ? undefined : present.length === 1 ? present[0] : AbortSignal.any(present)
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, Math.ceil(seconds * 1000))
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, Math.min(30_000, at - Date.now())) : undefined
}

function parseProxyUrl(value: string): URL {
  let proxyUrl: URL
  try { proxyUrl = new URL(value) }
  catch { throw new DeliverySecurityError('delivery/proxy-invalid', '代理地址配置无效') }
  if (!['http:', 'https:'].includes(proxyUrl.protocol) || !proxyUrl.hostname || proxyUrl.hash) {
    throw new DeliverySecurityError('delivery/proxy-invalid', '代理只支持 HTTP(S) 地址')
  }
  return proxyUrl
}

function splitNoProxyEntry(entry: string): { host: string; port?: string } | undefined {
  const value = entry.trim().toLowerCase()
  if (!value) return undefined
  if (value.startsWith('[')) {
    const close = value.indexOf(']')
    if (close < 0) return { host: value }
    const host = value.slice(1, close)
    const rest = value.slice(close + 1)
    return { host, ...(rest.startsWith(':') ? { port: rest.slice(1) } : {}) }
  }
  const colon = value.lastIndexOf(':')
  if (colon > 0 && value.indexOf(':') === colon && /^\d+$/.test(value.slice(colon + 1))) {
    return { host: value.slice(0, colon), port: value.slice(colon + 1) }
  }
  return { host: value }
}

export function matchesNoProxy(hostname: string, port: string, noProxy = ''): boolean {
  const target = normalizedHostname(hostname)
  for (const raw of noProxy.split(',')) {
    const entry = splitNoProxyEntry(raw)
    if (!entry) continue
    if (entry.host === '*') return true
    if (entry.port !== undefined && entry.port !== port) continue
    const pattern = entry.host.replace(/^\*\./, '.').replace(/^\./, '')
    if (!pattern) continue
    const normalizedPattern = normalizedHostname(pattern)
    if (target === normalizedPattern || target.endsWith('.' + normalizedPattern)) return true
  }
  return false
}

function proxyFor(url: URL, options: SafeFetchOptions): URL | undefined {
  const config = options.proxy
  if (!config) return undefined
  const port = url.port || '443'
  if (matchesNoProxy(url.hostname, port, config.noProxy)) return undefined
  const value = url.protocol === 'https:' ? config.httpsProxy : config.httpProxy
  if (!value) return undefined
  return parseProxyUrl(value)
}

function headersForRedirect(headers: Record<string, string>, from: URL, to: URL): Record<string, string> {
  const result = { ...headers }
  if (from.origin !== to.origin) {
    for (const key of Object.keys(result)) {
      if (['authorization', 'proxy-authorization', 'cookie', 'cookie2'].includes(key.toLowerCase())) delete result[key]
    }
  }
  return result
}

function responseWithDeadline(response: Response, signal: AbortSignal | undefined, cleanup: () => void): Response {
  if (!response.body) { cleanup(); return response }
  const reader = response.body.getReader()
  let finished = false
  let readPending = false
  let abandoned = false
  const release = () => { if (!readPending) { try { reader.releaseLock() } catch { /* already released */ } } }
  const finish = () => {
    if (finished) return
    finished = true
    cleanup()
    if (!readPending) release()
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const pending = reader.read()
      readPending = true
      void pending.then(() => { readPending = false; if (abandoned) release() },
        () => { readPending = false; if (abandoned) release() })
      try {
        const result = await withAbort(pending, signal)
        if (result.done) { controller.close(); finish() }
        else controller.enqueue(result.value)
      } catch (error) {
        controller.error(error)
        abandoned = true
        void reader.cancel(error).then(finish, finish)
        if (!readPending) finish()
      }
    },
    async cancel(reason) {
      abandoned = true
      try { await reader.cancel(reason) } finally { finish() }
    },
  })
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}

async function readWithIdleTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal | undefined, timeoutMs: number): Promise<ReadableStreamReadResult<Uint8Array>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DeliverySecurityError('delivery/body-idle-timeout', '读取响应正文时长时间没有数据')), timeoutMs)
  const pending = reader.read()
  try {
    return await withAbort(pending, combinedSignal(signal, controller.signal))
  } catch (error) {
    void reader.cancel(error).catch(() => undefined)
    if (controller.signal.aborted) throw controller.signal.reason
    throw error
  } finally { clearTimeout(timer) }
}

export async function readLimitedResponse(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
  bodyIdleTimeoutMs = 30_000,
): Promise<Uint8Array> {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new DeliverySecurityError('delivery/invalid-limit', '响应大小限制无效')
  const lengthHeader = response.headers.get('content-length')
  const declared = lengthHeader === null ? undefined : Number(lengthHeader)
  if (declared !== undefined && (!Number.isSafeInteger(declared) || declared < 0)) {
    void response.body?.cancel().catch(() => undefined)
    throw new DeliverySecurityError('delivery/invalid-length', '响应长度字段无效')
  }
  if (declared !== undefined && declared > maxBytes) {
    void response.body?.cancel().catch(() => undefined)
    throw new DeliverySecurityError('delivery/too-large', '响应声明体积超限')
  }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const part = await readWithIdleTimeout(reader, signal, bodyIdleTimeoutMs)
      if (part.done) break
      total += part.value.byteLength
      if (total > maxBytes) throw new DeliverySecurityError('delivery/too-large', '响应体积超限')
      chunks.push(part.value)
    }
    signal?.throwIfAborted()
    if (declared !== undefined && total !== declared) throw new DeliverySecurityError('delivery/length-mismatch', '实际响应长度与 Content-Length 不一致')
    return Buffer.concat(chunks, total)
  } finally {
    void reader.cancel().then(() => { try { reader.releaseLock() } catch { /* already released */ } }, () => undefined)
  }
}

/**
 * 只做有界的 HTTP GET/重定向检查。调用方必须继续限制响应正文并核对摘要；
 * HTTP 200 从来不代表制品已经验证。代理通过 per-request Undici dispatcher 注入，不改进程全局设置。
 */
export async function safeFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5
  const totalTimeoutMs = options.timeoutMs ?? 30_000
  const headersTimeoutMs = options.headersTimeoutMs ?? totalTimeoutMs
  const totalController = new AbortController()
  const totalTimer = setTimeout(() => totalController.abort(new DeliverySecurityError('delivery/total-timeout', '网络请求超过总时限')), totalTimeoutMs)
  const totalSignal = combinedSignal(options.signal, totalController.signal)
  let cleaned = false
  const cleanup = () => { if (!cleaned) { cleaned = true; clearTimeout(totalTimer); totalSignal?.removeEventListener('abort', cleanup) } }
  totalSignal?.addEventListener('abort', cleanup, { once: true })
  let current: URL
  try { current = await withAbort(assertSafeRemoteUrl(input, options), totalSignal) }
  catch (error) { cleanup(); throw error }
  let headers: Record<string, string> = { accept: '*/*', 'accept-encoding': 'identity', ...options.headers }

  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      totalSignal?.throwIfAborted()
      const headerController = new AbortController()
      const headerTimer = setTimeout(() => headerController.abort(new DeliverySecurityError('delivery/headers-timeout', '连接或响应头等待超时')), headersTimeoutMs)
      const requestSignal = combinedSignal(totalSignal, headerController.signal)
      let response: Response
      try {
        const safeUrl = await withAbort(assertSafeRemoteUrl(current, options), requestSignal)
        let dispatcher: unknown
        const selectedProxy = proxyFor(safeUrl, options)
        if (selectedProxy) {
          if (!options.dispatcherForProxy) throw new DeliverySecurityError('delivery/proxy-unavailable', '已配置代理，但 Host 没有提供安全的请求级代理通道')
          try { dispatcher = options.dispatcherForProxy(selectedProxy) }
          catch { throw new DeliverySecurityError('delivery/proxy-unavailable', '无法创建请求级代理通道') }
          if (dispatcher === undefined || dispatcher === null) throw new DeliverySecurityError('delivery/proxy-unavailable', '无法创建请求级代理通道')
        }
        const init: RequestInit & { readonly dispatcher?: unknown } = {
          method: 'GET',
          redirect: 'manual',
          ...(requestSignal === undefined ? {} : { signal: requestSignal }),
          headers,
          ...(dispatcher === undefined ? {} : { dispatcher }),
        }
        response = await withAbort((options.fetch ?? desktopHttpsFetch)(safeUrl, init), requestSignal)
      } catch (error) {
        if (headerController.signal.aborted) throw headerController.signal.reason
        throw error
      } finally { clearTimeout(headerTimer) }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        void response.body?.cancel().catch(() => undefined)
        const location = response.headers.get('location')
        if (!location) throw new DeliverySecurityError('delivery/invalid-redirect', '重定向响应缺少 Location')
        if (redirects === maxRedirects) throw new DeliverySecurityError('delivery/too-many-redirects', '下载重定向次数过多')
        const next = await withAbort(assertSafeRemoteUrl(new URL(location, current), options), totalSignal)
        options.validateRedirect?.(next)
        headers = headersForRedirect(headers, current, next)
        current = next
        continue
      }
      if (!response.ok && !options.allowStatuses?.includes(response.status)) {
        void response.body?.cancel().catch(() => undefined)
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
        throw new DeliverySecurityError('delivery/http-failed', `来源返回 HTTP ${response.status}`, { status: response.status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) })
      }
      return responseWithDeadline(response, totalSignal, cleanup)
    }
    throw new DeliverySecurityError('delivery/too-many-redirects', '下载重定向次数过多')
  } catch (error) {
    cleanup()
    if (totalController.signal.aborted) throw totalController.signal.reason
    throw error
  }
}
