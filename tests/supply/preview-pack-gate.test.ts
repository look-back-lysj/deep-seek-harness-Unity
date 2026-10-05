import { describe, expect, it } from 'vitest'
import { validateMarketIndex } from '../../packages/market-core/src/catalog/validate.ts'
import { withBackend } from '../core-api/helpers.ts'
import type { PlanResult } from '../../packages/market-core/src/contracts/types.ts'

const previewPack = {
  id: 'org.example.essentials',
  version: '1.0.0',
  name: '基础工具组合',
  summary: '组件产物尚未解析，只做展示。',
  source: { url: 'https://example.org/essentials', commit: null },
  requiresDsh: null,
  compatibilityBasis: 'unknown',
  components: [{ id: 'editor', ref: '@example/editor-tools', version: '^1.0.0' }],
  execution: { coverage: 'unknown', edges: [] },
  status: 'active',
}

const listing = {
  id: 'listing.alpha',
  name: '清单条目',
  packageName: '@test/listing-alpha',
  summary: '没有产物，只展示来源。',
  reason: '缺少产物，保留来源展示。',
  sourceUrl: 'https://example.org/listing-alpha',
}

function indexWith(extra: Record<string, unknown>): string {
  return JSON.stringify({
    schemaVersion: '2',
    revision: 'preview-gate-1',
    generatedAt: '2026-10-05T00:00:00.000Z',
    publication: { sourceId: 'synthetic-gate', sequence: 1 },
    plugins: [], packs: [], presentations: [], deliveries: [], releases: [], releaseStatuses: [], collections: [], recommendations: [],
    ...extra,
  }, null, 2)
}

function isInstallBlocked(result: PlanResult): boolean {
  if (result.status === 'blocked') return true
  if (result.status !== 'ready') return false
  return result.plan.items.length > 0
    && result.plan.items.every(item => item.action === 'blocked' && item.blockers.length > 0)
}

describe('previewPacks 纯展示模型', () => {
  it('解析并原样透出到 catalog() 与 catalogRefresh().current', async () => {
    await withBackend(async (backend) => {
      const snapshot = backend.catalog()
      expect(snapshot.previewPacks).toHaveLength(1)
      expect(snapshot.previewPacks?.[0]).toMatchObject({ id: 'org.example.essentials', status: 'active', execution: { coverage: 'unknown' } })
      expect(snapshot.previewPacks?.[0]).not.toHaveProperty('releaseId')
      const refreshed = await backend.catalogRefresh()
      expect(refreshed.current.previewPacks?.[0]?.id).toBe('org.example.essentials')
    }, { embeddedCatalogBytes: Buffer.from(indexWith({ previewPacks: [previewPack] }) + '\n'), catalogSources: [] })
  })

  it('结构闸：previewPacks 的 ID 伪装成 planCreate 输入必须进不了安装计划', async () => {
    await withBackend(async (backend) => {
      const result = await backend.planCreate({
        selections: [{
          pluginId: previewPack.id,
          packageName: previewPack.id,
          targetVersion: previewPack.version,
          targetDigest: 'a'.repeat(64),
          enabledIntent: true,
          tryUnverified: false,
        }],
      }, 'gate-caller')
      expect(isInstallBlocked(result)).toBe(true)
      if (result.status === 'ready') expect(result.plan.items[0]?.blockers).toContain('catalog:selection-fact-mismatch')
    }, { embeddedCatalogBytes: Buffer.from(indexWith({ previewPacks: [previewPack] }) + '\n'), catalogSources: [] })
  })

  it('回归：listings 的 ID 同样进不了安装计划', async () => {
    await withBackend(async (backend) => {
      const result = await backend.planCreate({
        selections: [{
          pluginId: listing.id,
          packageName: listing.packageName,
          targetVersion: '1.0.0',
          targetDigest: 'b'.repeat(64),
          enabledIntent: true,
          tryUnverified: false,
        }],
      }, 'gate-caller')
      expect(isInstallBlocked(result)).toBe(true)
      if (result.status === 'ready') expect(result.plan.items[0]?.blockers).toContain('catalog:selection-fact-mismatch')
    }, { embeddedCatalogBytes: Buffer.from(indexWith({ listings: [listing] }) + '\n'), catalogSources: [] })
  })

  it('结构校验：coverage=complete、重复组件 ID、未知状态都拒绝', () => {
    const base = { ...previewPack }
    const run = (patch: Record<string, unknown>): (() => void) => () => validateMarketIndex({
      schemaVersion: '2', revision: 'r', generatedAt: '2026-10-05T00:00:00.000Z',
      publication: { sourceId: 'g', sequence: 1 },
      plugins: [], packs: [], presentations: [], deliveries: [], releases: [], releaseStatuses: [], collections: [], recommendations: [],
      previewPacks: [{ ...base, ...patch }],
    }, { now: new Date('2026-10-05T00:00:00.000Z') })

    expect(run({ execution: { coverage: 'complete', edges: [] } })).toThrow(/preview-pack-coverage|coverage/)
    expect(run({ components: [{ id: 'x', ref: 'a' }, { id: 'x', ref: 'b' }] })).toThrow(/组件 ID 重复/)
    expect(run({ status: 'published' })).toThrow(/status/)
    expect(() => validateMarketIndex({
      schemaVersion: '2', revision: 'r', generatedAt: '2026-10-05T00:00:00.000Z',
      publication: { sourceId: 'g', sequence: 1 },
      plugins: [], packs: [], presentations: [], deliveries: [], releases: [], releaseStatuses: [], collections: [], recommendations: [],
      previewPacks: [{ ...base, components: [{ id: 'a', ref: 'a' }], execution: { coverage: 'unknown', edges: [{ prerequisiteId: 'ghost', consumerId: 'a', milestone: 'installed' }] } }],
    }, { now: new Date('2026-10-05T00:00:00.000Z') })).toThrow(/execution-unknown-component|引用/)
  })
})
