import { useEffect, useMemo, useState } from 'react'
import type { CatalogRefreshRequest, CatalogRefreshView, InventorySnapshot, TaskState } from '@dsh-eac/market-core/contracts'
import { assertCompatibleHello, ClientCompatibilityError, isTaskSettled, taskStateIsNewer, type LoadState, type MarketRemote } from './model.ts'

export class RequestTimeout extends Error {}

/** A timeout stops waiting, never asserts that a remote write was cancelled. */
export async function boundedRequest<T>(request: Promise<T>, label: string, timeoutMs = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RequestTimeout(`${label}超时。尚不能确认后台结果，请重新读取状态。`)), timeoutMs)
    })])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}

type Ready = Extract<LoadState, { status: 'ready' }>
export interface DataView {
  readonly state: LoadState
  readonly notice: string
  readonly paused: boolean
}
interface Options { timeoutMs?: number; pollMs?: number; idleMs?: number; maxPolls?: number }

/** One lifecycle owns the reads. React renders cannot dispose a terminal inventory refresh.
 * Reads are serial, bounded and environment-scoped. listTasks also discovers other tabs' work.
 * On timeout we stop automatic reads instead of stacking requests against a stalled Host.
 */
export class MarketDataController {
  private view: DataView = { state: { status: 'loading' }, notice: '', paused: false }
  private listeners = new Set<(view: DataView) => void>()
  private epoch = 0
  private stopped = true
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | undefined
  private inventoryRun: Promise<void> | undefined
  private inventoryVersion = 0
  private needsInventory = false
  private cycles = 0
  private failures = 0
  private hidden = false
  private refreshVersion = 0
  private readonly config: Required<Options>

