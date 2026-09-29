import { createHash } from 'node:crypto'
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CatalogRepository, CatalogSourceRegistry, releaseIdFor, validateMarketIndex } from '../../packages/market-core/src/catalog/index.ts'
import { rawRecord } from '../../packages/market-core/src/catalog/public-format.ts'

function fixture() {
  const document = JSON.parse(readFileSync(new URL('./fixtures/valid-market-index.json', import.meta.url), 'utf8'))
  const plugin = document.plugins[0]
  const metadata = rawRecord(Buffer.from(JSON.stringify({ name: plugin.packageName, version: plugin.version, dsh: { bundle: { patch: './cordis.patch.yml' } } })))
  delete plugin.manifest
  delete plugin.manifestDigest
  plugin.metadata = { kind: 'official-bundle', packageJson: metadata, files: ['package.json', 'cordis.patch.yml'] }
  document.schemaVersion = '2'
  document.revision = 'content-v2-1'
  document.publication = { sourceId: 'content-team', sequence: 1 }
  document.packs = []
  const release = { schemaVersion: '1', pluginId: plugin.id, packageName: plugin.packageName, version: plugin.version, artifactDigest: plugin.artifactDigest, metadataDigest: metadata.sha256, size: 509, publishedAt: '2026-09-01T00:00:00.000Z', provenance: { kind: 'author-release', repositoryUrl: 'https://example.invalid/fixture/repo', commit: '1'.repeat(40), releaseUrl: 'https://example.invalid/fixture/release/1.2.3', license: 'MIT', authorization: { basis: 'license', reference: 'TEST LICENSE', redistribution: true } } }
  plugin.releaseId = releaseIdFor(release)
  document.releases = [{ ...release, releaseId: plugin.releaseId }]
  document.releaseStatuses = [{ releaseId: plugin.releaseId, sequence: 1, status: 'active', effectiveAt: '2026-09-01T00:00:00.000Z', reason: 'test only' }]
  document.deliveries[0].sources = [{ kind: 'https-artifact', ref: 'https://example.invalid/fixture/a.tgz', priority: 0, size: 509 }]
  document.collections = [{ schemaVersion: '1', kind: 'MarketCollection', id: 'dev.test.private-collection', version: '1.0.0', name: '私有测试组合', summary: '无 npm 坐标', components: [{ pluginId: plugin.id, version: plugin.version, releaseId: plugin.releaseId, artifactDigest: plugin.artifactDigest, required: true, enabled: false }], execution: { coverage: 'complete', edges: [], provenance: 'synthetic' } }]
  document.recommendations = [{ id: 'fixture-featured', pluginId: plugin.id, version: plugin.version, curator: 'synthetic', placement: 'featured', order: 0, reason: '测试理由', effectiveAt: '2026-09-01T00:00:00.000Z', withdrawn: false }]
  return document
}

