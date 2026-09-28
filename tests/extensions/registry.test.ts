import { describe, expect, it, vi } from 'vitest'
import { EXTENSION_SLOTS, type ExtensionDefinition } from '../../packages/market/src/client/extensions/contract.ts'
import { compatibleVersion } from '../../packages/market/src/client/extensions/compatibility.ts'
import { createMarketExtensionHost, contributionSignal } from '../../packages/market/src/client/extensions/registry.ts'
import { registerBuiltinExtension } from '../../packages/market/src/client/extensions/builtin.ts'
import { TestOwner, capabilities, definition, makeHost } from './fixtures.ts'

describe('共同注册表（明确合成数据）', () => {
  it('两个适配器均完整接受五位置，复制冻结元数据，读取快照引用稳定', () => {
    const host = makeHost(); const owner = new TestOwner(); const def = definition()
    expect(registerBuiltinExtension(host, owner, def).status).toBe('registered')
    expect(host.service.register(owner, definition('external.fixture')).status).toBe('registered')
    expect(host.getSnapshot()).toHaveLength(10)
    expect(host.getSnapshot()).toBe(host.getSnapshot())
    expect(Object.isFrozen(host.getSnapshot()[0]!.contribution)).toBe(true)
    expect(host.getSnapshot().filter((e) => e.provider === 'builtin')).toHaveLength(5)
    expect(host.getSnapshot().filter((e) => e.provider === 'dsh-plugin')).toHaveLength(5)
    ;(def.contributions as unknown[]).pop()
    expect(host.getSnapshot()).toHaveLength(10)
    expect(new Set(host.getSnapshot().map((e) => e.contribution.slot))).toEqual(new Set(Object.values(EXTENSION_SLOTS)))
    owner.dispose(); expect(host.getSnapshot()).toHaveLength(0)
  })
  it('拒绝重复ID且旧dispose不能删除重新登记的同ID；50次开关清理无增长', () => {
    const host = makeHost(); const owner = new TestOwner()
    for (let i = 0; i < 50; i++) {
      const result = host.service.register(owner, definition())
      expect(result.status).toBe('registered')
      expect(host.registerBuiltin(owner, definition())).toEqual({ status: 'rejected', reason: 'extension/duplicate-id' })
      if (result.status !== 'registered') throw new Error('unexpected rejection')
      const signals = host.getSnapshot().map(contributionSignal)
      result.dispose(); result.dispose()
      expect(signals.every((s) => s?.aborted)).toBe(true)
      expect(owner.effects.size).toBe(0)
      const next = host.service.register(owner, definition()); result.dispose()
      expect(host.getSnapshot()).toHaveLength(5)
      if (next.status === 'registered') next.dispose()
    }
    expect(host.getSnapshot()).toHaveLength(0); expect(owner.effects.size).toBe(0)
  })
  it.each([
    ['API版本', { apiVersion: '2' }], ['市场版本', { marketRange: '^0.1.0' }], ['DSH版本', { dshRange: '>=0.1.8 <0.2.0' }],
    ['非法范围', { marketRange: '>=0.1.0-mvp.0 || nonsense' }],
    ['重复贡献', { contributions: [definition().contributions[0], definition().contributions[0]] }],
    ['核心槽位', { contributions: [{ ...definition().contributions[0], slot: 'main', priority: -100 }] }],
    ['跨页菜单', { contributions: [{ id: 'menu', slot: EXTENSION_SLOTS.more, title: 'bad', pageId: 'another:page' }] }],
    ['无对应页面', { contributions: [{ id: 'menu', slot: EXTENSION_SLOTS.more, title: 'bad', pageId: 'missing' }] }],
    ['菜单可执行代码', { contributions: [{ ...definition().contributions[1], component: () => null }, definition().contributions[2]] }],
    ['无穷顺序', { contributions: [{ ...definition().contributions[0], order: Infinity }] }],
    ['空过滤项', { contributions: [{ ...definition().contributions[3], pluginIds: [''] }] }],
  ])('%s整组拒绝，零部分登记', (_name, patch) => {
    const host = makeHost(); const owner = new TestOwner()
    expect(host.service.register(owner, { ...definition(), ...patch } as ExtensionDefinition).status).toBe('rejected')
    expect(host.getSnapshot()).toHaveLength(0); expect(owner.effects.size).toBe(0)
  })
  it('必需能力缺失拒绝本扩展，可选能力缺失只删除该能力', () => {
    const host = createMarketExtensionHost({ marketVersion: '0.1.0-mvp.1', dshVersion: '0.1.7-rc.2', capabilities: ['browse'] })
    expect(host.service.register(new TestOwner(), definition()).status).toBe('rejected')
    expect(host.service.register(new TestOwner(), { ...definition(), requiredCapabilities: ['browse'], optionalCapabilities: [...capabilities], contributions: [definition().contributions[0]!] }).status).toBe('registered')
    expect(host.getSnapshot()[0]!.capabilities).toEqual(['browse'])
  })
  it('相同order按命名空间ID稳定排序，卸载与监听异常不影响其他贡献', async () => {
    const issues = vi.fn(); const host = createMarketExtensionHost({ marketVersion: '0.1.0-mvp.1', dshVersion: '0.1.7-rc.2', capabilities, onIssue: issues })
    const stop = host.subscribe(() => { throw new Error('synthetic private details') })
    host.subscribe((async () => { throw new Error('synthetic rejected listener') }) as () => void)
    host.service.register(new TestOwner(), definition('z.fixture')); host.service.register(new TestOwner(), definition('a.fixture'))
    const keys = host.getSnapshot().map((e) => e.key)
    expect(keys).toEqual([...keys].sort()); stop(); await Promise.resolve(); await Promise.resolve()
    expect(issues).toHaveBeenCalledWith({ code: 'extension/subscriber-error' })
    host.dispose(); host.dispose()
    expect(host.getSnapshot()).toHaveLength(0)
    expect(host.service.register(new TestOwner(), definition()).status).toBe('rejected')
  })
  it('无效owner与初始化中终止均回滚', () => {
    const host = makeHost(); const owner = new TestOwner(); owner.dispose()
    expect(host.service.register(owner, definition()).status).toBe('rejected')
    expect(host.service.register({ effect: (setup) => { setup()(); return undefined } }, definition()).status).toBe('rejected')
    expect(host.getSnapshot()).toHaveLength(0)
  })
})

describe('兼容范围及预发行语义', () => {
  it.each([
    ['0.1.0-mvp.1', '>=0.1.0-mvp.0 <0.2.0', true], ['0.1.0-mvp.1', '^0.1.0', false],
    ['0.1.7-rc.2', '^0.1.7-rc.1', true], ['0.1.8-rc.1', '^0.1.7-rc.1', false],
    ['1.2.9', '~1.2.3', true], ['1.3.0', '~1.2.3', false], ['0.0.4', '^0.0.3', false],
    ['1.0.0+build.1', '=1.0.0+other', true], ['1.0.0', '2.0.0 || 1.0.0', true],
    ['0.1.7-rc.10', '>=0.1.7-rc.2 <0.1.7', true],
  ])('%s ∈ %s = %s', (version, range, result) => { expect(compatibleVersion(version, range)).toBe(result) })
  it.each(['', '*', '1.x', '>=1.0.0 || invalid', '^01.2.3', '1.0.0 - 2.0.0'])('明确拒绝不支持的表达式 %s', (range) => { expect(() => compatibleVersion('1.0.0', range)).toThrow() })
})
