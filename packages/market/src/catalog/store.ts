/**
 * 目录的原子刷新与离线兜底。
 *
 * 新目录先完整写到独立 revision 文件，最后才切换 current 指针；
 * 因此下载/校验/写盘任一步失败都不会破坏上一份有效目录，也不会触发任何安装。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CatalogSnapshot } from '../contracts/types.ts'
import {
  CatalogValidationError,
  DEFAULT_CATALOG_LIMITS,
  MARKET_INDEX_SCHEMA_VERSION,
  type CatalogLimitOptions,
  type MarketIndexDocument,
  type ValidatedCatalog,
} from './model.ts'
import { validateMarketIndex } from './validate.ts'
import type { CatalogSourceConnection, CatalogSourceIdentity } from './source.ts'

export type CatalogSourceReader = () => Promise<Uint8Array | string>

export interface CatalogLoadResult {
  readonly snapshot: CatalogSnapshot
  readonly source: 'embedded' | 'cache'
  readonly cacheUsable: boolean
  readonly reason?: string
}

export interface CatalogRefreshResult {
  readonly status: 'refreshed' | 'failed'
  readonly current: CatalogLoadResult
  readonly reason?: string
  readonly source?: Pick<CatalogSourceIdentity, 'id' | 'indexUrl'>
}

export interface CatalogRefreshOptions {
  readonly source?: Pick<CatalogSourceIdentity, 'id' | 'indexUrl'>
}

export interface CatalogSourceRefreshInput {
  readonly source: Pick<CatalogSourceIdentity, 'id' | 'indexUrl'>
  readonly read: () => Promise<Uint8Array | string>
}

interface Pointer {
  readonly schemaVersion: '1'
  readonly revision: string
  readonly digest: string
  readonly storedAt: string
}

const MAX_POINTER_BYTES = 16 * 1024

function bytesOf(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function safeJsonParse(bytes: Uint8Array, field: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    throw new CatalogValidationError('catalog/invalid-json', `${field} 不是合法 JSON`)
  }
}

function atomicWrite(path: string, bytes: Uint8Array): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, bytes, { flag: 'wx' })
  try {
    renameSync(temporary, path)
  } catch (error) {
    try {
      if (existsSync(temporary)) writeFileSync(`${path}.failed-${Date.now()}`, bytes)
    } catch {
      // 备份失败不能覆盖原始错误；上一份 current 仍未切换。
    }
    throw error
  }
}

function readPointer(path: string): Pointer | undefined {
  if (!existsSync(path)) return undefined
  const raw = readFileSync(path)
  if (raw.byteLength > MAX_POINTER_BYTES) throw new CatalogValidationError('catalog/invalid-pointer', '目录指针文件过大')
  const value = safeJsonParse(raw, path)
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as Pointer).schemaVersion !== '1' ||
    typeof (value as Pointer).revision !== 'string' ||
    typeof (value as Pointer).digest !== 'string' ||
    typeof (value as Pointer).storedAt !== 'string'
  ) {
    throw new CatalogValidationError('catalog/invalid-pointer', '目录指针结构无效')
  }
  return value as Pointer
}

export class CatalogRepository {
  private readonly embedded: ValidatedCatalog
  private readonly cacheDir: string
  private readonly limits: CatalogLimitOptions
  private cached: CatalogLoadResult | undefined
  private cachedValidation: ValidatedCatalog | undefined

  constructor(embeddedDocument: unknown, cacheDir: string, limits: CatalogLimitOptions = {}) {
    this.embedded = validateMarketIndex(embeddedDocument, { ...limits, origin: 'embedded' })
    this.cachedValidation = this.embedded
    this.cacheDir = cacheDir
    this.limits = limits
    mkdirSync(join(cacheDir, 'revisions'), { recursive: true })
  }

  load(): CatalogLoadResult {
    if (this.cached) return this.cached
    for (const pointerName of ['current.json', 'previous.json']) {
      try {
        const pointer = readPointer(join(this.cacheDir, pointerName))
        if (!pointer) continue
        const revisionPath = join(this.cacheDir, 'revisions', `${createHash('sha256').update(pointer.revision).digest('hex')}.json`)
        const bytes = readFileSync(revisionPath)
        if (digestBytes(bytes) !== pointer.digest) {
          throw new CatalogValidationError('catalog/cache-digest-mismatch', '缓存目录摘要不符')
        }
        if (bytes.byteLength > DEFAULT_CATALOG_LIMITS.maxDocumentBytes) {
          throw new CatalogValidationError('catalog/document-too-large', '缓存目录超过限制')
        }
        const validated = validateMarketIndex(safeJsonParse(bytes, revisionPath), { ...this.limits, origin: 'cache' })
        if (validated.snapshot.revision !== pointer.revision) {
          throw new CatalogValidationError('catalog/cache-revision-mismatch', '缓存 revision 与指针不符')
        }
        this.cachedValidation = validated
        this.cached = {
          snapshot: { ...validated.snapshot, stale: pointerName === 'previous.json' },
          source: 'cache',
          cacheUsable: true,
        }
        return this.cached
      } catch {
        // 继续尝试上一份有效缓存；绝不把损坏缓存当空目录。
      }
    }
    this.cachedValidation = this.embedded
    this.cached = { snapshot: this.embedded.snapshot, source: 'embedded', cacheUsable: false, reason: 'cache-unusable' }
    return this.cached
  }

  async refresh(reader: CatalogSourceReader, options: CatalogRefreshOptions = {}): Promise<CatalogRefreshResult> {
    const previous = this.load()
    try {
      const raw = bytesOf(await reader())
      const limits = { ...DEFAULT_CATALOG_LIMITS, ...this.limits }
      if (raw.byteLength > limits.maxDocumentBytes) {
        throw new CatalogValidationError('catalog/document-too-large', `在线目录超过 ${limits.maxDocumentBytes} 字节`)
      }
      const parsed = safeJsonParse(raw, 'online catalog')
      const validated = validateMarketIndex(parsed, { ...this.limits, origin: 'online' })
      const digest = digestBytes(raw)
      const revisionPath = join(this.cacheDir, 'revisions', `${createHash('sha256').update(validated.snapshot.revision).digest('hex')}.json`)
      atomicWrite(revisionPath, raw)
      const currentPath = join(this.cacheDir, 'current.json')
      if (existsSync(currentPath)) {
        atomicWrite(join(this.cacheDir, 'previous.json'), readFileSync(currentPath))
      }
      const pointer: Pointer = {
        schemaVersion: '1',
        revision: validated.snapshot.revision,
        digest,
        storedAt: new Date().toISOString(),
      }
      atomicWrite(currentPath, new TextEncoder().encode(JSON.stringify(pointer)))
      const next: CatalogLoadResult = {
        snapshot: { ...validated.snapshot, origin: 'online', stale: false },
        source: 'cache',
        cacheUsable: true,
      }
      this.cachedValidation = validated
      this.cached = next
      return { status: 'refreshed', current: next, ...(options.source === undefined ? {} : { source: options.source }) }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown catalog refresh error'
      const sourceReason = options.source === undefined ? reason : `目录来源 ${options.source.id} 刷新失败：${reason}；继续使用上一份有效快照`
      return {
        status: 'failed',
        current: { ...previous, snapshot: { ...previous.snapshot, stale: true }, reason: sourceReason },
        reason: sourceReason,
        ...(options.source === undefined ? {} : { source: options.source }),
      }
    }
  }

  /** 使用维护者登记的来源连接刷新；读取、校验、写盘失败都只回到同一旧快照/Lock。 */
  async refreshWithSource(connection: CatalogSourceConnection | CatalogSourceRefreshInput): Promise<CatalogRefreshResult> {
    const source = connection.source
    try {
      const readResult = 'readResult' in connection ? connection.readResult : undefined
      const result = readResult === undefined
        ? { bytes: await connection.read(), source }
        : await readResult()
      return await this.refresh(async () => result.bytes, { source: result.source })
    } catch (error) {
      const previous = this.load()
      const reason = `目录来源 ${source.id} 不可用：${error instanceof Error ? error.message : 'unknown source error'}；继续使用上一份有效快照`
      return {
        status: 'failed',
        current: { ...previous, snapshot: { ...previous.snapshot, stale: true }, reason },
        reason,
        source,
      }
    }
  }

  /** 更新目录只改变浏览快照；安装层必须继续持有旧 planDigest，不能被新目录静默替换。 */
  snapshotForInstall(): CatalogSnapshot {
    return this.load().snapshot
  }

  /** Exact Lock bytes for one catalog Pack; callers must not mutate the result. */
  lockBytes(packId: string, packVersion: string): Uint8Array | undefined {
    this.load()
    const bytes = this.cachedValidation?.lockBytes.get(`${packId}@${packVersion}:lock`)
    return bytes === undefined ? undefined : new Uint8Array(bytes)
  }
}

export type { MarketIndexDocument }
export { MARKET_INDEX_SCHEMA_VERSION }
