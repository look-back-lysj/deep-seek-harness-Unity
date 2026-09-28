/**
 * 目录跨对象校验器。
 *
 * 重点是三层绑定：Manifest 原字节 → manifestDigest；Pack/Lock 原字节 → lockDigest；
 * PackExecution → 精确 Lock 摘要。任何一层断开都不能解释成“完整独立”或可安装。
 */
import { createHash } from 'node:crypto'
import type {
  CatalogDelivery,
  DeliverySource,
  CatalogMedia,
  CatalogPack,
  CatalogPlugin,
  CatalogPresentation,
  CatalogSnapshot,
  PackComponent,
  PackExecution,
  PackExecutionEdge,
} from '../contracts/types.ts'
import {
  CatalogValidationError,
  DEFAULT_CATALOG_LIMITS,
  MARKET_INDEX_SCHEMA_VERSION,
  type CatalogLimitOptions,
  type MarketPackRecord,
  type MarketPluginRecord,
  type RawDocumentRecord,
  type ValidatedCatalog,
} from './model.ts'
import {
  evidenceSupportsVerification,
  validatePublicEvidence,
  validatePublicManifest,
  validatePublicPack,
  validatePublicPackLock,
  type EvidenceSummary,
} from './public-format.ts'

const ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

function fail(code: string, message: string, details: readonly string[] = []): never {
  throw new CatalogValidationError(code, message, details)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > max) {
    fail('catalog/invalid-field', `${field} 必须是 1..${max} 字节的字符串`)
  }
  return value
}

function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, field, max)
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail('catalog/invalid-field', `${field} 必须是布尔值`)
  return value
}

function numberInt(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    fail('catalog/invalid-field', `${field} 必须是 ${min}..${max} 的整数`)
  }
  return value as number
}

function array(value: unknown, field: string, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) fail('catalog/invalid-field', `${field} 必须是最多 ${max} 项的数组`)
  return value
}

function parseDigest(value: unknown, field: string): string {
  const digest = requiredString(value, field, 71)
  if (!DIGEST_RE.test(digest)) fail('catalog/invalid-digest', `${field} 必须是 sha256:<64位小写十六进制>`)
  return digest
}

function parseId(value: unknown, field: string): string {
  const id = requiredString(value, field, 200)
  if (!ID_RE.test(id)) fail('catalog/invalid-id', `${field} 不是稳定 ID`)
  return id
}

function parseVersion(value: unknown, field: string): string {
  const version = requiredString(value, field, 100)
  if (!SEMVER_RE.test(version)) fail('catalog/invalid-version', `${field} 必须是精确 semver`)
  return version
}

function parseDate(value: unknown, field: string): string {
  const text = requiredString(value, field, 64)
  const at = Date.parse(text)
  if (!Number.isFinite(at)) fail('catalog/invalid-field', `${field} 不是可解析时间`)
  return new Date(at).toISOString()
}

function decodeRaw(value: unknown, field: string, maxBytes: number): { record: RawDocumentRecord; bytes: Uint8Array } {
  if (!isRecord(value)) fail('catalog/invalid-field', `${field} 必须是对象`)
  const contentBase64 = requiredString(value.contentBase64, `${field}.contentBase64`, Math.ceil(maxBytes / 3) * 4 + 4)
  if (!BASE64_RE.test(contentBase64) || contentBase64.length % 4 !== 0) {
    fail('catalog/invalid-base64', `${field}.contentBase64 不是规范 base64`)
  }
  const bytes = Buffer.from(contentBase64, 'base64')
  if (bytes.byteLength > maxBytes) fail('catalog/document-too-large', `${field} 超过 ${maxBytes} 字节`)
  const expected = parseDigest(value.sha256, `${field}.sha256`)
  const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  if (actual !== expected) fail('catalog/digest-mismatch', `${field} 的原字节摘要不符`, [`expected=${expected}`, `actual=${actual}`])
  return { record: { contentBase64, sha256: expected }, bytes }
}

