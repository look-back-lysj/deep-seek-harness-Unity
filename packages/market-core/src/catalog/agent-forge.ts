/** Agent Forge v2 source adapter。
 *
 * 这个模块只处理元数据读取和一致性校验，不下载或安装插件。在线来源
 * 经过 HTTPS 安全边界；本地来源必须由 Host 显式限定允许目录；离线包
 * 走独立的 `.eacpack` 校验器。未知 `_meta` 字段保留在返回记录中。
 */
import { createHash } from 'node:crypto'
import { closeSync, fstatSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep, dirname, join } from 'node:path'
import type { MarketCatalogSource } from '../contracts/types.ts'
import { MARKET_INDEX_SCHEMA_VERSION, type MarketIndexDocument, type MarketPluginRecord, type MarketListingRecord, type RawDocumentRecord } from './model.ts'
import { validateMarketIndex } from './validate.ts'
import { readOfflinePack, type OfflinePackContents, type OfflinePackLimits } from './offline-pack.ts'
import { DEFAULT_ZIP_LIMITS } from '../authoring/zip.ts'
import { readLimitedResponse, safeFetch, type RemoteSecurityOptions } from '../delivery/security.ts'
import { parseAgentForgeMedia } from './agent-forge-media.ts'

export class AgentForgeSourceError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentForgeSourceError'
    this.code = code
  }
}

export interface AgentForgeSourceOptions extends RemoteSecurityOptions {
  readonly fetch?: typeof fetch
  readonly localRoots?: readonly string[]
  readonly maxBytes?: number
  readonly targetAgent?: string
  readonly offlinePack?: OfflinePackLimits
}

export interface AgentForgeCatalog {
  readonly source: Record<string, unknown>
  readonly index: Record<string, unknown>
  readonly packages: ReadonlyMap<string, Record<string, unknown>>
  readonly packageDocuments: ReadonlyMap<string, RawDocumentRecord>
  readonly advisories: ReadonlyMap<string, Record<string, unknown>>
  readonly sourceRevision: string
  readonly sourceId: string
  readonly agentId: string | null
  readonly stale: boolean
  readonly origin: 'online' | 'local-file' | 'offline-pack'
  readonly offline?: OfflinePackContents
}

export interface AgentForgeRefreshResult {
  readonly status: 'refreshed' | 'failed'
  readonly current?: AgentForgeCatalog
  readonly reason?: string
}

/** Keeps the last valid Agent Forge projection in this process when refresh fails. Runtime owns disk persistence. */
export class AgentForgeSourceCache {
  private cached: AgentForgeCatalog | undefined

  async refresh(source: MarketCatalogSource, options: AgentForgeSourceOptions = {}): Promise<AgentForgeRefreshResult> {
    try {
      const current = await readAgentForgeSource(source, options)
      this.cached = current
      return { status: 'refreshed', current }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (this.cached === undefined) return { status: 'failed', reason }
      // Persist stale in this in-process cache object so current() cannot report it as fresh.
      this.cached = { ...this.cached, stale: true }
      return { status: 'failed', current: this.cached, reason }
    }
  }

  current(): AgentForgeCatalog | undefined {
    return this.cached === undefined ? undefined : { ...this.cached, stale: this.cached.stale }
  }
}

const SOURCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const REVISION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const TYPES = new Set(['mcp', 'plugin', 'skill', 'general', 'bundle'])
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

function fail(code: string, message: string): never {
  throw new AgentForgeSourceError(`agent-forge/${code}`, message)
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-field', `${field} 必须是对象`)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, max = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > max) fail('invalid-field', `${field} 无效`)
  return value
}

