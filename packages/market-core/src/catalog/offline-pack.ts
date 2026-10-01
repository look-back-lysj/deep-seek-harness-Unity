/** Agent Forge 离线包读取与完整性校验。
 *
 * `.eacpack` 是 ZIP 容器，但包内路径、摘要和依赖关系仍必须由 Core
 * 独立核验。读取成功只代表离线资料自洽，不代表制品已安装或安全审查通过。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { OfflinePackArtifact, OfflinePackManifest } from '../contracts/types.ts'
import { createZip, readZip, safeZipPath, type ZipLimits } from '../authoring/zip.ts'

export class OfflinePackError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'OfflinePackError'
    this.code = code
  }
}

export interface OfflinePackLimits extends ZipLimits {
  readonly maxManifestBytes?: number
  readonly maxMetadataBytes?: number
  readonly maxPackages?: number
  readonly maxArtifactBytes?: number
}

export interface OfflinePackContents {
  readonly manifest: OfflinePackManifest
  readonly source: unknown
  readonly index: unknown
  readonly packages: ReadonlyMap<string, unknown>
  readonly advisories: ReadonlyMap<string, unknown>
  readonly artifacts: ReadonlyMap<string, Uint8Array>
  readonly artifactEntries: readonly OfflinePackArtifact[]
}

export interface OfflinePackBuildInput {
  readonly manifest: OfflinePackManifest
  readonly sourceBytes: Uint8Array
  readonly indexBytes: Uint8Array
  /** Keys are source-relative package record paths, e.g. `packages/foo.json`. */
  readonly packageRecords: ReadonlyMap<string, Uint8Array>
  readonly advisories?: ReadonlyMap<string, Uint8Array>
  /** Keys are the manifest's `sha256:<digest>` values. */
  readonly artifacts: ReadonlyMap<string, Uint8Array>
}

const DEFAULTS: Required<Pick<OfflinePackLimits, 'maxManifestBytes' | 'maxMetadataBytes' | 'maxPackages' | 'maxArtifactBytes'>> = {
  maxManifestBytes: 512 * 1024,
  maxMetadataBytes: 8 * 1024 * 1024,
  maxPackages: 10_000,
  maxArtifactBytes: 200 * 1024 * 1024,
}

function fail(code: string, message: string): never {
  throw new OfflinePackError(`offline-pack/${code}`, message)
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-field', `${field} 必须是对象`)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, max = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > max) fail('invalid-field', `${field} 无效`)
  return value
}

function safePath(value: unknown, field: string): string {
  const path = text(value, field).replace(/^\.\//, '')
  if (path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    fail('unsafe-path', `${field} 不是安全的包内相对路径`)
  }
  return path
}

function digest(value: unknown, field: string): string {
  const result = text(value, field, 71)
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) fail('invalid-digest', `${field} 必须是 sha256:<64位小写十六进制>`)
  return result
}

function json(bytes: Uint8Array, field: string, max: number): unknown {
  if (bytes.byteLength > max) fail('metadata-too-large', `${field} 超过体积限制`)
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { fail('invalid-json', `${field} 不是合法 JSON`) }
}

