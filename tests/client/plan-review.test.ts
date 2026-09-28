import { describe, expect, it } from 'vitest'
import { reviewInstallPlan } from '../../packages/market/src/client/plan-review.ts'
import { planRequestFor } from '../../packages/market/src/client/InstallPlanDialog.tsx'
import { browseSortPlugins, planTargetSignature, recommendationMatches } from '../../packages/market/src/client/model.ts'
import type { CatalogCollectionView, InstallPlan, InstallPlanItem } from '../../packages/market/src/types.ts'
import { catalogFixture, inventoryFixture, pluginFixtures } from './fixtures.ts'

const plugin = pluginFixtures.verified
const collection: CatalogCollectionView = {
  kind: 'market-collection', id: 'test-collection', version: '1.0.0', name: '合成市场组合', summary: '仅测试', collectionDigest: 'sha256:collection-test',
  components: [{ pluginId: plugin.id, version: plugin.version, releaseId: 'test-release', artifactDigest: plugin.artifactDigest!, required: true, enabled: false }],
  execution: { coverage: 'complete', edges: [], provenance: 'synthetic-test' },
}
function item(id: string, patch: Partial<InstallPlanItem> = {}): InstallPlanItem {
  return { pluginId: id, packageName: `@test/${id}`, action: 'add', currentEnabled: false, targetVersion: '1.0.0', targetDigest: 'sha256:test', requestedEnabled: false, verification: 'verified', requiresRestart: false, blockers: [], ...patch }
}
function plan(items: readonly InstallPlanItem[]): InstallPlan {
  return { planId: 'test-plan', schemaVersion: '1', createdAt: '2026-09-28T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', environmentId: 'test', hostFingerprint: 'test', catalogRevision: 'test', items, planDigest: 'sha256:test' }
}

describe('组合预检的执行范围', () => {
  it('已明确阻止的未验证项可跳过，不妨碍无关的安全项', () => {
    const review = reviewInstallPlan(plan([item('A', { action: 'blocked', verification: 'unverified', blockers: ['verification:unverified-not-confirmed'] }), item('B')]), true, [], false)
    expect(review.canConfirm).toBe(true)
    expect(review.executable.map((row) => row.pluginId)).toEqual(['B'])
    expect(review.skipped.map((row) => row.pluginId)).toEqual(['A'])
  })
  it('硬不兼容始终跳过；其直接和间接依赖暂停，无关项可执行', () => {
    const review = reviewInstallPlan(plan([item('A', { action: 'blocked', verification: 'hard-incompatible', blockers: ['verification:hard-incompatible'] }), item('B'), item('C'), item('D')]), true, [
      { prerequisiteId: 'A', consumerId: 'B', milestone: 'installed' },
      { prerequisiteId: 'B', consumerId: 'C', milestone: 'active' },
    ], true)
    expect(review.canConfirm).toBe(true)
    expect(review.executable.map((row) => row.pluginId)).toEqual(['D'])
    expect(review.dependencyPaused.map((row) => row.pluginId)).toEqual(['B', 'C'])
  })
  it('整套全blocked或只剩被阻断的依赖，确认不可用', () => {
    const blocked = item('A', { action: 'blocked' })
    expect(reviewInstallPlan(plan([blocked]), true, [], true).canConfirm).toBe(false)
    expect(reviewInstallPlan(plan([blocked, item('B')]), true, [{ prerequisiteId: 'A', consumerId: 'B', milestone: 'installed' }], true).canConfirm).toBe(false)
    expect(reviewInstallPlan(plan([]), true, [], true).canConfirm).toBe(false)
  })
  it('不能只在UI声称跳过：后台仍把未同意或硬不兼容项列为执行时拒绝整份确认', () => {
    for (const unsafe of [item('A', { verification: 'unverified' }), item('A', { verification: 'unknown' }), item('A', { blockers: ['artifact:not-installable'] })]) {
      expect(reviewInstallPlan(plan([unsafe, item('B')]), true, [], false).canConfirm).toBe(false)
    }
    expect(reviewInstallPlan(plan([item('A', { verification: 'hard-incompatible' }), item('B')]), true, [], true).canConfirm).toBe(false)
  })
  it('单插件的试装和硬限制保持不变', () => {
    expect(reviewInstallPlan(plan([item('A', { verification: 'unverified' })]), false, [], false).canConfirm).toBe(false)
    expect(reviewInstallPlan(plan([item('A', { verification: 'unverified' })]), false, [], true).canConfirm).toBe(true)
    expect(reviewInstallPlan(plan([item('A', { action: 'blocked', verification: 'hard-incompatible' })]), false, [], true).canConfirm).toBe(false)
  })
})

describe('市场组合身份与精选版本', () => {
  it('collection只发送私有身份和确切版本摘要，新装采用组合启用意图', () => {
    const request = planRequestFor({ collection, plugins: [plugin] }, [], false)
    expect(request.collectionId).toBe(collection.id)
    expect(request.collectionVersion).toBe(collection.version)
    expect(request).not.toHaveProperty('packId')
    expect(request).not.toHaveProperty('packVersion')
    expect(request.selections[0]).toMatchObject({ targetVersion: plugin.version, targetDigest: plugin.artifactDigest, enabledIntent: false, tryUnverified: false })
    expect(planRequestFor({ collection, plugins: [plugin] }, inventoryFixture.items, true).selections[0]?.enabledIntent).toBe(true)
  })
  it('拒绝混合pack身份，目录版本／摘要不一致不会替换目标', () => {
    expect(() => planRequestFor({ pack: catalogFixture.packs[0]!, collection, plugins: [plugin] }, [], false)).toThrow('不能混用')
    expect(planRequestFor({ collection, plugins: [{ ...plugin, version: '99.0.0' }] }, [], false).selections).toEqual([])
    expect(planRequestFor({ collection, plugins: [{ ...plugin, artifactDigest: 'sha256:changed' }] }, [], false).selections).toEqual([])
    expect(planTargetSignature({ collection, plugins: [plugin] })).not.toBe(planTargetSignature({ collection: { ...collection, collectionDigest: 'sha256:changed' }, plugins: [plugin] }))
  })
  it('人工精选与排序都按ID和可选精确版本匹配，旧版本推荐不提高新版本顺序', () => {
    const current = { ...plugin, id: 'same-id', name: 'Z', categories: [] }
    const other = { ...current, id: 'other-id', name: 'A' }
    const old = { pluginId: current.id, version: '0.1.0', placement: 'featured' as const, order: 0, reason: '旧版理由' }
    expect(recommendationMatches(old, current)).toBe(false)
    expect(browseSortPlugins([current, other], 'recommended', [old]).map((entry) => entry.id)).toEqual(['other-id', 'same-id'])
    const matching = { ...old, version: current.version }
    expect(recommendationMatches(matching, current)).toBe(true)
    expect(browseSortPlugins([current, other], 'recommended', [matching]).map((entry) => entry.id)).toEqual(['same-id', 'other-id'])
    const { version, ...legacy } = old; void version
    expect(recommendationMatches(legacy, current)).toBe(true)
    expect(recommendationMatches({ ...matching, pluginId: 'wrong-id' }, current)).toBe(false)
  })
})
