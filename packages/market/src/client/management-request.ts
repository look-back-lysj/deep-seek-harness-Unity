import type { InventoryItem, PluginActionResult } from '../types.ts'
import { failedActionFeedback, idleActionFeedback, pluginActionFeedbackState, preparingActionFeedback, runningActionFeedback, unknownActionFeedback, type ActionFeedbackState } from './action-state.ts'
import { boundedRequest } from './data-controller.ts'
import { assertCompatibleHello, createIdempotencyKey, type MarketRemote } from './model.ts'
import { ManagementPointerStore, type ManagementPointer } from './management-pointer.ts'
import { TaskRequestGuard } from './task-request-guard.ts'

export interface ManagementView {
  readonly feedback: ActionFeedbackState
  readonly busy: boolean
  readonly checking: boolean
  readonly pointer?: ManagementPointer | undefined
  readonly identity?: ManagementPointer | undefined
  readonly receipt?: PluginActionResult | undefined
  readonly result?: PluginActionResult | undefined
  readonly stage?: string | undefined
}

export const emptyManagementView = (): ManagementView => ({ feedback: idleActionFeedback(), busy: false, checking: false })
const actionLabel = (action: ManagementPointer['action']): string => action === 'remove' ? '卸载插件' : action === 'enable' ? '启用插件' : '停用插件'

function completeResult(value: unknown): value is PluginActionResult {
  if (!value || typeof value !== 'object') return false
  const result = value as PluginActionResult
  return ['applied', 'restart-required', 'failed', 'unknown'].includes(result.status)
    && typeof result.changed === 'boolean' && Array.isArray(result.permissionChanges)
    && result.permissionChanges.every(change => change && typeof change.packageName === 'string' && ['approved', 'revoked', 'already-approved'].includes(change.decision))
}

export class ManagementRequest {
  private readonly writes = new TaskRequestGuard()
  private readonly reads = new TaskRequestGuard()
  private view: ManagementView = emptyManagementView()
  private active = true

  constructor(
    private readonly remote: MarketRemote,
    private readonly environmentId: string,
    private readonly store: ManagementPointerStore,
    private readonly changed: (view: ManagementView) => void,
    private readonly refreshInventory: () => Promise<void>,
  ) {}

  private publish(patch: Partial<ManagementView>): void {
    if (!this.active) return
    this.view = { ...this.view, ...patch }
    this.changed(this.view)
  }

  private uncertain(message: string): void {
    this.publish({ busy: true, feedback: unknownActionFeedback(
      this.view.pointer ? actionLabel(this.view.pointer.action) : '插件管理', message,
      '核对原操作只读取原回执，不重发写入；当前库存与 not-found 都不能证明原操作完成或未执行。',
    ) })
  }

  restore(): void {
    try {
      const pointer = this.store.read(this.environmentId)
      if (!pointer) { this.publish(emptyManagementView()); return }
      this.publish({ pointer, identity: pointer })
      this.uncertain('已找回原管理操作身份，尚未确认后台结果。')
      void this.recheck()
    } catch {
      this.uncertain('无法读取可靠的原管理指针。为避免重复写入，已停止新管理操作；请到官方插件页核对。')
    }
  }