function validateManifest(value: unknown, maxPackages: number): OfflinePackManifest {
  const item = object(value, 'manifest')
  if (item.schemaVersion !== '1') fail('manifest-schema', 'manifest.schemaVersion 必须是 1')
  const packId = text(item.packId, 'manifest.packId', 200)
  const sourceRevision = text(item.sourceRevision, 'manifest.sourceRevision', 128)
  const targetAgent = text(item.targetAgent, 'manifest.targetAgent', 100)
  if (!Array.isArray(item.packages) || item.packages.length > maxPackages) fail('manifest-packages', 'manifest.packages 数量无效')
  const packages = item.packages.map((raw, index) => {
    const entry = object(raw, `manifest.packages[${index}]`)
    if (entry.optional !== true) fail('manifest-optional', '离线包中的所有项目必须明确 optional=true')
    const result: OfflinePackManifest['packages'][number] = {
      pluginId: text(entry.pluginId, `manifest.packages[${index}].pluginId`, 214),
      packageName: text(entry.packageName, `manifest.packages[${index}].packageName`, 214),
      version: text(entry.version, `manifest.packages[${index}].version`, 100),
      artifactDigest: digest(entry.artifactDigest, `manifest.packages[${index}].artifactDigest`),
      optional: true,
    }
    return result
  })
  const packageKeys = new Set<string>()
  for (const entry of packages) {
    const key = `${entry.pluginId}@${entry.version}`
    if (packageKeys.has(key)) fail('duplicate-package', `manifest.packages 重复 ${key}`)
    packageKeys.add(key)
  }
  if (!Array.isArray(item.artifacts) || item.artifacts.length > maxPackages) fail('manifest-artifacts', 'manifest.artifacts 数量无效')
  const artifacts = item.artifacts.map((raw, index) => {
    const entry = object(raw, `manifest.artifacts[${index}]`)
    const result: OfflinePackArtifact = {
      digest: digest(entry.digest, `manifest.artifacts[${index}].digest`),
      filename: safePath(entry.filename, `manifest.artifacts[${index}].filename`).split('/').pop() ?? '',
      size: typeof entry.size === 'number' && Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : fail('manifest-size', 'artifact.size 无效'),
      relativePath: safePath(entry.relativePath, `manifest.artifacts[${index}].relativePath`),
    }
    const expectedPrefix = `artifacts/sha256/${result.digest.slice(7)}/`
    if (result.relativePath !== `${expectedPrefix}${result.filename}`) fail('artifact-path', 'artifact.relativePath 必须按摘要寻址')
    return result
  })
  const artifactDigests = new Set<string>()
  for (const entry of artifacts) {
    if (artifactDigests.has(entry.digest)) fail('duplicate-artifact', `manifest.artifacts 重复 ${entry.digest}`)
    artifactDigests.add(entry.digest)
  }
  return { schemaVersion: '1', packId, sourceRevision, targetAgent, packages, artifacts }
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  return object(value, field)
}

function validateCrossReferences(manifest: OfflinePackManifest, source: unknown, index: unknown, packages: ReadonlyMap<string, unknown>, artifacts: ReadonlyMap<string, Uint8Array>): void {
  const sourceRecord = asRecord(source, 'agent-forge/source.json')
  const indexRecord = asRecord(index, 'agent-forge/index.json')
  if (sourceRecord.schemaVersion !== 2 || indexRecord.schemaVersion !== 2) fail('agent-forge-schema', '离线包必须包含 Agent Forge v2 元数据')
  if (sourceRecord.revision !== manifest.sourceRevision || indexRecord.revision !== manifest.sourceRevision) fail('revision-mismatch', '离线包 source/index/revision 不一致')
  if (sourceRecord.sourceId !== indexRecord.sourceId) fail('source-id-mismatch', 'source/index sourceId 不一致')
  const indexPackages = asRecord(indexRecord.packages, 'agent-forge/index.json.packages')
  const packageById = new Map<string, Record<string, unknown>>()
  for (const [key, value] of packages) {
    const record = asRecord(value, `package ${key}`)
    const id = text(record.id, `package ${key}.id`, 214)
    packageById.set(id, record)
  }
  for (const item of manifest.packages) {
    const record = packageById.get(item.pluginId)
    if (!record || record.name !== item.packageName || record.version !== item.version) fail('package-mismatch', `manifest 项目 ${item.pluginId}@${item.version} 缺少对应记录`)
    const indexEntry = asRecord(indexPackages[item.packageName], `index.packages.${item.packageName}`)
    const recordPath = safePath(indexEntry.path, `index.packages.${item.packageName}.path`)
    if (!packages.has(`agent-forge/${recordPath}`) && !packages.has(recordPath)) fail('package-record-missing', `index 指向的记录不存在 ${recordPath}`)
    const versions = indexEntry.versions
    if (!Array.isArray(versions) || !versions.includes(item.version)) fail('index-package-mismatch', `index 缺少 ${item.packageName}@${item.version}`)
    if (!artifacts.has(item.artifactDigest)) fail('artifact-missing', `缺少 ${item.artifactDigest} 制品`)
  }
  for (const [id, record] of packageById) {
    const dependencies = record.dependencies
    if (dependencies === undefined) continue
    if (!Array.isArray(dependencies)) fail('dependency-invalid', `${id}.dependencies 必须是数组`)
    for (const dependency of dependencies) {
      const dep = asRecord(dependency, `${id}.dependencies[]`)
      const depId = text(dep.id, `${id}.dependencies[].id`, 214)
      if (!packageById.has(depId)) fail('dependency-missing', `${id} 依赖 ${depId}，但离线包未包含该记录`)
    }
  }
}

