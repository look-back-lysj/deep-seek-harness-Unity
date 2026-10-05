import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { MarketIndexDocument, ReleaseRecord } from '../../packages/market-core/src/catalog/model.ts'
import { rawRecord } from '../../packages/market-core/src/catalog/public-format.ts'
import { releaseIdFor } from '../../packages/market-core/src/catalog/releases.ts'
import { createDshMarketBackend } from '../../packages/market-core/src/dsh.ts'
import { MarketRuntime } from '../../packages/market-core/src/host/market-runtime.ts'
import { readDshHostCore } from '../../packages/market/src/host-core.ts'
import { context, freshDirectory, identity, removeDirectory } from './helpers.ts'

function document(): MarketIndexDocument {
  const base = JSON.parse(readFileSync(new URL('../catalog/fixtures/valid-market-index.json', import.meta.url), 'utf8')) as MarketIndexDocument
  const original = base.plugins[0]!
  const versions = ['1.0.0', '1.5.0', '2.0.0']
  const releases: ReleaseRecord[] = []
  const plugins = versions.map(version => {
    const { manifest: _manifest, manifestDigest: _manifestDigest, ...plugin } = original
    const metadata = rawRecord(Buffer.from(JSON.stringify({ name: plugin.packageName, version, engines: { dsh: version === '2.0.0' ? '>=2.0.0' : '>=1.0.0 <2.0.0' }, dsh: { bundle: { patch: './cordis.patch.yml' } } })))
    const release = { schemaVersion: '1' as const, pluginId: plugin.id, packageName: plugin.packageName, version, artifactDigest: plugin.artifactDigest!, metadataDigest: metadata.sha256, size: 509,
      publishedAt: '2026-10-01T00:00:00Z', provenance: { kind: 'author-release' as const, repositoryUrl: 'https://example.invalid/test', commit: '1'.repeat(40), releaseUrl: 'https://example.invalid/test/release', license: 'MIT', authorization: { basis: 'license' as const, reference: 'TEST LICENSE', redistribution: true as const } },
    }
    const releaseId = releaseIdFor(release)
    releases.push({ ...release, releaseId })
    return { ...plugin, version, verification: 'unverified' as const, releaseId, metadata: { kind: 'official-bundle' as const, packageJson: metadata, files: ['package.json', 'cordis.patch.yml'] } }
  })
  return { ...base, schemaVersion: '2', revision: 'release-options-v2-r1', publication: { sourceId: 'release-options-fixture', sequence: 1 }, packs: [], plugins, releases,
    releaseStatuses: releases.map(release => ({ releaseId: release.releaseId, sequence: 1, status: 'active', effectiveAt: '2026-10-01T00:00:00Z', reason: 'synthetic only' })),
    deliveries: plugins.map(plugin => ({ pluginId: plugin.id, packageName: plugin.packageName, version: plugin.version, artifactDigest: plugin.artifactDigest!, sources: [{ kind: 'https-artifact', ref: 'https://example.invalid/test/fixture.tgz', priority: 0, size: 509 }] })),
  }
}

