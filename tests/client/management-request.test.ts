import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagementPointerStore } from '../../packages/market/src/client/management-pointer.ts'
import { ManagementRequest, emptyManagementView } from '../../packages/market/src/client/management-request.ts'
import { TaskRequestGuard } from '../../packages/market/src/client/task-request-guard.ts'
import { helloFixture, inventoryFixture, readOnlyRemote } from './fixtures.ts'
import type { EnvironmentHello, PluginActionRecoveryResult, PluginActionResult } from '../../packages/market/src/types.ts'

function setup() {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const store = new ManagementPointerStore(storage)
  const remote = { ...readOnlyRemote(), hello: vi.fn(async (): Promise<EnvironmentHello> => ({ ...helloFixture, capabilities: [...helloFixture.capabilities, 'operation-recovery'] })), setPluginEnabled: vi.fn(async () => ({ status: 'applied', changed: true, permissionChanges: [] } as PluginActionResult)), removePlugin: vi.fn(async () => ({ status: 'applied', changed: true, permissionChanges: [] } as PluginActionResult)), pluginActionRecover: vi.fn(async (): Promise<PluginActionRecoveryResult> => ({ status: 'not-found' })) }
  let view = emptyManagementView()
  const refresh = vi.fn(async () => {})
  const owner = new ManagementRequest(remote, helloFixture.environmentId, store, next => { view = next }, refresh)
  return { owner, remote, store, storage, values, refresh, view: () => view }
}

