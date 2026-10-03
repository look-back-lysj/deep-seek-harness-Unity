import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarketDataController } from '../../packages/market/src/client/data-controller.ts'
import type { MarketRemote } from '../../packages/market/src/client/model.ts'
import type { EnvironmentHello, InventorySnapshot, TaskState } from '@dsh-eac/market-core/contracts'
import { remoteFacade } from '../../packages/market/src/client/activation.ts'
import { catalogFixture, helloFixture, inventoryFixture, readOnlyRemote, taskFixture } from './fixtures.ts'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
const controllers: MarketDataController[] = []
function controller(remote: MarketRemote, options = {}) { const value = new MarketDataController(remote, options); controllers.push(value); return value }
afterEach(() => { controllers.forEach((item) => item.stop()); controllers.length = 0; vi.useRealTimers() })
function ready(value: MarketDataController) { const state = value.snapshot().state; if (state.status !== 'ready') throw new Error('expected ready'); return state }

describe('REV-10 bounded client data lifecycle', () => {
  it.each(['1.9.9', '3.0.0', '2.0.0-rc.1', 'invalid', '02.0.0'])('首次hello协议%s不兼容时不读取可操作旧状态', async (protocolVersion) => {
    const remote = {
      ...readOnlyRemote(), hello: async () => ({ ...helloFixture, protocolVersion }),
      catalog: vi.fn(async () => catalogFixture), inventory: vi.fn(async () => inventoryFixture), listTasks: vi.fn(async () => []),
    }
    const data = controller(remote)
    await data.start()
    expect(data.snapshot()).toMatchObject({ state: { status: 'error', message: expect.stringContaining('刷新') }, paused: true })
    expect(remote.catalog).not.toHaveBeenCalled()
    expect(remote.inventory).not.toHaveBeenCalled()
    expect(remote.listTasks).not.toHaveBeenCalled()
  })

  it.each(['1.0.0', '3.0.0', 'invalid'])('同步发现协议%s不兼容时撤掉ready状态并暂停', async (protocolVersion) => {
    vi.useFakeTimers()
    let hello = helloFixture
    const listTasks = vi.fn(async () => [])
    const data = controller({ ...readOnlyRemote(), hello: async () => hello, listTasks })
    await data.start()
    expect(data.snapshot().state.status).toBe('ready')
    hello = { ...helloFixture, protocolVersion }
    await data.sync()
    expect(data.snapshot()).toMatchObject({ state: { status: 'error', message: expect.stringContaining('刷新') }, paused: true })
    expect(listTasks).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(listTasks).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('协议不兼容使在途库存和目录回包失效；修复后可重新读取', async () => {
    let hello = helloFixture
    const pendingInventory = deferred<InventorySnapshot>()
    const pendingCatalog = deferred<{ status: 'refreshed'; current: typeof catalogFixture }>()
    const inventory = vi.fn().mockResolvedValueOnce(inventoryFixture).mockReturnValueOnce(pendingInventory.promise).mockResolvedValue(inventoryFixture)
    const data = controller({ ...readOnlyRemote(), hello: async () => hello, inventory, refreshCatalog: () => pendingCatalog.promise })
    await data.start()
    const inventoryRead = data.refreshInventory()
    const catalogRead = expect(data.refreshCatalog()).rejects.toThrow('请求已失效')
    hello = { ...helloFixture, protocolVersion: '3.0.0' }
    await data.sync()
    pendingInventory.resolve({ ...inventoryFixture, revision: 'test-late' })
    pendingCatalog.resolve({ status: 'refreshed', current: { ...catalogFixture, revision: 'test-late' } })
    await inventoryRead; await catalogRead
    data.acceptTask(taskFixture())
    expect(data.snapshot().state.status).toBe('error')
    hello = helloFixture
    await data.sync(true)
    expect(ready(data).inventory.revision).toBe(inventoryFixture.revision)
    expect(ready(data).catalog.revision).toBe(catalogFixture.revision)
  })

  it('hello声明不兼容核心API时，首次加载与同步均禁用旧状态', async () => {
    let hello: EnvironmentHello = { ...helloFixture, coreApiVersion: '2.0.0' }
    const data = controller({ ...readOnlyRemote(), hello: async () => hello })
    await data.start()
    expect(data.snapshot()).toMatchObject({ state: { status: 'error', message: expect.stringContaining('核心接口不兼容') } })
    hello = { ...helloFixture, coreApiVersion: '1.1.0' }
    await data.start()
    expect(data.snapshot().state.status).toBe('ready')
    hello = { ...helloFixture, coreApiVersion: 'invalid' }
    await data.sync()
    expect(data.snapshot()).toMatchObject({ state: { status: 'error', message: expect.stringContaining('刷新') }, paused: true })
  })

  it('真实facade首次加载和同步均为只读；hello可选核心字段缺失不要求写握手', async () => {
    const clientConnect = vi.fn(async () => { throw new Error('只读流程不得协商写入') })
    const raw = {
      hello: vi.fn(async () => ({ ok: true, value: helloFixture })),
      catalog: async () => ({ ok: true, value: catalogFixture }),
      inventory: async () => ({ ok: true, value: inventoryFixture }),
      taskList: async () => ({ ok: true, value: [] }), clientConnect,
    }
    const data = controller(remoteFacade(raw))
    await data.start(); await data.sync()
    expect(data.snapshot().state.status).toBe('ready')
    expect(raw.hello).toHaveBeenCalledTimes(2)
    expect(clientConnect).not.toHaveBeenCalled()
  })

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
  it('目录刷新可按已登记来源指定sourceId，并用后端返回快照更新页面', async () => {
    const current = { ...catalogFixture, revision: 'agent-forge:source-revision' }
    const refreshCatalog = vi.fn(async (_request?: { readonly sourceId?: string }) => ({ status: 'refreshed' as const, current }))
    const data = controller({ ...readOnlyRemote(), refreshCatalog })
    await data.start()
    await expect(data.refreshCatalog({ sourceId: 'agent-forge-main' })).resolves.toMatchObject({ status: 'refreshed' })
    expect(refreshCatalog).toHaveBeenCalledExactlyOnceWith({ sourceId: 'agent-forge-main' })
    expect(ready(data).catalog.revision).toBe('agent-forge:source-revision')
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