function safeRelative(value: unknown, field: string): string {
  const path = text(value, field).replace(/^\.\//, '')
  if (path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) fail('unsafe-path', `${field} 必须是安全的 POSIX 相对路径`)
  return path
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = ''
  for (const codePoint of value) {
    if (Buffer.byteLength(result + codePoint, 'utf8') > maxBytes) break
    result += codePoint
  }
  return result
}

function parseJson(bytes: Uint8Array, field: string): unknown {
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { fail('invalid-json', `${field} 不是合法 JSON`) }
}

function checkDate(value: unknown, field: string): string {
  const result = text(value, field, 128)
  if (!Number.isFinite(Date.parse(result))) fail('invalid-date', `${field} 不是有效时间`)
  return result
}

function validateSource(value: unknown): Record<string, unknown> {
  const source = object(value, 'source.json')
  if (source.schemaVersion !== 2) fail('schema-version', 'source.json 必须是 Agent Forge v2')
  const sourceId = text(source.sourceId, 'source.sourceId', 200)
  if (!SOURCE_ID_RE.test(sourceId)) fail('source-id', 'source.sourceId 格式无效')
  if (source.agentId !== null) text(source.agentId, 'source.agentId', 100)
  if (!TYPES.has(source.type as string)) fail('source-type', 'source.type 无效')
  try { const url = new URL(text(source.baseUrl, 'source.baseUrl')); if (url.protocol !== 'https:') fail('source-url', 'source.baseUrl 必须使用 HTTPS') } catch (error) { if (error instanceof AgentForgeSourceError) throw error; fail('source-url', 'source.baseUrl 不是 URL') }
  safeRelative(source.index, 'source.index')
  const revision = text(source.revision, 'source.revision', 128)
  if (!REVISION_RE.test(revision)) fail('revision', 'source.revision 格式无效')
  checkDate(source.generatedAt, 'source.generatedAt')
  if (source.updatedAt !== undefined) checkDate(source.updatedAt, 'source.updatedAt')
  if (source.mirrorOf !== undefined && source.mirrorOf !== null) text(source.mirrorOf, 'source.mirrorOf', 200)
  return source
}

function validateIndex(value: unknown, source: Record<string, unknown>): Record<string, unknown> {
  const index = object(value, 'index.json')
  if (index.schemaVersion !== 2) fail('schema-version', 'index.json 必须是 Agent Forge v2')
  if (index.sourceId !== source.sourceId || index.agentId !== source.agentId || index.type !== source.type || index.revision !== source.revision) fail('identity-mismatch', 'source.json 与 index.json 身份、目标或 revision 不一致')
  safeRelative(index.sourceManifest, 'index.sourceManifest')
  checkDate(index.generatedAt, 'index.generatedAt')
  if (index.updatedAt !== undefined) checkDate(index.updatedAt, 'index.updatedAt')
  const packages = object(index.packages, 'index.packages')
  for (const [name, raw] of Object.entries(packages)) {
    if (!/^[A-Za-z0-9@][A-Za-z0-9._@/+-]*$/.test(name)) fail('package-name', `index 包名无效 ${name}`)
    const entry = object(raw, `index.packages.${name}`)
    const latest = text(entry.latest, `index.packages.${name}.latest`, 100)
    if (!Array.isArray(entry.versions) || entry.versions.length === 0 || entry.versions.some(item => typeof item !== 'string' || item.length === 0) || new Set(entry.versions).size !== entry.versions.length || !entry.versions.includes(latest)) fail('versions', `index.packages.${name} 的版本列表必须唯一且包含 latest`)
    safeRelative(entry.path, `index.packages.${name}.path`)
    if (entry.id !== undefined) text(entry.id, `index.packages.${name}.id`, 214)
    if (entry.media !== undefined) parseAgentForgeMedia(entry.media, `index.packages.${name}.media`, fail, 1)
    if (entry.recordRevision !== undefined && (typeof entry.recordRevision !== 'string' || entry.recordRevision !== source.revision)) fail('record-revision', `index.packages.${name} recordRevision 与 source revision 不一致`)
  }
  return index
}

function validatePackage(value: unknown, field: string, targetAgent?: string): Record<string, unknown> {
  const record = object(value, field)
  if (record.media !== undefined) parseAgentForgeMedia(record.media, `${field}.media`, fail)
  const versionSchemes = ['semver', 'npm', 'pep440', 'calver', 'date', 'custom', 'unknown']
  if (record.versionScheme !== undefined && (typeof record.versionScheme !== 'string' || !versionSchemes.includes(record.versionScheme))) fail('version-scheme', `${field}.versionScheme 无效`)
  if (record.schemaVersion !== 2) fail('schema-version', `${field} 必须是 Agent Forge v2`)
  text(record.id, `${field}.id`, 214); text(record.name, `${field}.name`, 214); text(record.version, `${field}.version`, 100)
  if (!TYPES.has(record.type as string)) fail('package-type', `${field}.type 无效`)
  text(record.description, `${field}.description`, 4000)
  if (record.license === undefined || (typeof record.license !== 'string' && !Array.isArray(record.license))) fail('license', `${field}.license 无效`)
  if (!Array.isArray(record.targets) || record.targets.length === 0) fail('targets', `${field}.targets 不能为空`)
  if (targetAgent !== undefined) {
    const target = record.targets.find(item => object(item, `${field}.targets[]`).agentId === targetAgent)
    if (!target) fail('target-missing', `${field} 没有目标 Agent ${targetAgent}`)
    const targetRecord = object(target, `${field}.targets[]`)
    if (!['known', 'unknown'].includes(targetRecord.compatibilityStatus as string)) fail('target-status', `${field} target compatibilityStatus 无效`)
  }
  for (const [index, target] of (record.targets as unknown[]).entries()) {
    const targetRecord = object(target, `${field}.targets[${index}]`)
    if (targetRecord.versionScheme !== undefined && (typeof targetRecord.versionScheme !== 'string' || !versionSchemes.includes(targetRecord.versionScheme))) fail('version-scheme', `${field}.targets[${index}].versionScheme 无效`)
    text(targetRecord.agentId, `${field}.targets[${index}].agentId`, 100)
    if (targetRecord.compatibilityStatus === 'known') {
      text(targetRecord.agentVersionRange, `${field}.targets[${index}].agentVersionRange`, 512)
    } else if (targetRecord.compatibilityStatus === 'unknown') {
      if (targetRecord.agentVersionRange !== null) fail('target-range', `${field}.targets[${index}] 的 unknown 兼容性必须使用 null range`)
      text(targetRecord.compatibilityNote, `${field}.targets[${index}].compatibilityNote`, 2000)
    }
  }
  const detailKey = record.type === 'mcp' ? 'mcpDetails' : record.type === 'plugin' ? 'pluginDetails' : record.type === 'skill' ? 'skillDetails' : record.type === 'general' ? 'generalDetails' : 'bundleDetails'
  const details = object(record[detailKey], `${field}.${detailKey}`)
  if (record.type === 'mcp') { text(details.registryType, `${field}.mcpDetails.registryType`, 32); text(details.identifier, `${field}.mcpDetails.identifier`, 512) }
  if (record.type === 'plugin') text(details.manifestPath, `${field}.pluginDetails.manifestPath`, 4096)
  if (record.type === 'skill') text(details.skillPath, `${field}.skillDetails.skillPath`, 4096)
  if (record.type === 'general') { text(details.toolType, `${field}.generalDetails.toolType`, 100); text(details.agentUse, `${field}.generalDetails.agentUse`, 2000) }
  if (record.type !== 'bundle' && (!Array.isArray(record.distributions) || record.distributions.length === 0)) fail('distributions', `${field}.distributions 不能为空`)
  if (record.type === 'bundle') {
    if (!Array.isArray(details.members) || details.members.length === 0) fail('bundle-members', `${field}.bundleDetails.members 不能为空`)
    for (const [index, member] of details.members.entries()) {
      const item = object(member, `${field}.bundleDetails.members[${index}]`)
      if (!['package', 'bundle'].includes(item.memberType as string)) fail('bundle-member-type', `${field}.bundleDetails.members[${index}] 类型无效`)
      text(item.memberId, `${field}.bundleDetails.members[${index}].memberId`, 214)
    }
  }
  for (const key of ['dependencies', 'conflicts', 'provides', 'replaces'] as const) {
    if (record[key] === undefined) continue
    if (!Array.isArray(record[key])) fail('dependency-invalid', `${field}.${key} 必须是数组`)
    for (const [index, dependency] of (record[key] as unknown[]).entries()) {
      const item = object(dependency, `${field}.${key}[${index}]`)
      text(item.id, `${field}.${key}[${index}].id`, 214)
      if (item.optional !== undefined && typeof item.optional !== 'boolean') fail('dependency-optional', `${field}.${key}[${index}].optional 必须是布尔值`)
    }
  }
  return record
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..'))
}

function localPath(input: string, roots: readonly string[]): string {
  if (!isAbsolute(input) || roots.length === 0 || roots.some(root => !isAbsolute(root))) fail('local-source-not-controlled', '来源路径和 Host 授权根目录必须是绝对路径')
  let path: string
  try { path = realpathSync(resolve(input)) } catch { fail('local-source-missing', 'local-file 来源不存在') }
  const allowed = roots.map(root => { try { return realpathSync(resolve(root)) } catch { return undefined } }).filter((item): item is string => item !== undefined)
  if (!allowed.some(root => inside(root, path))) fail('local-source-not-controlled', 'local-file 来源不在受控目录内')
  if (!statSync(path).isFile() && !statSync(path).isDirectory()) fail('local-source-type', 'local-file 来源必须是文件或目录')
  return path
}

async function remoteJson(url: string, options: AgentForgeSourceOptions): Promise<Uint8Array> {
  const response = await safeFetch(url, { ...options, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) })
  return readLimitedResponse(response, options.maxBytes ?? DEFAULT_MAX_BYTES)
}

