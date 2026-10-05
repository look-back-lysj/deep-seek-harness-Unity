import { describe, expect, it } from 'vitest'
import type { CatalogPlugin, CatalogSnapshot, HostCoreSnapshot, InventorySnapshot, ReleaseOptionsRequest } from '../../packages/market-core/src/contracts/types.ts'
import { buildReleaseOptions } from '../../packages/market-core/src/host/release-options.ts'

const packageName = '@test/options'
const digest = `sha256:${'a'.repeat(64)}`
const hostCore: HostCoreSnapshot = { agentId: 'dsh', agentName: 'DSH', version: '1.0.0', versionScheme: 'semver', status: 'known', source: 'dsh-runtime-getter', hostRevision: `sha256:${'b'.repeat(64)}` }

function data(count = 25) {
  const plugins: CatalogPlugin[] = Array.from({ length: count }, (_, index) => ({
    id: 'dev.test.options', name: 'Options', packageName, version: `1.${index}.0`, summary: 'test', author: 'test', distribution: 'external', capabilityTier: 'standard',
    verification: 'unverified', installability: 'bundle-installable', artifactDigest: digest, metadataDigest: digest, publication: 'active',
    presentationId: 'test.presentation', categories: [], screenshots: [], enabledPolicy: 'default-on', requiresRestart: false, requiresSetup: false, largeExternalResource: false,
    hostRequirements: { historyCoverage: 'complete', declarations: [{ agentId: 'dsh', range: '^1.0.0', versionScheme: 'npm', origin: 'package-engines', metadataDigest: digest }] },
  }))
  const catalog: CatalogSnapshot = { schemaVersion: '2', revision: 'catalog-one', generatedAt: '2026-10-03T00:00:00Z', origin: 'embedded', stale: false, plugins,
    packs: [], presentations: [], deliveries: plugins.map(plugin => ({ pluginId: plugin.id, packageName, version: plugin.version, artifactDigest: digest, sources: [{ kind: 'cache', ref: digest, priority: 0 }] })),
  }
  const inventory: InventorySnapshot = { environmentId: 'test', revision: 'inventory-one', items: [], unknownItems: [] }
  return { environmentId: 'test', hostCore, catalog, inventory, sources: [{ sourceId: 'accepted-source', snapshot: catalog, provenance: { sourceId: 'accepted-source', revision: 'catalog-one' } }], now: new Date('2026-10-03T00:00:00Z') }
}

