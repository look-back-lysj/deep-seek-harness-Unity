import { describe, expect, it } from 'vitest'
import type { CatalogPlugin, CatalogSnapshot, HostCoreSnapshot, InventorySnapshot } from '../../packages/market-core/src/contracts/types.ts'
import { compareInstalledUpdates } from '../../packages/market-core/src/core/update-check.ts'

const inventory: InventorySnapshot = {
  environmentId: 'test', revision: 'inventory-1', unknownItems: [],
  items: [{ packageName: '@test/a', version: '1.0.0', source: 'profile', installed: true, bundleEnabled: true, removable: true, rows: [], restartRequired: false }],
}

const plugin = (version: string, installability: CatalogPlugin['installability'] = 'bundle-installable'): CatalogPlugin => ({
  id: 'test-a', name: 'A', packageName: '@test/a', version, summary: 'a', author: 'test', distribution: 'external', capabilityTier: 'standard', verification: 'verified', installability,
  presentationId: 'test-a', categories: [], screenshots: [], enabledPolicy: 'default-on', requiresRestart: false, requiresSetup: false, largeExternalResource: false,
})

const digest = `sha256:${'a'.repeat(64)}`
const hostCore: HostCoreSnapshot = {
  agentId: 'test-agent', agentName: 'Test Agent', version: '1.5.0', versionScheme: 'semver',
  status: 'known', hostRevision: 'host-1', source: 'synthetic-explicit-binding',
}

function release(version: string, range = '^1.0.0', overrides: Partial<CatalogPlugin> = {}): CatalogPlugin {
  return {
    ...plugin(version), publication: 'active', artifactDigest: digest, metadataDigest: digest,
    hostRequirements: {
      historyCoverage: 'complete',
      declarations: [{ agentId: 'test-agent', range, versionScheme: 'semver', origin: 'agent-forge-target', metadataDigest: digest }],
    },
    ...overrides,
  }
}

function catalogFor(plugins: readonly CatalogPlugin[]): Pick<CatalogSnapshot, 'revision' | 'stale' | 'deliveries'> {
  return {
    revision: 'catalog-2', stale: false,
    deliveries: plugins.flatMap(candidate => candidate.artifactDigest === undefined ? [] : [{
      pluginId: candidate.id, packageName: candidate.packageName, version: candidate.version, artifactDigest: candidate.artifactDigest,
      sources: [{ kind: 'cache' as const, ref: candidate.artifactDigest, priority: 0 }],
    }]),
  }
}

function freeze<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

describe('Core update check', () => {
  it('reports the highest catalog version without writing', () => {
    const result = compareInstalledUpdates(inventory, [plugin('1.5.0'), plugin('2.0.0')], 'catalog-2', { now: new Date('2026-10-01T00:00:00Z') })
    expect(result).toMatchObject({ sourceRevision: 'catalog-2', checkedAt: '2026-10-01T00:00:00.000Z' })
    expect(result.items[0]).toMatchObject({ status: 'update-available', installedVersion: '1.0.0', latestVersion: '2.0.0' })
  })

  it('keeps blocked catalog releases out of update candidates', () => {
    const result = compareInstalledUpdates(inventory, [plugin('2.0.0', 'hard-blocked')], 'catalog-3')
    expect(result.items[0]).toMatchObject({ status: 'incompatible', reason: 'catalog:hard-blocked' })
  })

  it.each([
    { version: '2.0.0', installability: 'bundle-installable' as const, status: 'update-available' },
    { version: '1.0.0', installability: 'bundle-installable' as const, status: 'up-to-date' },
    { version: '0.9.0', installability: 'bundle-installable' as const, status: 'up-to-date' },
    { version: '2.0.0', installability: 'missing-artifact' as const, status: 'incompatible', reason: 'catalog:missing-artifact' },
    { version: '2.0.0', installability: 'needs-repair' as const, status: 'incompatible', reason: 'catalog:needs-repair' },
    { version: 'invalid', installability: 'bundle-installable' as const, status: 'unknown', reason: 'catalog-version-unknown' },
  ])('没有新选项时保留旧字段：$version/$installability', ({ version, installability, status, reason }) => {
    expect(compareInstalledUpdates(inventory, [plugin(version, installability)], 'catalog-2', {
      now: new Date('2026-10-01T00:00:00Z'), catalogStale: true,
    })).toEqual({
      checkedAt: '2026-10-01T00:00:00.000Z', sourceRevision: 'catalog-2', catalogStale: true, inventoryRevision: 'inventory-1',
      items: [{ packageName: '@test/a', pluginId: 'test-a', installedVersion: '1.0.0', latestVersion: version, status,
        ...(reason === undefined ? {} : { reason }) }],
    })
  })

  it('只有宿主或只有目录时不添加摘要，不改变旧结果', () => {
    const plugins = [release('2.0.0')]
    const now = new Date('2026-10-01T00:00:00Z')
    const expected = compareInstalledUpdates(inventory, plugins, 'catalog-2', { now })
    expect(compareInstalledUpdates(inventory, plugins, 'catalog-2', { now, hostCore })).toEqual(expected)
    expect(compareInstalledUpdates(inventory, plugins, 'catalog-2', { now, catalog: catalogFor(plugins) })).toEqual(expected)
  })

  it('旧目录缺包和目标版本未知仍保留原始字段', () => {
    expect(compareInstalledUpdates(inventory, [], 'catalog-2').items).toEqual([
      { packageName: '@test/a', installedVersion: '1.0.0', status: 'not-in-catalog', reason: 'package-not-in-current-catalog' },
    ])
    expect(compareInstalledUpdates({ ...inventory, unknownItems: ['@test/a'] }, [plugin('2.0.0')], 'catalog-2').items).toEqual([
      { packageName: '@test/a', installedVersion: '1.0.0', status: 'unknown', reason: 'inventory-version-unknown' },
    ])
  })
})