function parseMedia(value: unknown, field: string, maxTextBytes: number): CatalogMedia {
  if (!isRecord(value)) fail('catalog/invalid-field', `${field} 必须是对象`)
  const width = value.width === undefined ? undefined : numberInt(value.width, `${field}.width`, 1, 32_768)
  const height = value.height === undefined ? undefined : numberInt(value.height, `${field}.height`, 1, 32_768)
  return {
    id: requiredString(value.id, `${field}.id`, 200),
    alt: requiredString(value.alt, `${field}.alt`, maxTextBytes),
    sourceUrl: requiredString(value.sourceUrl, `${field}.sourceUrl`, 4_096),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  }
}

function parsePlugin(value: unknown, field: string, maxTextBytes: number): MarketPluginRecord {
  if (!isRecord(value)) fail('catalog/invalid-field', `${field} 必须是对象`)
  const authorUrl = optionalString(value.authorUrl, `${field}.authorUrl`, 4_096)
  const sourceUrl = optionalString(value.sourceUrl, `${field}.sourceUrl`, 4_096)
  const license = optionalString(value.license, `${field}.license`, 200)
  const plugin: CatalogPlugin = {
    id: parseId(value.id, `${field}.id`),
    name: requiredString(value.name, `${field}.name`, 200),
    packageName: requiredString(value.packageName, `${field}.packageName`, 214),
    version: parseVersion(value.version, `${field}.version`),
    summary: requiredString(value.summary, `${field}.summary`, maxTextBytes),
    author: requiredString(value.author, `${field}.author`, 200),
    ...(authorUrl === undefined ? {} : { authorUrl }),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(license === undefined ? {} : { license }),
    distribution: parseDistribution(value.distribution, `${field}.distribution`),
    capabilityTier: requiredString(value.capabilityTier, `${field}.capabilityTier`, 100),
    verification: parseVerification(value.verification, `${field}.verification`),
    installability: parseInstallability(value.installability, `${field}.installability`),
    ...(value.artifactDigest === undefined ? {} : { artifactDigest: parseDigest(value.artifactDigest, `${field}.artifactDigest`) }),
    presentationId: requiredString(value.presentationId, `${field}.presentationId`, 200),
    categories: array(value.categories, `${field}.categories`, 32).map((item, index) => requiredString(item, `${field}.categories[${index}]`, 100)),
    screenshots: array(value.screenshots, `${field}.screenshots`, 32).map((item, index) => parseMedia(item, `${field}.screenshots[${index}]`, maxTextBytes)),
    enabledPolicy: parseEnabledPolicy(value.enabledPolicy, `${field}.enabledPolicy`),
    requiresRestart: bool(value.requiresRestart, `${field}.requiresRestart`),
    requiresSetup: bool(value.requiresSetup, `${field}.requiresSetup`),
    largeExternalResource: bool(value.largeExternalResource, `${field}.largeExternalResource`),
  }
  const manifestDigest = parseDigest(value.manifestDigest, `${field}.manifestDigest`)
  const manifest = decodeRaw(value.manifest, `${field}.manifest`, maxTextBytes)
  if (manifest.record.sha256 !== manifestDigest) {
    fail('catalog/manifest-digest-mismatch', `${field}.manifestDigest 与 Manifest 原字节不符`)
  }
  validatePublicManifest(manifest.bytes, plugin)
  const evidence = value.evidence === undefined ? [] : array(value.evidence, `${field}.evidence`, 32).map((item, index) => decodeRaw(item, `${field}.evidence[${index}]`, maxTextBytes))
  return { ...plugin, manifestDigest, manifest: manifest.record, ...(evidence.length === 0 ? {} : { evidence: evidence.map((item) => item.record) }) }
}

function parseDistribution(value: unknown, field: string): CatalogPlugin['distribution'] {
  const allowed = ['builtin', 'recommended', 'external', 'unclassified'] as const
  if (typeof value !== 'string' || !allowed.includes(value as never)) fail('catalog/invalid-field', `${field} 无效`)
  return value as CatalogPlugin['distribution']
}