afterEach(() => vi.useRealTimers())
describe('RW-13B 原意图保护与最小指针', () => {
  it('stopAccepting 不释放原 Promise 锁', () => {
    const guard = new TaskRequestGuard()
    const ticket = guard.begin()!
    guard.stopAccepting()
    expect(guard.pending).toBe(true)
    expect(guard.accepts(ticket)).toBe(false)
    expect(guard.begin()).toBeUndefined()
    expect(guard.finish(ticket)).toBe(true)
  })
  it('保存原 environment/package/version/action/key，不保存额外字段或跨环境借用', () => {
    const fixture = setup()
    const pointer = { environmentId: 'env/a', packageName: 'alpha', expectedVersion: '1.2.3', action: 'remove' as const, idempotencyKey: 'original-key', credential: 'never-save' }
    fixture.store.save(pointer)
    expect(fixture.store.read('env/a')).toEqual({ environmentId: 'env/a', packageName: 'alpha', expectedVersion: '1.2.3', action: 'remove', idempotencyKey: 'original-key' })
    expect(fixture.store.read('env/b')).toBeUndefined()
    expect([...fixture.values.values()].join('')).not.toContain('credential')
    expect(() => fixture.store.save(pointer)).toThrow()
  })
  it.each(['environment', 'storage'])('%s 写入前失败确定未提交', async cause => {
    const fixture = setup()
    if (cause === 'environment') fixture.remote.hello.mockResolvedValue({ ...helloFixture, environmentId: 'foreign' })
    else fixture.storage.setItem = () => { throw new Error('storage denied') }
    await fixture.owner.submit(inventoryFixture.items[0]!, 'disable')
    expect(fixture.remote.setPluginEnabled).not.toHaveBeenCalled()
    expect(fixture.view().feedback.status).toBe('failed')
    expect(fixture.view().busy).toBe(false)
    expect(fixture.view().feedback.message).toContain('确定未提交')
  })
  it('提交后拒绝为 unknown；同 key 只读核对 not-found 不解锁', async () => {
    const fixture = setup()
    fixture.remote.setPluginEnabled.mockRejectedValue(new Error('disconnected'))
    await fixture.owner.submit(inventoryFixture.items[0]!, 'disable')
    const pointer = fixture.view().pointer!
    expect(fixture.view().feedback.status).toBe('unknown')
    await fixture.owner.submit(inventoryFixture.items[0]!, 'enable')
    await fixture.owner.recheck()
    expect(fixture.remote.setPluginEnabled).toHaveBeenCalledTimes(1)
    expect(fixture.remote.pluginActionRecover).toHaveBeenCalledWith({ packageName: pointer.packageName, expectedVersion: pointer.expectedVersion, action: 'disable', idempotencyKey: pointer.idempotencyKey })
    expect(fixture.view().busy).toBe(true)
    expect(fixture.refresh).not.toHaveBeenCalled()
    expect(fixture.view().feedback.message).toContain('不证明未写入')
  })
  it.each(['applied', 'failed'])('20秒超时后迟到 %s 不改变未知状态或删除指针', async status => {
    vi.useFakeTimers()
    const fixture = setup()
    let settle!: (result: PluginActionResult) => void
    fixture.remote.setPluginEnabled.mockImplementation(() => new Promise(done => { settle = done }))
    const request = fixture.owner.submit(inventoryFixture.items[0]!, 'disable')
    await vi.advanceTimersByTimeAsync(20_000)
    const pointer = fixture.view().pointer
    expect(fixture.view().feedback.status).toBe('unknown')
    await fixture.owner.submit(inventoryFixture.items[0]!, 'enable')
    settle({ status: status as PluginActionResult['status'], changed: true, permissionChanges: [] })
    await request
    expect(fixture.view().pointer).toEqual(pointer)
    expect(fixture.view().busy).toBe(true)
    expect(fixture.remote.setPluginEnabled).toHaveBeenCalledTimes(1)
    expect(fixture.refresh).not.toHaveBeenCalled()
    fixture.owner.dispose()
  })
  it('损坏指针拒绝新写入而不是删除未知记录', async () => {
    const fixture = setup()
    fixture.values.set('eac-market:management:test-environment', '{bad')
    fixture.owner.restore()
    await fixture.owner.submit(inventoryFixture.items[0]!, 'disable')
    expect(fixture.view().busy).toBe(true)
    expect(fixture.remote.setPluginEnabled).not.toHaveBeenCalled()
    expect(fixture.values.size).toBe(1)
  })
  it('组件卸载后旧回包不清除指针或触发库存刷新', async () => {
    const fixture = setup()
    let settle!: (result: PluginActionResult) => void
    fixture.remote.setPluginEnabled.mockImplementation(() => new Promise(done => { settle = done }))
    const request = fixture.owner.submit(inventoryFixture.items[0]!, 'disable')
    await vi.waitFor(() => expect(fixture.remote.setPluginEnabled).toHaveBeenCalledTimes(1))
    const pointer = fixture.view().pointer!
    fixture.owner.dispose()
    settle({ status: 'applied', changed: true, permissionChanges: [] })
    await request
    expect(fixture.store.read(helloFixture.environmentId)).toEqual(pointer)
    expect(fixture.refresh).not.toHaveBeenCalled()
  })

  it('相同 key 但指针动作变化时不能清除保护', () => {
    const fixture = setup()
    const pointer = { environmentId: 'test-environment', packageName: 'alpha', action: 'disable' as const, idempotencyKey: 'original' }
    fixture.store.save(pointer)
    fixture.values.set('eac-market:management:test-environment', JSON.stringify({ ...pointer, action: 'remove' }))
    expect(() => fixture.store.clear(pointer)).toThrow('指针已变化')
    expect(fixture.store.read('test-environment')?.action).toBe('remove')
  })

  it.each(['write', 'recover'])('%s applied 后 removeItem 抛错保留原结果与保护，后续 submit 零新写', async source => {
    const fixture = setup()
    const result: PluginActionResult = { status: 'applied', changed: true, permissionChanges: [] }
    fixture.storage.removeItem = vi.fn(() => { throw new Error('storage clear denied') })
    if (source === 'recover') fixture.remote.setPluginEnabled.mockRejectedValue(new Error('disconnected'))
    else fixture.remote.setPluginEnabled.mockResolvedValue(result)
    await fixture.owner.submit(inventoryFixture.items[0]!, 'disable')
    const pointer = fixture.view().pointer!
    expect(pointer).toBeDefined()
    if (source === 'recover') {
      fixture.remote.pluginActionRecover.mockResolvedValue({ status: 'found', stage: 'settled', receipt: result, result })
      await fixture.owner.recheck()
    }
    expect(fixture.storage.removeItem).toHaveBeenCalledTimes(1)
    expect(fixture.view().result).toEqual(result)
    expect(fixture.view().pointer).toEqual(pointer)
    expect(fixture.store.read(helloFixture.environmentId)).toEqual(pointer)
    expect(fixture.view().busy).toBe(true)
    expect(fixture.view().feedback.status).toBe('unknown')
    expect(fixture.view().feedback.message).toContain('本地指针未能安全清除')
    await fixture.owner.submit(inventoryFixture.items[0]!, 'enable')
    await fixture.owner.submit(inventoryFixture.items[0]!, 'remove')
    expect(fixture.remote.setPluginEnabled).toHaveBeenCalledTimes(1)
    expect(fixture.remote.removePlugin).not.toHaveBeenCalled()
    expect(fixture.remote.pluginActionRecover).toHaveBeenCalledTimes(source === 'recover' ? 1 : 0)
    expect(fixture.refresh).not.toHaveBeenCalled()
    expect(fixture.view().result).toEqual(result)
    expect(fixture.view().pointer).toEqual(pointer)
    expect(fixture.view().busy).toBe(true)
  })
})