describe('有界只读版本列表与快照分页', () => {
  it('默认20条，latest 对完整集合求值；没有前端默认选择或中间态', () => {
    const fixture = data()
    const original = structuredClone(fixture)
    const first = buildReleaseOptions({ packageName }, fixture)
    expect(first.releases).toHaveLength(20)
    expect(first.latestPublished?.version).toBe('1.24.0')
    expect(first.latestCompatible?.version).toBe('1.24.0')
    expect(first.coverage).toMatchObject({ historyCoverage: 'complete', evaluatedRecords: 25, totalKnownRecords: 25 })
    expect(first.releases[0]?.sources).toEqual([{ sourceId: 'accepted-source', revision: 'catalog-one' }])
    expect(first.pagination.hasMore).toBe(true)
    const second = buildReleaseOptions({ packageName, cursor: first.pagination.cursor!, limit: 100 }, { ...fixture, now: new Date('2026-10-03T00:01:00Z') })
    expect(second.releases).toHaveLength(5)
    expect(second.latestPublished).toEqual(first.latestPublished)
    expect(second.pagination).toEqual({ cursor: null, hasMore: false })
    expect([...first.releases, ...second.releases].map(release => release.identity.version)).toHaveLength(25)
    for (const key of ['defaultReleaseId', 'loading', 'modalStep', 'polling', 'buttonDisabled']) expect(first).not.toHaveProperty(key)
    expect(fixture).toEqual(original)
  })

  it.each(['host', 'catalog', 'inventory', 'channel', 'stale', 'release-content'] as const)('%s 改变后不能拼接旧分页', change => {
    const fixture = data()
    const cursor = buildReleaseOptions({ packageName, limit: 1 }, fixture).pagination.cursor!
    const changed = structuredClone(fixture)
    if (change === 'host') Object.assign(changed.hostCore, { version: '2.0.0', hostRevision: `sha256:${'c'.repeat(64)}` })
    if (change === 'catalog') Object.assign(changed.catalog, { revision: 'catalog-two' })
    if (change === 'inventory') Object.assign(changed.inventory, { revision: 'inventory-two' })
    if (change === 'stale') Object.assign(changed.catalog, { stale: true })
    if (change === 'release-content') Object.assign(changed.catalog.plugins[0]!, { verification: 'unknown' })
    expect(() => buildReleaseOptions({ packageName, cursor, ...(change === 'channel' ? { includePrerelease: true } : {}) }, changed)).toThrow(expect.objectContaining({ code: 'release-options/stale-cursor' }))
  })

  it.each([
    null, [], {}, { packageName: '../outside' }, { packageName: 'https://example.com/x.tgz' },
    { packageName, limit: 0 }, { packageName, limit: 101 }, { packageName, limit: 1.5 }, { packageName, limit: '20' },
    { packageName, includePrerelease: 'true' }, { packageName, cursor: '' }, { packageName, cursor: 'x'.repeat(2049) },
    { packageName, hostVersion: '9.0.0' }, { packageName, hostCore }, { packageName, sourceId: 'custom' },
    { packageName, path: 'C:/Users/test/Profile' }, { packageName, url: 'https://example.com/x.tgz' },
  ])('拒绝不受支持的请求 %j', request => {
    expect(() => buildReleaseOptions(request as ReleaseOptionsRequest, data())).toThrow(expect.objectContaining({ code: 'release-options/invalid-request' }))
  })

  it.each(['not-json', '!!!!', Buffer.from('null').toString('base64url'), Buffer.from(JSON.stringify({ schemaVersion: 1, binding: 'fake', offset: -1 })).toString('base64url')])('拒绝损坏 cursor %s', cursor => {
    expect(() => buildReleaseOptions({ packageName, cursor }, data())).toThrow(expect.objectContaining({ code: 'release-options/invalid-cursor' }))
  })

  it('未收录的包不接受任意安装请求', () => {
    expect(() => buildReleaseOptions({ packageName: '@test/absent' }, data())).toThrow(expect.objectContaining({ code: 'release-options/package-not-found' }))
  })

  it('研究 listing 保留历史缺口但不成为发行或制品', () => {
    const fixture = data(0)
    Object.assign(fixture.catalog, { listings: [{ id: 'dev.test.research', name: 'Research', packageName, summary: 'test', reason: 'research', sourceUrl: 'https://example.com/record', requestedVersion: '9.0.0',
      hostRequirements: { historyCoverage: 'latest-only', declarations: [{ agentId: 'dsh', range: '^1.0.0', versionScheme: 'semver', origin: 'agent-forge-target', metadataDigest: digest }] },
    }] })
    const result = buildReleaseOptions({ packageName }, fixture)
    expect(result.coverage).toMatchObject({ historyCoverage: 'latest-only', obtainedRecords: 1, evaluatedRecords: 0, totalKnownRecords: null, reasons: ['release-history-incomplete', 'research-only-records'] })
    expect(result.latestPublished).toBeNull()
    expect(result.latestCompatible).toBeNull()
    expect(result.releases).toEqual([])
  })

  it('目标诊断导致 installed unknown，不从目录补已装版本', () => {
    const fixture = data()
    Object.assign(fixture.inventory, { unknownItems: ['listBundles:unavailable'] })
    const result = buildReleaseOptions({ packageName }, fixture)
    expect(result.installed).toMatchObject({ status: 'unknown', version: null })
    expect(result.releases.every(release => !release.selectable)).toBe(true)
  })

  it('混合来源的合法发行保存全部revision，不制造镜像歧义', () => {
    const fixture = data(1)
    fixture.sources.push({ sourceId: 'second-source', snapshot: { ...fixture.catalog, revision: 'second-revision' }, provenance: { sourceId: 'second-source', revision: 'second-revision' } })
    const result = buildReleaseOptions({ packageName }, fixture)
    expect(result.releases[0]?.sources).toEqual([{ sourceId: 'accepted-source', revision: 'catalog-one' }, { sourceId: 'second-source', revision: 'second-revision' }])
    expect(result.publishedAmbiguous).toBe(false)
  })

  it('上游 Agent Forge 身份不能由本地来源槽位或投影revision代替', () => {
    const fixture = data(1)
    const { provenance: _provenance, ...localSource } = fixture.sources[0]!
    Object.assign(localSource, { sourceId: 'agent-forge:local-alias', snapshot: { ...fixture.catalog, revision: 'af-local-alias-upstream-r17' } })
    Object.assign(fixture.catalog.plugins[0]!.hostRequirements!.declarations[0]!, { origin: 'agent-forge-target', sourceId: 'agent-forge:upstream:plugin', sourceRevision: 'upstream-r17' })
    const result = buildReleaseOptions({ packageName }, { ...fixture, sources: [localSource] })
    expect(result.releases[0]?.sources).toEqual([{ sourceId: 'agent-forge:upstream:plugin', revision: 'upstream-r17' }])
    expect(JSON.stringify(result.releases[0]?.sources)).not.toContain('local-alias')
  })

  it('没有证明的来源保持缺项，不从本地标签补造上游身份', () => {
    const fixture = data(1)
    const { provenance: _provenance, ...localSource } = fixture.sources[0]!
    const result = buildReleaseOptions({ packageName }, { ...fixture, sources: [localSource] })
    expect(result.releases[0]?.sources).toEqual([])
    expect(result.coverage.reasons).toContain('release-source-unknown')
  })

  it('已暂停的同包冲突通过问题事实解释，不成为适配发行', () => {
    const fixture = data(1)
    const merged: CatalogSnapshot = { ...fixture.catalog, plugins: [], deliveries: [], mergeIssues: [{ code: 'content-conflict', table: 'plugins', key: JSON.stringify(['dev.test.options', '1.0.0']), message: '元数据冲突', candidates: [{ sourceId: 'accepted-source', revision: 'catalog-one', contentDigest: digest }] }] }
    const result = buildReleaseOptions({ packageName }, { ...fixture, catalog: merged })
    expect(result.latestPublished).toBeNull()
    expect(result.releases).toEqual([])
    expect(result.issues).toEqual(merged.mergeIssues)
    expect(result.coverage.reasons).toContain('catalog-merge-issues')
  })
})