  async submit(item: InventoryItem, action: ManagementPointer['action']): Promise<void> {
    if (!this.active || this.view.busy) return
    const ticket = this.writes.begin()
    if (!ticket) return
    const label = actionLabel(action)
    this.publish({ busy: true, identity: undefined, receipt: undefined, result: undefined, stage: undefined, feedback: preparingActionFeedback(label) })
    let dispatched = false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const hello = await boundedRequest(this.remote.hello(), '写入前核对环境')
      if (!this.active || !this.writes.accepts(ticket)) return
      assertCompatibleHello(hello)
      if (hello.environmentId !== this.environmentId) throw new Error('环境已变化，未提交插件管理操作。')
      if (action === 'remove' ? !this.remote.removePlugin : !this.remote.setPluginEnabled) throw new Error('当前 Host 未开放此管理方法，未提交操作；请使用官方插件页。')
      const existing = this.store.read(this.environmentId)
      if (existing) {
        this.publish({ pointer: existing, identity: existing })
        this.uncertain('此环境仍有原管理操作待核对，没有提交新的操作。')
        return
      }
      const pointer: ManagementPointer = {
        environmentId: this.environmentId, packageName: item.packageName, action,
        ...(item.version === undefined ? {} : { expectedVersion: item.version }),
        idempotencyKey: createIdempotencyKey('market-management'),
      }
      this.store.save(pointer)
      this.publish({ pointer, identity: pointer, receipt: undefined, result: undefined, stage: undefined, feedback: runningActionFeedback(label) })
      const { environmentId: _environmentId, action: _action, ...request } = pointer
      timer = setTimeout(() => {
        if (!this.active || !this.writes.accepts(ticket)) return
        this.writes.expire(ticket)
        this.uncertain('展示等待已超时，原请求仍可能执行中；原 Promise 未结束，不允许重复提交。')
      }, 20_000)
      dispatched = true
      const result = action === 'remove'
        ? await this.remote.removePlugin!({ ...request, confirmed: true })
        : await this.remote.setPluginEnabled!({ ...request, enabled: action === 'enable' })
      if (timer !== undefined) { clearTimeout(timer); timer = undefined }
      if (!this.active || !this.writes.accepts(ticket)) return
      const settledHello = await boundedRequest(this.remote.hello(), '回包环境核对')
      if (!this.active || !this.writes.accepts(ticket)) return
      assertCompatibleHello(settledHello)
      if (settledHello.environmentId !== this.environmentId) { this.uncertain('回包时连接环境已变化，保留原指针，不把旧结果应用到当前环境。'); return }
      if (this.active && this.writes.accepts(ticket)) await this.acceptResult(pointer, result)
    } catch {
      if (!this.active || !this.writes.accepts(ticket)) return
      if (dispatched) this.uncertain('提交后发生传输异常，无法确认原操作结果；不会自动新建 key 或重新写入。')
      else this.publish({ busy: false, feedback: failedActionFeedback(label, '写入前检查或指针保存失败，确定未提交管理请求。请核对宿主环境、管理能力和浏览器存储。', '修复连接或存储后，由你明确发起新操作；也可使用官方插件页。', false) })
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (this.writes.finish(ticket) && this.active) this.publish({ busy: this.view.pointer !== undefined || this.view.feedback.status === 'unknown' })
    }
  }

  private async acceptResult(pointer: ManagementPointer, result: PluginActionResult): Promise<void> {
    if (!this.active || this.view.pointer?.idempotencyKey !== pointer.idempotencyKey) return
    if (!completeResult(result)) { this.uncertain('后台没有返回有效的完整业务结果；保留原身份和重复提交保护。'); return }
    this.publish({ result })
    if (result.status === 'unknown') { this.uncertain('原业务结果仍为 unknown，不能按成功或普通失败解除保护。'); return }
    try { this.store.clear(pointer) }
    catch { this.uncertain('后台已返回业务结果，但本地指针未能安全清除；保留原身份，停止新写入。'); return }
    this.publish({ pointer: undefined, busy: this.writes.pending, feedback: pluginActionFeedbackState(
      result, actionLabel(pointer.action), pointer.action === 'remove' ? '原卸载操作已返回完整业务结果；未额外清理独立配置、用户文件或未知目录。' : '原启停操作已返回完整业务结果。',
    ) })
    try { await this.refreshInventory() }
    catch {
      if (this.active && this.view.result === result) this.publish({ feedback: {
        ...this.view.feedback, nextStep: (this.view.feedback.nextStep ?? '') + ' 当前库存刷新失败；这不改变原业务回执。可使用页面“重新读取”核对当前事实。',
      } })
    }
  }

  async recheck(): Promise<void> {
    const pointer = this.view.pointer
    if (!this.active || !pointer) return
    const ticket = this.reads.begin()
    if (!ticket) return
    this.writes.stopAccepting()
    this.publish({ checking: true })
    try {
      const hello = await boundedRequest(this.remote.hello(), '核对原操作环境')
      if (!this.active || !this.reads.accepts(ticket)) return
      assertCompatibleHello(hello)
      if (hello.environmentId !== pointer.environmentId) { this.uncertain('连接环境已变化，未向另一环境查询原操作。请重新打开原环境。'); return }
      if (!hello.capabilities.includes('operation-recovery') || !this.remote.pluginActionRecover) {
        this.uncertain('当前 Host 未开放原管理操作查询能力；保留原身份，请到官方插件页核对，不会重发写入。')
        return
      }
      const { environmentId: _environmentId, ...request } = pointer
      const recovery = await boundedRequest(this.remote.pluginActionRecover(request), '核对原管理操作')
      if (!this.active || !this.reads.accepts(ticket)) return
      const settledHello = await boundedRequest(this.remote.hello(), '核对回包环境')
      if (!this.active || !this.reads.accepts(ticket)) return
      assertCompatibleHello(settledHello)
      if (settledHello.environmentId !== pointer.environmentId) { this.uncertain('查询期间连接环境已变化，保留原指针，不把旧结果应用到当前环境。'); return }
      if (recovery.status === 'not-found') { this.uncertain('没有找到原记录（not-found），这不证明未写入；保留原身份与重复提交保护。'); return }
      this.publish({ stage: recovery.stage, receipt: completeResult(recovery.receipt) ? recovery.receipt : undefined })
      if (!recovery.result) { this.uncertain('已找到官方管理记录，但缺少完整业务结果；官方阶段或回执不能证明维护业务完成。'); return }
      await this.acceptResult(pointer, recovery.result)
    } catch {
      if (this.active && this.reads.accepts(ticket)) this.uncertain('只读查询未能完成，原操作结果仍未知；不会重发写入。')
    } finally {
      if (this.reads.finish(ticket) && this.active) this.publish({ checking: false })
    }
  }

  dispose(): void {
    this.active = false
    this.writes.invalidate()
    this.reads.invalidate()
  }
}
