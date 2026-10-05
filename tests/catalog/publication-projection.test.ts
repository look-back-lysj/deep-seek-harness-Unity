import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CatalogPlugin, CatalogSnapshot } from '../../packages/market-core/src/contracts/types.ts'
import { deepFreeze } from '../../packages/market-core/src/core/canonical.ts'
import { applyKnownLifecycle, prepareAcceptance } from '../../packages/market-core/src/catalog/lifecycle.ts'
import { mergeCatalogSnapshots, type CatalogMergeSource } from '../../packages/market-core/src/catalog/merge.ts'
import { rawRecord } from '../../packages/market-core/src/catalog/public-format.ts'
import { releaseIdFor } from '../../packages/market-core/src/catalog/releases.ts'
import { CatalogRepository } from '../../packages/market-core/src/catalog/store.ts'
import { validateMarketIndex } from '../../packages/market-core/src/catalog/validate.ts'

const now = new Date('2026-10-03T00:00:00.000Z')

function v1Fixture() {
  return JSON.parse(readFileSync(new URL('./fixtures/valid-market-index.json', import.meta.url), 'utf8'))
}

function v2Fixture(status: 'active' | 'withdrawn' = 'active') {
  const document = v1Fixture()
  const plugin = document.plugins[0]
  const packageJson = rawRecord(Buffer.from(JSON.stringify({
    name: plugin.packageName, version: plugin.version, dsh: { bundle: { patch: './cordis.patch.yml' } },
  })))
  delete plugin.manifest
  delete plugin.manifestDigest
  plugin.metadata = { kind: 'official-bundle', packageJson, files: ['package.json', 'cordis.patch.yml'] }
  document.schemaVersion = '2'
  document.revision = 'publication-projection-v2'
  document.publication = { sourceId: 'synthetic-content-team', sequence: 1 }
  document.packs = []
  const release = {
    schemaVersion: '1', pluginId: plugin.id, packageName: plugin.packageName, version: plugin.version,
    artifactDigest: plugin.artifactDigest, metadataDigest: packageJson.sha256, size: 509,
    publishedAt: '2026-09-01T00:00:00.000Z',
    provenance: {
      kind: 'author-release', repositoryUrl: 'https://example.invalid/fixture/repo', commit: '1'.repeat(40),
      releaseUrl: 'https://example.invalid/fixture/release/1.2.3', license: 'MIT',
      authorization: { basis: 'license', reference: 'TEST LICENSE', redistribution: true },
    },
  }
  plugin.releaseId = releaseIdFor(release)
  document.releases = [{ ...release, releaseId: plugin.releaseId }]
  document.releaseStatuses = [{
    releaseId: plugin.releaseId, sequence: 1, status, effectiveAt: release.publishedAt, reason: 'synthetic fixture only',
  }]
  document.deliveries[0].sources = [{
    kind: 'https-artifact', ref: 'https://example.invalid/fixture/alpha.tgz', priority: 0, size: release.size,
  }]
  document.recommendations = [{
    id: 'synthetic-featured', pluginId: plugin.id, version: plugin.version, curator: 'synthetic',
    placement: 'featured', order: 0, reason: '测试推荐', effectiveAt: release.publishedAt, withdrawn: false,
  }]
  return document
}

