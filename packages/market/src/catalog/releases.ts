/** 私有发行记录；这里只检查材料一致性，不将许可声明当作法律认证或运行证据。 */
import type { ReleaseRecord, ReleaseProvenance, ReleaseStatusRecord, MarketCollection } from './model.ts'
import * as v from './input.ts'

export function releaseIdFor(record: Pick<ReleaseRecord, 'pluginId' | 'packageName' | 'version' | 'artifactDigest'>): string {
  return `release-${v.hash(JSON.stringify([record.pluginId, record.packageName, record.version, record.artifactDigest])).slice(7)}`
}

export function parseRelease(value: unknown): ReleaseRecord {
  const item = v.object(value, 'release')
  if (item.schemaVersion !== '1') v.invalid('release-schema', '不支持的发行记录版本')
  const origin = v.object(item.provenance, 'release.provenance')
  const authorization = v.object(origin.authorization, 'authorization')
  if (!['license', 'permission'].includes(String(authorization.basis)) || authorization.redistribution !== true) v.invalid('authorization-required', '发行必须记录明确的再分发依据')
  const commit = v.string(origin.commit, 'commit', 40)
  if (!/^[a-f0-9]{40}$/.test(commit)) v.invalid('fixed-source-required', '源码必须固定到完整 commit')
  const common = {
    repositoryUrl: v.httpsUrl(origin.repositoryUrl, 'repositoryUrl'), commit,
    license: v.string(origin.license, 'license', 200),
    authorization: { basis: authorization.basis as 'license' | 'permission', reference: v.string(authorization.reference, 'authorization.reference'), redistribution: true as const },
  }
  let provenance: ReleaseProvenance
  if (origin.kind === 'author-release') {
    provenance = { ...common, kind: 'author-release', releaseUrl: v.httpsUrl(origin.releaseUrl, 'releaseUrl') }
  } else if (origin.kind === 'team-build') {
    const target = v.object(origin.target, 'target')
    if (!['win32', 'linux', 'darwin'].includes(String(target.os)) || !['x64', 'arm64'].includes(String(target.arch))) v.invalid('build-target', '构建目标无效')
    const toolchain = v.array(origin.toolchain, 'toolchain', 16).map(entry => {
      const tool = v.object(entry, 'toolchain[]')
      return { name: v.string(tool.name, 'tool.name', 100), version: v.exactVersion(tool.version, 'tool.version') }
    })
    if (!toolchain.length) v.invalid('build-toolchain', '团队构建必须记录精确工具链')
    provenance = { ...common, kind: 'team-build', sourceSubdir: origin.sourceSubdir === '.' ? '.' : v.relativeFile(origin.sourceSubdir, 'sourceSubdir'), lockDigest: v.digest(origin.lockDigest, 'lockDigest'), recipeDigest: v.digest(origin.recipeDigest, 'recipeDigest'), toolchain, target: { os: String(target.os), arch: String(target.arch) }, buildRun: v.string(origin.buildRun, 'buildRun'), ...(origin.derivedFrom === undefined ? {} : { derivedFrom: v.string(origin.derivedFrom, 'derivedFrom') }) }
  } else v.invalid('release-provenance-kind', '发行来源只接受 author-release 或 team-build')
  const release: ReleaseRecord = {
    schemaVersion: '1', releaseId: v.string(item.releaseId, 'releaseId', 100), pluginId: v.string(item.pluginId, 'pluginId', 200),
    packageName: v.string(item.packageName, 'packageName', 214), version: v.exactVersion(item.version, 'version'),
    artifactDigest: v.digest(item.artifactDigest, 'artifactDigest'), metadataDigest: v.digest(item.metadataDigest, 'metadataDigest'),
    size: v.integer(item.size, 'size', 1, 500 * 1024 * 1024), provenance,
    ...(item.publishedAt === undefined ? {} : { publishedAt: v.timestamp(item.publishedAt, 'publishedAt') }),
  }
  if (release.releaseId !== releaseIdFor(release)) v.invalid('release-id', 'releaseId 未绑定精确身份和制品摘要')
  return release
}

export function parseReleaseStatus(value: unknown): ReleaseStatusRecord {
  const item = v.object(value, 'releaseStatus')
  if (item.status !== 'active' && item.status !== 'withdrawn') v.invalid('release-status', '发行状态无效')
  return { releaseId: v.string(item.releaseId, 'releaseId', 100), sequence: v.integer(item.sequence, 'status.sequence', 1), status: item.status, reason: v.string(item.reason, 'status.reason'), effectiveAt: v.timestamp(item.effectiveAt, 'status.effectiveAt') }
}

export function parseCollection(value: unknown, releases: ReadonlyMap<string, ReleaseRecord>): MarketCollection {
  const item = v.object(value, 'collection')
  if (item.kind !== 'MarketCollection' || item.schemaVersion !== '1') v.invalid('collection-kind', '私有组合必须明确声明 MarketCollection，不是公共 Pack')
  const components = v.array(item.components, 'collection.components', 64).map(value => {
    const part = v.object(value, 'component')
    const releaseId = v.string(part.releaseId, 'releaseId', 100)
    const release = releases.get(releaseId)
    if (!release || release.pluginId !== part.pluginId || release.version !== part.version || release.artifactDigest !== part.artifactDigest) v.invalid('collection-release', '私有组合必须引用实际发行记录与精确摘要')
    return { pluginId: release.pluginId, version: release.version, releaseId, artifactDigest: release.artifactDigest, required: v.boolean(part.required, 'required'), enabled: v.boolean(part.enabled, 'enabled') }
  })
  if (!components.length || new Set(components.map(part => part.pluginId)).size !== components.length) v.invalid('collection-components', '私有组合组件为空或重复')
  const execution = v.object(item.execution, 'execution')
  if (!['complete', 'partial', 'unknown'].includes(String(execution.coverage))) v.invalid('collection-coverage', '私有组合执行关系覆盖无效')
  const edges = v.array(execution.edges, 'execution.edges', 4096).map(value => {
    const edge = v.object(value, 'edge')
    if (edge.milestone !== 'installed' && edge.milestone !== 'active') v.invalid('collection-edge', '执行依赖状态无效')
    return { prerequisiteId: v.string(edge.prerequisiteId, 'prerequisiteId', 200), consumerId: v.string(edge.consumerId, 'consumerId', 200), milestone: edge.milestone as 'installed' | 'active' }
  })
  return { kind: 'MarketCollection', schemaVersion: '1', id: v.string(item.id, 'collection.id', 200), version: v.exactVersion(item.version, 'collection.version'), name: v.string(item.name, 'collection.name', 200), summary: v.string(item.summary, 'collection.summary'), components, execution: { coverage: execution.coverage as 'complete' | 'partial' | 'unknown', edges, provenance: v.string(execution.provenance, 'execution.provenance') } }
}
