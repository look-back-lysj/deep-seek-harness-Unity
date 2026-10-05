import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { MarketIndexDocument } from '../../packages/market-core/src/catalog/model.ts'
import type { CatalogRepository } from '../../packages/market-core/src/catalog/store.ts'
import { MarketRuntime } from '../../packages/market-core/src/host/market-runtime.ts'
import { context, embedded, freshDirectory, identity, removeDirectory } from '../core-api/helpers.ts'

describe('Runtime 多源接线与写前目录复验', () => {
  it('实际刷新 v1 Agent Forge 到 v2 Runtime，API 保留原始范围与完整来源向量', async () => {
    const directory = freshDirectory()
    const sourceRoot = join(directory, 'source')
    mkdirSync(join(sourceRoot, 'packages'), { recursive: true })
    const source = { schemaVersion: 2, sourceId: 'agent-forge:runtime:plugin', name: '测试来源', agentId: 'dsh', type: 'plugin', baseUrl: 'https://example.com/source/', index: 'index.json', revision: 'r1', generatedAt: '2026-10-03T00:00:00Z', description: 'test' }
    const record = { schemaVersion: 2, id: 'dev.test.runtime', name: '@test/runtime', version: '2.0.0', type: 'plugin', description: 'test', license: 'MIT', targets: [{ agentId: 'dsh', compatibilityStatus: 'known', agentVersionRange: '^2.0.0' }], pluginDetails: { manifestPath: 'package.json' }, distributions: [{ id: 'archive', type: 'archive', url: 'https://example.com/runtime.tgz' }] }
    const index = { schemaVersion: 2, sourceId: source.sourceId, sourceManifest: 'source.json', agentId: 'dsh', type: 'plugin', revision: source.revision, generatedAt: source.generatedAt, packages: { [record.name]: { id: record.id, latest: record.version, versions: ['1.0.0', record.version], path: 'packages/runtime.json' } } }
    const bytes = Buffer.from(JSON.stringify(record, null, 4))
    writeFileSync(join(sourceRoot, 'source.json'), JSON.stringify(source))
    writeFileSync(join(sourceRoot, 'index.json'), JSON.stringify(index))
    writeFileSync(join(sourceRoot, 'packages', 'runtime.json'), bytes)
    const runtime = new MarketRuntime(context(directory), identity, join(directory, 'market'), {
      embeddedCatalog: embedded, catalogSources: [],
      agentForgeSources: [{ id: 'runtime', kind: 'agent-forge', location: { mode: 'local-file', value: sourceRoot }, enabled: true, priority: 0, refreshPolicy: 'manual' }],
      agentForgeSourceOptions: { localRoots: [sourceRoot], targetAgent: 'dsh' },
    })
    try {
      const result = await runtime.agentForgeRefresh({ sourceId: 'runtime' })
      expect(result.status, result.reason).toBe('refreshed')
      expect(result.current.schemaVersion).toBe('2')
      expect(result.current.mergeIssues).toEqual([])
      expect(result.current.sourceRevisions).toContainEqual({ sourceId: 'agent-forge:runtime', revision: 'af-runtime-r1' })
      expect(result.current.listings?.[0]?.hostRequirements).toMatchObject({ historyCoverage: 'latest-only', declarations: [{ agentId: 'dsh', range: '^2.0.0', metadataDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }] })
      expect(result.current.listings?.[0]?.hostRequirements?.declarations[0]).not.toHaveProperty('versionScheme')
      expect(result.current.plugins).toEqual([])
      writeFileSync(join(sourceRoot, 'source.json'), JSON.stringify({ ...source, revision: 'r2' }))
      writeFileSync(join(sourceRoot, 'index.json'), JSON.stringify({ ...index, revision: 'r2' }))
      const refreshed = await runtime.agentForgeRefresh({ sourceId: 'runtime' })
      expect(refreshed.status).toBe('refreshed')
      expect(refreshed.current.revision).not.toBe(result.current.revision)
      expect(refreshed.current.sourceRevisions).toContainEqual({ sourceId: 'agent-forge:runtime', revision: 'af-runtime-r2' })
      const revisions: string[] = []
      for (const suffix of ['A', 'B']) {
        const revision = `${'r'.repeat(127)}${suffix}`
        writeFileSync(join(sourceRoot, 'source.json'), JSON.stringify({ ...source, revision }))
        writeFileSync(join(sourceRoot, 'index.json'), JSON.stringify({ ...index, revision }))
        const next = await runtime.agentForgeRefresh({ sourceId: 'runtime' })
        expect(next.status, next.reason).toBe('refreshed')
        expect(next.current.sourceRevisions).toContainEqual({ sourceId: 'agent-forge:runtime', revision: `af-runtime-${revision}` })
        revisions.push(next.current.revision)
      }
      expect(revisions[0]).not.toBe(revisions[1])
    } finally { await runtime.taskList(); removeDirectory(directory) }
  })

  it('预检后同包同版出现摘要冲突，公开问题事实并拒绝旧计划，零官方写', async () => {
    const directory = freshDirectory()
    const original = JSON.parse(readFileSync(new URL('../catalog/fixtures/valid-market-index.json', import.meta.url), 'utf8')) as MarketIndexDocument
    const document = { ...original, packs: [] }
    const selected = document.plugins[0]!
    const install = vi.fn(async () => ({ application: 'applied', changed: true }))
    const runtime = new MarketRuntime(context(directory, { listBundles: async () => [], listPlugins: async () => [], install }), identity, join(directory, 'market'), {
      embeddedCatalog: document, catalogSources: [],
      agentForgeSources: [{ id: 'mirror', kind: 'agent-forge', location: { mode: 'local-file', value: directory }, enabled: true, priority: 0, refreshPolicy: 'manual' }],
      agentForgeSourceOptions: { localRoots: [directory], targetAgent: 'dsh' },
    })
    try {
      const plan = await runtime.planCreate({ selections: [{ pluginId: selected.id, packageName: selected.packageName, targetVersion: selected.version, targetDigest: selected.artifactDigest!, enabledIntent: true, tryUnverified: true }] }, 'catalog-caller')
      expect(plan.status).toBe('ready')
      if (plan.status !== 'ready') throw new Error('expected plan')
      const digest = `sha256:${'b'.repeat(64)}`
      const manifest = JSON.parse(Buffer.from(selected.manifest!.contentBase64, 'base64').toString('utf8')) as Record<string, unknown>
      if (manifest.artifact !== undefined) manifest.artifact = { ...manifest.artifact as object, digest }
      const bytes = Buffer.from(JSON.stringify(manifest))
      const raw = { contentBase64: bytes.toString('base64'), sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
      const conflict = { ...document, revision: 'mirror-conflict', plugins: [{ ...selected, artifactDigest: digest, manifest: raw, manifestDigest: raw.sha256 }], deliveries: document.deliveries.map(delivery => ({ ...delivery, artifactDigest: digest })) }
      const repositories = (runtime as unknown as { agentForgeCatalogs: Map<string, CatalogRepository> }).agentForgeCatalogs
      await expect(repositories.get('mirror')!.refresh(async () => Buffer.from(JSON.stringify(conflict)))).resolves.toMatchObject({ status: 'refreshed' })
      const view = runtime.catalogView()
      expect(view.plugins).toEqual([])
      expect(view.deliveries).toEqual([])
      expect(view.mergeIssues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'content-conflict', candidates: expect.arrayContaining([expect.objectContaining({ sourceId: 'agent-forge:mirror', artifactDigest: digest })]) })]))
      const download = vi.spyOn(runtime.artifacts, 'acquire')
      await expect(runtime.taskStart({ planId: plan.plan.planId, planDigest: plan.plan.planDigest, confirmed: true, idempotencyKey: 'catalog-conflict-once' }, 'catalog-caller')).rejects.toMatchObject({ code: 'release-context/stale' })
      expect(download).not.toHaveBeenCalled()
      expect(install).not.toHaveBeenCalled()
      expect(await runtime.taskList()).toEqual([])
    } finally { await runtime.taskList(); removeDirectory(directory) }
  })
})
