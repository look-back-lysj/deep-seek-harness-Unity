/**
 * 目录跨对象校验器。
 *
 * 重点是三层绑定：Manifest 原字节 → manifestDigest；Pack/Lock 原字节 → lockDigest；
 * PackExecution → 精确 Lock 摘要。任何一层断开都不能解释成“完整独立”或可安装。
 */
import { createHash } from 'node:crypto'
import type {
  CatalogDelivery,
  CatalogDisplayMedia,
  CatalogListing,
  DeliverySource,
  CatalogMedia,
  CatalogPack,
  CatalogPlugin,
  CatalogPresentation,
  CatalogSnapshot,
  PackComponent,
  PackExecution,
  PackExecutionEdge,
  PreviewPack,
  PreviewPackComponent,
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
import { parseMetadata } from './metadata.ts'
import { parseRecommendations } from './recommendations.ts'
import { buildCatalogDiscovery } from './discovery.ts'
import { parseCollection, parseRelease, parseReleaseStatus } from './releases.ts'
import { exactVersion, integer, string, timestamp } from './input.ts'
import { parseManagementEvidence } from './management-evidence.ts'
import { agentForgeHostRequirements, packageHostRequirements } from './host-requirements.ts'

const ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

function fail(code: string, message: string, details: readonly string[] = []): never {
  throw new CatalogValidationError(code, message, details)
}

function pick<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) fail('catalog/invalid-field', `${field} 无效`)
  return value as T
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
  return exactVersion(value, field)
}

function parseDate(value: unknown, field: string): string {
  return timestamp(value, field)
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
  const theme = value.theme === undefined ? undefined : requiredString(value.theme, `${field}.theme`, 20)
  if (theme !== undefined && !['light', 'dark', 'system'].includes(theme)) fail('catalog/invalid-field', `${field}.theme 无效`)
  const sourceUrl = requiredString(value.sourceUrl, `${field}.sourceUrl`, 16_384)
  if (Array.from(sourceUrl).length > 4_096) fail('catalog/invalid-field', `${field}.sourceUrl 超过允许长度`)
  return {
    id: requiredString(value.id, `${field}.id`, 200),
    alt: requiredString(value.alt, `${field}.alt`, maxTextBytes),
    sourceUrl,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(theme === undefined ? {} : { theme: theme as NonNullable<CatalogMedia['theme']> }),
  }
}

function parseDisplayMedia(value: unknown, field: string): CatalogDisplayMedia {
  if (!isRecord(value) || Object.keys(value).some(key => !['icon', 'previews'].includes(key))
    || value.icon === undefined && value.previews === undefined) fail('catalog/invalid-field', `${field} 只能包含图标或预览`)
  const image = (raw: unknown, name: string): CatalogMedia => {
    const media = parseMedia(raw, name, 2_000)
    if (!media.alt.trim() || Array.from(media.alt).length > 500) fail('catalog/invalid-field', `${name}.alt 必须是非空且不超过500字符的文本`)
    let url: URL
    try { url = new URL(media.sourceUrl) } catch { fail('catalog/invalid-field', `${name}.sourceUrl 无效`) }
    if (url.protocol !== 'https:' || url.username || url.password || /[\s\\\u0000-\u001f\u007f]/u.test(media.sourceUrl)) {
      fail('catalog/invalid-field', `${name}.sourceUrl 必须是无凭据 HTTPS`)
    }
    return media
  }
  const icon = value.icon === undefined ? undefined : image(value.icon, `${field}.icon`)
  const previews = value.previews === undefined ? undefined : array(value.previews, `${field}.previews`, 12).map((item, index) => image(item, `${field}.previews[${index}]`))
  if (previews !== undefined && (previews.length === 0 || new Set(previews.map(item => JSON.stringify(item))).size !== previews.length)) {
    fail('catalog/invalid-field', `${field}.previews 必须是非空且不重复的有序列表`)
  }
  return { ...(icon === undefined ? {} : { icon }), ...(previews === undefined ? {} : { previews }) }
}

