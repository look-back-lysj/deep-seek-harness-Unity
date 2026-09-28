import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CatalogRepository, releaseIdFor, validateMarketIndex } from '../../packages/market/src/catalog/index.ts'
import { commitAcceptance, latestAcceptance, prepareAcceptance } from '../../packages/market/src/catalog/lifecycle.ts'
import { rawRecord } from '../../packages/market/src/catalog/public-format.ts'

const evidenceRoot = process.platform === 'win32' ? 'D:/eac-market-verify/distribution-20260928/catalog-floor' : tmpdir()
function fresh(): string { mkdirSync(evidenceRoot, { recursive: true }); return mkdtempSync(join(evidenceRoot, 'embedded-')) }
const digest = (bytes: Uint8Array): string => 'sha256:' + createHash('sha256').update(bytes).digest('hex')
const bytesOf = (document: unknown): Buffer => Buffer.from(JSON.stringify(document, null, 2) + '\n')
const revisionPath = (root: string, revision: string): string => join(root, 'revisions', createHash('sha256').update(revision).digest('hex') + '.json')

function fixture(sequence: number, withdrawn = false) {
  const document = JSON.parse(readFileSync(new URL('./fixtures/valid-market-index.json', import.meta.url), 'utf8'))
  const plugin = document.plugins[0]
  const metadata = rawRecord(Buffer.from(JSON.stringify({ name: plugin.packageName, version: plugin.version, dsh: { bundle: { patch: './cordis.patch.yml' } } })))
  delete plugin.manifest; delete plugin.manifestDigest
  plugin.metadata = { kind: 'official-bundle', packageJson: metadata, files: ['package.json', 'cordis.patch.yml'] }
  document.schemaVersion = '2'; document.revision = `embedded-floor-${sequence}`
  document.publication = { sourceId: 'content-team', sequence }; document.packs = []
  const release = { schemaVersion: '1' as const, pluginId: plugin.id, packageName: plugin.packageName, version: plugin.version, artifactDigest: plugin.artifactDigest, metadataDigest: metadata.sha256, size: 509, publishedAt: '2026-09-01T00:00:00.000Z', provenance: { kind: 'author-release' as const, repositoryUrl: 'https://example.invalid/fixture/repo', commit: '1'.repeat(40), releaseUrl: 'https://example.invalid/fixture/release', license: 'MIT', authorization: { basis: 'license' as const, reference: 'TEST LICENSE', redistribution: true } } }
  plugin.releaseId = releaseIdFor(release); document.releases = [{ ...release, releaseId: plugin.releaseId }]
  const status = { releaseId: plugin.releaseId, sequence: 1, status: 'active', effectiveAt: '2026-09-01T00:00:00.000Z', reason: 'synthetic original release' }
  document.releaseStatuses = [status, ...(withdrawn ? [{ ...status, sequence: 2, status: 'withdrawn', reason: 'synthetic withdrawal' }] : [])]
  document.deliveries[0].sources = [{ kind: 'https-artifact', ref: 'https://example.invalid/fixture/a.tgz', priority: 0, size: 509 }]
  document.recommendations = []; document.collections = []
  return document
}

/** Produce the existing disk schema directly, without the new bootstrap path. */
function seedLegacy(root: string, document: ReturnType<typeof fixture>): string {
  const raw = bytesOf(document)
  mkdirSync(join(root, 'revisions'), { recursive: true })
  writeFileSync(revisionPath(root, document.revision), raw)
  commitAcceptance(root, prepareAcceptance(validateMarketIndex(document), digest(raw)))
  return join(root, 'acceptances', `${String(document.publication.sequence).padStart(16, '0')}.json`)
}

function expectWithdrawn(repo: CatalogRepository, document: ReturnType<typeof fixture>): void {
  const plugin = document.plugins[0]
  expect(repo.snapshotForInstall().plugins[0]?.installability).toBe('hard-blocked')
  expect(() => repo.assertReleaseActive(plugin.id, plugin.version, plugin.artifactDigest)).toThrow(/撤回/)
}

