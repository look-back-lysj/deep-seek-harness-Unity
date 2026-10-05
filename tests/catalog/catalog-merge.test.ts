import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CatalogHostRequirements, CatalogPlugin, CatalogSnapshot } from '../../packages/market-core/src/contracts/types.ts'
import { canonicalJson, deepFreeze } from '../../packages/market-core/src/core/canonical.ts'
import { mergeCatalogSnapshots, type CatalogMergeSource } from '../../packages/market-core/src/catalog/merge.ts'
import { projectAgentForgeCatalog } from '../../packages/market-core/src/catalog/agent-forge.ts'
import { rawRecord } from '../../packages/market-core/src/catalog/public-format.ts'
import { validateMarketIndex } from '../../packages/market-core/src/catalog/validate.ts'

const artifactDigest = `sha256:${'a'.repeat(64)}`
const metadataDigest = `sha256:${'b'.repeat(64)}`
const otherDigest = `sha256:${'c'.repeat(64)}`

function requirements(range: string | null = '>=0.2.0', changes: Partial<CatalogHostRequirements['declarations'][number]> = {}): CatalogHostRequirements {
  return {
    historyCoverage: 'complete',
    declarations: [{ agentId: 'dsh', range, origin: 'package-engines', metadataDigest, ...changes }],
  }
}

function source(sourceId: string, pluginChanges: Partial<CatalogPlugin> = {}, snapshotChanges: Partial<CatalogSnapshot> = {}): CatalogMergeSource {
  const plugin: CatalogPlugin = {
    id: 'test.alpha', name: 'Alpha', packageName: '@test/alpha', version: '1.0.0',
    summary: '测试发行', author: 'test', distribution: 'unclassified', capabilityTier: 'test',
    verification: 'unverified', installability: 'bundle-installable', artifactDigest,
    presentationId: 'test.alpha.presentation', categories: [], screenshots: [], enabledPolicy: 'default-off',
    requiresRestart: false, requiresSetup: false, largeExternalResource: false, ...pluginChanges,
  }
  return {
    sourceId,
    snapshot: {
      schemaVersion: '1', revision: `revision-${sourceId}`, generatedAt: '2026-10-03T00:00:00.000Z', origin: 'online', stale: false,
      plugins: [plugin], packs: [],
      presentations: [{ id: plugin.presentationId, revision: 'p1', title: 'Alpha', summary: '测试', markdown: '', media: [] }],
      deliveries: [{ pluginId: plugin.id, packageName: plugin.packageName, version: plugin.version, artifactDigest: plugin.artifactDigest!,
        sources: [{ kind: 'https-artifact', ref: 'https://example.invalid/alpha.tgz', priority: 0 }] }],
      recommendations: [{ pluginId: plugin.id, version: plugin.version, placement: 'featured', order: 0, reason: '测试推荐' }],
      ...snapshotChanges,
    },
  }
}

function emptySource(sourceId: string): CatalogMergeSource {
  return source(sourceId, {}, { plugins: [], deliveries: [], presentations: [], recommendations: [] })
}

function listingSource(sourceId: string, hostRequirements?: CatalogHostRequirements): CatalogMergeSource {
  return source(sourceId, {}, {
    plugins: [], deliveries: [], presentations: [], recommendations: [],
    listings: [{ id: 'listing.alpha', packageName: '@test/alpha', name: 'Alpha', requestedVersion: '1.0.0',
      summary: '研究条目', reason: '没有制品', sourceUrl: 'https://example.invalid/alpha', ...(hostRequirements ? { hostRequirements } : {}) }],
  })
}

