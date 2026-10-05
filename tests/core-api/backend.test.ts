import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDshMarketBackend } from '../../packages/market-core/src/dsh.ts'
import { MarketRuntime, type RuntimeOptions } from '../../packages/market-core/src/host/market-runtime.ts'
import { latestAcceptance } from '../../packages/market-core/src/catalog/lifecycle.ts'
import type { TaskState } from '../../packages/market-core/src/contracts/types.ts'
import { context, embedded, freshDirectory, identity, removeDirectory, withBackend } from './helpers.ts'
import { createOfflinePack } from '../../packages/market-core/src/catalog/offline-pack.ts'
import { describeOfflineArtifact } from '../../packages/market-core/src/delivery/offline-pack.ts'
import { validTgz } from '../delivery/fixtures.ts'

describe('DSH 无界面业务门面', () => {
  it('提供冻结的 Core 门面并能使用新增只读/策略接口和作者草稿', async () => {
    await withBackend(async backend => {
      expect(Object.isFrozen(backend)).toBe(true)
      expect(Object.keys(backend)).toHaveLength(37)
      expect(Object.values(backend).every(value => typeof value === 'function')).toBe(true)
      for (const key of ['host', 'tasks', 'files', 'context', 'identity', 'runtime', 'authoring', 'transfers']) expect(backend).not.toHaveProperty(key)
      const { capabilities, catalog, inventory, authorDraftSave, authorDraftGet, authorDraftList, authorDraftDelete } = backend
      // 无官方 manager 的测试宿主必须如实报告能力不可用。
      expect(capabilities()).not.toContain('browse')
      expect(catalog().revision).toBe(embedded.revision)
      expect(catalog().collections).toEqual([])
      expect((await inventory()).environmentId).toBe(identity.environmentId)
      expect((await inventory()).unknownItems).toContain('pluginManager:unavailable')
      expect(await backend.catalogSources()).toEqual([])
      expect((await backend.maintenanceStatus()).environmentId).toBe(identity.environmentId)
      expect((await backend.checkUpdates()).items).toEqual([])
      const policy = await backend.updatePolicyGet()
      expect(policy.policy).toMatchObject({ automaticChecksEnabled: true, automaticDownloadsEnabled: false, automaticInstallsEnabled: false })
      const savedPolicy = await backend.updatePolicySave({ expectedRevision: policy.revision, policy: { ...policy.policy, automaticChecksEnabled: false } })
      expect(savedPolicy.policy.automaticChecksEnabled).toBe(false)
      const draft = authorDraftSave({ title: '仅测试草稿', summary: '', markdown: '# Synthetic fixture', mediaIds: [] })
      expect(authorDraftGet(draft.id)).toEqual(draft)
      expect(authorDraftList()).toContainEqual(draft)
      expect(() => authorDraftSave({ ...draft, expectedRevision: 'stale-revision' })).toThrow(/revision/)
      expect(authorDraftDelete({ id: draft.id, expectedRevision: draft.revision })).toBe(true)
      expect(authorDraftList()).toEqual([])
    })
  })

  it('Core-owned explicit intent survives Runtime recreation and is not inferred from old task success', async () => {
    const directory = freshDirectory()
    let enabled = false
    const manager = {
      listBundles: async () => [{ name: 'test-explicit', version: '1.0.0', installed: true, enabled, removable: true, rows: [], overrides: [] }],
      listPlugins: async () => [],
      setBundleEnabled: async (name: string, next: boolean) => {
        enabled = next
        return { application: 'applied', changed: true, stage: next ? 'enable' : 'disable', target: name }
      },
    }
    const options = { embeddedCatalogBytes: Buffer.from(JSON.stringify(embedded)), catalogSources: [] }
    try {
      const first = createDshMarketBackend(context(directory, manager), identity, join(directory, 'market'), options)
      await first.taskList()
      expect((await first.maintenanceStatus()).packages.find(item => item.packageName === 'test-explicit')?.explicitState).toBe('none')
      await expect(first.pluginSetEnabled({ packageName: 'test-explicit', expectedVersion: '1.0.0', enabled: true, idempotencyKey: 'explicit-1' })).resolves.toMatchObject({ status: 'applied' })
      expect((await first.maintenanceStatus()).packages.find(item => item.packageName === 'test-explicit')?.explicitState).toBe('explicit')
      const second = createDshMarketBackend(context(directory, manager), identity, join(directory, 'market'), options)
      await second.taskList()
      expect((await second.maintenanceStatus()).packages.find(item => item.packageName === 'test-explicit')).toMatchObject({ explicitState: 'explicit', enabledState: 'enabled' })
    } finally { removeDirectory(directory) }
  })

  it('通过公开 Backend 刷新 Agent Forge 并且只投影为研究条目', async () => {
    const directory = freshDirectory()
    const sourceRoot = join(directory, 'agent-forge')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(sourceRoot, 'packages'), { recursive: true })
    const source = {
      schemaVersion: 2, sourceId: 'agent-forge:test:plugin', name: 'test', agentId: 'dsh', type: 'plugin',
      baseUrl: 'https://example.test/agent-forge/', index: 'index.json', revision: 'r1',
      generatedAt: '2026-10-01T00:00:00Z', description: 'test source',
    }
    const record = {
      schemaVersion: 2, id: 'dev.test.alpha', name: '@test/alpha', version: '1.2.3', type: 'plugin', description: 'Alpha',
      license: 'MIT', targets: [{ agentId: 'dsh', compatibilityStatus: 'known', agentVersionRange: '*' }],
      pluginDetails: { manifestPath: 'package.json' }, distributions: [{ id: 'archive', type: 'archive', url: 'https://example.test/alpha.tgz' }],
    }
    const index = {
      schemaVersion: 2, sourceId: source.sourceId, sourceManifest: 'source.json', agentId: 'dsh', type: 'plugin',
      revision: 'r1', generatedAt: source.generatedAt,
      packages: { '@test/alpha': { id: record.id, latest: record.version, versions: [record.version], path: 'packages/alpha.json', recordRevision: 'r1' } },
    }
    writeFileSync(join(sourceRoot, 'source.json'), JSON.stringify(source))
    writeFileSync(join(sourceRoot, 'index.json'), JSON.stringify(index))
    writeFileSync(join(sourceRoot, 'packages', 'alpha.json'), JSON.stringify(record))
    const options = {
      embeddedCatalogBytes: Buffer.from(JSON.stringify(embedded)),
      catalogSources: [],
      agentForgeSources: [{
        id: 'af-test', kind: 'agent-forge' as const,
        location: { mode: 'local-file' as const, value: sourceRoot },
        enabled: true, priority: 5, refreshPolicy: 'manual' as const,
      }],
      agentForgeSourceOptions: { targetAgent: 'dsh', localRoots: [sourceRoot] },
    }
    const manager = { listBundles: async () => [], listPlugins: async () => [], installBundle: async () => ({ application: 'applied', changed: true, stage: 'install', target: record.name }) }
    const backend = createDshMarketBackend(context(directory, manager), identity, join(directory, 'market'), options)
    try {
      await backend.taskList()
      const result = await backend.agentForgeRefresh({ sourceId: 'af-test' })
      expect(result.status).toBe('refreshed')
      expect(result.current.listings).toEqual([expect.objectContaining({ packageName: '@test/alpha', requestedVersion: '1.2.3' })])
      expect(result.current.plugins).toEqual([])
      expect((await backend.catalogSources()).find(item => item.id === 'af-test')).toMatchObject({ status: 'ready', revision: expect.stringContaining('af-test-r1') })
    } finally { await backend.taskList(); removeDirectory(directory) }
  })

  it('离线 eacpack 刷新后进入可校验的插件目录和安装来源', async () => {
    const directory = freshDirectory()
    const sourceRoot = join(directory, 'offline-source')
    const bytes = validTgz('@test/alpha', '1.2.3')
    const artifact = describeOfflineArtifact(bytes, 'alpha.tgz')
    const source = { schemaVersion: 2, sourceId: 'agent-forge:offline:test', name: 'Offline', agentId: 'dsh', type: 'plugin', baseUrl: 'https://example.com/catalog/', index: 'index.json', revision: 'r1', generatedAt: '2026-10-01T00:00:00Z', description: 'offline' }
    const record = { schemaVersion: 2, id: 'dev.test.alpha', name: '@test/alpha', version: '1.2.3', type: 'plugin', description: 'alpha', license: 'MIT', targets: [{ agentId: 'dsh', compatibilityStatus: 'known', agentVersionRange: '*' }], pluginDetails: { manifestPath: 'package.json' }, distributions: [{ id: 'archive', type: 'archive', url: 'https://example.com/alpha.tgz', checksum: { sha256: artifact.digest.slice(7) } }] }
    const index = { schemaVersion: 2, sourceId: source.sourceId, sourceManifest: 'source.json', agentId: 'dsh', type: 'plugin', revision: 'r1', generatedAt: source.generatedAt, packages: { '@test/alpha': { id: record.id, latest: record.version, versions: [record.version], path: 'packages/alpha.json', recordRevision: 'r1' } } }
    const manifest = { schemaVersion: '1' as const, packId: 'offline-runtime', sourceRevision: 'r1', targetAgent: 'dsh', packages: [{ pluginId: record.id, packageName: record.name, version: record.version, artifactDigest: artifact.digest, optional: true as const }], artifacts: [artifact] }
    mkdirSync(sourceRoot, { recursive: true })
    const archive = createOfflinePack({ manifest, sourceBytes: Buffer.from(JSON.stringify(source)), indexBytes: Buffer.from(JSON.stringify(index)), packageRecords: new Map([['packages/alpha.json', Buffer.from(JSON.stringify(record))]]), artifacts: new Map([[artifact.digest, bytes]]) })
    const packPath = join(sourceRoot, 'offline.eacpack')
    writeFileSync(packPath, archive)
    const options = { embeddedCatalogBytes: Buffer.from(JSON.stringify(embedded)), catalogSources: [], agentForgeSources: [{ id: 'offline-test', kind: 'agent-forge' as const, location: { mode: 'offline-pack' as const, value: packPath }, enabled: true, priority: 0, refreshPolicy: 'manual' as const }], agentForgeSourceOptions: { targetAgent: 'dsh', localRoots: [sourceRoot] } }
    let installed = false
    const manager = {
      listBundles: async () => installed ? [{ name: record.name, version: record.version, installed: true, enabled: true, removable: true, rows: [], overrides: [] }] : [],
      listPlugins: async () => [],
      installBundle: async () => { installed = true; return { application: 'applied', changed: true, stage: 'install', target: record.name } },
    }
    const backend = createDshMarketBackend(context(directory, manager), identity, join(directory, 'market'), options)
    try {
      const result = await backend.agentForgeRefresh({ sourceId: 'offline-test' })
      expect(result.status).toBe('refreshed')
      expect(result.current.plugins).toEqual([expect.objectContaining({ packageName: '@test/alpha', installability: 'bundle-installable', artifactDigest: artifact.digest })])
      expect(result.current.deliveries[0]?.sources[0]).toMatchObject({ kind: 'cache', ref: artifact.digest })
      const plan = await backend.planCreate({ selections: [{ pluginId: record.id, packageName: record.name, targetVersion: record.version, targetDigest: artifact.digest, enabledIntent: true, tryUnverified: true }] }, 'offline-caller')
      expect(plan.status).toBe('ready')
    } finally { await backend.taskList(); removeDirectory(directory) }
  })

  it('不吞审批结果、不改参数、不把异常变成成功', async () => {
    await withBackend(async backend => {
      const outcome = { status: 'awaiting-approval', approval: { attemptId: 'test-attempt', pendingBuildsDigest: 'test-digest' } } as unknown as TaskState
      let receiver: MarketRuntime | undefined
      const approve = vi.spyOn(MarketRuntime.prototype, 'taskApproveBuilds').mockImplementation(async function () { receiver = this; return outcome })
      const failure = new Error('synthetic persistence failure')
      const cancel = vi.spyOn(MarketRuntime.prototype, 'taskCancel').mockRejectedValue(failure)
      try {
        const request = { taskId: 'test-task', attemptId: 'test-attempt', pendingBuildsDigest: 'test-digest', confirmed: true as const, idempotencyKey: 'test-approval' }
        const { taskApproveBuilds, taskCancel } = backend
        expect(await taskApproveBuilds(request)).toBe(outcome)
        expect(approve).toHaveBeenCalledExactlyOnceWith(request)
        expect(receiver).toBeInstanceOf(MarketRuntime)
        await expect(taskCancel({ taskId: 'test-task', idempotencyKey: 'test-cancel' })).rejects.toBe(failure)
      } finally { approve.mockRestore(); cancel.mockRestore() }
    })
  })

  it('透传四个显式连接身份和取消信号，JavaScript 省略/空白身份也在进入运行时前失败', async () => {
    await withBackend(async backend => {
      const names = ['planCreate', 'taskStart', 'aiAnalyze', 'aiConfirm'] as const
      const spies = names.map(name => vi.spyOn(MarketRuntime.prototype, name).mockResolvedValue({ status: 'blocked', changed: false, reason: 'synthetic' } as never))
      try {
        for (const [index, name] of names.entries()) {
          const request = { synthetic: name }
          const signal = new AbortController().signal
          const call = backend[name] as (...args: unknown[]) => Promise<unknown>
          for (const invalid of [undefined, '', '  ']) await expect(call(request, invalid)).rejects.toThrow(/callerId/)
          expect(spies[index]).not.toHaveBeenCalled()
          const third = name === 'aiAnalyze' ? signal : undefined
          await call(request, 'connection-test', third)
          const args = spies[index]!.mock.calls[0]!
          expect(args[0]).toBe(request)
          expect(args[1]).toBe('connection-test')
          if (name === 'aiAnalyze') expect(args[2]).toBe(third)
        }
      } finally { spies.forEach(spy => spy.mockRestore()) }
    })
  })
})

