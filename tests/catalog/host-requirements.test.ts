import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateMarketIndex } from '../../packages/market-core/src/catalog/validate.ts'
import { projectAgentForgeCatalog, type AgentForgeCatalog } from '../../packages/market-core/src/catalog/agent-forge.ts'
import type { MarketIndexDocument } from '../../packages/market-core/src/catalog/model.ts'

function raw(text: string) {
  return { contentBase64: Buffer.from(text).toString('base64'), sha256: `sha256:${createHash('sha256').update(text).digest('hex')}` }
}

function officialDocument(extra: Record<string, unknown>): MarketIndexDocument {
  const document = JSON.parse(readFileSync(new URL('./fixtures/valid-market-index.json', import.meta.url), 'utf8')) as MarketIndexDocument
  const original = document.plugins[0]!
  const { manifest: _manifest, manifestDigest: _manifestDigest, ...plugin } = original
  const packageJson = JSON.stringify({ name: plugin.packageName, version: plugin.version, dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } }, ...extra }, null, 2)
  return { ...document, packs: [], plugins: [{ ...plugin, metadata: { kind: 'official-bundle', packageJson: raw(packageJson), files: ['package.json', 'cordis.patch.yml'] } }] }
}

function forgeCatalog(range: string | null, formatting = 2, extra: Record<string, unknown> = {}): AgentForgeCatalog {
  const record = { schemaVersion: 2, id: 'dev.test.alpha', name: '@test/alpha', version: '1.2.3', type: 'plugin', description: '测试原始数据', license: 'MIT', targets: [{ agentId: 'dsh', compatibilityStatus: range === null ? 'unknown' : 'known', agentVersionRange: range }], ...extra }
  return {
    source: {}, index: { versions: ['1.0.0', '1.2.3'] }, packages: new Map([['@test/alpha', record]]),
    packageDocuments: new Map([['@test/alpha', raw(JSON.stringify(record, null, formatting))]]),
    advisories: new Map(), sourceId: 'agent-forge:test:plugin', sourceRevision: 'r1', agentId: 'dsh', stale: false, origin: 'local-file',
  }
}

const projection = { revision: 'projection-r1', generatedAt: '2026-10-03T00:00:00Z', sourceUrl: 'https://example.com/source.json' }