function parsePlugin(value: unknown, field: string, maxTextBytes: number, now: Date): MarketPluginRecord {
  if (!isRecord(value)) fail('catalog/invalid-field', `${field} 必须是对象`)
  const declaredKind = value.kind === undefined ? undefined : requiredString(value.kind, `${field}.kind`, 20)
  if (declaredKind !== undefined && !['plugin', 'skin', 'skill'].includes(declaredKind)) fail('catalog/invalid-field', `${field}.kind 必须是 plugin、skin 或 skill`)
  const authorUrl = optionalString(value.authorUrl, `${field}.authorUrl`, 4_096)
  const sourceUrl = optionalString(value.sourceUrl, `${field}.sourceUrl`, 4_096)
  const license = optionalString(value.license, `${field}.license`, 200)
  const targetRequirements = value.agentForgeMetadata === undefined ? undefined : agentForgeHostRequirements(value.agentForgeMetadata, requiredString(value.packageName, `${field}.packageName`, 214), parseVersion(value.version, `${field}.version`))
  const plugin: CatalogPlugin = {
    id: parseId(value.id, `${field}.id`),
    name: requiredString(value.name, `${field}.name`, 200),
    ...(value.media === undefined ? {} : { media: parseDisplayMedia(value.media, `${field}.media`) }),
    packageName: requiredString(value.packageName, `${field}.packageName`, 214),
    version: parseVersion(value.version, `${field}.version`),
    ...(declaredKind === undefined ? {} : { kind: declaredKind as CatalogPlugin['kind'] }),
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
    ...(value.releasedAt === undefined ? {} : { releasedAt: parseDate(value.releasedAt, `${field}.releasedAt`) }),
    ...(value.managementEvidence === undefined ? {} : { managementEvidence: parseManagementEvidence(value.managementEvidence, value.artifactDigest === undefined ? undefined : parseDigest(value.artifactDigest, `${field}.artifactDigest`), now) }),
    ...(targetRequirements === undefined ? {} : { hostRequirements: targetRequirements }),
  }
  if (value.metadata !== undefined) {
    if (value.manifest !== undefined || value.manifestDigest !== undefined) fail('catalog/ambiguous-metadata', 'metadata 联合与旧 Manifest 字段不能同时提供')
    const metadata = parseMetadata(value.metadata, plugin)
    const rawMetadata = metadata.kind === 'official-bundle' ? metadata.packageJson : metadata.manifest
    const parsedMetadata = JSON.parse(Buffer.from(rawMetadata.contentBase64, 'base64').toString('utf8')) as Record<string, unknown>
    const packageMetadata = metadata.kind === 'official-bundle' ? parsedMetadata : parsedMetadata['x-mojobox-package'] as Record<string, unknown> | undefined
    const packageRequirements = packageHostRequirements(packageMetadata ?? {}, rawMetadata.sha256)
    const hostRequirements = { historyCoverage: targetRequirements?.historyCoverage ?? packageRequirements.historyCoverage, declarations: [...(targetRequirements?.declarations ?? []), ...packageRequirements.declarations] }
    let skinView: { kind?: 'skin'; skinId?: string } = {}
    if (metadata.kind === 'official-bundle') {
      const packageJson = JSON.parse(Buffer.from(metadata.packageJson.contentBase64, 'base64').toString('utf8')) as { dsh?: { skin?: { id?: unknown; apiVersion?: unknown } } }
      const skin = packageJson.dsh?.skin
      if (skin !== undefined) {
        if (typeof skin !== 'object' || skin === null || skin.apiVersion !== 'dsh.ecosystem.ui-skin-loader/v1'
          || typeof skin.id !== 'string' || skin.id.length > 200 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(skin.id)) fail('catalog/skin-metadata', '皮肤声明缺少受支持的公约版本或稳定ID')
        if (declaredKind !== undefined && declaredKind !== 'skin') fail('catalog/skin-metadata', '皮肤元数据与目录 kind 不一致')
        skinView = { kind: 'skin', skinId: skin.id }
      }
    }
    const evidence = value.evidence === undefined ? [] : array(value.evidence, `${field}.evidence`, 32).map((item, index) => decodeRaw(item, `${field}.evidence[${index}]`, maxTextBytes).record)
    if (metadata.kind === 'official-bundle' && evidence.length) fail('catalog/official-evidence', '官方包不能冒用需要 Manifest 的公共 Evidence')
    return { ...plugin, ...skinView, metadataDigest: rawMetadata.sha256, hostRequirements, metadata, ...(value.releaseId === undefined ? {} : { releaseId: string(value.releaseId, 'releaseId', 100) }), ...(metadata.kind === 'dsh-std' ? { manifest: metadata.manifest, manifestDigest: metadata.manifest.sha256 } : {}), ...(evidence.length ? { evidence } : {}) }
  }
  const manifestDigest = parseDigest(value.manifestDigest, `${field}.manifestDigest`)
  const manifest = decodeRaw(value.manifest, `${field}.manifest`, maxTextBytes)
  if (manifest.record.sha256 !== manifestDigest) {
    fail('catalog/manifest-digest-mismatch', `${field}.manifestDigest 与 Manifest 原字节不符`)
  }
  validatePublicManifest(manifest.bytes, plugin)
  const evidence = value.evidence === undefined ? [] : array(value.evidence, `${field}.evidence`, 32).map((item, index) => decodeRaw(item, `${field}.evidence[${index}]`, maxTextBytes))
  const parsedManifest = JSON.parse(Buffer.from(manifest.record.contentBase64, 'base64').toString('utf8')) as Record<string, unknown>
  const packageRequirements = packageHostRequirements(parsedManifest['x-mojobox-package'] as Record<string, unknown> ?? {}, manifestDigest)
  const hostRequirements = { historyCoverage: targetRequirements?.historyCoverage ?? packageRequirements.historyCoverage, declarations: [...(targetRequirements?.declarations ?? []), ...packageRequirements.declarations] }
  return { ...plugin, metadataDigest: manifestDigest, hostRequirements, manifestDigest, manifest: manifest.record, ...(value.releaseId === undefined ? {} : { releaseId: string(value.releaseId, 'releaseId', 100) }), ...(evidence.length === 0 ? {} : { evidence: evidence.map((item) => item.record) }) }
}

