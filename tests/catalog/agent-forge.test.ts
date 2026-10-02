import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentForgeSourceCache, projectAgentForgeCatalog } from '../../packages/market-core/src/catalog/agent-forge.ts'
import { buildAgentForgeBundleSelectionGraph } from '../../packages/market-core/src/catalog/bundle-selection.ts'
import { validateMarketIndex } from '../../packages/market-core/src/catalog/validate.ts'
import { describe, expect, it } from 'vitest'
import type { MarketCatalogSource } from '../../packages/market-core/src/contracts/types.ts'
import { readAgentForgeSource } from '../../packages/market-core/src/catalog/agent-forge.ts'
import { digest, validTgz } from '../delivery/fixtures.ts'

const source = {
  schemaVersion: 2,
  sourceId: 'agent-forge:test:plugin',
  name: 'Test source',
  agentId: 'dsh',
  type: 'plugin',
  baseUrl: 'https://example.com/catalog/',
  index: 'index.json',
  revision: 'r1',
  generatedAt: '2026-10-01T00:00:00Z',
  description: 'test',
} as const
const record = {
  schemaVersion: 2,
  id: 'dev.test.alpha',
  name: '@test/alpha',
  version: '1.2.3',
  type: 'plugin',
  description: 'alpha',
  license: 'MIT',
  targets: [{ agentId: 'dsh', compatibilityStatus: 'known', agentVersionRange: '*' }],
  pluginDetails: { manifestPath: 'package.json' },
  distributions: [{ id: 'archive', type: 'archive', url: 'https://example.com/alpha.tgz' }],
  dependencies: [{ id: 'dev.test.dep', optional: true }],
  _meta: { 'org.eac.market/test': { retained: true } },
} as const
const index = {
  schemaVersion: 2,
  sourceId: source.sourceId,
  sourceManifest: 'source.json',
  agentId: source.agentId,
  type: source.type,
  revision: source.revision,
  generatedAt: source.generatedAt,
  packages: { '@test/alpha': { latest: '1.2.3', versions: ['1.2.3'], path: 'packages/alpha.json', recordRevision: 'r1' } },
} as const

