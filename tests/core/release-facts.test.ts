import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CatalogPlugin, CatalogSnapshot, HostCoreSnapshot, InventorySnapshot } from '../../packages/market-core/src/contracts/types.ts'
import { evaluatePackageReleaseFacts, type ReleaseCandidate } from '../../packages/market-core/src/core/release-facts.ts'

interface FixtureRelease {
  readonly version: string
  readonly range: string | null
  readonly artifactStatus?: 'available' | 'missing'
  readonly verification?: CatalogPlugin['verification']
  readonly artifactDigest?: string
  readonly sourceId?: string
  readonly targetAgentId?: string
  readonly publication?: 'active' | 'withdrawn'
}

interface FixtureCase {
  readonly id: string
  readonly title: string
  readonly scope: string
  readonly input: { readonly hostVersion: string | null; readonly installedVersion: string | null; readonly releases: readonly FixtureRelease[]; readonly includePrerelease?: boolean; readonly catalogStale?: boolean }
  readonly expected: { readonly latestPublished?: string | null; readonly latestCompatible?: string | null; readonly latestCompatibilityReason?: string; readonly compatibility?: string; readonly excludedReason?: string; readonly coreTooOldNotice?: boolean; readonly conflictReason?: string; readonly preserveVerification?: string; readonly latestSelectable?: boolean }
}

const fixture = JSON.parse(readFileSync(new URL('../../docs/handoff/fixtures/host-core-compatibility-cases.v1.json', import.meta.url), 'utf8')) as { cases: readonly FixtureCase[] }
const packageName = '@test/release-facts'
const digest = `sha256:${'a'.repeat(64)}`
const host = (version: string | null): HostCoreSnapshot => ({ agentId: 'fixture-agent', agentName: '测试 Agent', version, versionScheme: 'semver', status: version === null ? 'unknown' : 'known', hostRevision: 'host-test', source: 'synthetic-explicit-binding' })

function candidate(release: FixtureRelease): ReleaseCandidate {
  return {
    publication: release.publication ?? 'active',
    plugin: {
      id: 'dev.test.release-facts', name: '测试发行', packageName, version: release.version,
      summary: 'test', author: 'test', distribution: 'external', capabilityTier: 'standard',
      verification: release.verification ?? 'unverified', installability: release.artifactStatus === 'missing' ? 'missing-artifact' : 'bundle-installable',
      ...(release.artifactStatus === 'missing' ? {} : { artifactDigest: release.artifactDigest ?? digest }), metadataDigest: digest,
      presentationId: 'test.presentation', categories: [], screenshots: [], enabledPolicy: 'default-on', requiresRestart: false, requiresSetup: false, largeExternalResource: false,
      hostRequirements: { historyCoverage: 'latest-only', declarations: [{ agentId: release.targetAgentId ?? 'fixture-agent', range: release.range, versionScheme: 'semver', origin: 'agent-forge-target', metadataDigest: digest,
        ...(release.sourceId === undefined ? {} : { sourceId: release.sourceId }),
      }] },
    },
  }
}

function inputs(releases: readonly FixtureRelease[], installedVersion: string | null = '1.0.0') {
  const candidates = releases.map(candidate)
  const catalog: Pick<CatalogSnapshot, 'revision' | 'stale' | 'deliveries'> = { revision: 'catalog-test', stale: false, deliveries: candidates.flatMap(({ plugin }) => plugin.artifactDigest === undefined ? [] : [{ pluginId: plugin.id, packageName, version: plugin.version, artifactDigest: plugin.artifactDigest, sources: [{ kind: 'cache' as const, ref: plugin.artifactDigest, priority: 0 }] }]) }
  const inventory: InventorySnapshot = { environmentId: 'test', revision: 'inventory-test', unknownItems: [], items: installedVersion === null ? [] : [{ packageName, version: installedVersion, installed: true, bundleEnabled: true, source: 'profile', removable: true, rows: [], restartRequired: false }] }
  return { candidates, catalog, inventory }
}

