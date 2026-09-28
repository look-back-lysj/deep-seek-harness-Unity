/**
 * 目录的原子刷新与离线兜底。
 *
 * 新目录先完整写到独立 revision 文件，最后才切换 current 指针；
 * 因此下载/校验/写盘任一步失败都不会破坏上一份有效目录，也不会触发任何安装。
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
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
import { applyKnownLifecycle, commitAcceptance, latestAcceptance, mergeAcceptanceFloor, prepareAcceptance, type CatalogAcceptance } from './lifecycle.ts'
import type { MarketCollection } from './model.ts'
import { collectionPlanInput, collectionView, type CollectionPlanInput, type CatalogCollectionView } from './collections.ts'

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
  readonly source?: Pick<CatalogSourceIdentity, 'id' | 'indexUrl' | 'catalogId'>
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
  const temporary = `${path}.${randomUUID()}.tmp`
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
  private readonly embeddedDocument: unknown
  private readonly embeddedBytes: Uint8Array
  private readonly hasEmbeddedRaw: boolean
  private readonly cacheDir: string
  private readonly limits: CatalogLimitOptions
  private cached: CatalogLoadResult | undefined
  private cachedValidation: ValidatedCatalog | undefined
  private acceptance: CatalogAcceptance | undefined
  private pending: Promise<unknown> = Promise.resolve()
  private projectionDocument: unknown
  private acceptanceFailure: string | undefined

  constructor(embeddedDocument: unknown, cacheDir: string, limits: CatalogLimitOptions = {}, embeddedRaw?: Uint8Array) {
    this.embedded = validateMarketIndex(embeddedDocument, { ...limits, origin: 'embedded' })
    this.embeddedDocument = structuredClone(embeddedDocument)
    this.hasEmbeddedRaw = embeddedRaw !== undefined
    this.embeddedBytes = embeddedRaw === undefined ? bytesOf(JSON.stringify(embeddedDocument)) : new Uint8Array(embeddedRaw)
    if (embeddedRaw !== undefined && !isDeepStrictEqual(safeJsonParse(this.embeddedBytes, 'embedded catalog'), this.embeddedDocument)) throw new CatalogValidationError('catalog/embedded-bytes-mismatch', '随包原始字节与已解析目录不一致')
    this.cachedValidation = this.embedded
    this.cacheDir = cacheDir
    this.limits = limits
    this.projectionDocument = structuredClone(embeddedDocument)
    mkdirSync(join(cacheDir, 'revisions'), { recursive: true })
  }

  /** Shared by browsing, refresh admission and the final install guard. Read
   * disk first: corrupt history must never be treated as an empty cache. */
  private readAcceptance(): CatalogAcceptance | undefined {
    const known = latestAcceptance(this.cacheDir)
    if (!this.embedded.publication) return known
    const revisionPath = join(this.cacheDir, 'revisions', `${createHash('sha256').update(this.embedded.snapshot.revision).digest('hex')}.json`)
    let bytes = this.embeddedBytes
    // Legacy callers supplied only a parsed object. Reuse matching persisted
    // bytes when available rather than inventing a conflicting whitespace hash.
    if (!this.hasEmbeddedRaw && existsSync(revisionPath)) {
      const saved = readFileSync(revisionPath)
      if (isDeepStrictEqual(safeJsonParse(saved, 'embedded revision'), this.embeddedDocument)) bytes = saved
    }
    const floor = prepareAcceptance(this.embedded, digestBytes(bytes))
    const effective = mergeAcceptanceFloor(floor, known)
    if (!known || floor.publication.sequence > known.publication.sequence) {
      if (existsSync(revisionPath)) {
        if (digestBytes(readFileSync(revisionPath)) !== floor.digest) throw new CatalogValidationError('catalog/revision-mutated', '随包目录 revision 与已有字节不一致')
      } else atomicWrite(revisionPath, bytes)
      commitAcceptance(this.cacheDir, effective)
    }
    return effective
  }

  load(): CatalogLoadResult {
    try { this.acceptance = this.readAcceptance(); this.acceptanceFailure = undefined }
    catch (error) { this.acceptanceFailure = error instanceof Error ? error.message : '目录接受历史损坏' }
    if (this.cached) {
      // Reproject facts without changing source bytes; history failures block
      // installation even if this instance had already cached a good snapshot.
      const projection = this.cached.snapshot.schemaVersion === '2'
        ? validateMarketIndex(this.projectionDocument, { ...this.limits, origin: this.cached.snapshot.origin })
        : this.cachedValidation ?? this.embedded
      const snapshot = applyKnownLifecycle(projection.snapshot, this.acceptance)
      this.cached = { ...this.cached, ...(this.acceptanceFailure ? { reason: this.acceptanceFailure } : {}), snapshot: { ...snapshot, ...(this.acceptanceFailure ? { plugins: snapshot.plugins.map(plugin => ({ ...plugin, installability: 'hard-blocked' as const })), recommendations: [] } : {}), stale: this.cached.snapshot.stale || this.acceptanceFailure !== undefined } }
      return structuredClone(this.cached)
    }
    const acceptanceFailure = this.acceptanceFailure
    const candidates = this.acceptance ? ['accepted', 'current.json', 'previous.json'] : ['current.json', 'previous.json']
    for (const pointerName of candidates) {
      try {
        const pointer = pointerName === 'accepted' ? this.acceptance : readPointer(join(this.cacheDir, pointerName))
        if (!pointer) continue
        const revisionPath = join(this.cacheDir, 'revisions', `${createHash('sha256').update(pointer.revision).digest('hex')}.json`)
        const bytes = readFileSync(revisionPath)
        if (digestBytes(bytes) !== pointer.digest) {
          throw new CatalogValidationError('catalog/cache-digest-mismatch', '缓存目录摘要不符')
        }
        if (bytes.byteLength > (this.limits.maxDocumentBytes ?? DEFAULT_CATALOG_LIMITS.maxDocumentBytes)) {
          throw new CatalogValidationError('catalog/document-too-large', '缓存目录超过限制')
        }
        const document = safeJsonParse(bytes, revisionPath)
        const validated = validateMarketIndex(document, { ...this.limits, origin: 'cache' })
        if (this.embedded.publication && (!validated.publication || validated.publication.sourceId !== this.embedded.publication.sourceId || validated.publication.sequence < this.embedded.publication.sequence)) continue
        if (validated.snapshot.revision !== pointer.revision) {
          throw new CatalogValidationError('catalog/cache-revision-mismatch', '缓存 revision 与指针不符')
        }
        this.cachedValidation = validated
        this.projectionDocument = document
        const snapshot = applyKnownLifecycle(validated.snapshot, this.acceptance)
        this.cached = {
          snapshot: { ...snapshot, ...(acceptanceFailure ? { plugins: snapshot.plugins.map(plugin => ({ ...plugin, installability: 'hard-blocked' as const })), recommendations: [] } : {}), stale: pointerName === 'previous.json' || this.acceptance !== undefined || acceptanceFailure !== undefined },
          source: 'cache',
          cacheUsable: true,
          ...(acceptanceFailure ? { reason: acceptanceFailure } : {}),
        }
        return structuredClone(this.cached)
      } catch {
        // 继续尝试上一份有效缓存；绝不把损坏缓存当空目录。
      }
    }
    this.cachedValidation = this.embedded
    this.projectionDocument = this.embeddedDocument
    const snapshot = applyKnownLifecycle(this.embedded.snapshot, this.acceptance)
    this.cached = { snapshot: acceptanceFailure ? { ...snapshot, stale: true, plugins: snapshot.plugins.map(plugin => ({ ...plugin, installability: 'hard-blocked' as const })), recommendations: [] } : snapshot, source: 'embedded', cacheUsable: false, reason: acceptanceFailure ?? 'cache-unusable' }
    return structuredClone(this.cached)
  }

  async refresh(reader: CatalogSourceReader, options: CatalogRefreshOptions = {}): Promise<CatalogRefreshResult> {
    const operation = this.pending.then(() => this.refreshSerial(reader, options))
    this.pending = operation.catch(() => undefined)
    return operation
  }

  private async refreshSerial(reader: CatalogSourceReader, options: CatalogRefreshOptions): Promise<CatalogRefreshResult> {
    this.load()
    try {
      const raw = bytesOf(await reader())
      const limits = { ...DEFAULT_CATALOG_LIMITS, ...this.limits }
      if (raw.byteLength > limits.maxDocumentBytes) {
        throw new CatalogValidationError('catalog/document-too-large', `在线目录超过 ${limits.maxDocumentBytes} 字节`)
      }
      const parsed = safeJsonParse(raw, 'online catalog')
      const validated = validateMarketIndex(parsed, { ...this.limits, origin: 'online' })
      const digest = digestBytes(raw)
      const known = this.readAcceptance()
      if (known && !validated.publication) throw new CatalogValidationError('catalog/schema-downgrade', '已接受 v2 目录，拒绝不带撤回序号的旧镜像')
      if (validated.publication && options.source && validated.publication.sourceId !== (options.source.catalogId ?? options.source.id)) throw new CatalogValidationError('catalog/source-identity-mismatch', '目录发布身份与登记来源不符')
      const acceptance = validated.publication ? prepareAcceptance(validated, digest, known) : undefined
      const revisionPath = join(this.cacheDir, 'revisions', `${createHash('sha256').update(validated.snapshot.revision).digest('hex')}.json`)
      if (existsSync(revisionPath)) {
        if (digestBytes(readFileSync(revisionPath)) !== digest) throw new CatalogValidationError('catalog/revision-mutated', '同一目录 revision 不允许改变字节')
      } else atomicWrite(revisionPath, raw)
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
      if (acceptance) commitAcceptance(this.cacheDir, acceptance)
      // v2 以不可覆盖的接受记录为提交点，快捷指针故障不会谎称已提交目录未提交。
      let pointerWarning: string | undefined
      try { atomicWrite(currentPath, new TextEncoder().encode(JSON.stringify(pointer))) } catch (error) {
        if (!acceptance) throw error
        pointerWarning = '目录已提交；快捷指针写入失败，下次从接受记录恢复'
      }
      const next: CatalogLoadResult = {
        snapshot: { ...applyKnownLifecycle(validated.snapshot, acceptance), origin: 'online', stale: false },
        source: 'cache',
        cacheUsable: true,
      }
      this.cachedValidation = validated
      this.projectionDocument = parsed
      this.acceptance = acceptance
      this.acceptanceFailure = undefined
      this.cached = next
      return { status: 'refreshed', current: structuredClone(next), ...(pointerWarning ? { reason: pointerWarning } : {}), ...(options.source === undefined ? {} : { source: options.source }) }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown catalog refresh error'
      const sourceReason = options.source === undefined ? reason : `目录来源 ${options.source.id} 刷新失败：${reason}；继续使用上一份有效快照`
      const safePrevious = this.load()
      this.cached = { ...safePrevious, snapshot: { ...safePrevious.snapshot, stale: true }, reason: sourceReason }
      return {
        status: 'failed',
        current: structuredClone(this.cached),
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
      this.cached = { ...previous, snapshot: { ...previous.snapshot, stale: true }, reason }
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

  /** 私有组合不投影成公共 Pack；主控用同一核心规划器处理 selections 和完整依赖。 */
  collections(): readonly MarketCollection[] {
    this.load()
    return structuredClone(this.cachedValidation?.collections ?? [])
  }

  collection(id: string, version: string): MarketCollection | undefined {
    return this.collections().find(item => item.id === id && item.version === version)
  }

  collectionViews(): readonly CatalogCollectionView[] {
    return this.collections().map(collectionView)
  }

  /** 这是市场私有执行输入，documentBytes 不能解释为公共 Lock。
   * selectedPluginIds 可省略为整套；显式子集允许用户去掉可选项，但不能省略必选项。
   * 单项不兼容/缺安装声明继续交核心生成逐项 blocker，不把整个混合组合谎报成功。
   */
  collectionForPlan(id: string, version: string, selectedPluginIds?: readonly string[]): CollectionPlanInput {
    const collection = this.collection(id, version)
    if (!collection) throw new CatalogValidationError('catalog/collection-not-found', '私有组合不存在或版本已变化')
    if (collection.execution.coverage !== 'complete') throw new CatalogValidationError('catalog/collection-incomplete', '私有组合执行关系尚不完整，不能规划安装')
    const selected = new Set(selectedPluginIds ?? collection.components.map(item => item.pluginId))
    if (selectedPluginIds && selected.size !== selectedPluginIds.length) throw new CatalogValidationError('catalog/collection-selection', '私有组合选择重复')
    if ([...selected].some(id => !collection.components.some(item => item.pluginId === id)) || collection.components.some(item => item.required && !selected.has(item.pluginId))) throw new CatalogValidationError('catalog/collection-selection', '私有组合包含未知选择或缺少必选组件')
    const snapshot = this.load().snapshot
    for (const component of collection.components) {
      const plugin = snapshot.plugins.find(item => item.id === component.pluginId && item.version === component.version)
      if (!plugin || plugin.artifactDigest !== component.artifactDigest) throw new CatalogValidationError('catalog/collection-stale', '私有组合组件版本或摘要已变化')
      if (selected.has(component.pluginId)) this.assertReleaseActive(component.pluginId, component.version, component.artifactDigest)
    }
    for (const edge of collection.execution.edges) {
      if (selected.has(edge.consumerId) && !selected.has(edge.prerequisiteId)) throw new CatalogValidationError('catalog/collection-dependency', '选中组件缺少必需前置项')
    }
    return collectionPlanInput(collection)
  }

  assertReleaseActive(pluginId: string, version: string, artifactDigest: string): void {
    this.load()
    if (this.acceptanceFailure) throw new CatalogValidationError('catalog/acceptance-unavailable', this.acceptanceFailure)
    const latest = this.acceptance
    const release = Object.values(latest?.releases ?? {}).find(item => item.record.pluginId === pluginId && item.record.version === version && item.record.artifactDigest === artifactDigest)?.record
    const localRelease = this.cachedValidation?.releases.find(item => item.pluginId === pluginId && item.version === version && item.artifactDigest === artifactDigest)
    const localStatus = this.cachedValidation?.releaseStatuses.filter(item => item.releaseId === localRelease?.releaseId).sort((a, b) => b.sequence - a.sequence)[0]
    const status = release ? latest?.statuses[release.releaseId] : localStatus
    if (status?.status === 'withdrawn') throw new CatalogValidationError('catalog/release-withdrawn', '已确认发行被撤回，请重新生成方案')
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