describe('宿主核心范围数据投影，不执行范围匹配', () => {
  it('只保留白名单核心声明，不从其他依赖或实测状态猜范围', () => {
    const document = officialDocument({ engines: { dsh: '>=0.2.0 <0.4.0 || ^1.0.0' }, peerDependencies: { '@deepseek-ai/dsh': '>=0.2.0 <0.4.0 || ^1.0.0', '@deepseek-ai/dsh-settings': '^8.0.0' }, dependencies: { '@deepseek-ai/dsh-tools': '^9.0.0' } })
    const result = validateMarketIndex(document)
    const plugin = result.snapshot.plugins[0]!
    const metadata = document.plugins[0]!.metadata!
    if (metadata.kind !== 'official-bundle') throw new Error('expected official metadata')
    expect(plugin.metadataDigest).toBe(metadata.packageJson.sha256)
    expect(plugin.hostRequirements).toEqual({ historyCoverage: 'unknown', declarations: [
      { agentId: 'dsh', range: '>=0.2.0 <0.4.0 || ^1.0.0', versionScheme: 'npm', origin: 'package-engines', metadataDigest: metadata.packageJson.sha256 },
      { agentId: 'dsh', range: '>=0.2.0 <0.4.0 || ^1.0.0', versionScheme: 'npm', origin: 'package-peer', metadataDigest: metadata.packageJson.sha256 },
    ] })
    expect(Buffer.from(result.metadataBytes.values().next().value!)).toEqual(Buffer.from(metadata.packageJson.contentBase64, 'base64'))
    expect(plugin).not.toHaveProperty('metadata')
    expect(plugin.verification).toBe(document.plugins[0]!.verification)
  })

  it('缺声明保持未知，空 compatibility 或其他引擎不能生成通配范围', () => {
    const plugin = validateMarketIndex(officialDocument({ engines: { node: '>=24' }, compatibility: {}, peerDependencies: { '@deepseek-ai/dsh-app-boot': '*' } })).snapshot.plugins[0]!
    expect(plugin.hostRequirements).toEqual({ historyCoverage: 'unknown', declarations: [] })
  })

  it('相互冲突和非法范围原样保留，待完整评估器处理，不挑其中一条', () => {
    const plugin = validateMarketIndex(officialDocument({ engines: { dsh: '^1.0.0' }, peerDependencies: { '@deepseek-ai/dsh': 'not a range' } })).snapshot.plugins[0]!
    expect(plugin.hostRequirements?.declarations.map(declaration => declaration.range)).toEqual(['^1.0.0', 'not a range'])
    expect(plugin.hostRequirements?.declarations.map(declaration => declaration.versionScheme)).toEqual(['npm', 'npm'])
  })

  it.each(['>=0.2.0 <0.4.0', null])('研究 listing 保留发行绑定的 target %s，但不制造制品或发行ID', range => {
    const catalog = forgeCatalog(range)
    const projected = projectAgentForgeCatalog(catalog, projection)
    const listing = validateMarketIndex(projected).snapshot.listings?.[0]!
    expect(listing.hostRequirements).toEqual({ historyCoverage: 'latest-only', declarations: [{
      agentId: 'dsh', range, origin: 'agent-forge-target', metadataDigest: catalog.packageDocuments.get('@test/alpha')!.sha256,
      sourceId: catalog.sourceId, sourceRevision: catalog.sourceRevision,
    }] })
    expect(projected.plugins).toEqual([])
    expect(projected.deliveries).toEqual([])
    expect(listing).not.toHaveProperty('releaseId')
    expect(listing).not.toHaveProperty('agentForgeMetadata')
    expect(listing.hostRequirements!.declarations[0]).not.toHaveProperty('versionScheme')
  })

  it.each([
    { versionScheme: 'semver', range: '^0.2.0' },
    { versionScheme: 'npm', range: '>=0.2.0 <0.4.0 || ^1.0.0' },
    { versionScheme: 'pep440', range: '>=1.0rc1,<2' },
    { versionScheme: 'calver', range: '>=2026.10' },
    { versionScheme: 'date', range: '>=2026-10-03' },
    { versionScheme: 'custom', range: 'release:stable' },
    { versionScheme: 'unknown', range: '*' },
  ])('target $versionScheme 原样保留，不继承 package scheme，不改范围或原始字节', ({ versionScheme, range }) => {
    for (const targetRange of [range, null]) {
      const targets = [
        { agentId: 'dsh', compatibilityStatus: targetRange === null ? 'unknown' : 'known', agentVersionRange: targetRange, versionScheme },
        { agentId: 'other-agent', compatibilityStatus: 'known', agentVersionRange: 'legacy', versionScheme: 'custom' },
      ]
      const catalog = forgeCatalog(targetRange, 4, { versionScheme: versionScheme === 'semver' ? 'npm' : 'semver', targets })
      const original = structuredClone(catalog.packageDocuments.get('@test/alpha')!)
      const projected = projectAgentForgeCatalog(catalog, projection)
      const listing = validateMarketIndex(projected).snapshot.listings![0]!
      expect(listing.hostRequirements).toEqual({ historyCoverage: 'latest-only', declarations: targets.map(target => ({
        agentId: target.agentId, range: target.agentVersionRange, versionScheme: target.versionScheme,
        origin: 'agent-forge-target', metadataDigest: original.sha256, sourceId: catalog.sourceId, sourceRevision: catalog.sourceRevision,
      })) })
      expect(projected.listings![0]!.agentForgeMetadata!.document).toEqual(original)
      expect(catalog.packageDocuments.get('@test/alpha')).toEqual(original)
      const bytes = Buffer.from(original.contentBase64, 'base64')
      expect(original.sha256).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`)
      expect(JSON.parse(bytes.toString('utf8'))).toEqual(catalog.packages.get('@test/alpha'))
    }
  })

  it.each(['semver', 'npm', 'pep440', 'calver', 'date', 'custom', 'unknown'])('package %s 不填补缺失的 target scheme', versionScheme => {
    const catalog = forgeCatalog('*', 2, { versionScheme })
    const listing = validateMarketIndex(projectAgentForgeCatalog(catalog, projection)).snapshot.listings![0]!
    expect(listing.hostRequirements!.declarations[0]).not.toHaveProperty('versionScheme')
    expect(listing.hostRequirements!.historyCoverage).toBe('latest-only')
  })

  it.each([null, 7, true, [], {}, '', 'SEMVER', 'semver ', 'invalid'].map(versionScheme => ({ versionScheme })))('拒绝非法 target scheme $versionScheme', ({ versionScheme }) => {
    const catalog = forgeCatalog('*', 2, { targets: [{ agentId: 'dsh', compatibilityStatus: 'known', agentVersionRange: '*', versionScheme }] })
    expect(() => projectAgentForgeCatalog(catalog, projection)).toThrow('目标版本方案无效')
  })

  it('摘要使用原始格式字节，不重序列化；不接受原始记录与投影版本错配', () => {
    const catalog = forgeCatalog('*', 4)
    const projected = projectAgentForgeCatalog(catalog, projection)
    expect(projected.listings?.[0]?.agentForgeMetadata?.document).toEqual(catalog.packageDocuments.get('@test/alpha'))
    const compact = forgeCatalog('*', 0)
    expect(catalog.packageDocuments.get('@test/alpha')!.sha256).not.toBe(compact.packageDocuments.get('@test/alpha')!.sha256)
    const changed = { ...projected, listings: projected.listings!.map(listing => ({ ...listing, requestedVersion: '2.0.0' })) }
    expect(() => validateMarketIndex(changed)).toThrow('Agent Forge 范围元数据与该版本身份不符')
  })

  it('原始字节被篡改而摘要未更新时拒绝投影', () => {
    const projected = projectAgentForgeCatalog(forgeCatalog('*'), projection)
    const changed = structuredClone(projected)
    const provenance = changed.listings![0]!.agentForgeMetadata!
    Object.assign(provenance.document, { contentBase64: Buffer.from('{}').toString('base64') })
    expect(() => validateMarketIndex(changed)).toThrow()
  })
})