describe('Core update check release summary', () => {
  it('最高发布要求更高 Core 时仍汇总适配旧版，保留旧 flat 字段', () => {
    const plugins = [release('1.5.0'), release('2.0.0', '>=2.0.0')]
    const catalog = catalogFor(plugins)
    const item = compareInstalledUpdates(inventory, plugins, catalog.revision, { hostCore, catalog }).items[0]!
    expect(item).toMatchObject({ installedVersion: '1.0.0', latestVersion: '2.0.0', status: 'update-available' })
    expect(item.releaseSummary).toEqual({
      hostCore, installed: { status: 'known', version: '1.0.0' }, historyCoverage: 'complete',
      latestPublished: { pluginId: 'test-a', packageName: '@test/a', version: '2.0.0', metadataDigest: digest, artifactDigest: digest },
      latestCompatible: { pluginId: 'test-a', packageName: '@test/a', version: '1.5.0', metadataDigest: digest, artifactDigest: digest },
      latestPublishedCompatibility: { status: 'incompatible', reason: 'core-too-old', declaredRanges: ['>=2.0.0'] },
      publishedAmbiguous: false, compatibleAmbiguous: false,
    })
  })

  it.each(['missing-artifact', 'hard-blocked', 'needs-repair'] as const)('最新 %s 不伪装为 Core 不适配，也不回退 latestCompatible', installability => {
    const plugins = [release('1.5.0'), release('2.0.0', '^1.0.0', { installability, verification: 'hard-incompatible' })]
    const catalog = catalogFor(plugins)
    const item = compareInstalledUpdates(inventory, plugins, catalog.revision, { hostCore, catalog }).items[0]!
    expect(item).toMatchObject({ status: 'incompatible', reason: `catalog:${installability}` })
    expect(item.releaseSummary).toMatchObject({
      latestPublished: { version: '2.0.0' }, latestCompatible: { version: '2.0.0' },
      latestPublishedCompatibility: { status: 'compatible', declaredRanges: ['^1.0.0'] },
    })
    expect(item.releaseSummary?.latestPublishedCompatibility).not.toHaveProperty('reason')
  })

  it('最新版本没有 delivery 也仍是 latestCompatible', () => {
    const plugins = [release('1.5.0'), release('2.0.0')]
    const catalog = catalogFor(plugins.slice(0, 1))
    const summary = compareInstalledUpdates(inventory, plugins, catalog.revision, { hostCore, catalog }).items[0]?.releaseSummary
    expect(summary).toMatchObject({ latestPublished: { version: '2.0.0' }, latestCompatible: { version: '2.0.0' }, latestPublishedCompatibility: { status: 'compatible' } })
  })

  it.each(['host-unknown', 'host-missing', 'range-unknown', 'range-missing'] as const)('%s 不猜测 semver 版本域', scope => {
    const candidate = release('2.0.0')
    const declarations = candidate.hostRequirements!.declarations.map(declaration => {
      if (scope === 'range-missing') {
        const { versionScheme: _versionScheme, ...rest } = declaration
        return rest
      }
      return { ...declaration, versionScheme: scope === 'range-unknown' ? 'unknown' as const : declaration.versionScheme! }
    })
    const plugins = [{ ...candidate, hostRequirements: { ...candidate.hostRequirements!, declarations } }]
    const catalog = catalogFor(plugins)
    const { versionScheme: _versionScheme, ...unboundHost } = hostCore
    const currentHost = scope === 'host-missing' ? unboundHost : { ...hostCore, versionScheme: scope === 'host-unknown' ? 'unknown' as const : 'semver' as const }
    const summary = compareInstalledUpdates(inventory, plugins, catalog.revision, { hostCore: currentHost, catalog }).items[0]?.releaseSummary
    expect(summary).toMatchObject({
      latestPublished: { version: '2.0.0' }, latestCompatible: null,
      latestPublishedCompatibility: { status: 'unknown', reason: scope.startsWith('host-') ? 'core-version-scheme-unknown' : 'core-range-scheme-unknown' },
    })
  })

  it('显式 withdrawn 不参与最高发布或最高适配，旧 flat 仍保留最高 version', () => {
    const plugins = [release('1.5.0'), release('2.0.0', '^1.0.0', { publication: 'withdrawn' })]
    const catalog = catalogFor(plugins)
    const item = compareInstalledUpdates(inventory, plugins, catalog.revision, { hostCore, catalog }).items[0]!
    expect(item.latestVersion).toBe('2.0.0')
    expect(item.releaseSummary).toMatchObject({
      latestPublished: { version: '1.5.0' }, latestCompatible: { version: '1.5.0' }, latestPublishedCompatibility: { status: 'compatible' },
    })
  })

  it.each(['active', 'withdrawn', 'unknown', 'missing'] as const)('publication=%s 按已接受事实处理，不从 hard-blocked 猜测撤回', publication => {
    const candidate = release('2.0.0', '^1.0.0', { installability: 'hard-blocked' })
    const { publication: _publication, ...withoutPublication } = candidate
    const plugins = [publication === 'missing' ? withoutPublication : { ...candidate, publication }]
    const catalog = catalogFor(plugins)
    const summary = compareInstalledUpdates(inventory, plugins, catalog.revision, { hostCore, catalog }).items[0]?.releaseSummary
    if (publication === 'active') {
      expect(summary).toMatchObject({ latestPublished: { version: '2.0.0' }, latestCompatible: { version: '2.0.0' }, latestPublishedCompatibility: { status: 'compatible' } })
    } else {
      expect(summary).toMatchObject({ latestPublished: null, latestCompatible: null, latestPublishedCompatibility: null, publishedAmbiguous: false, compatibleAmbiguous: false })
    }
  })

  it.each([
    'pluginManager:unavailable', 'listBundles:unavailable', 'bundle-entry:missing-name',
    '@test/a', 'bundle-version:@test/a', 'bundle-entry:duplicate:@test/a', 'bundle:@test/a:unreadable',
  ])('共享分类的全局或目标未知 %s 不以目录填补安装事实', issue => {
    const plugins = [release('2.0.0')]
    const catalog = catalogFor(plugins)
    const item = compareInstalledUpdates({ ...inventory, unknownItems: [issue] }, plugins, catalog.revision, { hostCore, catalog }).items[0]!
    expect(item).toMatchObject({ installedVersion: '1.0.0', status: 'unknown', reason: 'inventory-version-unknown' })
    expect(item.releaseSummary).toMatchObject({
      installed: { status: 'unknown', version: null, reason: 'inventory-state-unknown' },
      latestPublished: { version: '2.0.0' }, latestCompatible: { version: '2.0.0' }, latestPublishedCompatibility: { status: 'compatible' },
    })
  })

  it.each(['bundle-version:@test/other', 'bundle-entry:duplicate:@test/other', 'bundle:@test/other:unreadable', '@test/other', 'unrelated-issue'])('无关异常 %s 不全局阻断目标', issue => {
    const plugins = [release('2.0.0')]
    const catalog = catalogFor(plugins)
    const currentInventory = { ...inventory, unknownItems: [issue] }
    const legacy = compareInstalledUpdates(currentInventory, plugins, catalog.revision).items[0]!
    const item = compareInstalledUpdates(currentInventory, plugins, catalog.revision, { hostCore, catalog }).items[0]!
    const { releaseSummary, ...flat } = item
    expect(flat).toEqual(legacy)
    expect(item.status).toBe('update-available')
    expect(releaseSummary?.installed).toEqual({ status: 'known', version: '1.0.0' })
    expect(releaseSummary?.latestCompatible?.version).toBe('2.0.0')
  })

  it('重复目标库存不挑选任意已安装版本', () => {
    const plugins = [release('2.0.0')]
    const catalog = catalogFor(plugins)
    const currentInventory = { ...inventory, items: [...inventory.items, { ...inventory.items[0]!, version: '1.5.0' }] }
    const items = compareInstalledUpdates(currentInventory, plugins, catalog.revision, { hostCore, catalog }).items
    expect(items.map(item => item.installedVersion)).toEqual(['1.0.0', '1.5.0'])
    expect(items.every(item => item.status === 'unknown')).toBe(true)
    expect(items[0]?.releaseSummary?.installed).toEqual({ status: 'unknown', version: null, reason: 'inventory-identity-conflict' })
  })

  it.each(['invalid-version', undefined])('未知安装版本 %s 保留原始字段，不用目录替代', version => {
    const { version: _version, ...installed } = inventory.items[0]!
    const currentInventory = { ...inventory, items: [{ ...installed, ...(version === undefined ? {} : { version }) }] }
    const plugins = [release('2.0.0')]
    const catalog = catalogFor(plugins)
    const item = compareInstalledUpdates(currentInventory, plugins, catalog.revision, { hostCore, catalog }).items[0]!
    expect(item.status).toBe('unknown')
    expect(item.releaseSummary?.installed).toEqual({ status: 'unknown', version: null, reason: 'inventory-version-unknown' })
    if (version === undefined) expect(item).not.toHaveProperty('installedVersion')
    else expect(item.installedVersion).toBe(version)
  })

  it('相同 precedence 的 build 身份保留歧义，不选择任意最高版本', () => {
    const plugins = [release('2.0.0+build.a'), release('2.0.0+build.b')]
    const catalog = catalogFor(plugins)
    const summary = compareInstalledUpdates(inventory, plugins, catalog.revision, { hostCore, catalog }).items[0]?.releaseSummary
    expect(summary).toMatchObject({ latestPublished: null, latestCompatible: null, latestPublishedCompatibility: null, publishedAmbiguous: true, compatibleAmbiguous: true })
    expect(compareInstalledUpdates(inventory, [...plugins].reverse(), catalog.revision, { hostCore, catalog }).items[0]?.releaseSummary).toEqual(summary)
  })

  it('发布身份歧义与最高适配身份独立，不把任意身份的原因当最高发布原因', () => {
    const plugins = [release('2.0.0+build.a'), release('2.0.0+build.b', '>=2.0.0')]
    const catalog = catalogFor(plugins)
    const summary = compareInstalledUpdates(inventory, plugins, catalog.revision, { hostCore, catalog }).items[0]?.releaseSummary
    expect(summary).toMatchObject({ latestPublished: null, latestCompatible: { version: '2.0.0+build.a' }, latestPublishedCompatibility: null, publishedAmbiguous: true, compatibleAmbiguous: false })
  })

  it('摘要默认稳定发行通道，旧 highest version 不改变', () => {
    const plugins = [release('1.5.0'), release('2.0.0-rc.1')]
    const catalog = catalogFor(plugins)
    const item = compareInstalledUpdates(inventory, plugins, catalog.revision, { hostCore, catalog }).items[0]!
    expect(item.latestVersion).toBe('2.0.0-rc.1')
    expect(item.releaseSummary).toMatchObject({ latestPublished: { version: '1.5.0' }, latestCompatible: { version: '1.5.0' } })
  })

  it.each([
    { range: '^1.0.0', compatible: false },
    { range: '>=1.5.0-rc.1 <2.0.0', compatible: true },
  ])('宿主 prerelease Range $range 与发行稳定通道独立', ({ range, compatible }) => {
    const plugins = [release('2.0.0', range)]
    const catalog = catalogFor(plugins)
    const summary = compareInstalledUpdates(inventory, plugins, catalog.revision, { hostCore: { ...hostCore, version: '1.5.0-rc.2' }, catalog }).items[0]?.releaseSummary
    expect(summary?.latestPublished?.version).toBe('2.0.0')
    expect(summary?.latestCompatible?.version ?? null).toBe(compatible ? '2.0.0' : null)
    expect(summary?.latestPublishedCompatibility).toMatchObject(compatible ? { status: 'compatible' } : { status: 'incompatible', reason: 'core-range-mismatch' })
  })

  it('目录缺包仍有空摘要，未安装条目不新增更新结果', () => {
    const catalog = catalogFor([])
    const currentInventory = { ...inventory, items: [...inventory.items, { ...inventory.items[0]!, packageName: '@test/other', installed: false }] }
    const result = compareInstalledUpdates(currentInventory, [], catalog.revision, { hostCore, catalog })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      installedVersion: '1.0.0', status: 'not-in-catalog', reason: 'package-not-in-current-catalog',
      releaseSummary: { installed: { status: 'known', version: '1.0.0' }, historyCoverage: 'unknown', latestPublished: null, latestCompatible: null, latestPublishedCompatibility: null, publishedAmbiguous: false, compatibleAmbiguous: false },
    })
  })

  it('未知 catalog version 不消失，摘要不虚构发布或兼容身份', () => {
    const plugins = [release('invalid-version')]
    const catalog = catalogFor(plugins)
    const item = compareInstalledUpdates(inventory, plugins, catalog.revision, { hostCore, catalog }).items[0]!
    expect(item).toMatchObject({ latestVersion: 'invalid-version', status: 'unknown', reason: 'catalog-version-unknown', releaseSummary: { latestPublished: null, latestCompatible: null, latestPublishedCompatibility: null } })
  })

  it('较新已安装版本保持事实，不生成默认降级选择', () => {
    const plugins = [release('1.5.0')]
    const catalog = catalogFor(plugins)
    const currentInventory = { ...inventory, items: [{ ...inventory.items[0]!, version: '3.0.0' }] }
    const item = compareInstalledUpdates(currentInventory, plugins, catalog.revision, { hostCore, catalog }).items[0]!
    expect(item).toMatchObject({ installedVersion: '3.0.0', latestVersion: '1.5.0', status: 'up-to-date', releaseSummary: { installed: { status: 'known', version: '3.0.0' }, latestCompatible: { version: '1.5.0' } } })
    expect(item.releaseSummary).not.toHaveProperty('defaultReleaseId')
    expect(item.releaseSummary).not.toHaveProperty('clientDefaultUpgrade')
  })

  it('纯读取冻结的库存、候选和目录，不写入或重排输入', () => {
    const plugins = [release('1.5.0'), release('2.0.0', '>=2.0.0')]
    const currentInventory = structuredClone(inventory)
    const catalog = { ...catalogFor(plugins), stale: true }
    const options = { hostCore: structuredClone(hostCore), catalog, catalogStale: true, now: new Date('2026-10-01T00:00:00Z') }
    const before = structuredClone({ currentInventory, plugins, options })
    freeze(currentInventory)
    freeze(plugins)
    freeze(options)
    const result = compareInstalledUpdates(currentInventory, plugins, catalog.revision, options)
    expect(result).toMatchObject({ catalogStale: true, checkedAt: '2026-10-01T00:00:00.000Z', sourceRevision: catalog.revision, inventoryRevision: inventory.revision })
    expect(result.items[0]?.releaseSummary).toMatchObject({ latestPublishedCompatibility: { reason: 'core-too-old' }, latestCompatible: { version: '1.5.0' } })
    expect({ currentInventory, plugins, options }).toEqual(before)
  })
})
