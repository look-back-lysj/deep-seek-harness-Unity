import { describe, expect, it, vi } from 'vitest'
import { activateMarketClient, remoteFacade } from '../../packages/market/src/client/activation.ts'
import type { AuthorDraft, ClientHandshakeRequest, ClientHandshakeResult, ReadmeApplyPreviewRequest, ReadmeImportRequest, ReadmePreviewView } from '@dsh-eac/market-core/contracts'
import { ADAPTER_PROTOCOL_VERSION, ADAPTER_VERSION } from '../../packages/market/src/version.ts'
import { helloFixture } from './fixtures.ts'

// 成功别名测试仍经过真实代理防护，提供完整握手响应；
// 拒绝、缺方法与超时分支由 protocol-guard.test.ts 覆盖。
function compatibleConnection() {
  return {
    hello: async () => ({ ok: true, value: helloFixture }),
    clientConnect: async (request: ClientHandshakeRequest) => {
      expect(request).toEqual({ protocolVersion: ADAPTER_PROTOCOL_VERSION, adapterVersion: ADAPTER_VERSION })
      const value: ClientHandshakeResult = { accepted: true, protocolVersion: ADAPTER_PROTOCOL_VERSION, coreVersion: '0.1.0', coreApiVersion: '1.0.0' }
      return { ok: true, value }
    },
  }
}

function emptyComponent() {
  return null
}

