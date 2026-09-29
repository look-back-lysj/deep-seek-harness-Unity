import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDshMarketBackend } from '../../packages/market-core/src/dsh.ts'
import { MarketRuntime, type RuntimeOptions } from '../../packages/market-core/src/host/market-runtime.ts'
import { latestAcceptance } from '../../packages/market-core/src/catalog/lifecycle.ts'
import type { TaskState } from '../../packages/market-core/src/contracts/types.ts'
import { context, embedded, freshDirectory, identity, removeDirectory, withBackend } from './helpers.ts'

describe('DSH 无界面业务门面', () => {
  it('仅提供 30 个冻结函数，解构后仍能读写真实的测试草稿', async () => {
    await withBackend(async backend => {
      expect(Object.isFrozen(backend)).toBe(true)
      expect(Object.keys(backend)).toHaveLength(30)
      expect(Object.values(backend).every(value => typeof value === 'function')).toBe(true)
      for (const key of ['host', 'tasks', 'files', 'context', 'identity', 'runtime', 'authoring', 'transfers']) expect(backend).not.toHaveProperty(key)
      const { capabilities, catalog, inventory, authorDraftSave, authorDraftGet, authorDraftList, authorDraftDelete } = backend
      // 无官方 manager 的测试宿主必须如实报告能力不可用。
      expect(capabilities()).not.toContain('browse')
      expect(catalog().revision).toBe(embedded.revision)
      expect(catalog().collections).toEqual([])
      expect((await inventory()).environmentId).toBe(identity.environmentId)
      expect((await inventory()).unknownItems).toContain('pluginManager:unavailable')
      const draft = authorDraftSave({ title: '仅测试草稿', summary: '', markdown: '# Synthetic fixture', mediaIds: [] })
      expect(authorDraftGet(draft.id)).toEqual(draft)
      expect(authorDraftList()).toContainEqual(draft)
      expect(() => authorDraftSave({ ...draft, expectedRevision: 'stale-revision' })).toThrow(/revision/)
      expect(authorDraftDelete({ id: draft.id, expectedRevision: draft.revision })).toBe(true)
      expect(authorDraftList()).toEqual([])
    })
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