describe('adapter 提供随包目录字节', () => {
  it('缺少字节明确失败；损坏字节不回退测试对象，也不创建市场目录', () => {
    const directory = freshDirectory()
    try {
      const data = join(directory, 'must-not-exist')
      expect(() => createDshMarketBackend(context(directory), identity, data, {} as never)).toThrow(/embeddedCatalogBytes/)
      expect(() => createDshMarketBackend(context(directory), identity, data, { embeddedCatalogBytes: 'not-bytes' } as never)).toThrow(/Uint8Array/)
      expect(() => createDshMarketBackend(context(directory), identity, data, { embeddedCatalogBytes: Buffer.from('{broken') } as never)).toThrow()
      expect(existsSync(data)).toBe(false)
    } finally { removeDirectory(directory) }
  })

  it('保留 adapter 原始排版字节及其摘要，并隔离调用方后续修改', async () => {
    const raw = Buffer.from(JSON.stringify(embedded, null, 3) + '\n\n')
    const original = Buffer.from(raw)
    await withBackend(async (backend, directory) => {
      raw.fill(0)
      expect(backend.catalog().revision).toBe(embedded.revision)
      const cache = join(directory, 'market', 'catalog')
      expect(latestAcceptance(cache)?.digest).toBe('sha256:' + createHash('sha256').update(original).digest('hex'))
      const saved = join(cache, 'revisions', createHash('sha256').update(embedded.revision).digest('hex') + '.json')
      expect(readFileSync(saved)).toEqual(original)
    }, { embeddedCatalogBytes: raw, catalogSources: [] })
  })

  it('旧 embeddedCatalog 测试注入仍可使用，不依赖生产目录位置', async () => {
    const directory = freshDirectory()
    const runtime = new MarketRuntime(context(directory), identity, join(directory, 'market'), { embeddedCatalog: embedded, catalogSources: [] } satisfies RuntimeOptions)
    try { expect(runtime.catalog.load().snapshot.revision).toBe(embedded.revision) }
    finally { await runtime.taskList(); removeDirectory(directory) }
  })
})