describe('HC-1 多源目录纯合并', () => {
  it('相同发行和关联表去重，重新生成发现页', () => {
    const result = mergeCatalogSnapshots(source('base'), [source('mirror')])
    expect(result.issues).toEqual([])
    expect(result.snapshot.plugins).toHaveLength(1)
    expect(result.snapshot.deliveries).toHaveLength(1)
    expect(result.snapshot.presentations).toHaveLength(1)
    expect(result.snapshot.discovery?.featured).toHaveLength(1)
  })

  it('同摘要交付合并所有镜像，不丢失原来源', () => {
    const mirror = source('mirror')
    const delivery = mirror.snapshot.deliveries[0]!
    const extra = { ...mirror, snapshot: { ...mirror.snapshot, deliveries: [{ ...delivery,
      sources: [{ kind: 'https-artifact' as const, ref: 'https://mirror.invalid/alpha.tgz', priority: 1 }] }] } }
    const result = mergeCatalogSnapshots(source('base'), [extra])
    expect(result.issues).toEqual([])
    expect(result.snapshot.deliveries[0]?.sources).toHaveLength(2)
  })

  it.each([
    ['制品摘要', { artifactDigest: otherDigest }],
    ['元数据摘要', { metadataDigest: otherDigest }],
    ['发行身份', { releaseId: 'release-other' }],
    ['内容', { summary: '不同内容' }],
    ['包身份', { packageName: '@test/other' }],
  ] satisfies readonly (readonly [string, Partial<CatalogPlugin>])[])('%s 冲突暂停所有候选而非最后写入赢', (_label, changes) => {
    const base = source('base', { metadataDigest, releaseId: 'release-alpha' })
    const mirror = source('mirror', { metadataDigest, releaseId: 'release-alpha', ...changes })
    const result = mergeCatalogSnapshots(base, [mirror])
    expect(result.snapshot.plugins).toEqual([])
    expect(result.snapshot.deliveries).toEqual([])
    expect(result.snapshot.presentations).toEqual([])
    expect(result.snapshot.recommendations).toEqual([])
    expect(result.issues).toContainEqual(expect.objectContaining({ table: 'plugins', code: 'content-conflict' }))
    expect(mergeCatalogSnapshots(mirror, [base])).toEqual(result)
  })

  it('相同声明只改变来源标识和 revision 时合并，并保留两份出处', () => {
    const base = source('base', { hostRequirements: requirements('>=0.2.0', { sourceId: 'base', sourceRevision: 'r1' }) })
    const mirror = source('mirror', { hostRequirements: { ...requirements('>=0.2.0', { sourceId: 'mirror', sourceRevision: 'r2' }), historyCoverage: 'partial' } })
    const result = mergeCatalogSnapshots(base, [mirror])
    expect(result.issues).toEqual([])
    expect(result.snapshot.plugins[0]?.hostRequirements?.declarations).toHaveLength(2)
    expect(result.snapshot.plugins[0]?.hostRequirements?.historyCoverage).toBe('partial')
    expect(mergeCatalogSnapshots(mirror, [base])).toEqual(result)
  })

  it.each([
    ['范围', requirements('>=0.3.0')],
    ['声明元数据摘要', requirements('>=0.2.0', { metadataDigest: otherDigest })],
    ['未知范围', requirements(null)],
  ])('%s 不同不能由镜像覆盖，问题保留真实声明', (_label, conflicting) => {
    const result = mergeCatalogSnapshots(source('base', { hostRequirements: requirements() }), [source('mirror', { hostRequirements: conflicting })])
    expect(result.snapshot.plugins).toEqual([])
    expect(result.issues[0]?.candidates.map(candidate => candidate.hostRequirements)).toEqual(expect.arrayContaining([requirements(), conflicting]))
  })

  it('单发行不同范围字符串交给 HC-2 评估，不在合并阶段判为矛盾', () => {
    const hostRequirements = { ...requirements(), declarations: [...requirements('^1.0.0').declarations,
      ...requirements('>=1.0.0 <2.0.0', { origin: 'package-peer' }).declarations] }
    const result = mergeCatalogSnapshots(source('base', { hostRequirements }), [])
    expect(result.snapshot.plugins).toHaveLength(1)
    expect(result.snapshot.plugins[0]?.hostRequirements?.declarations).toHaveLength(2)
    expect(result.issues).toEqual([])
  })

  it('单发行跨 origin 的文档摘要不同不影响相同范围，null 只是未知', () => {
    const hostRequirements = { ...requirements(), declarations: [...requirements().declarations,
      ...requirements('>=0.2.0', { origin: 'agent-forge-target', metadataDigest: otherDigest }).declarations,
      ...requirements('>=0.2.0', { origin: 'package-peer' }).declarations,
      ...requirements(null, { origin: 'agent-forge-target', metadataDigest: otherDigest }).declarations] }
    const result = mergeCatalogSnapshots(source('base', { hostRequirements }), [source('mirror', { hostRequirements })])
    expect(result.snapshot.plugins[0]?.hostRequirements?.declarations).toHaveLength(4)
    expect(result.issues).toEqual([])
  })

  it('缺失声明与已知声明不被视为相同内容', () => {
    const result = mergeCatalogSnapshots(source('base'), [source('mirror', { hostRequirements: requirements() })])
    expect(result.snapshot.plugins).toEqual([])
    expect(result.issues[0]?.code).toBe('content-conflict')
  })

  it('已知撤回的 hard-blocked 不被旧镜像恢复，交付和推荐同步移除', () => {
    const withdrawn = source('withdrawn', { installability: 'hard-blocked' })
    const mirror = source('old-mirror')
    const result = mergeCatalogSnapshots(withdrawn, [mirror])
    expect(result.snapshot.plugins[0]?.installability).toBe('hard-blocked')
    expect(result.snapshot.deliveries).toEqual([])
    expect(result.snapshot.recommendations).toEqual([])
    expect(result.snapshot.discovery?.featured).toEqual([])
    expect(result.issues[0]?.code).toBe('known-blocked')
    expect(mergeCatalogSnapshots(mirror, [withdrawn])).toEqual(result)
  })

  it('同包同版的不同插件 id 不产生隐式赢家', () => {
    const result = mergeCatalogSnapshots(source('base'), [source('alias', { id: 'test.alias' })])
    expect(result.snapshot.plugins).toEqual([])
    expect(result.snapshot.deliveries).toEqual([])
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'identity-conflict', table: 'plugins' }))
  })

  it('来源自身冲突被暂停，也不能抹掉其中已知的撤回事实', () => {
    const withdrawn = source('base', { installability: 'hard-blocked' })
    const contradictory = source('base')
    const mirror = source('mirror')
    const result = mergeCatalogSnapshots(withdrawn, [contradictory, mirror])
    expect(result.snapshot.plugins[0]?.installability).toBe('hard-blocked')
    expect(result.snapshot.deliveries).toEqual([])
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'known-blocked' }))
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'source-conflict' }))
    expect(mergeCatalogSnapshots(mirror, [contradictory, withdrawn])).toEqual(result)
  })

  it('缺少交付不能保留 bundle-installable 声明', () => {
    const result = mergeCatalogSnapshots(source('base', {}, { deliveries: [] }), [])
    expect(result.snapshot.plugins).toEqual([])
    expect(result.issues[0]?.code).toBe('reference-conflict')
  })

  it('纯浏览的缺制品发行可保留，不伪造交付', () => {
    const result = mergeCatalogSnapshots(source('base', { installability: 'missing-artifact' }, { deliveries: [] }), [])
    expect(result.snapshot.plugins[0]?.installability).toBe('missing-artifact')
    expect(result.snapshot.deliveries).toEqual([])
    expect(result.issues).toEqual([])
  })

  it('冲突只暂停对应发行，无关候选仍可浏览', () => {
    const safe = source('safe', { id: 'test.safe', packageName: '@test/safe', presentationId: 'safe.presentation' })
    const result = mergeCatalogSnapshots(source('base'), [source('bad', { artifactDigest: otherDigest }), safe])
    expect(result.snapshot.plugins.map(plugin => plugin.id)).toEqual(['test.safe'])
    expect(result.snapshot.deliveries.map(delivery => delivery.pluginId)).toEqual(['test.safe'])
  })

  it('展示资料相同去重，冲突时暂停引用它的发行', () => {
    const mirror = source('mirror')
    const result = mergeCatalogSnapshots(source('base'), [{ ...mirror, snapshot: { ...mirror.snapshot,
      presentations: mirror.snapshot.presentations.map(presentation => ({ ...presentation, markdown: '冲突正文' })) } }])
    expect(result.snapshot.plugins).toEqual([])
    expect(result.snapshot.presentations).toEqual([])
    expect(result.snapshot.deliveries).toEqual([])
    expect(result.issues).toContainEqual(expect.objectContaining({ table: 'presentations', code: 'content-conflict' }))
  })

  it('展示资料缺失不留下可选择的悬空候选', () => {
    const result = mergeCatalogSnapshots(source('base', {}, { presentations: [] }), [])
    expect(result.snapshot.plugins).toEqual([])
    expect(result.issues[0]?.code).toBe('reference-conflict')
  })

  it('交付与插件摘要不一致时暂停并保留问题事实', () => {
    const base = source('base')
    const result = mergeCatalogSnapshots({ ...base, snapshot: { ...base.snapshot,
      deliveries: base.snapshot.deliveries.map(delivery => ({ ...delivery, artifactDigest: otherDigest })) } }, [])
    expect(result.snapshot.plugins).toEqual([])
    expect(result.snapshot.deliveries).toEqual([])
    expect(result.issues[0]?.code).toBe('reference-conflict')
  })

  it('Listing 不升级为插件，来源差异不造成相同声明冲突', () => {
    const result = mergeCatalogSnapshots(listingSource('base', requirements()), [listingSource('mirror', requirements('>=0.2.0', { sourceId: 'mirror' }))])
    expect(result.issues).toEqual([])
    expect(result.snapshot.listings).toHaveLength(1)
    expect(result.snapshot.plugins).toEqual([])
    expect(result.snapshot.deliveries).toEqual([])
    expect(result.snapshot.listings?.[0]?.hostRequirements?.declarations).toHaveLength(2)
  })

  it('Listing 声明冲突保留事实而非最后写入赢', () => {
    const result = mergeCatalogSnapshots(listingSource('base', requirements()), [listingSource('mirror', requirements('<0.2.0'))])
    expect(result.snapshot.listings).toEqual([])
    expect(result.issues[0]).toMatchObject({ table: 'listings', code: 'content-conflict' })
  })

  it('完整来源 revision 向量使用规范 SHA-256，不截断长后缀', () => {
    const base = source('base')
    const longRevision = 'x'.repeat(500)
    const mirror = { ...source('mirror'), sourceRevision: `${longRevision}A` }
    const result = mergeCatalogSnapshots(base, [mirror])
    const expected = createHash('sha256').update(canonicalJson(result.sourceRevisions)).digest('hex')
    expect(result.snapshot.revision).toBe(`merge:sha256:${expected}`)
    expect(result.sourceRevisions).toContainEqual({ sourceId: 'mirror', revision: `${longRevision}A` })
    expect(mergeCatalogSnapshots(base, [{ ...mirror, sourceRevision: `${longRevision}B` }]).snapshot.revision).not.toBe(result.snapshot.revision)
  })

  it('独立版本不互相覆盖，未绑定版本的推荐不任意选择赢家', () => {
    const base = source('base')
    const second = source('second', { version: '2.0.0' }, {
      recommendations: [{ pluginId: 'test.alpha', placement: 'featured', order: 1, reason: '未绑定版本' }],
    })
    const result = mergeCatalogSnapshots(base, [second])
    expect(result.snapshot.plugins.map(plugin => plugin.version)).toEqual(['1.0.0', '2.0.0'])
    expect(result.snapshot.deliveries).toHaveLength(2)
    expect(result.snapshot.recommendations).toHaveLength(1)
    expect(result.snapshot.recommendations?.[0]?.version).toBe('1.0.0')
  })

  it('冲突发行关联套餐和集合同步暂停，不能借关联表恢复选择', () => {
    const base = source('base', {}, {
      packs: [{ id: 'test.pack', name: 'Pack', version: '1.0.0', summary: '测试', category: 'unclassified', lockDigest: metadataDigest,
        components: [{ pluginId: 'test.alpha', version: '1.0.0', required: true }],
        execution: { schemaVersion: '1', packId: 'test.pack', packVersion: '1.0.0', lockDigest: metadataDigest, coverage: 'complete', edges: [], provenance: 'test' } }],
      collections: [{ kind: 'market-collection', id: 'test.collection', name: 'Collection', version: '1.0.0', summary: '测试', collectionDigest: metadataDigest,
        components: [{ pluginId: 'test.alpha', version: '1.0.0', releaseId: 'release-alpha', artifactDigest, required: true, enabled: false }],
        execution: { coverage: 'complete', edges: [], provenance: 'test' } }],
    })
    const valid = mergeCatalogSnapshots(base, [])
    expect(valid.snapshot.packs).toHaveLength(1)
    expect(valid.snapshot.collections).toHaveLength(1)
    const conflict = mergeCatalogSnapshots(base, [source('bad', { artifactDigest: otherDigest })])
    expect(conflict.snapshot.packs).toEqual([])
    expect(conflict.snapshot.collections).toEqual([])
    expect(conflict.issues).toContainEqual(expect.objectContaining({ table: 'packs', code: 'reference-conflict' }))
    expect(conflict.issues).toContainEqual(expect.objectContaining({ table: 'collections', code: 'reference-conflict' }))
  })

  it('声明顺序和重复声明不改变内容判定，保留规范化声明集合', () => {
    const hostRequirements = { ...requirements(), declarations: [...requirements().declarations, ...requirements(null, { agentId: 'other' }).declarations] }
    const reversed = { ...hostRequirements, declarations: [...hostRequirements.declarations].reverse().concat(hostRequirements.declarations[0]!) }
    const result = mergeCatalogSnapshots(source('base', { hostRequirements }), [source('mirror', { hostRequirements: reversed })])
    expect(result.snapshot.plugins[0]?.hostRequirements?.declarations).toHaveLength(2)
    expect(result.issues).toEqual([])
  })

  it('来源身份与 revision 的配对变化会改变摘要', () => {
    const base = { ...emptySource('base'), sourceRevision: 'one' }
    const mirror = { ...emptySource('mirror'), sourceRevision: 'two' }
    expect(mergeCatalogSnapshots(base, [mirror]).snapshot.revision)
      .not.toBe(mergeCatalogSnapshots({ ...base, sourceRevision: 'two' }, [{ ...mirror, sourceRevision: 'one' }]).snapshot.revision)
  })

  it('输入来源顺序变化不改变任何结果或问题排序', () => {
    const inputs = [source('base'), source('bad', { metadataDigest: otherDigest }), listingSource('list')]
    const expected = mergeCatalogSnapshots(inputs[0]!, inputs.slice(1))
    for (const order of [[0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      const reordered = order.map(index => inputs[index]!)
      expect(mergeCatalogSnapshots(reordered[0]!, reordered.slice(1))).toEqual(expected)
    }
  })

  it('重复同一来源幂等，不一致的同名来源暂停', () => {
    const base = source('base')
    expect(mergeCatalogSnapshots(base, [base])).toEqual(mergeCatalogSnapshots(base, []))
    const conflict = mergeCatalogSnapshots(base, [source('base', { summary: '改变内容' })])
    expect(conflict.snapshot.plugins).toEqual([])
    expect(conflict.issues[0]).toMatchObject({ code: 'source-conflict', table: 'sources' })
  })

  it('stale 传播，生成时间和 origin 不依赖来源顺序', () => {
    const base = source('base', {}, { stale: true, origin: 'cache', generatedAt: '2026-10-02T00:00:00.000Z' })
    const mirror = source('mirror')
    const result = mergeCatalogSnapshots(base, [mirror])
    expect(result.snapshot).toMatchObject({ stale: true, origin: 'online', generatedAt: mirror.snapshot.generatedAt })
    expect(mergeCatalogSnapshots(mirror, [base])).toEqual(result)
  })

  it('不修改深度冻结的输入', () => {
    const base = deepFreeze(source('base', { hostRequirements: requirements() }))
    const extras = deepFreeze([source('mirror', { hostRequirements: requirements() })])
    const original = canonicalJson({ base, extras })
    expect(() => mergeCatalogSnapshots(base, extras)).not.toThrow()
    expect(canonicalJson({ base, extras })).toBe(original)
  })

  it('真实随包 v2 与经过投影校验的 Agent Forge v1 可以合并，保留 base schema', () => {
    const embedded = JSON.parse(readFileSync(new URL('../../packages/market/data/index.json', import.meta.url), 'utf8'))
    const baseSnapshot = validateMarketIndex(embedded, { origin: 'embedded' }).snapshot
    expect(baseSnapshot.schemaVersion).toBe('2')
    const record = { schemaVersion: 2, id: 'dev.test.merge-source', name: '@test/merge-source', version: '1.0.0',
      type: 'plugin', description: '合成 Agent Forge 合并测试', license: 'MIT',
      targets: [{ agentId: 'dsh', compatibilityStatus: 'known', agentVersionRange: '>=0.2.0' }] }
    const projected = projectAgentForgeCatalog({ source: {}, index: {}, packages: new Map([[record.name, record]]),
      packageDocuments: new Map([[record.name, rawRecord(Buffer.from(JSON.stringify(record)))]]), advisories: new Map(),
      sourceRevision: 'r1', sourceId: 'agent-forge:merge-test', agentId: 'dsh', stale: false, origin: 'local-file' },
    { revision: 'af-merge-r1', generatedAt: '2026-10-03T00:00:00.000Z', sourceUrl: 'https://example.invalid/merge/source.json' })
    const extraSnapshot = validateMarketIndex(projected, { origin: 'online' }).snapshot
    expect(extraSnapshot.schemaVersion).toBe('1')
    const base = { sourceId: 'market-index', snapshot: baseSnapshot, sourceRevision: baseSnapshot.revision }
    const extra = { sourceId: 'configured-agent-forge', snapshot: extraSnapshot, sourceRevision: extraSnapshot.revision }
    const result = mergeCatalogSnapshots(base, [extra])
    expect(result.snapshot.schemaVersion).toBe('2')
    expect(result.snapshot.plugins).toHaveLength(baseSnapshot.plugins.length)
    expect(result.snapshot.listings).toEqual(expect.arrayContaining([...(extraSnapshot.listings ?? [])]))
    expect(result.sourceRevisions).toEqual(expect.arrayContaining([
      { sourceId: 'market-index', revision: baseSnapshot.revision },
      { sourceId: 'configured-agent-forge', revision: extraSnapshot.revision },
    ]))
    expect(mergeCatalogSnapshots(extra, [base]).snapshot.schemaVersion).toBe('1')
  })

  it.each(['0', '3', 'unknown'])('未知 schema %s 明确拒绝，无论来自 base 还是 extra', schemaVersion => {
    const unknown = source('unknown', {}, { schemaVersion })
    expect(() => mergeCatalogSnapshots(source('base'), [unknown])).toThrow(/schemaVersion/)
    expect(() => mergeCatalogSnapshots(unknown, [source('extra')])).toThrow(/schemaVersion/)
  })

  it('合并问题和完整来源向量是快照的可序列化公共事实，不仅保存在 helper 返回外层', () => {
    const result = mergeCatalogSnapshots(source('base', { hostRequirements: requirements() }),
      [source('mirror', { hostRequirements: requirements('>=0.3.0') })])
    const wire = JSON.parse(JSON.stringify(result.snapshot)) as CatalogSnapshot
    expect(wire.sourceRevisions).toEqual(result.sourceRevisions)
    expect(wire.mergeIssues).toEqual(result.issues)
    expect(wire.mergeIssues?.[0]?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'base', revision: 'revision-base', hostRequirements: requirements() }),
      expect.objectContaining({ sourceId: 'mirror', revision: 'revision-mirror', hostRequirements: requirements('>=0.3.0') }),
    ]))
  })
})