describe('随包 v2 接受基线', () => {
  it('fresh seq3 在第一次刷新前即保存基线，拒绝 seq1，重启仍保留撤回', async () => {
    const root = fresh(), embedded = fixture(3, true), raw = bytesOf(embedded)
    const repo = new CatalogRepository(embedded, root, {}, raw)
    expectWithdrawn(repo, embedded)
    expect(latestAcceptance(root)?.publication.sequence).toBe(3)
    const result = await repo.refresh(async () => bytesOf(fixture(1)))
    expect(result.status).toBe('failed'); expect(result.reason).toMatch(/旧发布/)
    expect(repo.load().snapshot.revision).toBe(embedded.revision)
    expectWithdrawn(new CatalogRepository(embedded, root, {}, raw), embedded)
  })

  it('seq4 只保留 active 旧事件不能复活撤回，接受历史和重启都保留撤回', async () => {
    const root = fresh(), embedded = fixture(3, true), raw = bytesOf(embedded)
    const repo = new CatalogRepository(embedded, root, {}, raw)
    expect((await repo.refresh(async () => bytesOf(fixture(4)))).status).toBe('refreshed')
    expect(latestAcceptance(root)?.publication.sequence).toBe(4)
    expect(latestAcceptance(root)?.statuses[embedded.plugins[0].releaseId]?.status).toBe('withdrawn')
    expectWithdrawn(repo, embedded)
    expectWithdrawn(new CatalogRepository(embedded, root, {}, raw), embedded)
  })

  it('旧 seq2 升级随包 seq3 不清空或覆盖旧接受文件及额外撤回记录', () => {
    const root = fresh(), old = fixture(2)
    const extra = { ...old.releases[0], pluginId: 'dev.test.retired', packageName: '@test/retired' }
    extra.releaseId = releaseIdFor(extra)
    old.releases.push(extra)
    old.releaseStatuses.push({ ...old.releaseStatuses[0], releaseId: extra.releaseId, status: 'withdrawn' })
    const originalFile = seedLegacy(root, old), original = readFileSync(originalFile)
    const embedded = fixture(3, true)
    const repo = new CatalogRepository(embedded, root, {}, bytesOf(embedded))
    expectWithdrawn(repo, embedded)
    expect(repo.load().snapshot.revision).toBe(embedded.revision)
    expect(readFileSync(originalFile)).toEqual(original)
    expect(latestAcceptance(root)?.statuses[extra.releaseId]?.status).toBe('withdrawn')
    expect(latestAcceptance(root)?.publication.sequence).toBe(3)
  })

  it('已有更高 seq4 的旧历史仍合并随包撤回，不回退序号；下次接受保存合并结果', async () => {
    const root = fresh(), old = fixture(4), embedded = fixture(3, true), raw = bytesOf(embedded)
    const originalFile = seedLegacy(root, old), original = readFileSync(originalFile)
    const repo = new CatalogRepository(embedded, root, {}, raw)
    expectWithdrawn(repo, embedded)
    expect(repo.load().snapshot.revision).toBe(old.revision)
    expectWithdrawn(new CatalogRepository(embedded, root, {}, raw), embedded)
    expect(readFileSync(originalFile)).toEqual(original)
    expect((await repo.refresh(async () => bytesOf(fixture(5)))).status).toBe('refreshed')
    expect(latestAcceptance(root)?.statuses[embedded.plugins[0].releaseId]?.status).toBe('withdrawn')
  })

  it('原始漂亮排版字节同 seq3 可重刷，内容变化仍拒绝；旧三参数调用复用已有摘要', async () => {
    const root = fresh(), embedded = fixture(3, true), raw = bytesOf(embedded)
    const repo = new CatalogRepository(embedded, root, {}, raw)
    repo.load()
    expect(latestAcceptance(root)?.digest).toBe(digest(raw))
    expect((await repo.refresh(async () => raw)).status).toBe('refreshed')
    const legacyCaller = new CatalogRepository(embedded, root)
    expectWithdrawn(legacyCaller, embedded)
    expect((await legacyCaller.refresh(async () => raw)).status).toBe('refreshed')
    const changed = structuredClone(embedded); changed.plugins[0].summary = 'changed at the same sequence'
    expect((await repo.refresh(async () => bytesOf(changed))).status).toBe('failed')
    expect(() => new CatalogRepository(embedded, fresh(), {}, bytesOf(changed))).toThrow(/原始字节/)
  })

  it('最高 acceptance 损坏时，同实例/重启/刷新/安装检查全部 fail closed，不能重建覆盖损坏历史', async () => {
    const root = fresh(), embedded = fixture(3), raw = bytesOf(embedded)
    const repo = new CatalogRepository(embedded, root, {}, raw)
    expect(repo.load().snapshot.plugins[0]?.installability).toBe('bundle-installable')
    const path = join(root, 'acceptances', '0000000000000003.json')
    writeFileSync(path, '{corrupt')
    expect(repo.snapshotForInstall().plugins[0]?.installability).toBe('hard-blocked')
    const plugin = embedded.plugins[0]
    expect(() => repo.assertReleaseActive(plugin.id, plugin.version, plugin.artifactDigest)).toThrow()
    expect((await repo.refresh(async () => bytesOf(fixture(4)))).status).toBe('failed')
    const restarted = new CatalogRepository(embedded, root, {}, raw)
    expect(restarted.load().snapshot.plugins[0]?.installability).toBe('hard-blocked')
    expect(() => restarted.assertReleaseActive(plugin.id, plugin.version, plugin.artifactDigest)).toThrow()
    expect(readFileSync(path, 'utf8')).toBe('{corrupt')
  })

  it('随包 v2 基线也拒绝首次刷新退回 v1 或另一来源', async () => {
    const embedded = fixture(3, true), repo = new CatalogRepository(embedded, fresh(), {}, bytesOf(embedded))
    const v1 = readFileSync(new URL('./fixtures/valid-market-index.json', import.meta.url))
    expect((await repo.refresh(async () => v1)).status).toBe('failed')
    const other = fixture(4); other.publication.sourceId = 'another-team'
    expect((await repo.refresh(async () => bytesOf(other))).status).toBe('failed')
    expectWithdrawn(repo, embedded)
  })
})
