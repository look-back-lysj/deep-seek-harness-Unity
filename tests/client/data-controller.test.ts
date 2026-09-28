import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarketDataController } from '../../packages/market/src/client/data-controller.ts'
import type { MarketRemote } from '../../packages/market/src/client/model.ts'
import type { InventorySnapshot, TaskState } from '../../packages/market/src/types.ts'
import { catalogFixture, helloFixture, inventoryFixture, readOnlyRemote, taskFixture } from './fixtures.ts'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
const controllers: MarketDataController[] = []
function controller(remote: MarketRemote, options = {}) { const value = new MarketDataController(remote, options); controllers.push(value); return value }
afterEach(() => { controllers.forEach((item) => item.stop()); controllers.length = 0; vi.useRealTimers() })
function ready(value: MarketDataController) { const state = value.snapshot().state; if (state.status !== 'ready') throw new Error('expected ready'); return state }

describe('REV-10 bounded client data lifecycle', () => {
  it('startTask直接返回终态也会刷新同页库存', async () => {
    let inventory = { ...inventoryFixture, revision: 'before', items: [] }
    const remote = { ...readOnlyRemote(), inventory: vi.fn(async () => inventory), listTasks: async () => [] }
    const data = controller(remote); await data.start()
    inventory = { ...inventoryFixture, revision: 'after', items: [] }
    data.acceptTask(taskFixture({ status: 'completed' }))
    await data.refreshInventory(false)
    expect(ready(data).inventory.revision).toBe('after')
    expect(remote.inventory).toHaveBeenCalledTimes(2)
  })
  it('没有已知任务时也能恢复其他标签的任务，并刷新终态库存', async () => {
    let tasks: readonly TaskState[] = []
    const read = vi.fn(async () => inventoryFixture)
    const data = controller({ ...readOnlyRemote(), listTasks: async () => tasks, inventory: read })
    await data.start()
    tasks = [taskFixture({ taskId: 'other-tab', status: 'completed' })]
    await data.sync()
    expect(ready(data).tasks[0]?.taskId).toBe('other-tab')
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('旧task列表不会把完成态退回安装中，跨环境任务被拒绝', async () => {
    let tasks: readonly TaskState[] = []
    const data = controller({ ...readOnlyRemote(), listTasks: async () => tasks }); await data.start()
    data.acceptTask(taskFixture({ status: 'completed', updatedAt: '2026-09-28T00:02:00Z' }))
    tasks = [taskFixture({ status: 'installing', updatedAt: '2026-09-28T00:01:00Z' }), taskFixture({ taskId: 'foreign', environmentId: 'another' })]
    await data.sync()
    expect(ready(data).tasks).toHaveLength(1)
    expect(ready(data).tasks[0]?.status).toBe('completed')
  })
  it('库存读取中出现新的完成任务时，旧回包不能覆盖新的状态', async () => {
    const stale = deferred<InventorySnapshot>()
    const fresh = deferred<InventorySnapshot>()
    const read = vi.fn().mockResolvedValueOnce(inventoryFixture).mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)
    const data = controller({ ...readOnlyRemote(), inventory: read, listTasks: async () => [] }); await data.start()
    data.acceptTask(taskFixture({ taskId: 'A', status: 'completed' }))
    data.acceptTask(taskFixture({ taskId: 'B', status: 'completed' }))
    stale.resolve({ ...inventoryFixture, revision: 'stale' })
    await Promise.resolve(); await Promise.resolve()
    expect(ready(data).inventory.revision).not.toBe('stale')
    fresh.resolve({ ...inventoryFixture, revision: 'fresh' }); await data.refreshInventory(false)
    expect(ready(data).inventory.revision).toBe('fresh')
  })
  it('超时后暂停轮询且迟到回包不覆写，卸载清理定时器', async () => {
    vi.useFakeTimers()
    const late = deferred<readonly TaskState[]>()
    const listTasks = vi.fn().mockResolvedValueOnce([]).mockReturnValue(late.promise)
    const data = controller({ ...readOnlyRemote(), listTasks }, { timeoutMs: 30, idleMs: 10, maxPolls: 5 }); await data.start()
    await vi.advanceTimersByTimeAsync(45)
    expect(data.snapshot().paused).toBe(true)
    late.resolve([taskFixture()]); await vi.advanceTimersByTimeAsync(100)
    expect(ready(data).tasks).toEqual([])
    expect(listTasks).toHaveBeenCalledTimes(2)
    data.stop(); expect(vi.getTimerCount()).toBe(0)
  })
  it('旧controller结束后不能更新，环境变化关闭旧对象操作', async () => {
    const pending = deferred<InventorySnapshot>()
    const data = controller({ ...readOnlyRemote(), inventory: vi.fn().mockResolvedValueOnce(inventoryFixture).mockReturnValueOnce(pending.promise) }); await data.start()
    const refresh = data.refreshInventory(); data.stop(); pending.resolve({ ...inventoryFixture, revision: 'late' }); await refresh
    expect(ready(data).inventory.revision).not.toBe('late')
    let hello = helloFixture
    const next = controller({ ...readOnlyRemote(), hello: async () => hello }); await next.start()
    hello = { ...hello, environmentId: 'new-profile' }; await next.sync()
    expect(next.snapshot().state.status).toBe('error')
  })
  it('刷新失败保留后台旧缓存与失败原因，不能产生成功提示', async () => {
    const failure = { status: 'failed' as const, current: { ...catalogFixture, revision: 'cached', stale: true }, reason: '来源离线' }
    const data = controller({ ...readOnlyRemote(), refreshCatalog: async () => failure }); await data.start()
    expect(await data.refreshCatalog()).toEqual(failure)
    expect(ready(data).catalog.revision).toBe('cached')
  })
  it('相同轮询只发一个请求，达到上限停止并可显式恢复', async () => {
    vi.useFakeTimers()
    const data = controller(readOnlyRemote(), { idleMs: 10, maxPolls: 2 }); await data.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(data.snapshot().paused).toBe(true)
    await data.sync(true)
    expect(data.snapshot().paused).toBe(false)
  })
})