function localJson(path: string, maxBytes: number, allowedRoot: string): Uint8Array {
  // Resolve every indexed file, not only the configured source directory.
  let finalPath: string
  try { finalPath = realpathSync(resolve(path)) } catch { fail('local-source-missing', '本地目录文件不存在') }
  if (!inside(allowedRoot, finalPath)) fail('local-source-not-controlled', '本地索引或 package 文件不在授权目录内')
  const before = statSync(finalPath)
  if (!before.isFile() || before.size > maxBytes) fail('document-too-large', `${path} 超过读取上限或不是普通文件`)
  const fd = openSync(finalPath, 'r')
  try {
    const opened = fstatSync(fd)
    const currentPath = localPath(finalPath, [allowedRoot])
    const current = statSync(currentPath)
    if (!opened.isFile() || opened.size > maxBytes || opened.dev !== before.dev || opened.ino !== before.ino || current.dev !== opened.dev || current.ino !== opened.ino) {
      fail('local-file-changed', `${path} 在安全检查期间发生变化`)
    }
    return readFileSync(fd)
  } finally {
    closeSync(fd)
  }
}

export async function readAgentForgeSource(source: MarketCatalogSource, options: AgentForgeSourceOptions = {}): Promise<AgentForgeCatalog> {
  if (!source.enabled) fail('source-disabled', `来源 ${source.id} 已禁用`)
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  if (source.location.mode === 'offline-pack') {
    const path = localPath(source.location.value, options.localRoots ?? [])
    const archiveBytes = localJson(path, options.offlinePack?.maxCompressedBytes ?? DEFAULT_ZIP_LIMITS.maxCompressedBytes, dirname(path))
    const offline = readOfflinePack(archiveBytes, options.offlinePack)
    const sourceRecord = validateSource(offline.source)
    const indexRecord = validateIndex(offline.index, sourceRecord)
    if (sourceRecord.agentId !== offline.manifest.targetAgent || indexRecord.agentId !== offline.manifest.targetAgent) fail('agent-target-mismatch', '离线包 manifest、source 和 index 的 targetAgent 必须一致')
    if (options.targetAgent !== undefined && offline.manifest.targetAgent !== options.targetAgent) fail('agent-target-mismatch', '离线包目标与当前宿主不一致')
    const offlineTargetAgent = options.targetAgent ?? offline.manifest.targetAgent
    const packageRecords = new Map<string, Record<string, unknown>>()
    const packageDocuments = new Map<string, RawDocumentRecord>()
    const identityIds = new Set<string>()
    for (const [pathName, value] of offline.packages) {
      const record = validatePackage(value, pathName, offlineTargetAgent)
      if (packageRecords.has(String(record.name))) fail('duplicate-package-name', `Duplicate offline package name ${String(record.name)}`)
      if (identityIds.has(String(record.id))) fail('duplicate-package-id', `Duplicate offline package id ${String(record.id)}`)
      identityIds.add(String(record.id))
      packageRecords.set(String(record.name), record)
      const bytes = offline.packageBytes.get(pathName)
      if (bytes === undefined) fail('package-bytes-missing', '离线包缺少原始元数据')
      packageDocuments.set(String(record.name), rawDocument(bytes))
    }
    if (source.expectedRevision !== undefined && source.expectedRevision !== sourceRecord.revision) fail('revision-mismatch', '来源 revision 与 expectedRevision 不一致')
    return { source: sourceRecord, index: indexRecord, packages: packageRecords, packageDocuments, advisories: new Map([...offline.advisories].map(([key, value]) => [key, object(value, key)])), sourceRevision: sourceRecord.revision as string, sourceId: sourceRecord.sourceId as string, agentId: sourceRecord.agentId as string | null, stale: false, origin: 'offline-pack', offline }
  }
  let sourceBytes: Uint8Array
  let indexBytes: Uint8Array
  let packageRead: (path: string) => Promise<Uint8Array>
  if (source.location.mode === 'https') {
    let sourceUrl: URL
    try { sourceUrl = new URL(source.location.value) } catch { fail('source-url', 'HTTPS 来源地址无效') }
    if (sourceUrl.protocol !== 'https:') fail('source-url', '在线来源必须使用 HTTPS')
    const sourceUrlString = sourceUrl.href.endsWith('/')
      ? new URL('source.json', sourceUrl).href
      : sourceUrl.pathname.endsWith('/index.json')
        ? new URL('source.json', sourceUrl).href.replace(/index\.json$/, 'source.json')
        : sourceUrl.href
    sourceBytes = await remoteJson(sourceUrlString, options)
    const sourceRecord = validateSource(parseJson(sourceBytes, 'source.json'))
    const baseUrl = new URL(text(sourceRecord.baseUrl, 'source.baseUrl'))
    indexBytes = await remoteJson(new URL(sourceRecord.index as string, baseUrl).href, options)
    packageRead = path => remoteJson(new URL(path, baseUrl).href, options)
  } else {
    const controlled = localPath(source.location.value, options.localRoots ?? [])
    const root = statSync(controlled).isDirectory() ? controlled : dirname(controlled)
    const sourcePath = statSync(controlled).isDirectory() ? join(root, 'source.json') : controlled
    sourceBytes = localJson(sourcePath, maxBytes, root)
    const sourceRecord = validateSource(parseJson(sourceBytes, sourcePath))
    const indexPath = join(root, String(sourceRecord.index))
    indexBytes = localJson(indexPath, maxBytes, root)
    packageRead = path => Promise.resolve(localJson(join(root, path), maxBytes, root))
  }
  const sourceRecord = validateSource(parseJson(sourceBytes, 'source.json'))
  const indexRecord = validateIndex(parseJson(indexBytes, 'index.json'), sourceRecord)
  if (source.expectedRevision !== undefined && source.expectedRevision !== sourceRecord.revision) fail('revision-mismatch', '来源 revision 与 expectedRevision 不一致')
  if (options.targetAgent !== undefined && sourceRecord.agentId !== null && sourceRecord.agentId !== options.targetAgent) fail('agent-target-mismatch', '来源目标 Agent 与当前宿主不一致')
  const targetAgent = options.targetAgent ?? (sourceRecord.agentId === null ? undefined : String(sourceRecord.agentId))
  const packageRecords = new Map<string, Record<string, unknown>>()
  const packageDocuments = new Map<string, RawDocumentRecord>()
  const identityNames = new Map<string, string>()
  const entries = object(indexRecord.packages, 'index.packages')
  for (const [name, raw] of Object.entries(entries)) {
    const entry = object(raw, `index.packages.${name}`)
    const bytes = await packageRead(String(entry.path))
    const record = validatePackage(parseJson(bytes, `package ${name}`), `package ${name}`, targetAgent)
    if (record.name !== name) fail('package-name-mismatch', `索引键 ${name} 与 package record name 不一致`)
    if (record.version !== entry.latest || !Array.isArray(entry.versions) || !entry.versions.includes(record.version)) fail('package-version-mismatch', `索引 latest 与 ${name} package record version 不一致`)
    if (entry.id !== undefined && record.id !== entry.id) fail('package-id-mismatch', `索引 id 与 ${name} package record id 不一致`)
    const id = String(record.id)
    const existingName = identityNames.get(id)
    if (existingName !== undefined && existingName !== name) fail('duplicate-package-id', `Agent Forge id ${id} 对应多个包名`)
    identityNames.set(id, name)
    packageRecords.set(name, record)
    packageDocuments.set(name, rawDocument(bytes))
  }
  return { source: sourceRecord, index: indexRecord, packages: packageRecords, packageDocuments, advisories: new Map(), sourceRevision: sourceRecord.revision as string, sourceId: sourceRecord.sourceId as string, agentId: sourceRecord.agentId as string | null, stale: false, origin: source.location.mode === 'https' ? 'online' : 'local-file' }
}

