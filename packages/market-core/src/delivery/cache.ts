/**
 * Delivery：冻结来源、多镜像、流式制品下载、摘要核验和引用缓存。
 * 远程正文只写摘要/来源隔离的 `.part`；通过长度、SHA-256 和 tgz 身份校验后才原子提交。
 */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { CatalogDelivery, DeliverySource } from '../contracts/types.ts'
import { DeliverySecurityError, safeFetch, withAbort, type RemoteSecurityOptions, type SafeFetchOptions } from './security.ts'
import { TgzVerificationError, verifyTgzFile, type TgzLimits, type VerifiedTgz } from './tgz.ts'

export type CacheReferenceKind = 'active-task' | 'installed'
export interface CacheReference { readonly id: string; readonly kind: CacheReferenceKind; readonly createdAt: string }
export interface ArtifactCacheOptions extends RemoteSecurityOptions {
  readonly cacheDir: string
  readonly maxCompressedBytes?: number
  readonly allowLocalFileSources?: readonly string[]
  readonly fetch?: typeof fetch
  readonly now?: () => Date
  readonly maxDownloadTimeoutMs?: number
  readonly maxDownloadTotalMs?: number
  readonly downloadBaseTimeoutMs?: number
  readonly minDownloadBytesPerSecond?: number
  readonly maxRetries?: number
  readonly retryBaseDelayMs?: number
  readonly retryMaxDelayMs?: number
  readonly progressIntervalMs?: number
}
export type ArtifactDownloadStage = 'connecting' | 'downloading' | 'retrying' | 'verifying' | 'completed' | 'failed' | 'cancelled'
export interface ArtifactDownloadProgress {
  readonly stage: ArtifactDownloadStage
  readonly pluginId: string
  readonly packageName: string
  readonly version: string
  readonly artifactDigest: string
  readonly sourceIndex: number
  readonly sourceCount: number
  readonly sourceKind: DeliverySource['kind']
  readonly attempt: number
  readonly receivedBytes: number
  readonly totalBytes?: number
  readonly resumed: boolean
}
export interface DownloadArtifactOptions {
  readonly signal?: AbortSignal | undefined
  readonly requireBundle?: boolean
  readonly referenceId: string
  readonly referenceKind: CacheReferenceKind
  readonly tgzLimits?: TgzLimits
  readonly allowLocalFileSources?: readonly string[]
  readonly onProgress?: ((progress: ArtifactDownloadProgress) => void | Promise<void>) | undefined
}
export interface DeliveryAttempt {
  readonly source: DeliverySource
  readonly status: 'accepted' | 'network-failed' | 'digest-mismatch' | 'unsafe' | 'identity-mismatch'
  readonly reason?: string
}
export interface AcquiredArtifact { readonly verified: VerifiedTgz; readonly localPath: string; readonly attempts: readonly DeliveryAttempt[] }
export class DeliveryError extends Error {
  readonly code: string
  readonly attempts: readonly DeliveryAttempt[]
  constructor(code: string, message: string, attempts: readonly DeliveryAttempt[] = []) {
    super(message); this.name = 'DeliveryError'; this.code = code; this.attempts = attempts
  }
}
interface ReferenceFile { readonly schemaVersion: '1'; readonly references: Record<string, readonly CacheReference[]> }
interface PartMetadata {
  readonly schemaVersion: 1
  readonly digest: string
  readonly sourceKey: string
  readonly receivedBytes: number
  readonly totalBytes?: number
  readonly etag?: string
  readonly lastModified?: string
}
interface PartLocation { readonly file: string; readonly metadata: string; readonly sourceKey: string }
function digestOf(bytes: Uint8Array): string { return `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
function normalizeDigest(value: string): string {
  const raw = value.startsWith('sha256:') ? value.slice(7) : value
  if (!/^[a-f0-9]{64}$/.test(raw)) throw new DeliveryError('delivery/invalid-digest', 'artifactDigest 格式无效')
  return `sha256:${raw}`
}
function atomicJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  try { writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', flag: 'wx', mode: 0o600 }); renameSync(temporary, path) }
  catch (error) { if (existsSync(temporary)) unlinkSync(temporary); throw error }
}
function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..'))
}
function removeIfExists(path: string): void { if (existsSync(path)) unlinkSync(path) }
function sourceIdentity(source: DeliverySource, digest: string): string {
  // Raw URLs can contain signed queries; only their one-way identity hash is persisted.
  return createHash('sha256').update(`${digest}\0${source.kind}\0${source.ref}`).digest('hex')
}
function parseContentLength(headers: Headers): number | undefined {
  const value = headers.get('content-length')
  if (value === null) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new DeliveryError('delivery/invalid-length', '来源返回了无效的 Content-Length')
  return parsed
}
function parseContentRange(value: string | null): { start: number; end: number; total: number } | undefined {
  const match = value ? /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(value.trim()) : null
  if (!match) return undefined
  const start = Number(match[1]), end = Number(match[2]), total = Number(match[3])
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end) return undefined
  return { start, end, total }
}
function strongEtag(value: string | undefined): value is string { return value !== undefined && !/^W\//i.test(value) }
function retryable(error: unknown): boolean {
  if (error instanceof DeliverySecurityError) {
    if (error.code === 'delivery/http-failed') return error.status === 408 || error.status === 425 || error.status === 429 || (error.status ?? 0) >= 500
    return ['delivery/dns-failed', 'delivery/headers-timeout', 'delivery/total-timeout', 'delivery/body-idle-timeout'].includes(error.code)
  }
  if (error instanceof DeliveryError) return ['delivery/request-timeout', 'delivery/body-idle-timeout', 'delivery/response-interrupted'].includes(error.code)
  // A generic injected Error is treated as a source failure so the next
  // registered mirror is tried. Only explicit transient network errors are
  // retried against the same source.
  return error instanceof TypeError || (error instanceof Error && ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? ''))
}
function retryAfter(error: unknown): number | undefined { return error instanceof DeliverySecurityError ? error.retryAfterMs : undefined }
function abortError(signal?: AbortSignal): unknown { return signal?.reason ?? new DOMException('已取消', 'AbortError') }
function safeReason(error: unknown): string {
  const text = error instanceof Error ? error.message : '下载失败'
  return text
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1<redacted>@')
    .replace(/((?:bearer|basic)\s+)[A-Za-z0-9._+/=-]+/gi, '$1<redacted>')
    .replace(/([?&](?:token|password|secret|api[_-]?key|signature|authorization)=)[^&\s]+/gi, '$1<redacted>')
}
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) { signal?.throwIfAborted(); return Promise.resolve() }
  return new Promise((resolveDelay, reject) => {
    if (signal?.aborted) { reject(abortError(signal)); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolveDelay() }, ms)
    const onAbort = () => { clearTimeout(timer); reject(abortError(signal)) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class ArtifactCache {
  private readonly root: string
  private readonly options: ArtifactCacheOptions
  private readonly now: () => Date
  private readonly inFlightDownloads = new Map<string, Promise<AcquiredArtifact>>()
  constructor(options: ArtifactCacheOptions) {
    this.root = resolve(options.cacheDir); this.options = options; this.now = options.now ?? (() => new Date())
    mkdirSync(join(this.root, 'tmp'), { recursive: true }); mkdirSync(join(this.root, 'refs'), { recursive: true })
    mkdirSync(join(this.root, 'sha256'), { recursive: true })
    if (!existsSync(this.referencesPath)) atomicJson(this.referencesPath, { schemaVersion: '1', references: {} })
  }
  private get referencesPath(): string { return join(this.root, 'refs', 'index.json') }
  private readReferences(): ReferenceFile {
    const value = JSON.parse(readFileSync(this.referencesPath, 'utf8')) as ReferenceFile
    if (value.schemaVersion !== '1' || typeof value.references !== 'object') throw new DeliveryError('delivery/reference-schema', '缓存引用索引结构无效')
    return value
  }
  retain(digest: string, reference: Omit<CacheReference, 'createdAt'>): void {
    const normalized = normalizeDigest(digest), file = this.readReferences(), current = file.references[normalized] ?? []
    if (current.some(item => item.id === reference.id && item.kind === reference.kind)) return
    atomicJson(this.referencesPath, { schemaVersion: '1', references: { ...file.references,
      [normalized]: [...current, { ...reference, createdAt: this.now().toISOString() }] } })
  }
  release(digest: string, referenceId: string): void {
    const normalized = normalizeDigest(digest), file = this.readReferences(), current = file.references[normalized] ?? []
    atomicJson(this.referencesPath, { schemaVersion: '1', references: { ...file.references,
      [normalized]: current.filter(item => item.id !== referenceId) } })
  }
  pathFor(digest: string): string { return join(this.root, 'sha256', `${normalizeDigest(digest).slice(7)}.tgz`) }
  pruneUnreferenced(before: Date): readonly string[] {
    const file = this.readReferences(), removed: string[] = [], directory = join(this.root, 'sha256')
    if (!existsSync(directory)) return removed
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.tgz')) continue
      const path = join(directory, name), digest = `sha256:${name.slice(0, -4)}`
      if ((file.references[digest] ?? []).length > 0) continue
      if (statSync(path).mtimeMs >= before.getTime()) continue
      unlinkSync(path); removed.push(name)
    }
    return removed
  }
  private allowedLocalRoots(override?: readonly string[]): readonly string[] {
    return (override ?? this.options.allowLocalFileSources ?? []).map(root => realpathSync(resolve(root)))
  }
  private localFileBytes(source: DeliverySource, roots: readonly string[], maxBytes: number): Uint8Array {
    if (!isAbsolute(source.ref)) throw new DeliveryError('delivery/unsafe-local-source', 'local-file 必须由 Host 给出绝对路径')
    const path = realpathSync(resolve(source.ref))
    if (!roots.some(root => isInside(root, path))) throw new DeliveryError('delivery/unsafe-local-source', 'local-file 不在允许的受控目录内')
    const info = statSync(path)
    if (!info.isFile()) throw new DeliveryError('delivery/unsafe-local-source', '本地制品不是普通文件')
    if (info.size > maxBytes) throw new DeliveryError('delivery/too-large', '本地制品体积超限')
    return readFileSync(path)
  }
  private partLocation(digest: string, source: DeliverySource): PartLocation {
    const key = sourceIdentity(source, digest), base = join(this.root, 'tmp', `${digest.slice(7)}.${key}`)
    return { file: base + '.part', metadata: base + '.json', sourceKey: key }
  }
  private readPart(location: PartLocation, digest: string, maxBytes: number, declaredSize?: number): PartMetadata | undefined {
    try {
      const value = JSON.parse(readFileSync(location.metadata, 'utf8')) as PartMetadata
      const info = statSync(location.file)
      if (value.schemaVersion !== 1 || value.digest !== digest || value.sourceKey !== location.sourceKey ||
        !Number.isSafeInteger(value.receivedBytes) || value.receivedBytes < 0 || value.receivedBytes > info.size ||
        value.receivedBytes > maxBytes || (value.totalBytes !== undefined &&
          (!Number.isSafeInteger(value.totalBytes) || value.totalBytes < 0 || value.totalBytes > maxBytes)) ||
        (declaredSize !== undefined && value.totalBytes !== undefined && value.totalBytes !== declaredSize)) {
        removeIfExists(location.file); removeIfExists(location.metadata); return undefined
      }
      if (info.size < value.receivedBytes) { removeIfExists(location.file); removeIfExists(location.metadata); return undefined }
      if (info.size > value.receivedBytes) {
        // A crash after writing a chunk but before saving its metadata leaves an uncommitted tail.
        const handle = openSync(location.file, 'r+')
        try { ftruncateSync(handle, value.receivedBytes) } finally { closeSync(handle) }
      }
      return value
    } catch {
      removeIfExists(location.file); removeIfExists(location.metadata); return undefined
    }
  }
  private savePart(location: PartLocation, metadata: PartMetadata): void { atomicJson(location.metadata, metadata) }
  private clearPart(location: PartLocation): void { removeIfExists(location.file); removeIfExists(location.metadata) }

  private securityOptions(signal?: AbortSignal): SafeFetchOptions {
    return {
      ...(this.options.allowPrivateHosts === undefined ? {} : { allowPrivateHosts: this.options.allowPrivateHosts }),
      ...(this.options.maxRedirects === undefined ? {} : { maxRedirects: this.options.maxRedirects }),
      ...(this.options.headersTimeoutMs === undefined ? {} : { headersTimeoutMs: this.options.headersTimeoutMs }),
      ...(this.options.lookup === undefined ? {} : { lookup: this.options.lookup }),
      ...(this.options.proxy === undefined ? {} : { proxy: this.options.proxy }),
      ...(this.options.dispatcherForProxy === undefined ? {} : { dispatcherForProxy: this.options.dispatcherForProxy }),
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
      ...(signal === undefined ? {} : { signal }),
    }
  }
  private calculatedSourceBudget(size: number | undefined, maxBytes: number): number {
    // timeoutMs remains an explicit legacy override; normal product defaults scale with bytes.
    if (this.options.timeoutMs !== undefined) return this.options.timeoutMs
    const base = this.options.downloadBaseTimeoutMs ?? 90_000
    const rate = this.options.minDownloadBytesPerSecond ?? 32 * 1024
    const cap = this.options.maxDownloadTimeoutMs ?? 2 * 60 * 60 * 1000
    return Math.max(base, Math.min(cap, base + Math.ceil((size ?? maxBytes) / rate * 1000)))
  }
  private async report(options: DownloadArtifactOptions, progress: ArtifactDownloadProgress, force = false, throttle?: { lastAt: number }): Promise<void> {
    if (!options.onProgress) return
    const now = Date.now(), interval = this.options.progressIntervalMs ?? 250
    if (!force && throttle && now - throttle.lastAt < interval) return
    if (throttle) throttle.lastAt = now
    try { await options.onProgress(progress) } catch { /* Event reporting cannot break verified transport. */ }
  }
  private async writeChunk(handle: Awaited<ReturnType<typeof open>>, chunk: Uint8Array, position: number): Promise<void> {
    let written = 0
    while (written < chunk.byteLength) {
      const result = await handle.write(chunk, written, chunk.byteLength - written, position + written)
      if (result.bytesWritten <= 0) throw new DeliveryError('delivery/disk-write-failed', '写入下载临时文件失败')
      written += result.bytesWritten
    }
  }

  private async downloadRemoteToPart(
    source: DeliverySource,
    expectedDigest: string,
    maxBytes: number,
    signal: AbortSignal | undefined,
    sourceDeadline: number,
    progress: (receivedBytes: number, totalBytes: number | undefined, resumed: boolean) => Promise<void>,
  ): Promise<{ path: string; size: number }> {
    const location = this.partLocation(expectedDigest, source)
    let metadata = this.readPart(location, expectedDigest, maxBytes, source.size)
    const canResume = (part: PartMetadata | undefined): boolean => Boolean(part && part.receivedBytes > 0 &&
      part.totalBytes !== undefined && part.totalBytes > part.receivedBytes && (strongEtag(part.etag) || part.lastModified))
    if (metadata && !canResume(metadata) && !(metadata.totalBytes !== undefined && metadata.receivedBytes === metadata.totalBytes && metadata.receivedBytes > 0)) {
      this.clearPart(location); metadata = undefined
    }
    if (metadata?.totalBytes !== undefined && metadata.receivedBytes === metadata.totalBytes && metadata.receivedBytes > 0) {
      return { path: location.file, size: metadata.receivedBytes }
    }

    let protocolRestarted = false
    while (true) {
      signal?.throwIfAborted()
      const resumePart = canResume(metadata) ? metadata : undefined
      const resumed = resumePart !== undefined, offset = resumePart?.receivedBytes ?? 0
      const headers: Record<string, string> = {}
      if (resumePart) {
        headers.range = `bytes=${offset}-`
        headers['if-range'] = strongEtag(resumePart.etag) ? resumePart.etag : resumePart.lastModified!
      }
      const remaining = sourceDeadline - Date.now()
      if (remaining <= 0) throw new DeliverySecurityError('delivery/total-timeout', '单个来源已超过可用下载时间')
      const idleController = new AbortController()
      const requestSignal = signal ? AbortSignal.any([signal, idleController.signal]) : idleController.signal
      const response = await safeFetch(source.ref, {
        ...this.securityOptions(requestSignal),
        timeoutMs: remaining,
        headersTimeoutMs: Math.min(this.options.headersTimeoutMs ?? 30_000, remaining),
        headers,
        allowStatuses: [206, 416],
      })
      if (resumed && response.status === 416) {
        void response.body?.cancel().catch(() => undefined)
        this.clearPart(location); metadata = undefined
        if (protocolRestarted) throw new DeliveryError('delivery/invalid-range', '来源拒绝从头重取后的 Range 请求')
        protocolRestarted = true
        continue
      }

      let append = false
      let totalBytes: number | undefined
      let expectedResponseBytes: number | undefined
      const responseEtag = response.headers.get('etag') ?? undefined
      const responseModified = response.headers.get('last-modified') ?? undefined
      if (resumed && response.status === 206) {
        const range = parseContentRange(response.headers.get('content-range'))
        const segmentLength = range ? range.end - range.start + 1 : undefined
        const length = parseContentLength(response.headers)
        const validatorsMatch = (resumePart!.etag === undefined || responseEtag === resumePart!.etag) &&
          (resumePart!.lastModified === undefined || responseModified === resumePart!.lastModified)
        if (!range || range.start !== offset || !validatorsMatch || (length !== undefined && length !== segmentLength) ||
          (source.size !== undefined && range.total !== source.size) || (resumePart!.totalBytes !== undefined && range.total !== resumePart!.totalBytes)) {
          void response.body?.cancel().catch(() => undefined)
          this.clearPart(location); metadata = undefined
          if (protocolRestarted) throw new DeliveryError('delivery/invalid-range', '来源连续返回无效断点数据')
          protocolRestarted = true
          continue
        }
        append = true; totalBytes = range.total; expectedResponseBytes = segmentLength
      } else if (resumed && response.status === 200) {
        // A 200 is a complete representation from byte zero (Range ignored or If-Range changed).
        this.clearPart(location); metadata = undefined
        totalBytes = parseContentLength(response.headers) ?? source.size
        expectedResponseBytes = parseContentLength(response.headers)
      } else {
        if (response.status === 416) {
          void response.body?.cancel().catch(() => undefined)
          throw new DeliveryError('delivery/unexpected-range', '来源在未续传请求中返回 HTTP 416')
        }
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => undefined)
          throw new DeliveryError('delivery/unexpected-status', `来源返回了不支持的 HTTP ${response.status}`)
        }
        totalBytes = parseContentLength(response.headers) ?? source.size
        expectedResponseBytes = parseContentLength(response.headers)
      }
      const contentLength = parseContentLength(response.headers)
      if (contentLength !== undefined && contentLength > maxBytes) {
        void response.body?.cancel().catch(() => undefined); this.clearPart(location)
        throw new DeliveryError('delivery/too-large', '来源声明制品体积超限')
      }
      if (source.size !== undefined && totalBytes !== undefined && source.size !== totalBytes) {
        void response.body?.cancel().catch(() => undefined); this.clearPart(location)
        throw new DeliveryError('delivery/source-size-mismatch', '来源声明大小与冻结制品大小不同')
      }
      if (totalBytes !== undefined && totalBytes > maxBytes) {
        void response.body?.cancel().catch(() => undefined); this.clearPart(location)
        throw new DeliveryError('delivery/too-large', '来源制品体积超限')
      }
      const startBytes = append ? offset : 0
      let current = startBytes
      const nextMetadata = (receivedBytes: number): PartMetadata => ({
        schemaVersion: 1, digest: expectedDigest, sourceKey: location.sourceKey, receivedBytes,
        ...(totalBytes === undefined ? {} : { totalBytes }),
        ...(responseEtag === undefined ? {} : { etag: responseEtag }),
        ...(responseModified === undefined ? {} : { lastModified: responseModified }),
      })
      this.savePart(location, nextMetadata(current))
      const file = await open(location.file, append ? 'a' : 'w', 0o600)
      try {
        if (!response.body) throw new DeliveryError('delivery/empty-body', '来源没有返回制品正文')
        const reader = response.body.getReader()
        let responseBytes = 0, lastCheckpoint = current
        try {
          while (true) {
            signal?.throwIfAborted()
            const timer = setTimeout(() => idleController.abort(new DeliverySecurityError('delivery/body-idle-timeout', '制品正文下载停滞超时')),
              this.options.bodyIdleTimeoutMs ?? 30_000)
            let next: ReadableStreamReadResult<Uint8Array>
            const pendingRead = reader.read()
            try { next = await withAbort(pendingRead, requestSignal) }
            catch (error) {
              if (idleController.signal.aborted && !signal?.aborted) throw idleController.signal.reason
              throw error
            } finally { clearTimeout(timer) }
            if (next.done) break
            const part = next.value
            responseBytes += part.byteLength; current += part.byteLength
            if (current > maxBytes || (totalBytes !== undefined && current > totalBytes)) throw new DeliveryError('delivery/too-large', '制品正文超过声明或配置的体积上限')
            const writePosition = append ? startBytes + responseBytes - part.byteLength : current - part.byteLength
            await this.writeChunk(file, part, writePosition)
            if (current - lastCheckpoint >= 64 * 1024 || expectedResponseBytes === responseBytes) {
              this.savePart(location, nextMetadata(current)); lastCheckpoint = current
            }
            await progress(current, totalBytes, resumed)
          }
          if (expectedResponseBytes !== undefined && responseBytes !== expectedResponseBytes) throw new DeliveryError('delivery/length-mismatch', '实际下载长度与服务器声明不一致')
          if (totalBytes !== undefined && current < totalBytes) {
            // Some range servers return a valid shorter 206 span. Continue with the next
            // validated range from this exact checkpoint; never treat it as a full file.
            await file.sync()
            this.savePart(location, nextMetadata(current))
            metadata = nextMetadata(current)
            continue
          }
          if (totalBytes !== undefined && current !== totalBytes) throw new DeliveryError('delivery/length-mismatch', '下载完成长度与制品总长度不一致')
          if (source.size !== undefined && current !== source.size) throw new DeliveryError('delivery/source-size-mismatch', '实际下载大小与冻结来源不符')
          await file.sync(); this.savePart(location, nextMetadata(current))
          return { path: location.file, size: current }
        } finally {
          void reader.cancel().catch(() => undefined)
        }
      } catch (error) {
        try {
          await file.sync()
          const savedBytes = statSync(location.file).size
          if (savedBytes <= maxBytes && (totalBytes === undefined || savedBytes <= totalBytes)) this.savePart(location, nextMetadata(savedBytes))
        } catch { /* disk failure: keep the last metadata checkpoint */ }
        throw error
      } finally { await file.close() }
    }
  }
  async download(delivery: CatalogDelivery, options: DownloadArtifactOptions): Promise<AcquiredArtifact> {
    options.signal?.throwIfAborted()
    const frozen = structuredClone(delivery)
    const expectedDigest = normalizeDigest(frozen.artifactDigest)
    const shared = this.inFlightDownloads.get(expectedDigest)
    if (shared) {
      let acquired: AcquiredArtifact
      try { acquired = await withAbort(shared, options.signal) }
      catch (error) {
        if (options.signal?.aborted) throw abortError(options.signal)
        // Another consumer may have cancelled the shared transport. Resume or retry
        // independently for this still-active consumer rather than inheriting cancel.
        if (error instanceof DOMException && error.name === 'AbortError') return this.download(frozen, options)
        throw error
      }
      const verified = await verifyTgzFile(acquired.localPath, {
        artifactDigest: expectedDigest, packageName: frozen.packageName, version: frozen.version,
        ...(options.requireBundle === undefined ? {} : { requireBundle: options.requireBundle }),
      }, { ...(options.tgzLimits ?? {}), signal: options.signal })
      options.signal?.throwIfAborted()
      this.retain(expectedDigest, { id: options.referenceId, kind: options.referenceKind })
      const accepted = acquired.attempts.find(item => item.status === 'accepted')
      const sourceIndex = accepted ? [...frozen.sources].sort((a, b) => a.priority - b.priority).findIndex(item =>
        item.kind === accepted.source.kind && item.ref === accepted.source.ref) : -1
      try {
        await options.onProgress?.({
          stage: 'completed', pluginId: frozen.pluginId, packageName: frozen.packageName, version: frozen.version,
          artifactDigest: expectedDigest, sourceIndex: Math.max(0, sourceIndex), sourceCount: frozen.sources.length,
          sourceKind: accepted?.source.kind ?? 'cache', attempt: 0, receivedBytes: verified.size, totalBytes: verified.size, resumed: true,
        })
      } catch { /* One consumer's progress sink cannot fail another consumer's verified download. */ }
      return { ...acquired, verified, attempts: [] }
    }
    const operation = this.downloadExclusive(frozen, options)
    this.inFlightDownloads.set(expectedDigest, operation)
    try { return await operation }
    finally { if (this.inFlightDownloads.get(expectedDigest) === operation) this.inFlightDownloads.delete(expectedDigest) }
  }

  private async downloadExclusive(delivery: CatalogDelivery, options: DownloadArtifactOptions): Promise<AcquiredArtifact> {
    options.signal?.throwIfAborted()
    delivery = structuredClone(delivery)
    const expectedDigest = normalizeDigest(delivery.artifactDigest), target = this.pathFor(expectedDigest)
    mkdirSync(join(this.root, 'sha256'), { recursive: true })
    const limits = options.tgzLimits ?? {}
    const verify = (path: string): Promise<VerifiedTgz> => verifyTgzFile(path, {
      artifactDigest: expectedDigest, packageName: delivery.packageName, version: delivery.version,
      ...(options.requireBundle === undefined ? {} : { requireBundle: options.requireBundle }),
    }, { ...limits, signal: options.signal })
    const throttle = { lastAt: 0 }
    const progress = (stage: ArtifactDownloadStage, sourceIndex: number, sourceKind: DeliverySource['kind'], attempt: number,
      receivedBytes: number, totalBytes: number | undefined, resumed: boolean): ArtifactDownloadProgress => ({
      stage, pluginId: delivery.pluginId, packageName: delivery.packageName, version: delivery.version,
      artifactDigest: expectedDigest, sourceIndex, sourceCount: delivery.sources.length, sourceKind, attempt,
      receivedBytes, ...(totalBytes === undefined ? {} : { totalBytes }), resumed,
    })
    const report = (stage: ArtifactDownloadStage, sourceIndex = 0, sourceKind: DeliverySource['kind'] = 'cache',
      attempt = 0, receivedBytes = 0, totalBytes?: number, resumed = false, force = true) =>
      this.report(options, progress(stage, sourceIndex, sourceKind, attempt, receivedBytes, totalBytes, resumed), force, throttle)

    if (existsSync(target)) {
      try {
        const verified = await verify(target)
        options.signal?.throwIfAborted()
        // Content address + full tgz identity are stronger than stale size claims from other mirrors.
        this.retain(expectedDigest, { id: options.referenceId, kind: options.referenceKind })
        await report('completed')
        return { verified, localPath: target, attempts: [] }
      } catch {
        options.signal?.throwIfAborted()
        const references = this.readReferences().references[expectedDigest] ?? []
        if (references.length > 0) throw new DeliveryError('delivery/referenced-cache-corrupt', '缓存已被引用但校验失败，禁止覆盖或删除')
        removeIfExists(target)
      }
    }

    const attempts: DeliveryAttempt[] = []
    const sources = [...delivery.sources].sort((left, right) => left.priority - right.priority)
    const allowedRoots = this.allowedLocalRoots(options.allowLocalFileSources)
    const maxBytes = this.options.maxCompressedBytes ?? 200 * 1024 * 1024
    const totalBudget = this.options.maxDownloadTotalMs ?? this.options.maxDownloadTimeoutMs ?? 2 * 60 * 60 * 1000
    const totalDeadline = Date.now() + totalBudget
    const retries = Math.max(0, Math.min(5, this.options.maxRetries ?? 2))

    try {
      for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
        const source = sources[sourceIndex]!
        options.signal?.throwIfAborted()
        const sourceDeadline = Math.min(totalDeadline, Date.now() + this.calculatedSourceBudget(source.size, maxBytes))
        try {
          if (source.kind === 'local-file') {
            if (allowedRoots.length === 0) throw new DeliveryError('delivery/unsafe-local-source', '未显式允许 local-file 来源')
            const bytes = this.localFileBytes(source, allowedRoots, maxBytes)
            if (source.size !== undefined && source.size !== bytes.byteLength) {
              attempts.push({ source, status: 'identity-mismatch', reason: '本地文件大小与冻结来源不符' }); continue
            }
            if (digestOf(bytes) !== expectedDigest) {
              attempts.push({ source, status: 'digest-mismatch', reason: '本地文件摘要与冻结制品不符' }); continue
            }
            const temporary = join(this.root, 'tmp', `${expectedDigest.slice(7)}.${randomUUID()}.tgz`)
            writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 })
            let verified: VerifiedTgz
            try { verified = await verify(temporary) } catch (error) { removeIfExists(temporary); throw error }
            options.signal?.throwIfAborted()
            renameSync(temporary, target)
            this.retain(expectedDigest, { id: options.referenceId, kind: options.referenceKind })
            attempts.push({ source, status: 'accepted' })
            await report('completed', sourceIndex, source.kind)
            return { verified: { ...verified, path: target }, localPath: target, attempts }
          }
          if (source.kind === 'cache') {
            if (source.ref !== expectedDigest) throw new DeliveryError('delivery/unsafe-cache-source', 'cache 来源只接受目标摘要')
            if (!existsSync(target)) throw new DeliveryError('delivery/cache-source-missing', '目标摘要缓存不存在')
            const verified = await verify(target)
            this.retain(expectedDigest, { id: options.referenceId, kind: options.referenceKind })
            attempts.push({ source, status: 'accepted' })
            await report('completed', sourceIndex, source.kind)
            return { verified, localPath: target, attempts }
          }

          const location = this.partLocation(expectedDigest, source)
          let remote: { path: string; size: number } | undefined
          let lastError: unknown
          for (let retry = 0; retry <= retries; retry += 1) {
            options.signal?.throwIfAborted()
            if (Date.now() >= sourceDeadline || Date.now() >= totalDeadline) {
              lastError = new DeliverySecurityError('delivery/total-timeout', '已达到本次制品下载的时间预算')
              break
            }
            await report('connecting', sourceIndex, source.kind, retry + 1)
            try {
              remote = await this.downloadRemoteToPart(source, expectedDigest, maxBytes, options.signal,
                Math.min(sourceDeadline, totalDeadline), (receivedBytes, totalBytes, resumed) =>
                  this.report(options, progress('downloading', sourceIndex, source.kind, retry + 1, receivedBytes, totalBytes, resumed), false, throttle))
              lastError = undefined
              break
            } catch (error) {
              if (options.signal?.aborted) throw abortError(options.signal)
              lastError = error
              if (!retryable(error) || retry >= retries || Date.now() >= sourceDeadline || Date.now() >= totalDeadline) break
              const backoff = Math.min(this.options.retryMaxDelayMs ?? 3_000, (this.options.retryBaseDelayMs ?? 250) * (2 ** retry))
              const wait = Math.min(sourceDeadline - Date.now(), totalDeadline - Date.now(), retryAfter(error) ?? backoff)
              const partMetadata = this.readPart(location, expectedDigest, maxBytes, source.size)
              await report('retrying', sourceIndex, source.kind, retry + 1, partMetadata?.receivedBytes ?? 0,
                partMetadata?.totalBytes ?? source.size, Boolean(partMetadata?.receivedBytes))
              await delay(Math.max(0, wait), options.signal)
            }
          }
          if (lastError !== undefined || remote === undefined) {
            const unsafe = lastError instanceof DeliverySecurityError &&
              !['delivery/http-failed', 'delivery/dns-failed', 'delivery/headers-timeout', 'delivery/total-timeout', 'delivery/body-idle-timeout'].includes(lastError.code) ||
              lastError instanceof DeliveryError && lastError.code.includes('unsafe')
            attempts.push({ source, status: unsafe ? 'unsafe' : 'network-failed', reason: safeReason(lastError) })
            continue
          }
          await report('verifying', sourceIndex, source.kind, retries + 1, remote.size, source.size ?? remote.size)
          let verified: VerifiedTgz
          try { verified = await verify(remote.path) }
          catch (error) {
            this.clearPart(location)
            const digestMismatch = error instanceof TgzVerificationError && error.code === 'tgz/digest-mismatch'
            attempts.push({ source, status: digestMismatch ? 'digest-mismatch' : 'identity-mismatch', reason: safeReason(error) })
            continue
          }
          options.signal?.throwIfAborted()
          renameSync(remote.path, target)
          removeIfExists(location.metadata)
          this.retain(expectedDigest, { id: options.referenceId, kind: options.referenceKind })
          attempts.push({ source, status: 'accepted' })
          await report('completed', sourceIndex, source.kind, retries + 1, remote.size, remote.size)
          return { verified: { ...verified, path: target }, localPath: target, attempts }
        } catch (error) {
          if (options.signal?.aborted) throw abortError(options.signal)
          const unsafe = error instanceof DeliverySecurityError &&
            !['delivery/http-failed', 'delivery/dns-failed', 'delivery/headers-timeout', 'delivery/total-timeout', 'delivery/body-idle-timeout'].includes(error.code) ||
            error instanceof DeliveryError && error.code.includes('unsafe')
          attempts.push({ source, status: unsafe ? 'unsafe' : 'network-failed', reason: safeReason(error) })
        }
      }
    } catch (error) {
      await report(options.signal?.aborted ? 'cancelled' : 'failed')
      throw error
    }
    await report('failed')
    throw new DeliveryError('delivery/unavailable', '所有候选来源均未得到同摘要且身份正确的已验证制品', attempts)
  }
}

/** Host-only result转UI时只交摘要/大小/来源，不交本机绝对路径。 */
export function publicArtifactView(artifact: AcquiredArtifact): Omit<VerifiedTgz, 'path' | 'packageJson' | 'files'> {
  const { path: _path, packageJson: _packageJson, files: _files, ...publicView } = artifact.verified
  return publicView
}
