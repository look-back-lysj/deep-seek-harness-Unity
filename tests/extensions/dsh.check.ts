import { Context } from '@deepseek-ai/cordis'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@official/slot-registry'
import { describe, expect, it } from 'vitest'
import { EXTENSION_SERVICE, EXTENSION_SLOTS, type ExtensionRegistration, type ExtensionSlot } from '../../packages/market/src/client/extensions/contract.ts'
import { EXTENSION_CHILDREN, attachDshService } from '../../packages/market/src/client/extensions/dsh.tsx'
import { definition, makeHost } from './fixtures.ts'

const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve() }
async function boot() {
  const root = new Context(); const slots = await root.plugin(SlotRegistry)
  return { root, slots, declare: () => root.slots.register({ name: 'root', children: EXTENSION_CHILDREN }, (_props: PropsRenderSlots<ExtensionSlot>) => null) }
}
function extension(root: Context, id = 'test.extension') {
  let last: ExtensionRegistration | undefined
  let unrelatedStarts = 0
  const fiber = root.plugin({
    name: `fixture:${id}`,
    apply(ctx: Context) {
      unrelatedStarts++
      ctx.inject([EXTENSION_SERVICE], (scope) => { last = scope.eacMarketExtensions.register(scope, definition(id)) })
    },
  })
  return { fiber, result: () => last, unrelatedStarts: () => unrelatedStarts }
}

describe('真实Cordis 4.0.4 + 官方0.1.7-rc.2 SlotRegistry源码（专属配置，不操作Desktop）', () => {
  it.each(['extension-first', 'market-first'])('%s：服务和槽位先后就绪，五位置投影与撤销', async (order) => {
    const b = await boot(); const host = makeHost()
    let ext: ReturnType<typeof extension> | undefined
    if (order === 'extension-first') { ext = extension(b.root); await ext.fiber; expect(ext.result()).toBeUndefined(); expect(ext.unrelatedStarts()).toBe(1) }
    const market = await b.root.plugin({ inject: ['slots'], apply: (ctx) => attachDshService(ctx, host) })
    ext ??= extension(b.root); await ext.fiber; await settle()
    expect(ext.result()?.status).toBe('registered'); expect(host.getSnapshot()).toHaveLength(5)
    for (const slot of Object.values(EXTENSION_SLOTS)) expect(b.root.slots.entries(slot)).toHaveLength(0)
    const undeclare = b.declare(); await settle()
    for (const slot of Object.values(EXTENSION_SLOTS)) {
      const entries = b.root.slots.entries(slot)
      expect(entries).toHaveLength(1); expect(entries[0]!.options.priority).toBe(0)
    }
    undeclare(); await settle()
    for (const slot of Object.values(EXTENSION_SLOTS)) expect(b.root.slots.entries(slot)).toHaveLength(0)
    const undeclareAgain = b.declare(); await settle()
    for (const slot of Object.values(EXTENSION_SLOTS)) expect(b.root.slots.entries(slot)).toHaveLength(1)
    await ext.fiber.dispose(); await settle(); expect(host.getSnapshot()).toHaveLength(0)
    for (const slot of Object.values(EXTENSION_SLOTS)) expect(b.root.slots.entries(slot)).toHaveLength(0)
    undeclareAgain(); await market.dispose(); await b.slots.dispose()
  })
  it('独立插件50次开关、相同版本重载不遗留effect或投影', async () => {
    const b = await boot(); const host = makeHost()
    const market = await b.root.plugin({ inject: ['slots'], apply: (ctx) => attachDshService(ctx, host) })
    const undeclare = b.declare(); await settle()
    const baseline = JSON.stringify(market.getEffects())
    for (let i = 0; i < 50; i++) {
      const ext = extension(b.root); await ext.fiber; await settle()
      expect(host.getSnapshot()).toHaveLength(5)
      for (const slot of Object.values(EXTENSION_SLOTS)) expect(b.root.slots.entries(slot)).toHaveLength(1)
      await ext.fiber.dispose(); await settle()
      expect(host.getSnapshot()).toHaveLength(0)
      for (const slot of Object.values(EXTENSION_SLOTS)) expect(b.root.slots.entries(slot)).toHaveLength(0)
      expect(JSON.stringify(market.getEffects())).toBe(baseline)
    }
    undeclare(); await market.dispose(); await b.slots.dispose()
  })
  it('市场停用再启用会使等待中的独立插件重登记，原host不复活', async () => {
    const b = await boot(); const undeclare = b.declare(); const ext = extension(b.root); await ext.fiber
    for (let i = 0; i < 5; i++) {
      const host = makeHost(); const market = await b.root.plugin({ inject: ['slots'], apply: (ctx) => attachDshService(ctx, host) })
      await settle(); expect(host.getSnapshot()).toHaveLength(5)
      await market.dispose(); await settle(); expect(host.getSnapshot()).toHaveLength(0)
      for (const slot of Object.values(EXTENSION_SLOTS)) expect(b.root.slots.entries(slot)).toHaveLength(0)
      expect(ext.unrelatedStarts()).toBe(1)
    }
    await ext.fiber.dispose(); undeclare(); await b.slots.dispose()
  })
  it('真实slot排序与共同注册表一致；重复外部ID不覆盖原贡献', async () => {
    const b = await boot(); const host = makeHost(); const undeclare = b.declare()
    const market = await b.root.plugin({ inject: ['slots'], apply: (ctx) => attachDshService(ctx, host) })
    const z = extension(b.root, 'z.fixture'); await z.fiber
    const a = extension(b.root, 'a.fixture'); await a.fiber; await settle()
    expect(b.root.slots.entries(EXTENSION_SLOTS.home).map((e) => e.options.id)).toEqual(['a.fixture:home', 'z.fixture:home'])
    const duplicate = extension(b.root, 'a.fixture'); await duplicate.fiber; await settle()
    expect(duplicate.result()).toEqual({ status: 'rejected', reason: 'extension/duplicate-id' })
    await duplicate.fiber.dispose(); expect(host.getSnapshot()).toHaveLength(10)
    await a.fiber.dispose(); await z.fiber.dispose(); undeclare(); await market.dispose(); await b.slots.dispose()
  })
})