describe('官方元数据、独立私有组合与推荐', () => {
  it('原样保留官方包的 dsh.skin 扩展，但仍核验标准加载字段与真实 patch', () => {
    const input = fixture()
    const original = { name: input.plugins[0].packageName, version: input.plugins[0].version,
      dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' }, skin: { apiVersion: 'dsh.ecosystem.ui-skin-loader/v1', id: 'example.skin', name: '示例皮肤' } } }
    const bytes = Buffer.from(JSON.stringify(original))
    const raw = rawRecord(bytes)
    input.plugins[0].metadata.packageJson = raw
    input.releases[0].metadataDigest = raw.sha256
    const parsed = validateMarketIndex(input)
    expect(Buffer.from(parsed.metadataBytes.get(`${input.plugins[0].id}@${input.plugins[0].version}`)!)).toEqual(bytes)
    original.dsh.bundle.patch = '../outside.yml'
    const unsafe = rawRecord(Buffer.from(JSON.stringify(original)))
    input.plugins[0].metadata.packageJson = unsafe
    input.releases[0].metadataDigest = unsafe.sha256
    expect(() => validateMarketIndex(input)).toThrow()
  })
  it('私有组合 lookup、Client 视图和计划字节保持独立 kind，并拒绝越界选择', () => {
    const input = fixture()
    const repo = new CatalogRepository(input, mkdtempSync(join(tmpdir(), 'collection-plan-')))
    const prepared = repo.collectionForPlan(input.collections[0].id, '1.0.0')
    expect(repo.collectionViews()[0]?.kind).toBe('market-collection')
    expect(prepared.kind).toBe('market-collection')
    expect(JSON.parse(Buffer.from(prepared.documentBytes).toString('utf8')).kind).toBe('MarketCollection')
    expect(prepared.collectionDigest).toBe('sha256:' + createHash('sha256').update(prepared.documentBytes).digest('hex'))
    expect(prepared).not.toHaveProperty('lockBytes')
    expect(() => repo.collectionForPlan(input.collections[0].id, '1.0.0', [])).toThrow(/必选/)
    expect(() => repo.collectionForPlan(input.collections[0].id, '1.0.0', ['dev.test.unknown'])).toThrow(/未知/)
  })

  it('合法官方-only 源码条目可以显示缺 bundle，不假装可安装', () => {
    const input = fixture()
    input.plugins[0].installability = 'missing-bundle'
    const record = rawRecord(Buffer.from(JSON.stringify({ name: input.plugins[0].packageName, version: input.plugins[0].version })))
    input.plugins[0].metadata = { kind: 'official-bundle', packageJson: record, files: ['package.json'] }
    input.releases[0].metadataDigest = record.sha256
    const result = validateMarketIndex(input)
    expect(result.snapshot.plugins[0]?.installability).toBe('missing-bundle')
    expect(result.manifestBytes.size).toBe(0)
  })
  it('official-only 不伪造 Manifest；GitHub-only 组合保持 MarketCollection kind', () => {
    const result = validateMarketIndex(fixture())
    expect(result.snapshot.plugins[0]).not.toHaveProperty('manifest')
    expect(result.snapshot.plugins[0]?.releasedAt).toBe('2026-09-01T00:00:00.000Z')
    expect(result.snapshot.plugins[0]?.verification).toBe('unverified')
    expect(result.snapshot.recommendations?.[0]).toMatchObject({ pluginId: 'dev.test.alpha', version: '1.2.3' })
    expect(result.manifestBytes.size).toBe(0)
    expect(result.metadataBytes.size).toBe(1)
    expect(result.collections[0]?.kind).toBe('MarketCollection')
    expect(result.snapshot.packs).toEqual([])
  })

  it('缺 patch、伪造元数据身份和私有组合冒充 Pack 均拒绝', () => {
    const missing = fixture(); missing.plugins[0].metadata.files.pop()
    expect(() => validateMarketIndex(missing)).toThrow(/patch/)
    const wrong = fixture(); wrong.plugins[0].packageName = '@test/other'
    expect(() => validateMarketIndex(wrong)).toThrow(/身份/)
    const confused = fixture(); confused.collections[0].kind = 'Pack'
    expect(() => validateMarketIndex(confused)).toThrow(/MarketCollection/)
  })

  it('未到期、过期、撤回推荐分别投影；非法时间仍拒绝', () => {
    const input = fixture()
    input.recommendations[0].expiresAt = '2026-09-28T00:00:00Z'
    expect(validateMarketIndex(input, { now: new Date('2026-09-28T00:00:00Z') }).snapshot.recommendations).toEqual([])
    delete input.recommendations[0].expiresAt
    input.recommendations[0].withdrawn = true
    expect(validateMarketIndex(input).snapshot.recommendations).toEqual([])
  })
})

describe('发布接受记录与撤回持久性', () => {
  it('新撤回后主源故障回到旧镜像被拒；重启且 current 损坏仍不复活', async () => {
    const root = mkdtempSync(join(tmpdir(), 'catalog-v2-'))
    const old = fixture()
    const repo = new CatalogRepository(old, root)
    expect((await repo.refresh(async () => JSON.stringify(old))).status).toBe('refreshed')
    const next = fixture()
    next.revision = 'content-v2-2'; next.publication.sequence = 2
    next.releaseStatuses.push({ ...next.releaseStatuses[0], sequence: 2, status: 'withdrawn', reason: '合成撤回' })
    expect((await repo.refresh(async () => JSON.stringify(next))).status).toBe('refreshed')
    const registry = new CatalogSourceRegistry([
      { id: 'primary', catalogId: 'content-team', indexUrl: 'https://primary.example.test/index.json', maintainer: 'test', trust: 'team-registered', fallbackId: 'mirror' },
      { id: 'mirror', catalogId: 'content-team', indexUrl: 'https://mirror.example.test/index.json', maintainer: 'test', trust: 'team-registered' },
    ], { security: { lookup: async () => ['93.184.216.34'] }, fetch: (async url => { if (String(url).includes('primary')) throw new Error('故障注入'); return new Response(JSON.stringify(old)) }) as typeof fetch })
    const rejected = await repo.refreshWithSource(registry.connection())
    expect(rejected.status).toBe('failed')
    expect(rejected.reason).toMatch(/旧发布|旧镜像/)
    expect(repo.snapshotForInstall().plugins[0]?.installability).toBe('hard-blocked')
    expect(repo.load().snapshot.stale).toBe(true)
    writeFileSync(join(root, 'current.json'), '{broken')
    const restarted = new CatalogRepository(old, root)
    expect(restarted.load().snapshot.revision).toBe('content-v2-2')
    expect(() => restarted.assertReleaseActive(old.plugins[0].id, old.plugins[0].version, old.plugins[0].artifactDigest)).toThrow(/撤回/)
    expect(() => restarted.collectionForPlan(old.collections[0].id, '1.0.0')).toThrow(/撤回/)
    // 即使最新快照文件坏了，读取旧目录时仍应用累计撤回记录。
    writeFileSync(join(root, 'revisions', createHash('sha256').update(next.revision).digest('hex') + '.json'), 'corrupt')
    expect(new CatalogRepository(old, root).load().snapshot.plugins[0]?.installability).toBe('hard-blocked')
  })

  it('新的介绍目录遗漏撤回状态不能解除撤回；旧 v1 不能覆盖 v2', async () => {
    const input = fixture(); input.releaseStatuses[0].status = 'withdrawn'
    const root = mkdtempSync(join(tmpdir(), 'catalog-v2-retain-'))
    const repo = new CatalogRepository(input, root)
    await repo.refresh(async () => JSON.stringify(input))
    const next = fixture(); next.revision = 'content-v2-2'; next.publication.sequence = 2
    expect((await repo.refresh(async () => JSON.stringify(next))).status).toBe('failed') // 同一状态序号改回 active 非法
    const v1 = JSON.parse(readFileSync(new URL('./fixtures/valid-market-index.json', import.meta.url), 'utf8'))
    expect((await repo.refresh(async () => JSON.stringify(v1))).status).toBe('failed')
  })

  it('revision 写入或接受记录失败均不切换；指针失败从已提交记录恢复', async () => {
    const initial = fixture()
    const root = mkdtempSync(join(tmpdir(), 'catalog-v2-atomic-'))
    const repo = new CatalogRepository(initial, root)
    await repo.refresh(async () => JSON.stringify(initial))
    const next = fixture(); next.revision = 'content-v2-2'; next.publication.sequence = 2
    mkdirSync(join(root, 'acceptances', '0000000000000002.json'))
    expect((await repo.refresh(async () => JSON.stringify(next))).status).toBe('failed')
    expect(repo.snapshotForInstall().revision).toBe(initial.revision)
    expect(new CatalogRepository(initial, root).load().snapshot.plugins[0]?.installability).toBe('hard-blocked') // 最高接受记录损坏，禁止安装
  })

  it('同实例并发刷新不能把较慢旧修订覆盖新修订；返回对象不可修改内部缓存', async () => {
    const old = fixture(), next = fixture(); next.revision = 'content-v2-2'; next.publication.sequence = 2
    const repo = new CatalogRepository(old, mkdtempSync(join(tmpdir(), 'catalog-v2-race-')))
    const [first, second] = await Promise.all([repo.refresh(async () => JSON.stringify(next)), repo.refresh(async () => JSON.stringify(old))])
    expect(first.status).toBe('refreshed'); expect(second.status).toBe('failed')
    ;(first.current.snapshot.plugins[0] as any).name = 'tampered'
    expect(repo.snapshotForInstall().plugins[0]?.name).not.toBe('tampered')
  })
})