function parseVerification(value: unknown, field: string): CatalogPlugin['verification'] {
  const allowed = ['verified', 'unverified', 'hard-incompatible', 'unknown'] as const
  if (typeof value !== 'string' || !allowed.includes(value as never)) fail('catalog/invalid-field', `${field} 无效`)
  return value as CatalogPlugin['verification']
}

function parseInstallability(value: unknown, field: string): CatalogPlugin['installability'] {
  const allowed = ['bundle-installable', 'missing-bundle', 'missing-artifact', 'hard-blocked', 'needs-repair'] as const
  if (typeof value !== 'string' || !allowed.includes(value as never)) fail('catalog/invalid-field', `${field} 无效`)
  return value as CatalogPlugin['installability']
}

function parseEnabledPolicy(value: unknown, field: string): CatalogPlugin['enabledPolicy'] {
  const allowed = ['default-on', 'default-off', 'requires-setup'] as const
  if (typeof value !== 'string' || !allowed.includes(value as never)) fail('catalog/invalid-field', `${field} 无效`)
  return value as CatalogPlugin['enabledPolicy']
}

function parseComponent(value: unknown, field: string): PackComponent {
  if (!isRecord(value)) fail('catalog/invalid-field', `${field} 必须是对象`)
  return {
    pluginId: parseId(value.pluginId, `${field}.pluginId`),
    version: parseVersion(value.version, `${field}.version`),
    required: bool(value.required, `${field}.required`),
  }
}

function parseExecution(value: unknown, field: string, maxTextBytes: number): PackExecution {
  if (!isRecord(value)) fail('catalog/invalid-field', `${field} 必须是对象`)
  const coverage = value.coverage
  if (coverage !== 'complete' && coverage !== 'partial' && coverage !== 'unknown') {
    fail('catalog/invalid-field', `${field}.coverage 无效`)
  }
  const rawEdges = array(value.edges, `${field}.edges`, 4_096)
  const edges: PackExecutionEdge[] = rawEdges.map((item, index) => {
    if (!isRecord(item)) fail('catalog/invalid-field', `${field}.edges[${index}] 必须是对象`)
    const milestone = item.milestone
    if (milestone !== 'installed' && milestone !== 'active') fail('catalog/invalid-field', `${field}.edges[${index}].milestone 无效`)
    return {
      prerequisiteId: parseId(item.prerequisiteId, `${field}.edges[${index}].prerequisiteId`),
      consumerId: parseId(item.consumerId, `${field}.edges[${index}].consumerId`),
      milestone,
    }
  })
  return {
    schemaVersion: requiredString(value.schemaVersion, `${field}.schemaVersion`, 20),
    packId: parseId(value.packId, `${field}.packId`),
    packVersion: parseVersion(value.packVersion, `${field}.packVersion`),
    lockDigest: parseDigest(value.lockDigest, `${field}.lockDigest`),
    coverage,
    edges,
    provenance: requiredString(value.provenance, `${field}.provenance`, maxTextBytes),
  }
}

function parsePack(value: unknown, field: string, maxTextBytes: number): MarketPackRecord {
  if (!isRecord(value)) fail('catalog/invalid-field', `${field} 必须是对象`)
  const category = value.category
  if (category !== 'function' && category !== 'appearance' && category !== 'workflow' && category !== 'unclassified') {
    fail('catalog/invalid-field', `${field}.category 无效`)
  }
  const pack: CatalogPack = {
    id: parseId(value.id, `${field}.id`),
    name: requiredString(value.name, `${field}.name`, 200),
    version: parseVersion(value.version, `${field}.version`),
    summary: requiredString(value.summary, `${field}.summary`, maxTextBytes),
    category,
    components: array(value.components, `${field}.components`, 64).map((item, index) => parseComponent(item, `${field}.components[${index}]`)),
    lockDigest: parseDigest(value.lockDigest, `${field}.lockDigest`),
    execution: parseExecution(value.execution, `${field}.execution`, maxTextBytes),
  }
  const packBytes = decodeRaw(value.pack, `${field}.pack`, 2 * 1024 * 1024)
  const packDigest = parseDigest(value.packDigest, `${field}.packDigest`)
  if (packBytes.record.sha256 !== packDigest) fail('catalog/pack-digest-mismatch', `${field}.packDigest 与 Pack 原字节不符`)
  validatePublicPack(packBytes.bytes, pack.id, pack.version, pack.components)
  const lock = decodeRaw(value.lock, `${field}.lock`, 2 * 1024 * 1024)
  return { ...pack, packDigest, pack: packBytes.record, lock: lock.record }
}