  constructor(readonly remote: MarketRemote, options: Options = {}) {
    this.config = { timeoutMs: 12_000, pollMs: 1_500, idleMs: 12_000, maxPolls: 160, ...options }
  }
  snapshot(): DataView { return this.view }
  subscribe(listener: (view: DataView) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(next: Partial<DataView>): void {
    if (this.stopped) return
    this.view = { ...this.view, ...next }
    this.listeners.forEach((listener) => listener(this.view))
  }
  private read<T>(promise: Promise<T>, label: string): Promise<T> {
    return boundedRequest(promise, label, this.config.timeoutMs)
  }
  async start(): Promise<void> {
    this.stopped = false
    const epoch = ++this.epoch
    this.cycles = 0
    this.failures = 0
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.publish({ state: { status: 'loading' }, notice: '', paused: false })
    try {
      const hello = await this.read(this.remote.hello(), '环境读取')
      assertCompatibleHello(hello)
      const catalog = await this.read(this.remote.catalog(), '目录读取')
      const inventory = await this.read(this.remote.inventory(), '插件状态读取')
      const tasks = await this.read(this.remote.listTasks?.() ?? Promise.resolve([]), '任务读取')
      if (this.stopped || epoch !== this.epoch) return
      if (inventory.environmentId !== hello.environmentId) throw new Error('环境已变化，请重新打开市场后核对。')
      this.publish({ state: { status: 'ready', hello, catalog, inventory, tasks: tasks.filter((task) => task.environmentId === hello.environmentId) } })
      this.schedule()
    } catch (error) {
      if (epoch === this.epoch) this.publish({ state: { status: 'error', message: String(error instanceof Error ? error.message : error) }, paused: true })
    }
  }
  stop(): void {
    this.stopped = true
    this.epoch += 1
    this.refreshVersion += 1
    if (this.timer !== undefined) clearTimeout(this.timer)
  }
  setHidden(hidden: boolean): void { this.hidden = hidden }
  private ready(): Ready | undefined { return this.view.state.status === 'ready' ? this.view.state : undefined }
  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.stopped || this.view.paused || this.ready() === undefined) return
    if (this.cycles >= this.config.maxPolls) {
      this.publish({ paused: true, notice: '已暂停长时间自动同步。点击重新读取，或回到此面板继续核对。' })
      return
    }
    const active = this.ready()?.tasks.some((task) => !isTaskSettled(task))
    this.timer = setTimeout(() => { void this.sync() }, !this.hidden && active ? this.config.pollMs : this.config.idleMs)
  }
  async sync(manual = false): Promise<void> {
    if (this.stopped) return
    if (manual) { this.cycles = 0; this.failures = 0; this.publish({ paused: false, notice: '' }) }
    if (this.running !== undefined) return this.running
    if (this.ready() === undefined) return this.start()
    const epoch = this.epoch
    this.running = (async () => {
      try {
        this.cycles += 1
        const hello = await this.read(this.remote.hello(), '环境核对')
        if (this.stopped || epoch !== this.epoch) return
        assertCompatibleHello(hello)
        if (hello.environmentId !== this.ready()?.hello.environmentId) {
          // Never leave old-environment action buttons operable after host/profile changes.
          this.epoch += 1
          this.publish({ state: { status: 'error', message: '运行环境已切换，请重新读取后再操作。' }, paused: true })
          return
        }
        if (this.remote.listTasks !== undefined) {
          const tasks = await this.read(this.remote.listTasks(), '任务同步')
          if (this.stopped || epoch !== this.epoch) return
          for (const task of tasks) this.mergeTask(task)
        } else if (this.remote.getTask !== undefined) {
          for (const known of (this.ready()?.tasks ?? []).filter((task) => !isTaskSettled(task)).slice(0, 16)) {
            const task = await this.read(this.remote.getTask({ taskId: known.taskId }), '任务同步')
            if (this.stopped || epoch !== this.epoch) return
            if (task.taskId === known.taskId) this.mergeTask(task)
          }
        }
        if (manual) this.markInventoryDirty()
        if (this.needsInventory) await this.flushInventory()
        this.failures = 0
      } catch (error) {
        if (epoch !== this.epoch) return
        if (error instanceof ClientCompatibilityError) {
          // 协议变化不能当作临时读取失败：撤掉可操作旧状态，
          // 并使仍在等待的旧回包失效，避免重新展示旧操作入口。
          this.epoch += 1
          this.publish({ state: { status: 'error', message: error.message }, notice: '', paused: true })
          return
        }
        this.failures += 1
        this.publish({ notice: `同步失败，保留上次状态：${error instanceof Error ? error.message : String(error)}`, paused: error instanceof RequestTimeout || this.failures >= 3 })
      }
    })()
    try { await this.running } finally { this.running = undefined; this.schedule() }
  }
  private markInventoryDirty(): void { this.needsInventory = true; this.inventoryVersion += 1 }
  private mergeTask(task: TaskState): boolean {
    const ready = this.ready()
    if (ready === undefined || task.environmentId !== ready.hello.environmentId) return false
    const current = ready.tasks.find((item) => item.taskId === task.taskId)
    if (!taskStateIsNewer(current, task)) return false
    this.publish({ state: { ...ready, tasks: current === undefined ? [...ready.tasks, task] : ready.tasks.map((item) => item.taskId === task.taskId ? task : item) } })
    // Includes a task that is already terminal when startTask returns, and paused/restart outcomes.
    if (isTaskSettled(task) || task.items.some((item) => item.changed)) this.markInventoryDirty()
    return true
  }
  acceptTask(task: TaskState): void {
    if (this.stopped || !this.mergeTask(task)) return
    if (this.needsInventory) void this.refreshInventory(false).catch(() => { /* notice is set by refreshInventory */ })
    this.schedule()
  }
  async refreshInventory(markDirty = true): Promise<void> {
    if (markDirty) this.markInventoryDirty()
    try { await this.flushInventory() }
    catch (error) {
      this.publish({ notice: `插件状态尚未刷新：${error instanceof Error ? error.message : String(error)}`, paused: error instanceof RequestTimeout })
      throw error
    }
  }
  private async flushInventory(): Promise<void> {
    if (this.inventoryRun !== undefined) return this.inventoryRun
    const epoch = this.epoch
    this.inventoryRun = (async () => {
      // A new terminal result while reading invalidates the older inventory response.
      // Retry at most twice here; the next serial polling pass handles further activity.
      for (let attempt = 0; attempt < 2 && this.needsInventory; attempt += 1) {
        const version = this.inventoryVersion
        const inventory: InventorySnapshot = await this.read(this.remote.inventory(), '插件状态读取')
        const ready = this.ready()
        if (this.stopped || epoch !== this.epoch || ready === undefined) return
        if (inventory.environmentId !== ready.hello.environmentId) throw new Error('返回的插件状态属于另一环境，已拒绝更新。')
        if (version !== this.inventoryVersion) continue
        this.needsInventory = false
        this.publish({ state: { ...ready, inventory }, notice: '' })
      }
    })()
    try { await this.inventoryRun } finally { this.inventoryRun = undefined }
  }
  async refreshCatalog(request?: CatalogRefreshRequest): Promise<CatalogRefreshView> {
    if (this.remote.refreshCatalog === undefined) throw new Error('当前宿主没有目录刷新能力。')
    const version = ++this.refreshVersion
    const epoch = this.epoch
    const result = await this.read(request === undefined ? this.remote.refreshCatalog() : this.remote.refreshCatalog(request), '目录刷新')
    const ready = this.ready()
    if (this.stopped || epoch !== this.epoch || version !== this.refreshVersion || ready === undefined) throw new Error('目录请求已失效，请重新读取。')
    this.publish({ state: { ...ready, catalog: result.current } })
    return result
  }

  async recheckCatalog(): Promise<void> {
    const version = ++this.refreshVersion
    const epoch = this.epoch
    const catalog = await this.read(this.remote.catalog(), '目录状态读取')
    const ready = this.ready()
    if (this.stopped || epoch !== this.epoch || version !== this.refreshVersion || ready === undefined) return
    this.publish({ state: { ...ready, catalog } })
  }
}

export function useMarketData(remote: MarketRemote): DataView & { controller: MarketDataController } {
  const controller = useMemo(() => new MarketDataController(remote), [remote])
  const [view, setView] = useState<DataView>(controller.snapshot())
  useEffect(() => {
    const unsubscribe = controller.subscribe(setView)
    void controller.start()
    const onFocus = (): void => { controller.setHidden(document.hidden); if (!document.hidden) void controller.sync(true) }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { unsubscribe(); controller.stop(); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [controller])
  return { ...view, controller }
}