export function readOfflinePack(bytes: Uint8Array, options: OfflinePackLimits = {}): OfflinePackContents {
  const limits = {
    ...DEFAULTS,
    ...options,
    maxManifestBytes: options.maxManifestBytes ?? DEFAULTS.maxManifestBytes,
    maxMetadataBytes: options.maxMetadataBytes ?? DEFAULTS.maxMetadataBytes,
    maxPackages: options.maxPackages ?? DEFAULTS.maxPackages,
    maxArtifactBytes: options.maxArtifactBytes ?? DEFAULTS.maxArtifactBytes,
  }
  const entries = readZip(bytes, options)
  const byPath = new Map(entries.map(entry => [entry.path, entry.data]))
  const manifestBytes = byPath.get('manifest.json')
  const sourceBytes = byPath.get('agent-forge/source.json')
  const indexBytes = byPath.get('agent-forge/index.json')
  if (!manifestBytes || !sourceBytes || !indexBytes) fail('missing-entry', '离线包缺少 manifest.json 或 Agent Forge source/index')
  const manifest = validateManifest(json(manifestBytes, 'manifest.json', limits.maxManifestBytes), limits.maxPackages)
  const source = json(sourceBytes, 'agent-forge/source.json', limits.maxMetadataBytes)
  const index = json(indexBytes, 'agent-forge/index.json', limits.maxMetadataBytes)
  const packagePaths = entries.filter(entry => entry.path.startsWith('agent-forge/packages/') && entry.path.endsWith('.json'))
  if (packagePaths.length === 0 || packagePaths.length > limits.maxPackages) fail('missing-packages', '离线包缺少 package records')
  const packages = new Map<string, unknown>()
  for (const entry of packagePaths) {
    packages.set(entry.path, json(entry.data, entry.path, limits.maxMetadataBytes))
  }
  const advisories = new Map<string, unknown>()
  for (const entry of entries.filter(item => item.path.startsWith('advisories/') && item.path.endsWith('.json'))) advisories.set(entry.path, json(entry.data, entry.path, limits.maxMetadataBytes))
  const artifacts = new Map<string, Uint8Array>()
  for (const artifact of manifest.artifacts) {
    const data = byPath.get(artifact.relativePath)
    if (!data) fail('artifact-missing', `离线包缺少 ${artifact.relativePath}`)
    if (data.byteLength !== artifact.size) fail('artifact-size-mismatch', `${artifact.relativePath} 体积不符`)
    if (data.byteLength > limits.maxArtifactBytes) fail('artifact-too-large', `${artifact.relativePath} 超过体积限制`)
    const actual = `sha256:${createHash('sha256').update(data).digest('hex')}`
    if (actual !== artifact.digest) fail('artifact-digest-mismatch', `${artifact.relativePath} 摘要不符`)
    artifacts.set(artifact.digest, data)
  }
  validateCrossReferences(manifest, source, index, packages, artifacts)
  return { manifest, source, index, packages, advisories, artifacts, artifactEntries: manifest.artifacts }
}

export function readOfflinePackFile(path: string, options: OfflinePackLimits = {}): OfflinePackContents {
  return readOfflinePack(readFileSync(path), options)
}

/**
 * Build a portable `.eacpack` and run the same importer validation before
 * returning it. The caller supplies bytes, while all archive paths are fixed
 * under the controlled manifest layout.
 */
export function createOfflinePack(input: OfflinePackBuildInput): Uint8Array {
  const entries: { readonly path: string; readonly data: Uint8Array }[] = [
    { path: 'manifest.json', data: Buffer.from(JSON.stringify(input.manifest), 'utf8') },
    { path: 'agent-forge/source.json', data: new Uint8Array(input.sourceBytes) },
    { path: 'agent-forge/index.json', data: new Uint8Array(input.indexBytes) },
  ]
  for (const [path, bytes] of input.packageRecords) entries.push({ path: `agent-forge/${safeZipPath(path)}`, data: new Uint8Array(bytes) })
  for (const [path, bytes] of input.advisories ?? []) entries.push({ path: `advisories/${safeZipPath(path)}`, data: new Uint8Array(bytes) })
  for (const artifact of input.manifest.artifacts) {
    const bytes = input.artifacts.get(artifact.digest)
    if (bytes === undefined) fail('artifact-missing', `构建离线包缺少 ${artifact.digest}`)
    entries.push({ path: safeZipPath(artifact.relativePath), data: new Uint8Array(bytes) })
  }
  const archive = createZip(entries)
  readOfflinePack(archive)
  return archive
}