function parsePresentation(value: unknown, field: string, maxTextBytes: number): CatalogPresentation {
  if (!isRecord(value)) fail('catalog/invalid-field', `${field} 必须是对象`)
  const sourceCommit = optionalString(value.sourceCommit, `${field}.sourceCommit`, 64)
  const sourceUrl = optionalString(value.sourceUrl, `${field}.sourceUrl`, 4_096)
  const importedAt = optionalString(value.importedAt, `${field}.importedAt`, 64)
  return {
    id: requiredString(value.id, `${field}.id`, 200),
    revision: requiredString(value.revision, `${field}.revision`, 100),
    title: requiredString(value.title, `${field}.title`, 200),
    summary: requiredString(value.summary, `${field}.summary`, maxTextBytes),
    markdown: requiredString(value.markdown, `${field}.markdown`, maxTextBytes),
    media: array(value.media, `${field}.media`, 64).map((item, index) => parseMedia(item, `${field}.media[${index}]`, maxTextBytes)),
    ...(sourceCommit === undefined ? {} : { sourceCommit }),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(importedAt === undefined ? {} : { importedAt: parseDate(importedAt, `${field}.importedAt`) }),
  }
}

function parseDelivery(value: unknown, field: string): CatalogDelivery {
  if (!isRecord(value)) fail('catalog/invalid-field', `${field} 必须是对象`)
  const sources = array(value.sources, `${field}.sources`, 32).map((item, index) => {
    if (!isRecord(item)) fail('catalog/invalid-field', `${field}.sources[${index}] 必须是对象`)
    const kind = item.kind
    const allowed = ['embedded', 'online-index', 'cache', 'registry-tarball', 'https-artifact', 'local-file'] as const
    if (typeof kind !== 'string' || !allowed.includes(kind as never)) fail('catalog/invalid-field', `${field}.sources[${index}].kind 无效`)
    const sourceKind = kind as DeliverySource['kind']
    return {
      kind: sourceKind,
      ref: requiredString(item.ref, `${field}.sources[${index}].ref`, 4_096),
      priority: numberInt(item.priority, `${field}.sources[${index}].priority`, 0, 1_000),
      ...(item.size === undefined ? {} : { size: numberInt(item.size, `${field}.sources[${index}].size`, 0, 500 * 1024 * 1024) }),
    }
  })
  return {
    pluginId: parseId(value.pluginId, `${field}.pluginId`),
    version: parseVersion(value.version, `${field}.version`),
    artifactDigest: parseDigest(value.artifactDigest, `${field}.artifactDigest`),
    packageName: requiredString(value.packageName, `${field}.packageName`, 214),
    sources,
  }
}

