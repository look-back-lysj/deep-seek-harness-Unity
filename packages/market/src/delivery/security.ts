/**
 * 远端来源安全边界。
 *
 * 远端 URL 只允许 HTTPS、无内嵌凭据、非本机/内网地址；每次重定向都重新检查，
 * 避免一个公开地址通过302把下载静默带到 localhost 或企业内网。
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { desktopHttpsFetch } from './https-reader.ts'

export interface RemoteSecurityOptions {
  readonly allowPrivateHosts?: boolean
  readonly maxRedirects?: number
  readonly timeoutMs?: number
  readonly lookup?: (hostname: string) => Promise<readonly string[]>
}

export interface SafeFetchOptions extends RemoteSecurityOptions {
  readonly headers?: Record<string, string>
  readonly fetch?: typeof fetch
  readonly signal?: AbortSignal | undefined
  /** 目录读者可进一步要求每跳都属于维护者登记的确切 URL。 */
  readonly validateRedirect?: (url: URL) => void
}

export class DeliverySecurityError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'DeliverySecurityError'
    this.code = code
  }
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a = -1, b = -1] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
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
  return (numeric & 0xfe00) === 0xfc00 || (numeric & 0xffc0) === 0xfe80 || (numeric & 0xff00) === 0xff00 || normalized.startsWith('2001:db8:')
}

export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address)
  if (kind === 4) return isPrivateIpv4(address)
  if (kind === 6) return isPrivateIpv6(address)
  return true
}

function assertSafeHostname(hostname: string): void {
  const lower = hostname.toLowerCase().replace(/\.$/, '')
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.home.arpa')
  ) {
    throw new DeliverySecurityError('delivery/private-host', `不允许访问本机或私有主机 ${hostname}`)
  }
}

export async function assertSafeRemoteUrl(input: string | URL, options: RemoteSecurityOptions = {}): Promise<URL> {
  const url = input instanceof URL ? input : new URL(input)
  if (url.protocol !== 'https:') throw new DeliverySecurityError('delivery/insecure-url', '远端来源必须使用 HTTPS')
  if (url.username || url.password) throw new DeliverySecurityError('delivery/credential-url', 'URL 不得内嵌用户名或密码')
  assertSafeHostname(url.hostname)
  if (options.allowPrivateHosts) return url
  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new DeliverySecurityError('delivery/private-address', '不允许下载到本机或私网地址')
    return url
  }
  const resolve = options.lookup ?? (async (hostname: string) => (await lookup(hostname, { all: true })).map((item: { readonly address: string }) => item.address))
  let addresses: readonly string[]
  try {
    addresses = await resolve(url.hostname)
  } catch {
    throw new DeliverySecurityError('delivery/dns-failed', `无法解析来源主机 ${url.hostname}`)
  }
  if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address))) {
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
  try { return await Promise.race([operation, cancelled]) } finally { signal.removeEventListener('abort', abort) }
}

export async function readLimitedResponse(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted()
  if (Number(response.headers.get('content-length') ?? '0') > maxBytes) {
    void response.body?.cancel().catch(() => undefined)
    throw new DeliverySecurityError('delivery/too-large', '响应声明体积超限')
  }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const part = await withAbort(reader.read(), signal)
      if (part.done) break
      total += part.value.byteLength
      if (total > maxBytes) throw new DeliverySecurityError('delivery/too-large', '响应体积超限')
      chunks.push(part.value)
    }
    signal?.throwIfAborted()
    return Buffer.concat(chunks, total)
  } finally {
    // cancel 不等待远端清理，避免自定义/失联流让取消操作重新阻塞。
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/**
 * 只做有界的 HTTP GET/重定向检查。调用方必须自己限制响应体并核对摘要；
 * HTTP 200 从来不代表制品已经验证。
 */
export async function safeFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  signal.throwIfAborted()
  let current = await withAbort(assertSafeRemoteUrl(input, options), signal)
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    signal.throwIfAborted()
    const response = await withAbort((options.fetch ?? desktopHttpsFetch)(current, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: { accept: '*/*', ...options.headers },
    }), signal)
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      void response.body?.cancel().catch(() => undefined)
      const location = response.headers.get('location')
      if (!location) throw new DeliverySecurityError('delivery/invalid-redirect', '重定向响应缺少 Location')
      if (redirects === maxRedirects) throw new DeliverySecurityError('delivery/too-many-redirects', '下载重定向次数过多')
      current = await withAbort(assertSafeRemoteUrl(new URL(location, current), options), signal)
      options.validateRedirect?.(current)
      continue
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      throw new DeliverySecurityError('delivery/http-failed', `来源返回 HTTP ${response.status}`)
    }
    return response
  }
  throw new DeliverySecurityError('delivery/too-many-redirects', '下载重定向次数过多')
}