function rawDocument(bytes: Uint8Array): RawDocumentRecord {
  return { contentBase64: Buffer.from(bytes).toString('base64'), sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
}

/** Convert Agent Forge metadata into validated browse-only market listings.
 * This intentionally produces no installable plugin or delivery rows.
 */
export interface AgentForgeVerifiedArtifact {
  readonly pluginId: string
  readonly packageName: string
  readonly version: string
  readonly artifactDigest: string
  readonly size: number
  readonly packageJson: string
  readonly files: readonly string[]
}

export interface AgentForgeProjectionOptions {
  readonly revision: string
  readonly generatedAt: string
  readonly sourceUrl: string
  /** Only verified offline bundle artifacts may become installable rows. */
  readonly offlineArtifacts?: readonly AgentForgeVerifiedArtifact[]
}

export function projectAgentForgeCatalog(
  catalog: AgentForgeCatalog,
  options: AgentForgeProjectionOptions,
): MarketIndexDocument {
  const revision = text(options.revision, 'projection.revision', 200)
  const generatedAt = checkDate(options.generatedAt, 'projection.generatedAt')
  const sourceUrl = text(options.sourceUrl, 'projection.sourceUrl', 4096)
  let parsedSourceUrl: URL
  try { parsedSourceUrl = new URL(sourceUrl) } catch { fail('projection-source-url', 'sourceUrl 必須是有效 HTTPS 地址') }
  if (parsedSourceUrl.protocol !== 'https:' || parsedSourceUrl.username || parsedSourceUrl.password) fail('projection-source-url', 'sourceUrl 必須是無憑據 HTTPS 地址')
  const ids = new Set<string>()
  const verifiedByPackage = new Map((options.offlineArtifacts ?? []).map(item => [item.packageName, item]))
  const plugins: MarketPluginRecord[] = []
  const presentations: MarketIndexDocument['presentations'][number][] = []
  const deliveries: MarketIndexDocument['deliveries'][number][] = []
  const listings: MarketListingRecord[] = []
  for (const record of catalog.packages.values()) {
    const rawId = text(record.id, 'package.id', 214)
    const normalizedId = rawId.toLowerCase().replace(/[^a-z0-9.-]+/g, '-')
    let id = `agent-forge.${normalizedId}`
    if (Buffer.byteLength(id, 'utf8') > 200) id = `agent-forge.af-${createHash('sha256').update(rawId).digest('hex').slice(0, 32)}`
    if (ids.has(id)) fail('projection-duplicate-id', `多个 Agent Forge ID 映射为 ${id}`)
    ids.add(id)
    const packageName = text(record.name, 'package.name', 214)
    const name = truncateUtf8(packageName, 200)
    const requestedVersion = text(record.version, 'package.version', 100)
    const document = catalog.packageDocuments.get(packageName)
    if (document === undefined) fail('package-bytes-missing', '投影缺少原始 Agent Forge 元数据')
    const agentForgeMetadata = { document, sourceId: catalog.sourceId, sourceRevision: catalog.sourceRevision }
    const media = record.media === undefined ? undefined : parseAgentForgeMedia(record.media, `package ${packageName}.media`, fail)
    const previews = media?.previews ?? []
    const description = typeof record.description === 'string' ? record.description : ''
    const verified = verifiedByPackage.get(packageName)
    const installable = record.type === 'plugin' && verified !== undefined && verified.packageName === packageName && verified.version === requestedVersion && verified.pluginId === rawId
    if (installable) {
      const packageJson = Buffer.from(verified.packageJson, 'utf8').toString('base64')
      const packageJsonDigest = `sha256:${createHash('sha256').update(verified.packageJson, 'utf8').digest('hex')}`
      const license = typeof record.license === 'string' ? record.license : Array.isArray(record.license) ? record.license.filter(item => typeof item === 'string').join(', ') : undefined
      presentations.push({ id: `agent-forge.${rawId}.presentation`, revision, title: name, summary: truncateUtf8(description, 4096) || 'Agent Forge 离线制品', markdown: description || '该制品来自受控 Agent Forge 离线包。', media: previews, sourceUrl: parsedSourceUrl.href, importedAt: generatedAt })
      plugins.push({
        id: rawId, name, packageName, version: requestedVersion, kind: 'plugin',
        summary: truncateUtf8(description, 4096) || 'Agent Forge 离线制品',
        author: typeof record.author === 'string' && record.author.trim() ? record.author : 'Agent Forge',
        ...(license === undefined ? {} : { license }), sourceUrl: parsedSourceUrl.href,
        distribution: 'external', capabilityTier: 'unclassified',
        // Agent Forge target metadata is not a current official-host evidence record.
        verification: 'unknown',
        installability: 'bundle-installable', artifactDigest: verified.artifactDigest,
        presentationId: `agent-forge.${rawId}.presentation`, categories: ['plugin'], screenshots: previews,
        ...(media === undefined ? {} : { media }),
        enabledPolicy: 'default-on', requiresRestart: false, requiresSetup: false, largeExternalResource: false,
        metadata: { kind: 'official-bundle', packageJson: { contentBase64: packageJson, sha256: packageJsonDigest }, files: verified.files },
        agentForgeMetadata,
      })
      deliveries.push({ pluginId: rawId, version: requestedVersion, artifactDigest: verified.artifactDigest, packageName,
        sources: [{ kind: 'cache', ref: verified.artifactDigest, priority: 0, size: verified.size }] })
    } else {
      listings.push({
        id, name, packageName,
        ...(media === undefined ? {} : { media }),
        summary: truncateUtf8(description, 4096) || 'Agent Forge 来源条目；尚未验证为可安装市场制品。',
        reason: 'Agent Forge 元数据已读取；当前尚未绑定市场审核发行与官方安装验证。',
        sourceUrl: parsedSourceUrl.href, requestedVersion,
        agentForgeMetadata,
      })
    }
  }
  const document: MarketIndexDocument = {
    schemaVersion: MARKET_INDEX_SCHEMA_VERSION,
    revision,
    generatedAt,
    plugins,
    listings,
    packs: [],
    presentations,
    deliveries,
    recommendations: [],
  }
  // Validate before returning so callers never receive an invalid projection.
  validateMarketIndex(document, { origin: catalog.stale ? 'cache' : 'online' })
  return document
}