function parsePreviewComponent(value: unknown, field: string): PreviewPackComponent {
  if (!isRecord(value)) fail('catalog/invalid-field', `${field} 必须是对象`)
  const resolved = value.resolved === undefined ? undefined : (() => {
    if (!isRecord(value.resolved)) fail('catalog/invalid-field', `${field}.resolved 必须是对象`)
    return {
      packageName: requiredString(value.resolved.packageName, `${field}.resolved.packageName`, 214),
      version: parseVersion(value.resolved.version, `${field}.resolved.version`),
      sha256: requiredString(value.resolved.sha256, `${field}.resolved.sha256`, 64),
    }
  })()
  return {
    id: requiredString(value.id, `${field}.id`, 200),
    ref: requiredString(value.ref, `${field}.ref`, 512),
    ...(value.version === undefined ? {} : { version: requiredString(value.version, `${field}.version`, 100) }),
    ...(resolved === undefined ? {} : { resolved }),
  }
}

/** 上游未解析整合包：只做展示解析，coverage 禁 complete，组件 ID 必须唯一。 */
function parsePreviewPack(value: unknown, field: string): PreviewPack {
  if (!isRecord(value)) fail('catalog/invalid-field', `${field} 必须是对象`)
  const status = pick(value.status, `${field}.status`, ['active', 'withdrawn'] as const)
  const basis = pick(value.compatibilityBasis, `${field}.compatibilityBasis`, ['author-declared', 'maintainer-target', 'unknown'] as const)
  const requiresDsh = value.requiresDsh === null ? null : requiredString(value.requiresDsh, `${field}.requiresDsh`, 100)
  const source = value.source
  if (!isRecord(source)) fail('catalog/invalid-field', `${field}.source 必须是对象`)
  let sourceUrl: URL
  try { sourceUrl = new URL(requiredString(source.url, `${field}.source.url`, 4096)) } catch { fail('catalog/invalid-field', `${field}.source.url 不是有效链接`) }
  if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password) fail('catalog/invalid-field', `${field}.source.url 只允许无凭据 HTTPS`)
  if (source.commit !== null && typeof source.commit !== 'string') fail('catalog/invalid-field', `${field}.source.commit 只能是字符串或 null`)
  const components = array(value.components, `${field}.components`, 2_000).map((item, index) => parsePreviewComponent(item, `${field}.components[${index}]`))
  if (components.length === 0) fail('catalog/invalid-field', `${field}.components 至少要有一个组件`)
  if (new Set(components.map(item => item.id)).size !== components.length) fail('catalog/invalid-field', `${field}.components 组件 ID 重复`)
  const execution = value.execution
  if (!isRecord(execution)) fail('catalog/invalid-field', `${field}.execution 必须是对象`)
  if (execution.coverage === 'complete') {
    fail('catalog/preview-pack-coverage', `${field}.execution.coverage 不允许 complete：完整可装组合走 MarketCollection，不走预览`)
  }
  const coverage = pick(execution.coverage, `${field}.execution.coverage`, ['unknown', 'partial'] as const)
  const edges = array(execution.edges, `${field}.execution.edges`, 4_000).map((edge, index) => {
    if (!isRecord(edge)) fail('catalog/invalid-field', `${field}.execution.edges[${index}] 必须是对象`)
    const milestone = pick(edge.milestone, `${field}.execution.edges[${index}].milestone`, ['installed', 'active'] as const)
    return {
      prerequisiteId: requiredString(edge.prerequisiteId, `${field}.execution.edges[${index}].prerequisiteId`, 200),
      consumerId: requiredString(edge.consumerId, `${field}.execution.edges[${index}].consumerId`, 200),
      milestone,
    }
  })
  const componentIds = new Set(components.map(item => item.id))
  validateExecutionGraph({ schemaVersion: '1', packId: String(value.id ?? ''), packVersion: String(value.version ?? ''), lockDigest: '', coverage, edges, provenance: 'preview-pack' }, componentIds)
  const artifact = value.artifact === undefined ? undefined : (() => {
    if (!isRecord(value.artifact)) fail('catalog/invalid-field', `${field}.artifact 必须是对象`)
    if (value.artifact.format !== 'eac-feature-pack-v1') fail('catalog/invalid-field', `${field}.artifact.format 只能是 eac-feature-pack-v1`)
    let url: URL
    try { url = new URL(requiredString(value.artifact.downloadUrl, `${field}.artifact.downloadUrl`, 4096)) } catch { fail('catalog/invalid-field', `${field}.artifact.downloadUrl 不是有效链接`) }
    if (url.protocol !== 'https:' || url.username || url.password) fail('catalog/invalid-field', `${field}.artifact.downloadUrl 只允许无凭据 HTTPS`)
    const sha256 = requiredString(value.artifact.sha256, `${field}.artifact.sha256`, 64)
    if (!/^[0-9a-f]{64}$/.test(sha256)) fail('catalog/invalid-digest', `${field}.artifact.sha256 必须是 64 位小写十六进制`)
    return { format: 'eac-feature-pack-v1' as const, downloadUrl: url.href, sha256, size: numberInt(value.artifact.size, `${field}.artifact.size`, 1, Number.MAX_SAFE_INTEGER) }
  })()
  return {
    id: parseId(value.id, `${field}.id`),
    version: parseVersion(value.version, `${field}.version`),
    name: requiredString(value.name, `${field}.name`, 200),
    summary: requiredString(value.summary, `${field}.summary`, 4096),
    source: { url: sourceUrl.href, commit: source.commit === null ? null : String(source.commit) },
    requiresDsh,
    compatibilityBasis: basis,
    components,
    ...(artifact === undefined ? {} : { artifact }),
    execution: { coverage, edges, ...(execution.reference === undefined ? {} : { reference: requiredString(execution.reference, `${field}.execution.reference`, 4096) }) },
    status,
  }
}