describe('client activation order', () => {
  it('unwraps RemoteResult, maps legacy UI names and supplies an empty refresh request', async () => {
    const calls: unknown[][] = []
    const facade = remoteFacade({
      ...compatibleConnection(),
      planCreate: async (...args: unknown[]) => { calls.push(['planCreate', ...args]); return { ok: true, value: 'plan' } },
      catalogRefresh: async (...args: unknown[]) => { calls.push(['catalogRefresh', ...args]); return { ok: true, value: { status: 'refreshed', current: 'catalog' } } },
    })
    expect(await facade.createPlan?.({ packId: 'pack', packVersion: '1.0.0', selections: [], attemptUnknown: false })).toBe('plan')
    expect(await facade.refreshCatalog?.()).toEqual({ status: 'refreshed', current: 'catalog' })
    expect(calls[1]).toEqual(['catalogRefresh', {}])
  })

  it('目录刷新失败保留状态、原因与上次可用目录', async () => {
    const failure = { status: 'failed', current: { revision: 'last-good' }, reason: '没有可用目录来源' }
    const facade = remoteFacade({ ...compatibleConnection(), catalogRefresh: async () => ({ ok: true, value: failure }) })
    expect(await facade.refreshCatalog?.()).toEqual(failure)
  })

  it('README两阶段alias保留候选、revision和确认结果，预览不触发应用', async () => {
    const draft: AuthorDraft = { id: 'test-draft', revision: 'r1', title: '合成草稿', summary: '测试', markdown: '原正文', mediaIds: [], updatedAt: '2026-09-28T00:00:00Z' }
    const preview: ReadmePreviewView = {
      previewId: 'test-preview', expiresAt: '2026-09-28T00:15:00Z', before: draft,
      candidate: { id: draft.id, expectedRevision: draft.revision, title: draft.title, summary: draft.summary, markdown: '候选正文', mediaIds: [] },
      repositoryUrl: 'https://github.com/example/test', commit: 'a'.repeat(40), importedAt: draft.updatedAt, mediaWarnings: ['合成媒体提示'],
    }
    const result = { draft: { ...draft, revision: 'r2', markdown: preview.candidate.markdown }, repositoryUrl: preview.repositoryUrl, commit: preview.commit, importedAt: preview.importedAt, mediaWarnings: preview.mediaWarnings }
    const read = vi.fn(async (_request: ReadmeImportRequest) => ({ ok: true, value: preview }))
    const apply = vi.fn(async (_request: ReadmeApplyPreviewRequest) => ({ ok: true, value: result }))
    const facade = remoteFacade({ ...compatibleConnection(), authorReadmePreview: read, authorReadmeApplyPreview: apply })
    const request: ReadmeImportRequest = { repositoryUrl: preview.repositoryUrl, targetDraftId: draft.id, expectedRevision: draft.revision }
    expect(await facade.previewReadme?.(request)).toEqual(preview)
    expect(read).toHaveBeenCalledWith(request)
    expect(apply).not.toHaveBeenCalled()
    const confirmation: ReadmeApplyPreviewRequest = { previewId: preview.previewId, expectedRevision: draft.revision }
    expect(await facade.applyReadmePreview?.(confirmation)).toEqual(result)
    expect(apply).toHaveBeenCalledExactlyOnceWith(confirmation)
  })

  it('README确认的revision冲突穿过alias后仍是失败', async () => {
    const facade = remoteFacade({ ...compatibleConnection(), authorReadmeApplyPreview: async () => ({ ok: false, error: { code: 'draft/revision-conflict', message: '草稿已在另一窗口更新', retryable: false } }) })
    await expect(facade.applyReadmePreview?.({ previewId: 'test-preview', expectedRevision: 'old' })).rejects.toMatchObject({ code: 'draft/revision-conflict', message: '草稿已在另一窗口更新', retryable: false })
  })

  it('preserves stable Remote failure fields while remaining an Error', async () => {
    const facade = remoteFacade({
      fail: async () => ({ ok: false, error: { message: 'failed', code: 'test/failure', details: { field: 'x' }, retryable: true, nextAction: 'retry' } }),
    }) as unknown as Record<string, () => Promise<unknown>>
    const error = await facade.fail?.().catch((value: unknown) => value) as Error & Record<string, unknown>
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('failed')
    expect(error.code).toBe('test/failure')
    expect(error.retryable).toBe(true)
    expect(error.nextAction).toBe('retry')
  })

  it('必须先 mount generated remote，再读取 eacMarket namespace', async () => {
    const order: string[] = []
    let mounted = false
    const remote = {
      async $mount() {
        order.push('mount')
        mounted = true
        return () => { order.push('dispose:mount') }
      },
      get eacMarket() {
        order.push('namespace')
        if (!mounted) throw new Error('namespace read before mount')
        return {}
      },
    }
    const ctx = {
      remote,
      locale: {
        register() {
          order.push('locale')
          return () => { order.push('dispose:locale') }
        },
      },
      slots: {
        inject(name: string, factory: () => unknown) {
          order.push(`inject:${name}`)
          const result = factory()
          const disposers: Array<() => void> = []
          if (typeof result === 'function') {
            disposers.push(result as () => void)
          } else if (typeof result === 'object' && result !== null && Symbol.iterator in result) {
            for (const value of result as Iterable<() => void>) disposers.push(value)
          }
          return () => {
            order.push(`dispose:inject:${name}`)
            for (const dispose of disposers.reverse()) dispose()
          }
        },
        register(options: { name: string }) {
          order.push(`register:${options.name}`)
          return () => { order.push(`dispose:register:${options.name}`) }
        },
      },
    } as unknown as Parameters<typeof activateMarketClient>[0]

    const dispose = await activateMarketClient(ctx, { fake: true }, {
      MarketPage: emptyComponent,
      Icon: emptyComponent,
    })
    expect(order).toEqual([
      'mount',
      'namespace',
      'locale',
      'inject:main',
      'register:main',
      'inject:sidebar.panellist',
      'register:sidebar.panellist',
    ])
    await dispose()
    expect(order.slice(7)).toEqual([
      'dispose:inject:sidebar.panellist',
      'dispose:register:sidebar.panellist',
      'dispose:inject:main',
      'dispose:register:main',
      'dispose:locale',
      'dispose:mount',
    ])
  })

  it('后续注册失败时回滚已经完成的 mount 和 locale', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const disposed: string[] = []
    const ctx = {
      remote: {
        async $mount() {
          return () => disposed.push('mount')
        },
        get eacMarket() { return {} },
      },
      locale: {
        register() {
          return () => disposed.push('locale')
        },
      },
      slots: {
        inject() {
          throw new Error('main slot failed')
        },
        register() {
          return () => disposed.push('slot')
        },
      },
    } as unknown as Parameters<typeof activateMarketClient>[0]

    await expect(activateMarketClient(ctx, {}, {
      MarketPage: emptyComponent,
      Icon: emptyComponent,
    })).rejects.toThrow('main slot failed')
    expect(disposed).toEqual(['locale', 'mount'])
  })
})
