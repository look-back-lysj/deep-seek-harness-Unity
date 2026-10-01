/** Agent Forge v2 source adapter。
 *
 * 这个模块只处理元数据读取和一致性校验，不下载或安装插件。在线来源
 * 经过 HTTPS 安全边界；本地来源必须由 Host 显式限定允许目录；离线包
 * 走独立的 `.eacpack` 校验器。未知 `_meta` 字段保留在返回记录中。
 */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep, dirname, join } from 'node:path'
import type { MarketCatalogSource } from '../contracts/types.ts'
import { readOfflinePackFile, type OfflinePackContents, type OfflinePackLimits } from './offline-pack.ts'
import { readLimitedResponse, safeFetch, type RemoteSecurityOptions } from '../delivery/security.ts'

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

/** Keeps the last valid Agent Forge projection when a later refresh fails. */
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
      return { status: 'failed', current: { ...this.cached, stale: true }, reason }
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
    if (!Array.isArray(entry.versions) || entry.versions.length === 0 || entry.versions.some(item => typeof item !== 'string' || item.length === 0) || !entry.versions.includes(latest)) fail('versions', `index.packages.${name} 的 latest 不在 versions 中`)
    safeRelative(entry.path, `index.packages.${name}.path`)
    if (entry.recordRevision !== undefined && (typeof entry.recordRevision !== 'string' || entry.recordRevision !== source.revision)) fail('record-revision', `index.packages.${name} recordRevision 与 source revision 不一致`)
  }
  return index
}

function validatePackage(value: unknown, field: string, targetAgent?: string): Record<string, unknown> {
  const record = object(value, field)
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
  if (!isAbsolute(input) || roots.length === 0) fail('local-source-not-controlled', 'local-file 来源必须由 Host 提供绝对路径并限定允许目录')
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

function localJson(path: string, maxBytes: number): Uint8Array {
  const stat = statSync(path)
  if (!stat.isFile() || stat.size > maxBytes) fail('document-too-large', `${path} 超过读取上限`)
  return readFileSync(path)
}

export async function readAgentForgeSource(source: MarketCatalogSource, options: AgentForgeSourceOptions = {}): Promise<AgentForgeCatalog> {
  if (!source.enabled) fail('source-disabled', `来源 ${source.id} 已禁用`)
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  if (source.location.mode === 'offline-pack') {
    const path = localPath(source.location.value, options.localRoots ?? [])
    const offline = readOfflinePackFile(path, options.offlinePack)
    const sourceRecord = validateSource(offline.source)
    const indexRecord = validateIndex(offline.index, sourceRecord)
    const packageRecords = new Map<string, Record<string, unknown>>()
    for (const [pathName, value] of offline.packages) {
      const record = validatePackage(value, pathName, options.targetAgent)
      packageRecords.set(String(record.name), record)
    }
    if (source.expectedRevision !== undefined && source.expectedRevision !== sourceRecord.revision) fail('revision-mismatch', '来源 revision 与 expectedRevision 不一致')
    return { source: sourceRecord, index: indexRecord, packages: packageRecords, advisories: new Map([...offline.advisories].map(([key, value]) => [key, object(value, key)])), sourceRevision: sourceRecord.revision as string, sourceId: sourceRecord.sourceId as string, agentId: sourceRecord.agentId as string | null, stale: false, origin: 'offline-pack', offline }
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
    sourceBytes = localJson(sourcePath, maxBytes)
    const sourceRecord = validateSource(parseJson(sourceBytes, sourcePath))
    const indexPath = join(root, String(sourceRecord.index))
    indexBytes = localJson(indexPath, maxBytes)
    packageRead = path => Promise.resolve(localJson(join(root, path), maxBytes))
  }
  const sourceRecord = validateSource(parseJson(sourceBytes, 'source.json'))
  const indexRecord = validateIndex(parseJson(indexBytes, 'index.json'), sourceRecord)
  if (source.expectedRevision !== undefined && source.expectedRevision !== sourceRecord.revision) fail('revision-mismatch', '来源 revision 与 expectedRevision 不一致')
  const packageRecords = new Map<string, Record<string, unknown>>()
  const entries = object(indexRecord.packages, 'index.packages')
  for (const [name, raw] of Object.entries(entries)) {
    const entry = object(raw, `index.packages.${name}`)
    const record = validatePackage(parseJson(await packageRead(String(entry.path)), `package ${name}`), `package ${name}`, options.targetAgent)
    packageRecords.set(name, record)
  }
  return { source: sourceRecord, index: indexRecord, packages: packageRecords, advisories: new Map(), sourceRevision: sourceRecord.revision as string, sourceId: sourceRecord.sourceId as string, agentId: sourceRecord.agentId as string | null, stale: false, origin: source.location.mode === 'https' ? 'online' : 'local-file' }
}
