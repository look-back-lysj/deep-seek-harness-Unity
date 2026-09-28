import { describe, expect, it, vi } from 'vitest'
import { activateMarketClient, remoteFacade } from '../../packages/market/src/client/activation.ts'

function emptyComponent() {
  return null
}

describe('client activation order', () => {
  it('unwraps RemoteResult, maps legacy UI names and supplies an empty refresh request', async () => {
    const calls: unknown[][] = []
    const facade = remoteFacade({
      planCreate: async (...args: unknown[]) => { calls.push(['planCreate', ...args]); return { ok: true, value: 'plan' } },
      catalogRefresh: async (...args: unknown[]) => { calls.push(['catalogRefresh', ...args]); return { ok: true, value: { current: 'catalog' } } },
    })
    expect(await facade.createPlan?.({ packId: 'pack', packVersion: '1.0.0', selections: [], attemptUnknown: false })).toBe('plan')
    expect(await facade.refreshCatalog?.()).toBe('catalog')
    expect(calls[1]).toEqual(['catalogRefresh', {}])
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
