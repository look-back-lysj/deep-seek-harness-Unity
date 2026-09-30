import { describe, expect, it } from 'vitest'
import { buildCatalogDiscovery, filterCatalogDiscovery } from '../../packages/market-core/src/catalog/discovery.ts'
import { validateMarketIndex } from '../../packages/market-core/src/catalog/index.ts'
import type { CatalogSnapshot } from '../../packages/market-core/src/contracts/types.ts'
import { readFileSync } from 'node:fs'

describe('发现页目录投影', () => {
  it('无媒体时保留标题与简介，客户端可渲染默认海报卡', () => {
    const snapshot = JSON.parse(readFileSync(new URL('./fixtures/valid-market-index.json', import.meta.url), 'utf8')) as Record<string, unknown>
    snapshot.recommendations = [{ pluginId: 'dev.test.alpha', version: '1.2.3', placement: 'featured', order: 0, reason: '团队精选' }]
    const validated = validateMarketIndex(snapshot).snapshot
    expect(validated.discovery?.featured[0]).toMatchObject({
      pluginId: 'dev.test.alpha', title: 'Alpha Test Fixture', summary: '正向目录 fixture；只用于测试，不是生产推荐。',
    })
    expect(validated.discovery?.featured[0]).not.toHaveProperty('poster')
  })

  it('没有评分资料时不伪造高分插件或高分 skill 分区', () => {
    const snapshot = {
      plugins: [{ id: 'dev.test.alpha', version: '1.2.3', name: 'Alpha', summary: '插件', presentationId: 'p', screenshots: [], kind: 'plugin' }],
      presentations: [{ id: 'p', revision: '1', title: 'Alpha', summary: '插件', markdown: '', media: [] }],
      recommendations: [{ pluginId: 'dev.test.alpha', version: '1.2.3', placement: 'top-plugin', order: 0, reason: '暂无评分' }],
    } as unknown as Pick<CatalogSnapshot, 'plugins' | 'presentations' | 'recommendations'>
    const discovery = buildCatalogDiscovery(snapshot)
    expect(discovery.highScorePlugins).toBeUndefined()
    expect(discovery.highScoreSkills).toBeUndefined()
  })

  it('评分推荐保留评分来源，便于解释排序依据', () => {
    const snapshot = JSON.parse(readFileSync(new URL('./fixtures/valid-market-index.json', import.meta.url), 'utf8')) as Record<string, unknown>
    snapshot.plugins[0].kind = 'skill'
    snapshot.recommendations = [{ pluginId: 'dev.test.alpha', version: '1.2.3', placement: 'top-skill', order: 0, reason: '维护者评分', source: 'score', score: { value: 4.8, scale: 5, source: 'editorial-review', measuredAt: '2026-09-29T00:00:00.000Z' } }]
    const validated = validateMarketIndex(snapshot).snapshot
    expect(validated.discovery?.highScoreSkills?.[0]?.score).toMatchObject({ value: 4.8, scale: 5, source: 'editorial-review' })
  })

  it('允许显式 skill 分类，并拒绝未知分类值', () => {
    const source = JSON.parse(readFileSync(new URL('./fixtures/valid-market-index.json', import.meta.url), 'utf8')) as Record<string, any>
    source.plugins[0].kind = 'skill'
    expect(validateMarketIndex(source).snapshot.plugins[0]?.kind).toBe('skill')
    source.plugins[0].kind = 'widget'
    expect(() => validateMarketIndex(source)).toThrow(/kind/)
  })

  it('生命周期过滤掉撤回版本，避免发现页继续展示失效卡片', () => {
    const source = JSON.parse(readFileSync(new URL('./fixtures/valid-market-index.json', import.meta.url), 'utf8')) as any
    source.recommendations = [{ pluginId: 'dev.test.alpha', version: '1.2.3', placement: 'featured', order: 0, reason: '精选' }]
    const snapshot = validateMarketIndex(source).snapshot
    const filtered = filterCatalogDiscovery(snapshot.discovery, [])
    expect(filtered?.featured).toEqual([])
  })
})