describe('Agent Forge v2 source reader', () => {
  it('读取受控本地目录并保留未知 _meta', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-agent-forge-'))
    try {
      writeFileSync(join(root, 'source.json'), JSON.stringify(source))
      writeFileSync(join(root, 'index.json'), JSON.stringify(index))
      mkdirSync(join(root, 'packages'), { recursive: true })
      writeFileSync(join(root, 'packages', 'alpha.json'), JSON.stringify(record))
      const config: MarketCatalogSource = { id: 'test', kind: 'agent-forge', location: { mode: 'local-file', value: root }, enabled: true, priority: 0, refreshPolicy: 'manual', expectedRevision: 'r1' }
      const result = await readAgentForgeSource(config, { localRoots: [root], targetAgent: 'dsh' })
      expect(result.sourceRevision).toBe('r1')
      expect(result.packages.get('@test/alpha')).toMatchObject({ _meta: { 'org.eac.market/test': { retained: true } } })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })



  it('交叉核对 index key、id、latest version 与 package record', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-agent-forge-identity-'))
    try {
      writeFileSync(join(root, 'source.json'), JSON.stringify(source))
      writeFileSync(join(root, 'index.json'), JSON.stringify(index))
      mkdirSync(join(root, 'packages'), { recursive: true })
      writeFileSync(join(root, 'packages', 'alpha.json'), JSON.stringify({ ...record, name: '@test/wrong' }))
      const config: MarketCatalogSource = { id: 'test', kind: 'agent-forge', location: { mode: 'local-file', value: root }, enabled: true, priority: 0, refreshPolicy: 'manual' }
      await expect(readAgentForgeSource(config, { localRoots: [root] })).rejects.toMatchObject({ code: 'agent-forge/package-name-mismatch' })
      writeFileSync(join(root, 'packages', 'alpha.json'), JSON.stringify({ ...record, version: '9.0.0' }))
      await expect(readAgentForgeSource(config, { localRoots: [root] })).rejects.toMatchObject({ code: 'agent-forge/package-version-mismatch' })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('投影接受长包名、中文简介和长身份，并保持仅浏览', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-agent-forge-projection-'))
    const longRecord = { ...record, id: `dev.${'a'.repeat(205)}`, name: `@test/${'a'.repeat(198)}`, description: '描述'.repeat(600) }
    const longIndex = { ...index, packages: { [longRecord.name]: { latest: longRecord.version, versions: [longRecord.version], path: 'packages/alpha.json' } } }
    try {
      writeFileSync(join(root, 'source.json'), JSON.stringify(source))
      writeFileSync(join(root, 'index.json'), JSON.stringify(longIndex))
      mkdirSync(join(root, 'packages'), { recursive: true })
      writeFileSync(join(root, 'packages', 'alpha.json'), JSON.stringify(longRecord))
      const config: MarketCatalogSource = { id: 'test', kind: 'agent-forge', location: { mode: 'local-file', value: root }, enabled: true, priority: 0, refreshPolicy: 'manual' }
      const catalog = await readAgentForgeSource(config, { localRoots: [root], targetAgent: 'dsh' })
      const document = projectAgentForgeCatalog(catalog, { revision: 'projection-long-r1', generatedAt: '2026-10-01T00:00:00Z', sourceUrl: 'https://example.com/catalog/source.json' })
      const validated = validateMarketIndex(document)
      expect(validated.snapshot.listings).toHaveLength(1)
      expect(validated.snapshot.listings?.[0]?.id).toMatch(/^agent-forge\.af-/)
      expect(Buffer.byteLength(validated.snapshot.listings?.[0]?.name ?? '')).toBeLessThanOrEqual(200)
      expect(document.plugins).toEqual([])
      expect(document.deliveries).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('仅将已校验的离线 bundle 投影为可安装插件和 cache delivery', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-agent-forge-offline-projection-'))
    try {
      writeFileSync(join(root, 'source.json'), JSON.stringify(source))
      writeFileSync(join(root, 'index.json'), JSON.stringify(index))
      mkdirSync(join(root, 'packages'), { recursive: true })
      writeFileSync(join(root, 'packages', 'alpha.json'), JSON.stringify(record))
      const config: MarketCatalogSource = { id: 'test', kind: 'agent-forge', location: { mode: 'local-file', value: root }, enabled: true, priority: 0, refreshPolicy: 'manual' }
      const catalog = await readAgentForgeSource(config, { localRoots: [root], targetAgent: 'dsh' })
      const bytes = validTgz('@test/alpha', '1.2.3')
      const artifactDigest = digest(bytes)
      const document = projectAgentForgeCatalog(catalog, {
        revision: 'offline-projection-r1', generatedAt: '2026-10-01T00:00:00Z', sourceUrl: 'https://example.com/catalog/source.json',
        offlineArtifacts: [{ pluginId: record.id, packageName: record.name, version: record.version, artifactDigest, size: bytes.byteLength,
          packageJson: JSON.stringify({ name: record.name, version: record.version, dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } }),
          files: ['package.json', 'lib/index.js', 'cordis.patch.yml'] }]
      })
      const validated = validateMarketIndex(document)
      expect(validated.snapshot.plugins).toHaveLength(1)
      expect(validated.snapshot.plugins[0]).toMatchObject({ id: record.id, packageName: record.name, installability: 'bundle-installable', verification: 'unknown', artifactDigest })
      expect(validated.snapshot.deliveries[0]?.sources[0]).toMatchObject({ kind: 'cache', ref: artifactDigest, size: bytes.byteLength })
      expect(validated.snapshot.listings).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('核对 index 声明的 package id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-agent-forge-id-'))
    try {
      writeFileSync(join(root, 'source.json'), JSON.stringify(source))
      writeFileSync(join(root, 'index.json'), JSON.stringify({ ...index, packages: { '@test/alpha': { ...index.packages['@test/alpha'], id: 'dev.wrong.id' } } }))
      mkdirSync(join(root, 'packages'), { recursive: true })
      writeFileSync(join(root, 'packages', 'alpha.json'), JSON.stringify(record))
      const config: MarketCatalogSource = { id: 'test', kind: 'agent-forge', location: { mode: 'local-file', value: root }, enabled: true, priority: 0, refreshPolicy: 'manual' }
      await expect(readAgentForgeSource(config, { localRoots: [root], targetAgent: 'dsh' })).rejects.toMatchObject({ code: 'agent-forge/package-id-mismatch' })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('拒绝 package 文件经 symlink/junction 指向授权根目录外', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-agent-forge-path-'))
    const outside = mkdtempSync(join(tmpdir(), 'eac-agent-forge-outside-'))
    try {
      writeFileSync(join(root, 'source.json'), JSON.stringify(source))
      writeFileSync(join(root, 'index.json'), JSON.stringify(index))
      mkdirSync(join(root, 'packages'))
      writeFileSync(join(outside, 'alpha.json'), JSON.stringify(record))
      try { symlinkSync(join(outside, 'alpha.json'), join(root, 'packages', 'alpha.json'), 'file') }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error }
      const config: MarketCatalogSource = { id: 'test', kind: 'agent-forge', location: { mode: 'local-file', value: root }, enabled: true, priority: 0, refreshPolicy: 'manual' }
      await expect(readAgentForgeSource(config, { localRoots: [root] })).rejects.toMatchObject({ code: 'agent-forge/local-source-not-controlled' })
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) }
  })

  it('刷新失败后 current() 持续标记 stale，投影仅含可浏览 listings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-agent-forge-stale-'))
    try {
      writeFileSync(join(root, 'source.json'), JSON.stringify(source))
      writeFileSync(join(root, 'index.json'), JSON.stringify(index))
      mkdirSync(join(root, 'packages'), { recursive: true })
      writeFileSync(join(root, 'packages', 'alpha.json'), JSON.stringify(record))
      const config: MarketCatalogSource = { id: 'test', kind: 'agent-forge', location: { mode: 'local-file', value: root }, enabled: true, priority: 0, refreshPolicy: 'manual' }
      const cache = new AgentForgeSourceCache()
      const first = await cache.refresh(config, { localRoots: [root] })
      expect(first.status).toBe('refreshed')
      const stale = await cache.refresh({ ...config, location: { mode: 'local-file', value: join(root, 'missing') } }, { localRoots: [root] })
      expect(stale.current?.stale).toBe(true)
      expect(cache.current()?.stale).toBe(true)
      const document = projectAgentForgeCatalog(cache.current()!, { revision: 'project-r1', generatedAt: '2026-10-01T00:00:00Z', sourceUrl: 'https://example.com/catalog/source.json' })
      const validated = validateMarketIndex(document)
      expect(validated.snapshot.plugins).toEqual([])
      expect(validated.snapshot.listings).toHaveLength(1)
      expect(document.deliveries).toEqual([])
      expect(document.recommendations).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('拒绝 latest 不在 versions 中和目标 Agent 缺失', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-agent-forge-invalid-'))
    try {
      writeFileSync(join(root, 'source.json'), JSON.stringify(source))
      writeFileSync(join(root, 'index.json'), JSON.stringify({ ...index, packages: { '@test/alpha': { ...index.packages['@test/alpha'], latest: '9.9.9' } } }))
      mkdirSync(join(root, 'packages'), { recursive: true }); writeFileSync(join(root, 'packages', 'alpha.json'), JSON.stringify(record))
      const config: MarketCatalogSource = { id: 'test', kind: 'agent-forge', location: { mode: 'local-file', value: root }, enabled: true, priority: 0, refreshPolicy: 'manual' }
      await expect(readAgentForgeSource(config, { localRoots: [root], targetAgent: 'other' })).rejects.toMatchObject({ code: 'agent-forge/versions' })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