function digest(document: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(document)).digest('hex')}`
}

function dshStdFixture(status: 'active' | 'withdrawn' = 'active') {
  const document = v2Fixture(status)
  const manifest = v1Fixture().plugins[0].manifest
  document.plugins[0].metadata = { kind: 'dsh-std', manifest }
  document.releases[0].metadataDigest = manifest.sha256
  return document
}

function source(sourceId: string, snapshot: CatalogSnapshot, changes: Partial<CatalogPlugin> = {}): CatalogMergeSource {
  return { sourceId, snapshot: { ...snapshot, plugins: snapshot.plugins.map(plugin => ({ ...plugin, ...changes })) } }
}

describe('Catalog 正式发行生命周期投影', () => {
  it.each(['active', 'withdrawn'] as const)('v2 精确绑定 release/status 投影 %s', status => {
    const input = v2Fixture(status)
    const result = validateMarketIndex(input, { now })
    expect(result.snapshot.plugins[0]).toMatchObject({
      publication: status, releaseId: input.plugins[0].releaseId, releasedAt: input.releases[0].publishedAt,
      installability: status === 'withdrawn' ? 'hard-blocked' : 'bundle-installable',
    })
  })

  it('按正式状态 sequence 而不是输入顺序投影', () => {
    const input = v2Fixture()
    const active = input.releaseStatuses[0]
    input.releaseStatuses.unshift({ ...active, sequence: 2, status: 'withdrawn' })
    expect(validateMarketIndex(input, { now }).snapshot.plugins[0]?.publication).toBe('withdrawn')
  })

  it.each(['active', 'withdrawn'] as const)('v2 dsh-std 以校验后 Manifest 摘要绑定正式 %s', status => {
    const input = dshStdFixture(status)
    input.plugins[0].metadataDigest = `sha256:${'f'.repeat(64)}`
    input.plugins[0].publication = status === 'active' ? 'withdrawn' : 'active'
    const result = validateMarketIndex(input, { now })
    expect(result.snapshot.plugins[0]).toMatchObject({
      publication: status, metadataDigest: input.releases[0].metadataDigest,
      installability: status === 'withdrawn' ? 'hard-blocked' : 'bundle-installable',
    })
    expect(Buffer.from(result.manifestBytes.get(`${input.plugins[0].id}@${input.plugins[0].version}:manifest`)!))
      .toEqual(Buffer.from(input.plugins[0].metadata.manifest.contentBase64, 'base64'))
    input.releases[0].metadataDigest = input.plugins[0].metadataDigest
    expect(() => validateMarketIndex(input, { now })).toThrow(/精确发行/)
  })

  it('合法 v1 目录没有正式生命周期时 unknown，不从可安装状态制造 active', () => {
    const result = validateMarketIndex(v1Fixture(), { now })
    expect(result.snapshot.plugins[0]).toMatchObject({ publication: 'unknown', installability: 'bundle-installable' })
    expect(result.releases).toEqual([])
    expect(result.releaseStatuses).toEqual([])
  })

  it.each(['active', 'withdrawn', 'unknown', { forged: true }])('忽略 raw 自报 publication %j', publication => {
    for (const input of [v1Fixture(), v2Fixture(), v2Fixture('withdrawn')]) {
      const expected = validateMarketIndex(input, { now }).snapshot
      input.plugins[0].publication = publication
      expect(validateMarketIndex(input, { now }).snapshot).toEqual(expected)
    }
  })

  it('v1 即使夹带 release/status，也不能冒充正式 v2 生命周期', () => {
    const input = v2Fixture('withdrawn')
    input.schemaVersion = '1'
    expect(validateMarketIndex(input, { now }).snapshot.plugins[0]).toMatchObject({
      publication: 'unknown', installability: 'bundle-installable',
    })
  })

  it.each(['1', '2'])('v%s hard-incompatible 不等于 withdrawn', schemaVersion => {
    const input = schemaVersion === '2' ? v2Fixture() : v1Fixture()
    input.plugins[0].verification = 'hard-incompatible'
    expect(validateMarketIndex(input, { now }).snapshot.plugins[0]).toMatchObject({
      verification: 'hard-incompatible', publication: schemaVersion === '2' ? 'active' : 'unknown',
    })
  })

  it.each(['1', '2'])('v%s 缺制品且未绑定正式发行时 unknown', schemaVersion => {
    const input = schemaVersion === '2' ? v2Fixture() : v1Fixture()
    delete input.plugins[0].artifactDigest
    delete input.plugins[0].releaseId
    input.plugins[0].installability = 'missing-artifact'
    input.plugins[0].publication = 'active'
    input.packs = []
    input.deliveries = []
    input.releases = []
    input.releaseStatuses = []
    expect(validateMarketIndex(input, { now }).snapshot.plugins[0]).toMatchObject({
      installability: 'missing-artifact', publication: 'unknown',
    })
  })

  it('缺制品但 raw 指向已存在 releaseId 也不能借用 active', () => {
    const input = v2Fixture()
    delete input.plugins[0].artifactDigest
    input.plugins[0].installability = 'missing-artifact'
    input.deliveries = []
    expect(validateMarketIndex(input, { now }).snapshot.plugins[0]?.publication).toBe('unknown')
  })

  it('已有正式 active 时，missing-artifact/hard-blocked 不能伪造 withdrawn', () => {
    for (const installability of ['missing-artifact', 'hard-blocked']) {
      const input = v2Fixture()
      input.plugins[0].installability = installability
      expect(validateMarketIndex(input, { now }).snapshot.plugins[0]).toMatchObject({ publication: 'active', installability })
    }
  })

  it('正式发行的绑定和摘要保护保持不变', () => {
    const missingStatus = v2Fixture()
    missingStatus.releaseStatuses = []
    expect(() => validateMarketIndex(missingStatus, { now })).toThrow(/生命周期状态/)
    const badMetadata = v2Fixture()
    badMetadata.releases[0].metadataDigest = `sha256:${'b'.repeat(64)}`
    expect(() => validateMarketIndex(badMetadata, { now })).toThrow(/精确发行/)
  })

  it('已知撤回覆盖旧 active 和 v1 unknown，保留 hard-blocked 且不修改输入', () => {
    const input = v2Fixture('withdrawn')
    const validated = validateMarketIndex(input, { now })
    const acceptance = deepFreeze(prepareAcceptance(validated, digest(input)))
    const before = JSON.stringify(acceptance)
    for (const snapshot of [validateMarketIndex(v2Fixture(), { now }).snapshot, validateMarketIndex(v1Fixture(), { now }).snapshot]) {
      deepFreeze(snapshot)
      const snapshotBefore = JSON.stringify(snapshot)
      const result = applyKnownLifecycle(snapshot, acceptance)
      expect(result.plugins[0]).toMatchObject({ publication: 'withdrawn', installability: 'hard-blocked' })
      expect(result.recommendations).toEqual([])
      expect(JSON.stringify(snapshot)).toBe(snapshotBefore)
    }
    expect(JSON.stringify(acceptance)).toBe(before)
  })

  it('active 历史不升级 v1 unknown，也不解除原 hard-blocked', () => {
    const input = v2Fixture()
    const acceptance = prepareAcceptance(validateMarketIndex(input, { now }), digest(input))
    const snapshot = validateMarketIndex(v1Fixture(), { now }).snapshot
    const blocked = { ...snapshot, plugins: snapshot.plugins.map(plugin => ({ ...plugin, installability: 'hard-blocked' as const })) }
    expect(applyKnownLifecycle(blocked, acceptance).plugins[0]).toMatchObject({ publication: 'unknown', installability: 'hard-blocked' })
    expect(applyKnownLifecycle(snapshot)).toBe(snapshot)
  })

  it('验证投影不修改 raw JSON、元数据/Manifest/Pack/Lock 字节及冻结发行记录', () => {
    for (const input of [v1Fixture(), v2Fixture('withdrawn'), dshStdFixture('withdrawn')]) {
      const before = JSON.stringify(input)
      deepFreeze(input)
      const result = validateMarketIndex(input, { now })
      const plugin = input.plugins[0]
      const metadata = plugin.metadata?.packageJson ?? plugin.metadata?.manifest ?? plugin.manifest
      expect(Buffer.from(result.metadataBytes.get(`${plugin.id}@${plugin.version}`)!)).toEqual(Buffer.from(metadata.contentBase64, 'base64'))
      expect(result.snapshot.plugins[0]?.artifactDigest).toBe(plugin.artifactDigest)
      const manifest = plugin.manifest ?? plugin.metadata?.manifest
      if (manifest) expect(Buffer.from(result.manifestBytes.get(`${plugin.id}@${plugin.version}:manifest`)!)).toEqual(Buffer.from(manifest.contentBase64, 'base64'))
      for (const pack of input.packs) {
        expect(Buffer.from(result.packBytes.get(`${pack.id}@${pack.version}:pack`)!)).toEqual(Buffer.from(pack.pack.contentBase64, 'base64'))
        expect(Buffer.from(result.lockBytes.get(`${pack.id}@${pack.version}:lock`)!)).toEqual(Buffer.from(pack.lock.contentBase64, 'base64'))
      }
      if (input.releases) expect(result.releases).toEqual(input.releases)
      expect(JSON.stringify(input)).toBe(before)
    }
  })
})

describe('Catalog publication 多镜像合并', () => {
  it.each([false, true])('withdrawn 优先且与 active 输入顺序无关（反序=%s）', reverse => {
    const active = source('active-mirror', validateMarketIndex(v2Fixture(), { now }).snapshot)
    const withdrawn = source('withdrawn-mirror', validateMarketIndex(v2Fixture('withdrawn'), { now }).snapshot)
    deepFreeze(active)
    deepFreeze(withdrawn)
    const before = JSON.stringify([active, withdrawn])
    const forward = mergeCatalogSnapshots(active, [withdrawn])
    const backward = mergeCatalogSnapshots(withdrawn, [active])
    const result = reverse ? backward : forward
    expect(backward).toEqual(forward)
    expect(result.snapshot.plugins).toHaveLength(1)
    expect(result.snapshot.plugins[0]).toMatchObject({ publication: 'withdrawn', installability: 'hard-blocked' })
    expect(result.issues.some(issue => issue.code === 'known-blocked')).toBe(true)
    expect(result.issues.some(issue => issue.code === 'content-conflict')).toBe(false)
    expect(result.snapshot.deliveries).toEqual([])
    expect(result.snapshot.recommendations).toEqual([])
    expect(JSON.stringify([active, withdrawn])).toBe(before)
    const merged = source('merged', result.snapshot)
    expect(mergeCatalogSnapshots(active, [merged]).snapshot.plugins[0]?.publication).toBe('withdrawn')
  })

  it('即使 withdrawn 镜像自带可安装标记，仍保守阻断', () => {
    const snapshot = validateMarketIndex(v2Fixture(), { now }).snapshot
    const result = mergeCatalogSnapshots(source('active', snapshot), [source('withdrawn', snapshot, { publication: 'withdrawn' })])
    expect(result.snapshot.plugins[0]).toMatchObject({ publication: 'withdrawn', installability: 'hard-blocked' })
    expect(result.issues.some(issue => issue.code === 'content-conflict')).toBe(false)
  })

  it('active 与 unknown 的生命周期差异不是 metadata conflict，保守阻断且不伪造 active', () => {
    const snapshot = validateMarketIndex(v2Fixture(), { now }).snapshot
    const active = source('active', snapshot)
    const unknown = source('unknown', snapshot, { publication: 'unknown' })
    const result = mergeCatalogSnapshots(active, [unknown])
    expect(result).toEqual(mergeCatalogSnapshots(unknown, [active]))
    expect(result.snapshot.plugins[0]).toMatchObject({ publication: 'unknown', installability: 'hard-blocked' })
    expect(result.issues.some(issue => issue.code === 'content-conflict')).toBe(false)
  })

  it('硬阻断但没有撤回事实时保留 active，不推断 withdrawn', () => {
    const snapshot = validateMarketIndex(v2Fixture(), { now }).snapshot
    const result = mergeCatalogSnapshots(source('active', snapshot), [source('blocked', snapshot, { installability: 'hard-blocked' })])
    expect(result.snapshot.plugins[0]).toMatchObject({ publication: 'active', installability: 'hard-blocked' })
  })

  it('已拒绝来源中的已知撤回也不能被另一 active 镜像复活', () => {
    const snapshot = validateMarketIndex(v2Fixture(), { now }).snapshot
    const result = mergeCatalogSnapshots(source('active', snapshot), [
      source('conflicting-source', snapshot, { publication: 'withdrawn' }), source('conflicting-source', snapshot),
    ])
    expect(result.snapshot.plugins[0]).toMatchObject({ publication: 'withdrawn', installability: 'hard-blocked' })
    expect(result.issues.some(issue => issue.code === 'source-conflict')).toBe(true)
  })

  it('忽略 publication 差异不放宽元数据内容冲突保护', () => {
    const snapshot = validateMarketIndex(v2Fixture(), { now }).snapshot
    const result = mergeCatalogSnapshots(source('active', snapshot), [source('withdrawn', snapshot, { publication: 'withdrawn', summary: '不同元数据' })])
    expect(result.snapshot.plugins).toEqual([])
    expect(result.issues.some(issue => issue.code === 'content-conflict')).toBe(true)
  })

  it('撤回优先也不放宽同身份制品摘要冲突保护', () => {
    const snapshot = validateMarketIndex(v2Fixture(), { now }).snapshot
    const result = mergeCatalogSnapshots(source('active', snapshot), [source('withdrawn', snapshot, {
      publication: 'withdrawn', artifactDigest: `sha256:${'b'.repeat(64)}`,
    })])
    expect(result.snapshot.plugins).toEqual([])
    expect(result.issues.some(issue => issue.code === 'content-conflict')).toBe(true)
    expect(result.snapshot.deliveries).toEqual([])
  })
})

describe('Catalog 接受历史损坏安全前置', () => {
  it.each([false, true])('历史损坏后的缓存接受不得保留 active（重启=%s）', restart => {
    const input = v2Fixture()
    const root = mkdtempSync(join(tmpdir(), 'publication-history-'))
    const raw = Buffer.from(JSON.stringify(input))
    const repository = new CatalogRepository(input, root, { now }, raw)
    expect(repository.load().snapshot.plugins[0]?.publication).toBe('active')
    const path = join(root, 'acceptances', '0000000000000001.json')
    writeFileSync(path, '{corrupt')
    const current = restart ? new CatalogRepository(input, root, { now }, raw) : repository
    const snapshot = current.load().snapshot
    expect(snapshot.plugins[0]?.installability).toBe('hard-blocked')
    expect(snapshot.plugins[0]?.publication).toBe('unknown')
    expect(readFileSync(path, 'utf8')).toBe('{corrupt')
  })
})