function validateExecutionGraph(execution: PackExecution, componentIds: ReadonlySet<string>): void {
  const seen = new Set<string>()
  const adjacency = new Map<string, string[]>()
  for (const id of componentIds) adjacency.set(id, [])
  for (const edge of execution.edges) {
    if (edge.prerequisiteId === edge.consumerId) fail('catalog/execution-cycle', 'PackExecution 不允许自依赖')
    if (!componentIds.has(edge.prerequisiteId) || !componentIds.has(edge.consumerId)) {
      fail('catalog/execution-unknown-component', 'PackExecution 引用了 Lock 之外的组件')
    }
    const key = `${edge.prerequisiteId}->${edge.consumerId}:${edge.milestone}`
    if (seen.has(key)) fail('catalog/execution-duplicate-edge', 'PackExecution 存在重复边')
    seen.add(key)
    adjacency.get(edge.prerequisiteId)?.push(edge.consumerId)
  }
  const visiting = new Set<string>()
  const done = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) fail('catalog/execution-cycle', 'PackExecution 组件关系存在循环')
    if (done.has(id)) return
    visiting.add(id)
    for (const next of adjacency.get(id) ?? []) visit(next)
    visiting.delete(id)
    done.add(id)
  }
  for (const id of componentIds) visit(id)
}

/**
 * 校验完整 MarketIndex，并投影成 Client 可见的 CatalogSnapshot。
 * Manifest/Lock 原字节只留在 Host 返回的内部结构，不跨 Remote 暴露。
 */