describe('已绑定 DSH runtime 的只读版本门面', () => {
  it('通过公共Backend返回适配旧版和最新过旧原因；与checkUpdates同源，零写入', async () => {
    const directory = freshDirectory()
    const catalog = document()
    const packageName = catalog.plugins[0]!.packageName
    const writes = vi.fn()
    const manager = { listBundles: async () => [{ name: packageName, version: '1.0.0', installed: true, enabled: true, removable: true, rows: [], overrides: [] }], listPlugins: async () => [], install: writes, removeBundle: writes, setBundleEnabled: writes }
    let runningVersion = '1.0.0'
    const backend = createDshMarketBackend(context(directory, manager), { ...identity, hostVersion: '9.9.9' }, join(directory, 'market'), {
      embeddedCatalogBytes: Buffer.from(JSON.stringify(catalog)), catalogSources: [], readHostCore: () => readDshHostCore(() => runningVersion),
    })
    try {
      expect(backend.capabilities()).toContain('host-release-options')
      expect(backend.hostCore()).toMatchObject({ agentId: 'dsh', version: '1.0.0', source: 'dsh-runtime-getter' })
      const result = await backend.releaseOptions({ packageName, limit: 1 })
      expect(result.hostCore.version).toBe('1.0.0')
      expect(result.installed).toMatchObject({ status: 'known', version: '1.0.0' })
      expect(result.latestPublished?.version).toBe('2.0.0')
      expect(result.latestCompatible?.version).toBe('1.5.0')
      expect(result.releases[0]?.sources).toEqual([{ sourceId: 'release-options-fixture', revision: 'release-options-v2-r1' }])
      expect(result.releases[0]?.compatibility.reason).toBe('core-too-old')
      expect(result.releases[0]?.selectable).toBe(false)
      expect(result.coverage.historyCoverage).toBe('unknown')
      expect(result.coverage.totalKnownRecords).toBeNull()
      const second = await backend.releaseOptions({ packageName, cursor: result.pagination.cursor! })
      expect(second.releases.map(release => release.identity.version)).toEqual(['1.5.0', '1.0.0'])
      expect(second.releases[0]?.selectable).toBe(true)
      const summary = (await backend.checkUpdates()).items[0]?.releaseSummary
      expect(summary?.latestPublished).toEqual(result.latestPublished)
      expect(summary?.latestCompatible).toEqual(result.latestCompatible)
      expect(summary?.latestPublishedCompatibility?.reason).toBe(result.releases[0]?.compatibility.reason)
      runningVersion = '2.0.0'
      expect(backend.hostCore().version).toBe('2.0.0')
      await expect(backend.releaseOptions({ packageName, cursor: result.pagination.cursor! })).rejects.toMatchObject({ code: 'release-options/stale-cursor' })
      expect((await backend.releaseOptions({ packageName })).latestCompatible?.version).toBe('2.0.0')
      expect(writes).not.toHaveBeenCalled()
      expect(await backend.taskList()).toEqual([])
    } finally { await backend.taskList(); removeDirectory(directory) }
  })

  it('读核心失败不回退到旧hostVersion；库存读失败不冒充未安装', async () => {
    const directory = freshDirectory()
    const catalog = document()
    const runtime = new MarketRuntime(context(directory, { listBundles: async () => [], listPlugins: async () => [] }), { ...identity, hostVersion: '99.0.0' }, join(directory, 'market'), {
      embeddedCatalog: catalog, catalogSources: [], readHostCore: () => readDshHostCore(() => { throw new Error('C:/Users/private/Profile/secret=fixture-sensitive') }),
    })
    try {
      await runtime.taskList()
      const read = vi.spyOn(runtime.host, 'readState').mockRejectedValue(new Error('fixture outage'))
      const result = await runtime.releaseOptions({ packageName: catalog.plugins[0]!.packageName })
      expect(result.hostCore).toMatchObject({ agentId: 'dsh', version: null, status: 'unknown' })
      expect(result.installed).toMatchObject({ status: 'unknown', version: null })
      expect(result.latestCompatible).toBeNull()
      expect(result.releases.every(release => release.compatibility.status === 'unknown')).toBe(true)
      expect(JSON.stringify(result)).not.toContain('fixture-sensitive')
      expect(JSON.stringify(result)).not.toContain('private/Profile')
      read.mockRestore()
    } finally { await runtime.taskList(); removeDirectory(directory) }
  })

  it('旧调用方没有可信读取器时保持绑定未知，不从hostVersion构造核心', async () => {
    const directory = freshDirectory()
    const catalog = document()
    const backend = createDshMarketBackend(context(directory), identity, join(directory, 'market'), { embeddedCatalogBytes: Buffer.from(JSON.stringify(catalog)), catalogSources: [] })
    try {
      expect(backend.hostCore()).toMatchObject({ agentId: null, version: null, status: 'unknown', reason: 'host-core-binding-unavailable' })
      expect((await backend.releaseOptions({ packageName: catalog.plugins[0]!.packageName })).latestCompatible).toBeNull()
    } finally { await backend.taskList(); removeDirectory(directory) }
  })

  it('一次读取期间核心变化返回stale，不拼接两个宿主快照', async () => {
    const directory = freshDirectory()
    const catalog = document()
    let version = '1.0.0'
    const runtime = new MarketRuntime(context(directory), identity, join(directory, 'market'), { embeddedCatalog: catalog, catalogSources: [], readHostCore: () => readDshHostCore(() => version) })
    try {
      await runtime.taskList()
      const state = await runtime.host.readState()
      const read = vi.spyOn(runtime.host, 'readState').mockImplementationOnce(async () => { version = '2.0.0'; return state })
      await expect(runtime.releaseOptions({ packageName: catalog.plugins[0]!.packageName })).rejects.toMatchObject({ code: 'release-options/stale-context' })
      read.mockRestore()
    } finally { await runtime.taskList(); removeDirectory(directory) }
  })

  it('已知不适配不能由旧预检入口绕过；核心变化使未提交计划失效，零下载零写入', async () => {
    const directory = freshDirectory()
    const catalog = document()
    const writes = vi.fn()
    let version = '1.0.0'
    const runtime = new MarketRuntime(context(directory, { listBundles: async () => [], listPlugins: async () => [], install: writes }), identity, join(directory, 'market'), {
      embeddedCatalog: catalog, catalogSources: [], readHostCore: () => readDshHostCore(() => version),
    })
    const selection = (targetVersion: string) => {
      const plugin = catalog.plugins.find(plugin => plugin.version === targetVersion)!
      return { pluginId: plugin.id, packageName: plugin.packageName, targetVersion, targetDigest: plugin.artifactDigest!, enabledIntent: true, tryUnverified: true }
    }
    try {
      expect(await runtime.planCreate({ selections: [selection('2.0.0')] }, 'range-caller')).toMatchObject({ status: 'blocked', reason: 'core-too-old', blockers: ['core-too-old'] })
      const plan = await runtime.planCreate({ selections: [selection('1.5.0')] }, 'range-caller')
      expect(plan.status).toBe('ready')
      if (plan.status !== 'ready') throw new Error('expected ready plan')
      const download = vi.spyOn(runtime.artifacts, 'acquire')
      version = '1.1.0'
      await expect(runtime.taskStart({ planId: plan.plan.planId, planDigest: plan.plan.planDigest, confirmed: true, idempotencyKey: 'range-drift' }, 'range-caller')).rejects.toMatchObject({ code: 'plan/stale-host' })
      expect(download).not.toHaveBeenCalled()
      expect(writes).not.toHaveBeenCalled()
      expect(await runtime.taskList()).toEqual([])
      download.mockRestore()
    } finally { await runtime.taskList(); removeDirectory(directory) }
  })

  it.each(['releaseOptions', 'checkUpdates'] as const)('%s 读取期间同revision撤回必须拒绝旧投影', async method => {
    const directory = freshDirectory()
    const catalog = document()
    const runtime = new MarketRuntime(context(directory, { listBundles: async () => [], listPlugins: async () => [] }), identity, join(directory, 'market'), {
      embeddedCatalog: catalog, catalogSources: [], readHostCore: () => readDshHostCore(() => '1.0.0'),
    })
    try {
      await runtime.taskList()
      const state = await runtime.host.readState()
      let withdrawn = false
      const sourceSnapshot = runtime.catalog.sourceSnapshot.bind(runtime.catalog)
      const snapshot = vi.spyOn(runtime.catalog, 'sourceSnapshot').mockImplementation(() => {
        const current = sourceSnapshot()
        return withdrawn ? { ...current, snapshot: { ...current.snapshot, plugins: current.snapshot.plugins.map(plugin => ({ ...plugin, publication: 'withdrawn' as const, installability: 'hard-blocked' as const })) } } : current
      })
      const read = vi.spyOn(runtime.host, 'readState').mockImplementationOnce(async () => { withdrawn = true; return state })
      const request = method === 'releaseOptions' ? runtime.releaseOptions({ packageName: catalog.plugins[0]!.packageName }) : runtime.checkUpdates()
      await expect(request).rejects.toMatchObject({ code: method === 'releaseOptions' ? 'release-options/stale-context' : 'update-check/stale-context' })
      read.mockRestore()
      snapshot.mockRestore()
    } finally { await runtime.taskList(); removeDirectory(directory) }
  })
})