function parseListing(value: unknown, field: string): CatalogListing {
  if (!isRecord(value)) fail('catalog/invalid-field', `${field} 必须是对象`)
  const sourceUrl = requiredString(value.sourceUrl, `${field}.sourceUrl`, 4096)
  let url: URL
  try { url = new URL(sourceUrl) } catch { fail('catalog/listing-source', '清点记录缺少有效来源链接') }
  if (url.protocol !== 'https:' || url.username || url.password) fail('catalog/listing-source', '清点来源只允许无凭据 HTTPS')
  return {
    id: parseId(value.id, `${field}.id`),
    name: requiredString(value.name, `${field}.name`, 200),
    packageName: requiredString(value.packageName, `${field}.packageName`, 214),
    summary: requiredString(value.summary, `${field}.summary`, 4096),
    reason: requiredString(value.reason, `${field}.reason`, 8192),
    sourceUrl,
    ...(value.media === undefined ? {} : { media: parseDisplayMedia(value.media, `${field}.media`) }),
    ...(value.requestedVersion === undefined ? {} : { requestedVersion: requiredString(value.requestedVersion, `${field}.requestedVersion`, 100) }),
    ...(value.agentForgeMetadata === undefined ? {} : { hostRequirements: agentForgeHostRequirements(value.agentForgeMetadata, requiredString(value.packageName, `${field}.packageName`, 214), typeof value.requestedVersion === 'string' ? value.requestedVersion : undefined) }),
  }
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
  if (input.schemaVersion !== MARKET_INDEX_SCHEMA_VERSION && input.schemaVersion !== '2') fail('catalog/schema-mismatch', '不支持的 MarketIndex schemaVersion')
  const isV2 = input.schemaVersion === '2'
  const publication = !isV2 ? undefined : (() => {
    if (!isRecord(input.publication)) fail('catalog/publication-required', 'v2 目录必须有来源身份和发布序号')
    return { sourceId: string(input.publication.sourceId, 'publication.sourceId', 100), sequence: integer(input.publication.sequence, 'publication.sequence', 1) }
  })()
  const revision = requiredString(input.revision, 'revision', 200)
  const generatedAt = parseDate(input.generatedAt, 'generatedAt')
  const plugins = array(input.plugins, 'plugins', limits.maxPlugins).map((item, index) => parsePlugin(item, `plugins[${index}]`, limits.maxTextBytes, options.now ?? new Date()))
  const packs = array(input.packs, 'packs', limits.maxPacks).map((item, index) => parsePack(item, `packs[${index}]`, limits.maxTextBytes))
  const presentations = array(input.presentations, 'presentations', limits.maxPresentations).map((item, index) => parsePresentation(item, `presentations[${index}]`, limits.maxTextBytes))
  const deliveries = array(input.deliveries, 'deliveries', limits.maxDeliveries).map((item, index) => parseDelivery(item, `deliveries[${index}]`))
  const releases = input.releases === undefined ? [] : array(input.releases, 'releases', limits.maxPlugins).map(parseRelease)
  const releasesById = new Map(releases.map(release => [release.releaseId, release]))
  if (releasesById.size !== releases.length) fail('catalog/duplicate-release', '发行记录重复')
  const releaseStatuses = input.releaseStatuses === undefined ? [] : array(input.releaseStatuses, 'releaseStatuses', limits.maxPlugins * 10).map(parseReleaseStatus)
  const statusKeys = new Set<string>()
  for (const status of releaseStatuses) {
    const key = `${status.releaseId}:${status.sequence}`
    if (statusKeys.has(key) || !releasesById.has(status.releaseId)) fail('catalog/release-status-binding', '发行状态重复或没有对应记录')
    if (Date.parse(status.effectiveAt) > (options.now ?? new Date()).getTime()) fail('catalog/future-status', '未来生效状态应到生效时再发布')
    statusKeys.add(key)
  }
  const latestStatuses = new Map(releaseStatuses.slice().sort((a, b) => a.sequence - b.sequence).map(status => [status.releaseId, status]))

  const pluginKeys = new Set<string>()
  const pluginByIdVersion = new Map<string, MarketPluginRecord>()
  const presentationIds = new Set(presentations.map((item) => item.id))
  const manifestBytes = new Map<string, Uint8Array>()
  const metadataBytes = new Map<string, Uint8Array>()
  const verificationByKey = new Map<string, CatalogPlugin['verification']>()
  const evidenceBytes = new Map<string, readonly Uint8Array[]>()
  for (const plugin of plugins) {
    const key = `${plugin.id}@${plugin.version}`
    if (isV2 && !plugin.metadata) fail('catalog/metadata-required', 'v2 插件必须明确区分 official-bundle 和 dsh-std 元数据')
    if (pluginKeys.has(key)) fail('catalog/duplicate-plugin', `重复插件版本 ${key}`)
    pluginKeys.add(key)
    pluginByIdVersion.set(key, plugin)
    const metadataRecord = plugin.metadata?.kind === 'official-bundle' ? plugin.metadata.packageJson : plugin.manifest
    if (!metadataRecord) fail('catalog/missing-metadata', `${key} 缺少元数据`)
    const bytes = Buffer.from(metadataRecord.contentBase64, 'base64')
    metadataBytes.set(key, bytes)
    if (plugin.manifest) manifestBytes.set(`${key}:manifest`, bytes)
    const evidence = (plugin.evidence ?? []).map((item) => Buffer.from(item.contentBase64, 'base64'))
    evidenceBytes.set(`${key}:evidence`, evidence)
    const summaries: EvidenceSummary[] = evidence.map((item) => validatePublicEvidence(item, plugin, plugin.manifestDigest as string))
    const currentEvidence = options.host !== undefined && summaries.some(item => evidenceSupportsVerification(item, options.host!, options.now ?? new Date()))
    verificationByKey.set(key, plugin.verification)
    if (plugin.verification === 'verified') {
      // v2 把远端声明与当前宿主投影分开：别的宿主证据仍可浏览，但绝不展示成 verified。
      if (isV2 && !currentEvidence) verificationByKey.set(key, 'unverified')
      else if (!options.host) fail('catalog/evidence-host-context-missing', `${key} 标记 verified 但没有当前宿主证据上下文`)
      else if (!currentEvidence) {
        fail('catalog/evidence-not-current', `${key} 的 verified 未绑定当前宿主、版本和有效运行 Evidence`)
      }
    }
    if (!presentationIds.has(plugin.presentationId)) fail('catalog/missing-presentation', `${key} 引用不存在的 Presentation`)
    if (isV2 && plugin.releasedAt !== undefined && !plugin.releaseId) fail('catalog/release-date-binding', '没有发行记录不能声明可核验的发布时间')
    if (isV2 && plugin.artifactDigest !== undefined) {
      const release = releasesById.get(plugin.releaseId ?? '')
      if (!release || release.pluginId !== plugin.id || release.packageName !== plugin.packageName || release.version !== plugin.version || release.artifactDigest !== plugin.artifactDigest || release.metadataDigest !== metadataRecord.sha256) fail('catalog/release-binding', `${key} 未绑定精确发行、制品与元数据`)
      if (plugin.releasedAt !== undefined && plugin.releasedAt !== release.publishedAt) fail('catalog/release-date-binding', '显示发布时间与发行记录不符')
      if (!latestStatuses.has(release.releaseId)) fail('catalog/release-status-missing', '发行缺少生命周期状态')
    }
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
      if (locked.source !== `npm:${plugin.packageName}@${plugin.version}`) fail('catalog/lock-package-mismatch', '公共 Lock npm 身份与实际目录包名不符')
    }
    validateExecutionGraph(pack.execution, new Set(packComponents.keys()))
    lockBytes.set(`${key}:lock`, bytes)
  }

  for (const delivery of deliveries) {
    const key = `${delivery.pluginId}@${delivery.version}`
    const plugin = pluginByIdVersion.get(key)
    if (!plugin) fail('catalog/missing-plugin', `Delivery 引用不存在的 ${key}`)
    if (plugin.artifactDigest !== delivery.artifactDigest) fail('catalog/delivery-digest-mismatch', `${key} 的 Delivery 不是同制品`)
    if (plugin.packageName !== delivery.packageName) fail('catalog/delivery-package-mismatch', `${key} 的 Delivery 包名不一致`)
    const release = releasesById.get(plugin.releaseId ?? '')
    if (release && delivery.sources.some(source => source.size !== release.size)) fail('catalog/delivery-size-mismatch', 'v2 来源必须带发行记录的精确大小')
    if (delivery.sources.length === 0) fail('catalog/missing-delivery-source', `${key} 没有候选来源`)
    const priorities = new Set(delivery.sources.map((source) => source.priority))
    if (priorities.size !== delivery.sources.length) fail('catalog/duplicate-priority', `${key} 的 Delivery priority 必须唯一`)
  }
  if (new Set(deliveries.map(item => `${item.pluginId}@${item.version}`)).size !== deliveries.length || presentationIds.size !== presentations.length || new Set(packs.map(item => `${item.id}@${item.version}`)).size !== packs.length) fail('catalog/duplicate-record', '目录引用对象重复')
  const collections = input.collections === undefined ? [] : array(input.collections, 'collections', limits.maxPacks).map(item => parseCollection(item, releasesById))
  for (const collection of collections) {
    for (const component of collection.components) if (!pluginByIdVersion.has(`${component.pluginId}@${component.version}`)) fail('catalog/collection-plugin', '私有组合组件没有可浏览插件记录')
    validateExecutionGraph({ ...collection.execution, schemaVersion: '1', packId: collection.id, packVersion: collection.version, lockDigest: '' }, new Set(collection.components.map(item => item.pluginId)))
  }
  if (new Set(collections.map(item => `${item.id}@${item.version}`)).size !== collections.length) fail('catalog/duplicate-collection', '私有组合重复')
  const projectedPlugins = plugins.map(({ manifest: _manifest, manifestDigest: _manifestDigest, metadata: _metadata, releaseId, evidence: _evidence, ...plugin }) => {
    const release = isV2 && releaseId ? releasesById.get(releaseId) : undefined
    const publication: NonNullable<CatalogPlugin['publication']> = release && release.pluginId === plugin.id && release.packageName === plugin.packageName
      && release.version === plugin.version && release.artifactDigest === plugin.artifactDigest
      && release.metadataDigest === plugin.metadataDigest ? latestStatuses.get(release.releaseId)?.status ?? 'unknown' : 'unknown'
    return {
      ...plugin, publication,
      verification: verificationByKey.get(`${plugin.id}@${plugin.version}`) ?? plugin.verification,
      ...(release ? { releaseId, releasedAt: release.publishedAt } : {}),
      ...(publication === 'withdrawn' ? { installability: 'hard-blocked' as const } : {}),
    }
  })

  const recommendations = parseRecommendations(input.recommendations, projectedPlugins, options.now ?? new Date(), isV2)
  const snapshotPluginIds = new Set(plugins.map(plugin => plugin.id))
  const snapshot: CatalogSnapshot = {
    schemaVersion: input.schemaVersion,
    revision,
    generatedAt,
    origin: options.origin ?? 'embedded',
    stale: false,
    plugins: projectedPlugins,
    ...(input.listings === undefined ? {} : { listings: array(input.listings, 'listings', limits.maxPlugins).map((value, i) => parseListing(value, `listings[${i}]`)) }),
    ...(input.previewPacks === undefined ? {} : { previewPacks: (() => {
      const packs = array(input.previewPacks, 'previewPacks', limits.maxPacks).map((value, i) => parsePreviewPack(value, `previewPacks[${i}]`))
      if (new Set(packs.map(item => item.id + '@' + item.version)).size !== packs.length) fail('catalog/duplicate-record', '预览组合 ID 重复')
      if (packs.some(pack => snapshotPluginIds.has(pack.id))) fail('catalog/duplicate-record', '预览组合 ID 与插件记录冲突')
      return packs
    })() }),
    packs: packs.map(({ pack: _pack, packDigest: _packDigest, lock: _lock, ...pack }) => pack),
    presentations,
    deliveries,
    recommendations,
    discovery: buildCatalogDiscovery({ plugins: projectedPlugins, presentations, recommendations }),
  }
  if (snapshot.listings && (new Set(snapshot.listings.map(item => item.id)).size !== snapshot.listings.length || snapshot.listings.some(item => projectedPlugins.some(plugin => plugin.id === item.id)))) fail('catalog/duplicate-listing', '清点记录ID重复或与插件记录冲突')
  return { snapshot, manifestBytes, packBytes, lockBytes, evidenceBytes, metadataBytes, releases, releaseStatuses, collections, ...(publication === undefined ? {} : { publication }) }
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