export function validateMarketIndex(
  input: unknown,
  options: CatalogLimitOptions & { readonly origin?: CatalogSnapshot['origin'] } = {},
): ValidatedCatalog {
  const limits = { ...DEFAULT_CATALOG_LIMITS, ...options }
  if (!isRecord(input)) fail('catalog/invalid-root', '目录根必须是对象')
  if (input.schemaVersion !== MARKET_INDEX_SCHEMA_VERSION) fail('catalog/schema-mismatch', '不支持的 MarketIndex schemaVersion')
  const revision = requiredString(input.revision, 'revision', 200)
  const generatedAt = parseDate(input.generatedAt, 'generatedAt')
  const plugins = array(input.plugins, 'plugins', limits.maxPlugins).map((item, index) => parsePlugin(item, `plugins[${index}]`, limits.maxTextBytes))
  const packs = array(input.packs, 'packs', limits.maxPacks).map((item, index) => parsePack(item, `packs[${index}]`, limits.maxTextBytes))
  const presentations = array(input.presentations, 'presentations', limits.maxPresentations).map((item, index) => parsePresentation(item, `presentations[${index}]`, limits.maxTextBytes))
  const deliveries = array(input.deliveries, 'deliveries', limits.maxDeliveries).map((item, index) => parseDelivery(item, `deliveries[${index}]`))

  const pluginKeys = new Set<string>()
  const pluginByIdVersion = new Map<string, MarketPluginRecord>()
  const presentationIds = new Set(presentations.map((item) => item.id))
  const manifestBytes = new Map<string, Uint8Array>()
  const evidenceBytes = new Map<string, readonly Uint8Array[]>()
  for (const plugin of plugins) {
    const key = `${plugin.id}@${plugin.version}`
    if (pluginKeys.has(key)) fail('catalog/duplicate-plugin', `重复插件版本 ${key}`)
    pluginKeys.add(key)
    pluginByIdVersion.set(key, plugin)
    const bytes = Buffer.from(plugin.manifest.contentBase64, 'base64')
    manifestBytes.set(`${key}:manifest`, bytes)
    const evidence = (plugin.evidence ?? []).map((item) => Buffer.from(item.contentBase64, 'base64'))
    evidenceBytes.set(`${key}:evidence`, evidence)
    const summaries: EvidenceSummary[] = evidence.map((item) => validatePublicEvidence(item, plugin, plugin.manifestDigest))
    if (plugin.verification === 'verified') {
      if (!options.host) fail('catalog/evidence-host-context-missing', `${key} 标记 verified 但没有当前宿主证据上下文`)
      const now = options.now ?? new Date()
      if (!summaries.some((item) => evidenceSupportsVerification(item, options.host as never, now))) {
        fail('catalog/evidence-not-current', `${key} 的 verified 未绑定当前宿主、版本和有效运行 Evidence`)
      }
    }
    if (!presentationIds.has(plugin.presentationId)) fail('catalog/missing-presentation', `${key} 引用不存在的 Presentation`)
  }

  const packBytes = new Map<string, Uint8Array>()
  const lockBytes = new Map<string, Uint8Array>()
  for (const pack of packs) {
    const key = `${pack.id}@${pack.version}`
    const publicPackBytes = Buffer.from(pack.pack.contentBase64, 'base64')
    packBytes.set(`${key}:pack`, publicPackBytes)
    const bytes = Buffer.from(pack.lock.contentBase64, 'base64')
    const lockDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    if (lockDigest !== pack.lockDigest) fail('catalog/lock-digest-mismatch', `${key}.lockDigest 与 Lock 原字节不符`)
    if (pack.execution.packId !== pack.id || pack.execution.packVersion !== pack.version || pack.execution.lockDigest !== lockDigest) {
      fail('catalog/execution-lock-mismatch', `${key} 的 PackExecution 未绑定精确 Lock`)
    }
    const lockedComponents = validatePublicPackLock(bytes, pack.id, pack.version, pack.components)
    const packComponents = new Map(pack.components.map((item) => [item.pluginId, item]))
    const lockComponents = new Map(lockedComponents.map((item) => [item.id, item]))
    if (packComponents.size !== lockComponents.size) fail('catalog/pack-lock-mismatch', `${key} 与 Lock 组件集合不一致`)
    for (const [id, component] of packComponents) {
      const locked = lockComponents.get(id)
      if (!locked || locked.version !== component.version) fail('catalog/pack-lock-mismatch', `${key} 的 ${id} 版本与 Lock 不一致`)
      const plugin = pluginByIdVersion.get(`${id}@${component.version}`)
      if (!plugin) fail('catalog/missing-plugin', `${key} 引用不存在的 ${id}@${component.version}`)
      if (plugin.artifactDigest !== locked.artifactDigest || plugin.manifestDigest !== locked.manifestDigest) {
        fail('catalog/lock-plugin-digest-mismatch', `${key} 的 ${id} 摘要与目录对象不一致`)
      }
    }
    validateExecutionGraph(pack.execution, new Set(packComponents.keys()))
    lockBytes.set(`${key}:lock`, bytes)
  }

  for (const delivery of deliveries) {
    const key = `${delivery.pluginId}@${delivery.version}`
    const plugin = pluginByIdVersion.get(key)
    if (!plugin) fail('catalog/missing-plugin', `Delivery 引用不存在的 ${key}`)
    if (plugin.artifactDigest !== delivery.artifactDigest) fail('catalog/delivery-digest-mismatch', `${key} 的 Delivery 不是同制品`)
    if (delivery.sources.length === 0) fail('catalog/missing-delivery-source', `${key} 没有候选来源`)
    const priorities = new Set(delivery.sources.map((source) => source.priority))
    if (priorities.size !== delivery.sources.length) fail('catalog/duplicate-priority', `${key} 的 Delivery priority 必须唯一`)
  }

  const snapshot: CatalogSnapshot = {
    schemaVersion: MARKET_INDEX_SCHEMA_VERSION,
    revision,
    generatedAt,
    origin: options.origin ?? 'embedded',
    stale: false,
    plugins: plugins.map(({ manifest: _manifest, manifestDigest: _manifestDigest, evidence: _evidence, ...plugin }) => plugin),
    packs: packs.map(({ pack: _pack, packDigest: _packDigest, lock: _lock, ...pack }) => pack),
    presentations,
    deliveries,
  }
  return { snapshot, manifestBytes, packBytes, lockBytes, evidenceBytes }
}

/** 只允许 complete 且关系无环的 PackExecution 被当作完整执行资料。 */
export function isCompletePackExecution(execution: PackExecution): boolean {
  try {
    const ids = new Set(execution.edges.flatMap((edge) => [edge.prerequisiteId, edge.consumerId]))
    validateExecutionGraph(execution, ids)
    return execution.coverage === 'complete'
  } catch {
    return false
  }
}