describe('已接受发行的纯版本事实，前端仍负责默认选择', () => {
  it.each(fixture.cases.filter(item => item.scope === 'version-facts'))('$id $title（仅核对后端事实）', item => {
    const data = inputs(item.input.releases, item.input.installedVersion)
    const facts = evaluatePackageReleaseFacts(host(item.input.hostVersion), packageName, data.candidates, { ...data.catalog, stale: item.input.catalogStale ?? false }, data.inventory, { includePrerelease: item.input.includePrerelease ?? false })
    if ('latestPublished' in item.expected) expect(facts.latestPublished?.version ?? null).toBe(item.expected.latestPublished)
    if ('latestCompatible' in item.expected) expect(facts.latestCompatible?.version ?? null).toBe(item.expected.latestCompatible)
    const published = facts.releases.find(release => release.identity.version === facts.latestPublished?.version)
    if (item.expected.latestCompatibilityReason !== undefined) expect((published ?? facts.releases[0])?.compatibility.reason).toBe(item.expected.latestCompatibilityReason)
    if (item.expected.compatibility !== undefined) expect(facts.releases[0]?.compatibility.status).toBe(item.expected.compatibility)
    if (item.expected.excludedReason !== undefined) expect(facts.releases[0]?.exclusionReason).toBe(item.expected.excludedReason)
    if (item.expected.coreTooOldNotice !== undefined) expect(published?.compatibility.reason === 'core-too-old').toBe(item.expected.coreTooOldNotice)
    if (item.expected.conflictReason !== undefined) expect(facts.releases.every(release => release.compatibility.reason === item.expected.conflictReason)).toBe(true)
    if (item.expected.preserveVerification !== undefined) expect(facts.releases[0]?.verification).toBe(item.expected.preserveVerification)
    if (item.expected.latestSelectable !== undefined) expect(published?.selectable).toBe(item.expected.latestSelectable)
    expect(facts).not.toHaveProperty('defaultReleaseId')
    expect(facts).not.toHaveProperty('clientDefaultUpgrade')
    expect(facts.catalogStale).toBe(item.input.catalogStale ?? false)
  })

  it('相同 precedence 的两种 build 身份公开歧义，不选择任意胜者', () => {
    const data = inputs([{ version: '1.1.0+build.a', range: '^1.0.0' }, { version: '1.1.0+build.b', range: '^1.0.0' }])
    const facts = evaluatePackageReleaseFacts(host('1.0.0'), packageName, data.candidates, data.catalog, data.inventory)
    expect(facts.latestPublished).toBeNull()
    expect(facts.latestCompatible).toBeNull()
    expect(facts.publishedAmbiguous).toBe(true)
    expect(facts.latestCompatibleCandidates.map(identity => identity.version)).toEqual(['1.1.0+build.a', '1.1.0+build.b'])
    expect(facts.releases.every(release => release.selectable)).toBe(true)
  })

  it('较新已安装版本是真实事实，不被目录覆盖，也不产生后端默认降级', () => {
    const data = inputs([{ version: '2.0.0', range: '^1.0.0' }], '3.0.0')
    const facts = evaluatePackageReleaseFacts(host('1.0.0'), packageName, data.candidates, data.catalog, data.inventory)
    expect(facts.installed).toEqual({ status: 'known', version: '3.0.0' })
    expect(facts.releases[0]?.relation).toBe('downgrade')
    expect(facts.releases[0]?.confirmationRequirements).toEqual(['ordinary-plan', 'downgrade'])
  })

  it.each(['bundle-entry:duplicate:' + packageName, 'listBundles:unavailable', 'bundle-version:' + packageName])('目标或全局未知 %s 不以目录填补已安装版本', issue => {
    const data = inputs([{ version: '1.1.0', range: '*' }])
    const facts = evaluatePackageReleaseFacts(host('1.0.0'), packageName, data.candidates, data.catalog, { ...data.inventory, unknownItems: [issue] })
    expect(facts.installed).toMatchObject({ status: 'unknown', version: null })
    expect(facts.releases[0]?.relation).toBe('unknown')
    expect(facts.releases[0]?.selectable).toBe(false)
  })

  it('无关未知不影响目标已安装事实；重复包库存仍为未知', () => {
    const data = inputs([{ version: '1.1.0', range: '*' }])
    const facts = evaluatePackageReleaseFacts(host('1.0.0'), packageName, data.candidates, data.catalog, { ...data.inventory, unknownItems: ['bundle-version:other'] })
    expect(facts.installed.status).toBe('known')
    expect(facts.releases[0]?.selectable).toBe(true)
    expect(evaluatePackageReleaseFacts(host('1.0.0'), packageName, data.candidates, data.catalog, { ...data.inventory, items: [...data.inventory.items, ...data.inventory.items] }).installed.status).toBe('unknown')
  })

  it('制品缺失和未实测不改变范围结果或 latestCompatible', () => {
    const data = inputs([{ version: '1.3.0', range: '^1.0.0', artifactStatus: 'missing' }, { version: '1.2.0', range: '^1.0.0', verification: 'unknown' }])
    const facts = evaluatePackageReleaseFacts(host('1.0.0'), packageName, data.candidates, data.catalog, data.inventory)
    expect(facts.latestCompatible?.version).toBe('1.3.0')
    expect(facts.releases[0]?.compatibility.status).toBe('compatible')
    expect(facts.releases[0]?.artifact.status).toBe('missing')
    expect(facts.releases[1]?.verification).toBe('unknown')
    expect(facts.releases[1]?.selectable).toBe(true)
    expect(facts.releases[1]?.confirmationRequirements).toEqual(['ordinary-plan'])
  })

  it('没有符合项但历史只有 latest-only，不宣称全历史无适配版本', () => {
    const data = inputs([{ version: '2.0.0', range: '>=2.0.0' }])
    const facts = evaluatePackageReleaseFacts(host('1.0.0'), packageName, data.candidates, data.catalog, data.inventory)
    expect(facts.latestCompatible).toBeNull()
    expect(facts.historyCoverage).toBe('latest-only')
    expect(facts).not.toHaveProperty('noCompatibleReleaseExists')
  })

  it('未确认发布状态不进入最新集合；非法包版本不冒充最高版', () => {
    const data = inputs([{ version: 'not-semver', range: '*' }, { version: '1.1.0', range: '*' }])
    const facts = evaluatePackageReleaseFacts(host('1.0.0'), packageName, [data.candidates[0]!, { ...data.candidates[1]!, publication: 'unknown' }], data.catalog, data.inventory)
    expect(facts.latestPublished).toBeNull()
    expect(facts.releases.every(release => !release.selectable)).toBe(true)
  })

  it('调换输入不改变冲突结论，不修改输入对象或原文', () => {
    const data = inputs([{ version: '1.1.0', range: '^1.0.0', artifactDigest: digest }, { version: '1.1.0', range: '^2.0.0', artifactDigest: `sha256:${'b'.repeat(64)}` }])
    const original = structuredClone(data)
    const first = evaluatePackageReleaseFacts(host('1.0.0'), packageName, data.candidates, data.catalog, data.inventory)
    const second = evaluatePackageReleaseFacts(host('1.0.0'), packageName, [...data.candidates].reverse(), data.catalog, data.inventory)
    expect(first).toEqual(second)
    expect(data).toEqual(original)
  })

  it.each(['verification', 'installability'] as const)('相同发行只有 %s 状态不同，不产生核心冲突或假 build 歧义', dimension => {
    const data = inputs([{ version: '1.1.0', range: '^1.0.0' }])
    const original = data.candidates[0]!
    const mirror: ReleaseCandidate = { ...original, plugin: { ...original.plugin,
      ...(dimension === 'verification' ? { verification: 'unknown' as const } : { installability: 'missing-artifact' as const }),
    } }
    const facts = evaluatePackageReleaseFacts(host('1.0.0'), packageName, [original, mirror], data.catalog, data.inventory)
    expect(facts.releases).toHaveLength(2)
    expect(facts.releases.every(release => release.compatibility.status === 'compatible')).toBe(true)
    expect(facts.latestPublished?.version).toBe('1.1.0')
    expect(facts.latestCompatible?.version).toBe('1.1.0')
    expect(facts.publishedAmbiguous).toBe(false)
    expect(facts.compatibleAmbiguous).toBe(false)
    expect(facts).toEqual(evaluatePackageReleaseFacts(host('1.0.0'), packageName, [mirror, original], data.catalog, data.inventory))
  })

  it('同发行的两个来源不制造假歧义，出处仍保留', () => {
    const data = inputs([{ version: '1.1.0', range: '^1.0.0', sourceId: 'one' }, { version: '1.1.0', range: '^1.0.0', sourceId: 'two' }])
    const facts = evaluatePackageReleaseFacts(host('1.0.0'), packageName, data.candidates, data.catalog, data.inventory)
    expect(facts.latestPublishedCandidates).toHaveLength(1)
    expect(facts.latestCompatibleCandidates).toHaveLength(1)
    expect(facts.latestCompatible?.version).toBe('1.1.0')
    expect(facts.compatibleAmbiguous).toBe(false)
    expect(facts.releases.map(release => release.hostRequirements?.declarations[0]?.sourceId).sort()).toEqual(['one', 'two'])
    expect(facts).toEqual(evaluatePackageReleaseFacts(host('1.0.0'), packageName, [...data.candidates].reverse(), data.catalog, data.inventory))
  })
})
