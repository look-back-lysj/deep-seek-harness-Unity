import { describe, expect, it } from 'vitest'
import type { ReleaseSelectionContext } from '../../packages/market/src/types.ts'
import { planRequestFor } from '../../packages/market/src/client/InstallPlanDialog.tsx'
import { catalogFixture, inventoryFixture, pluginFixtures } from './fixtures.ts'

const plugin = pluginFixtures.verified
const binding: ReleaseSelectionContext = {
  context: { environmentId: 'env', hostRevision: 'host', catalogRevision: 'catalog', inventoryRevision: 'inventory', checkedAt: '2026-10-04T00:00:00Z', catalogStale: false },
  identity: { pluginId: 'exact-release-plugin', packageName: plugin.packageName, version: '2.0.0', metadataDigest: 'sha256:meta', artifactDigest: 'sha256:artifact', releaseId: 'release-2' },
  sources: [{ sourceId: 'agent-forge', revision: 'full-revision' }],
}

describe('预检绑定后端所选版本而非展示目录版本', () => {
  it('完整 context、identity、sources 与确切目标身份进入单包请求', () => {
    const request = planRequestFor({ plugin, plugins: [plugin] }, [], false, binding)
    expect(request.selections).toEqual([{ pluginId: binding.identity.pluginId, packageName: plugin.packageName,
      targetVersion: '2.0.0', targetDigest: 'sha256:artifact', enabledIntent: false, tryUnverified: false, releaseContext: binding }])
    expect(request.attemptUnknown).toBe(false)
  })
  it('保留已安装启用意图，而非套用另一个版本的默认策略', () => {
    expect(planRequestFor({ plugin, plugins: [plugin] }, inventoryFixture.items, false, binding).selections[0]?.enabledIntent).toBe(true)
  })
  it('缺摘要仍使用不可用哨兵，交后端阻止，不伪造 digest', () => {
    const { artifactDigest, ...identity } = binding.identity; void artifactDigest
    expect(planRequestFor({ plugin, plugins: [plugin] }, [], false, { ...binding, identity }).selections[0]?.targetDigest).toBe('digest-unavailable')
  })
  it('不允许另一包、套餐、组合或多包借用单包上下文', () => {
    expect(() => planRequestFor({ plugin, plugins: [plugin] }, [], false, { ...binding, identity: { ...binding.identity, packageName: '@example/other' } })).toThrow('当前单包')
    expect(() => planRequestFor({ pack: catalogFixture.packs[0]!, plugins: [plugin] }, [], false, binding)).toThrow('当前单包')
    expect(() => planRequestFor({ plugin, plugins: [plugin, plugin] }, [], false, binding)).toThrow('当前单包')
    expect(() => planRequestFor({ plugin, plugins: [] }, [], false, binding)).toThrow('当前单包')
  })
  it('旧宿主请求与套餐锁定版本不受新能力影响', () => {
    expect(planRequestFor({ plugin, plugins: [plugin] }, [], false).selections[0]).toMatchObject({ pluginId: plugin.id, targetVersion: plugin.version, targetDigest: plugin.artifactDigest })
    expect(planRequestFor({ plugin, plugins: [plugin] }, [], false).selections[0]).not.toHaveProperty('releaseContext')
    const request = planRequestFor({ pack: catalogFixture.packs[0]!, plugins: [plugin] }, [], false)
    expect(request.packVersion).toBe(catalogFixture.packs[0]!.version)
    expect(request.selections[0]?.targetVersion).toBe(plugin.version)
    expect(request.selections[0]).not.toHaveProperty('releaseContext')
  })
})
