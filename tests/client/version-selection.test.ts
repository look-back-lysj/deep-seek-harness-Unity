import { describe, expect, it } from 'vitest'
import { findPlugin, latestCompatiblePlugin } from '../../packages/market/src/client/model.ts'
import { packPlugins } from '../../packages/market/src/client/MarketPage.tsx'
import { planRequestFor } from '../../packages/market/src/client/InstallPlanDialog.tsx'
import type { CatalogPlugin, CatalogSnapshot } from '../../packages/market/src/types.ts'
import { catalogFixture, pluginFixtures } from './fixtures.ts'

function version(value: string, patch: Partial<CatalogPlugin> = {}): CatalogPlugin {
  return { ...pluginFixtures.verified, version: value, name: `版本 ${value}`, artifactDigest: `sha256:test-${value}`, ...patch }
}
function catalog(plugins: readonly CatalogPlugin[]): CatalogSnapshot {
  return { ...catalogFixture, plugins, deliveries: plugins.map((plugin) => ({ pluginId: plugin.id, packageName: plugin.packageName, version: plugin.version, artifactDigest: plugin.artifactDigest!, sources: [{ kind: 'https-artifact', ref: 'https://example.invalid/test.tgz', priority: 0 }] })) }
}

describe('精确版本的页面选择与默认更新', () => {
  it('详情按ID和版本匹配，所选版本消失不跳到同ID另一个版本', () => {
    const old = version('1.0.0'); const latest = version('2.0.0')
    const snapshot = catalog([latest, old])
    expect(findPlugin(snapshot, old.id, '1.0.0')).toBe(old)
    expect(findPlugin(catalog([old, latest]), latest.id, '2.0.0')).toBe(latest)
    expect(findPlugin(catalog([latest]), old.id, '1.0.0')).toBeUndefined()
    expect(findPlugin(snapshot, old.id)).toBe(latest)
    expect(findPlugin(catalog([old, latest]), old.id)).toBe(latest)
  })
  it('公共Pack取确切component.version并保持预检目标，不用数组里的较新版替代', () => {
    const old = version('1.0.0'); const latest = version('2.0.0')
    const pack = { ...catalogFixture.packs[0]!, components: [{ pluginId: old.id, version: '1.0.0', required: true }] }
    const plugins = packPlugins(pack, [latest, old])
    expect(plugins).toEqual([old])
    expect(planRequestFor({ pack, plugins }, [], false).selections[0]?.targetVersion).toBe('1.0.0')
    expect(packPlugins(pack, [latest])).toEqual([])
  })
  it('默认更新按严格SemVer选最高已验证发行，与数组顺序无关', () => {
    const values = ['1.9.0', '2.0.0-rc.2', '2.0.0-rc.10', '2.0.0'].map((value) => version(value))
    for (const plugins of [values, [...values].reverse(), [values[1]!, values[3]!, values[0]!, values[2]!]]) {
      expect(latestCompatiblePlugin(catalog(plugins), values[0]!.packageName)?.version).toBe('2.0.0')
    }
    expect(latestCompatiblePlugin(catalog(values.slice(0, 3)), values[0]!.packageName)?.version).toBe('2.0.0-rc.10')
  })
  it('不推荐不兼容、未知、无效版本、缺制品或缺匹配登记来源的更高版本', () => {
    const safe = version('2.0.0')
    const entries = [safe, version('99.0.0', { verification: 'hard-incompatible' }), version('98.0.0', { verification: 'unknown' }), version('97.0.0', { verification: 'unverified' }), version('96.0.0', { installability: 'missing-artifact' }), version('latest')]
    const snapshot = catalog(entries)
    const unregistered = version('95.0.0')
    expect(latestCompatiblePlugin({ ...snapshot, plugins: [unregistered, ...entries] }, safe.packageName)).toBe(safe)
    expect(latestCompatiblePlugin({ ...snapshot, deliveries: snapshot.deliveries.filter((delivery) => delivery.version !== safe.version) }, safe.packageName)).toBeUndefined()
    expect(latestCompatiblePlugin(snapshot, '@different/package')).toBeUndefined()
  })
  it('来源摘要和版本必须属于同一个候选，不能借用同包另一个版本的登记', () => {
    const safe = version('1.0.0'); const candidate = version('2.0.0')
    const snapshot = catalog([safe, candidate])
    const wrongDigest = { ...snapshot, deliveries: snapshot.deliveries.map((delivery) => delivery.version === candidate.version ? { ...delivery, artifactDigest: safe.artifactDigest! } : delivery) }
    expect(latestCompatiblePlugin(wrongDigest, safe.packageName)).toBe(safe)
  })
})
