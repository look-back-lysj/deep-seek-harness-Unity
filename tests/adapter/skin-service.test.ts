import { describe, expect, it } from 'vitest'
import { Context } from '../../packages/market/node_modules/@deepseek-ai/cordis/lib/index.js'
import { attachSkinService } from '../../packages/market/src/client/activation.ts'

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const runtime = () => ({ list: () => [], current: () => 'default', switchTo: async () => ({ ok: true as const }), subscribe: () => () => {} })

describe('真实 Cordis 的可选皮肤服务', () => {
  it('市场先启动，管理器后安装/停用/重新安装都正确更新，清理后不再回调', async () => {
    const ctx = new Context()
    const bridge = attachSkinService(ctx)
    const seen: unknown[] = []
    const unsub = bridge.subscribe(() => seen.push(bridge.getRuntime()))
    expect(bridge.getRuntime()).toBeUndefined()
    for (let i = 0; i < 3; i++) {
      const value = runtime()
      const provider = await ctx.plugin({ apply: scope => { scope.reflect.provide('uiSkinLoader', value) } })
      await settle()
      expect(bridge.getRuntime()?.current()).toBe('default')
      expect(seen.at(-1)).toBeDefined()
      await provider.dispose()
      await settle()
      expect(bridge.getRuntime()).toBeUndefined()
      expect(seen.at(-1)).toBeUndefined()
    }
    unsub()
    await bridge.dispose()
    const count = seen.length
    const late = await ctx.plugin({ apply: scope => { scope.reflect.provide('uiSkinLoader', runtime()) } })
    await settle()
    expect(bridge.getRuntime()).toBeUndefined()
    expect(seen.length).toBe(count)
    await late.dispose()
  })
})
