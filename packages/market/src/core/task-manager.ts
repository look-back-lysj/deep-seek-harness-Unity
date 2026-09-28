/**
 * Profile-serial install task runner.
 *
 * The manager persists intent before any write, rechecks state immediately
 * before every Host write, and never maps an absent/unknown Host result to
 * success. Synthetic ports are valid test inputs but never become proof of an
 * official install.
 */
import type {
  ApprovalChallenge,
  InventoryItem,
  InventorySnapshot,
  ResumeChallenge,
  TaskApprovalRequest,
  TaskCancelRequest,
  TaskEvent,
  TaskItemResult,
  TaskItemStatus,
  TaskResumeRequest,
  TaskStartRequest,
  TaskState,
  TaskStatus,
} from '../contracts/types.ts'
import { canonicalJson, pendingBuildsDigest, sha256Hex } from './canonical.ts'
import { MarketCoreError } from './errors.ts'
import type {
  ArtifactAcquisition,
  ArtifactPort,
  EventLogPage,
  HostInstallOutcome,
  HostPort,
  HostReadState,
  PlanBundle,
  ProfileLockPort,
  TaskAttemptRecord,
  TaskEventLogPort,
  TaskItemFact,
  TaskRecord,
  TaskStorePort,
} from './ports.ts'
import { verifyPlanBundle } from './planner.ts'

const SUCCESS_ITEM_STATUS: ReadonlySet<TaskItemStatus> = new Set([
  'installed', 'enabled', 'disabled', 'restart-required',
])
const ACTIVE_ITEM_STATUS: ReadonlySet<TaskItemStatus> = new Set([
  'pending', 'downloading', 'verifying', 'installing', 'blocked-on-restart',
])
const TERMINAL_TASK_STATUS: ReadonlySet<TaskStatus> = new Set([
  'completed', 'partial', 'failed', 'cancelled', 'needs-attention', 'unknown',
])

export interface TaskManagerDeps {
  readonly host: HostPort
  readonly artifacts: ArtifactPort
  readonly store: TaskStorePort
  readonly locks: ProfileLockPort
  readonly events?: TaskEventLogPort
  readonly owner?: string
  readonly now?: () => Date
  readonly maxEventHistory?: number
}

export interface TaskStartOutcome {
  readonly task: TaskState
  readonly created: boolean
}

class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.catch(() => undefined)
    return result
  }
}

function cloneState(state: TaskState): TaskState {
  return {
    ...state,
    items: state.items.map((item) => ({ ...item, permissionChanges: [...item.permissionChanges] })),
    events: state.events.map((event) => ({ ...event })),
    ...(state.approval === undefined ? {} : { approval: { ...state.approval, packages: [...state.approval.packages] } }),
    ...(state.resume === undefined ? {} : { resume: { ...state.resume, remainingPluginIds: [...state.resume.remainingPluginIds] } }),
  }
}

function mergeNonterminal(current: TaskRecord, incoming: TaskRecord): TaskRecord {
  const currentItems = new Map(current.task.items.map((item) => [item.pluginId, item]))
  const items = incoming.task.items.map((item) => {
    const prior = currentItems.get(item.pluginId)
    if (prior !== undefined && (prior.status === 'cancelled' || prior.status === 'failed' || prior.status === 'unknown')) return prior
    return item
  })
  const events = [...current.task.events, ...incoming.task.events]
    .filter((event, index, all) => all.findIndex((candidate) => candidate.sequence === event.sequence) === index)
    .sort((left, right) => left.sequence - right.sequence)
  return {
    ...cloneRecord(incoming),
    task: { ...cloneState(incoming.task), items, events },
    idempotency: { ...current.idempotency, ...incoming.idempotency },
    approvalIdempotency: { ...current.approvalIdempotency, ...incoming.approvalIdempotency },
    resumeIdempotency: { ...current.resumeIdempotency, ...incoming.resumeIdempotency },
    cancellationRequested: current.cancellationRequested || incoming.cancellationRequested,
    nextSequence: Math.max(current.nextSequence, incoming.nextSequence),
  }
}

function cloneRecord(record: TaskRecord): TaskRecord {
  return {
    ...record,
    task: cloneState(record.task),
    bundle: {
      ...record.bundle,
      plan: { ...record.bundle.plan, items: record.bundle.plan.items.map((item) => ({ ...item, blockers: [...item.blockers] })) },
      steps: record.bundle.steps.map((step) => ({ ...step })),
      dependencies: record.bundle.dependencies.map((edge) => ({ ...edge })),
      expected: record.bundle.expected.map((item) => ({ ...item })),
    },
    baseline: {
      ...record.baseline,
      items: record.baseline.items.map((item) => ({ ...item, rows: item.rows.map((row) => ({ ...row })) })),
      unknownItems: [...record.baseline.unknownItems],
    },
    itemFacts: Object.fromEntries(Object.entries(record.itemFacts).map(([key, value]) => [key, { ...value }])),
    attempts: record.attempts.map((attempt) => ({
      ...attempt,
      ...(attempt.pendingBuilds === undefined ? {} : { pendingBuilds: [...attempt.pendingBuilds] }),
      ...(attempt.approvedBuilds === undefined ? {} : { approvedBuilds: [...attempt.approvedBuilds] }),
      ...(attempt.artifact === undefined ? {} : { artifact: { ...attempt.artifact } }),
    })),
    idempotency: { ...record.idempotency },
    approvalIdempotency: { ...record.approvalIdempotency },
    resumeIdempotency: { ...record.resumeIdempotency },
    ...(record.activeRequestId === undefined ? {} : { activeRequestId: record.activeRequestId }),
  }
}

function itemResult(item: PlanBundle['plan']['items'][number]): TaskItemResult {
  return {
    pluginId: item.pluginId,
    packageName: item.packageName,
    targetVersion: item.targetVersion,
    status: item.action === 'blocked' ? 'failed' : 'pending',
    changed: false,
    installOutcome: item.action === 'blocked' ? 'failed' : 'unknown',
    permissionChanges: [],
    ...(item.action === 'blocked' ? { error: item.blockers.join(','), packageResultCode: 'plan-blocked' } : {}),
  }
}

function makeFacts(bundle: PlanBundle): Record<string, TaskItemFact> {
  return Object.fromEntries(bundle.expected.map((item) => [item.pluginId, {
    installed: item.version !== undefined,
    active: item.enabled && item.version !== undefined,
  }]))
}

function packageItem(inventory: InventorySnapshot, packageName: string): InventoryItem | undefined {
  return inventory.items.find((item) => item.packageName === packageName)
}

function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUS.has(status)
}

function statusAfterItems(items: readonly TaskItemResult[], cancellationRequested: boolean): TaskStatus {
  if (items.some((item) => item.status === 'unknown')) return 'needs-attention'
  const succeeded = items.some((item) => SUCCESS_ITEM_STATUS.has(item.status))
  const pending = items.some((item) => ACTIVE_ITEM_STATUS.has(item.status))
  const failed = items.some((item) => item.status === 'failed')
  const blocked = items.some((item) => item.status === 'blocked-by-dependency')
  const cancelled = items.some((item) => item.status === 'cancelled')
  const restart = items.some((item) => item.status === 'restart-required' || item.status === 'blocked-on-restart')
  if (pending) return restart ? 'awaiting-resume' : (cancellationRequested ? 'cancelling' : 'queued')
  if (restart) return 'awaiting-resume'
  if (succeeded && (failed || blocked || cancelled)) return 'partial'
  if (failed || blocked) return 'failed'
  if (cancelled) return 'cancelled'
  return 'completed'
}

function nextActionFor(status: TaskStatus, items: readonly TaskItemResult[]): string {
  if (status === 'awaiting-approval') return 'review-build-approval'
  if (status === 'awaiting-resume') return 'review-restart-and-resume'
  if (status === 'cancelling') return 'waiting-for-cancellation-result'
  if (status === 'needs-attention') return 'reconcile-before-retrying'
  if (status === 'partial') return 'review-partial-results'
  if (status === 'completed') return 'open-plugin-or-settings'
  if (status === 'cancelled') return 'review-cancelled-items'
  return items.some((item) => item.status === 'failed') ? 'review-failure' : 'waiting'
}

export class InstallTaskManager {
  private readonly queues = new Map<string, SerialQueue>()
  private readonly owner: string
  private readonly now: () => Date
  private readonly maxEventHistory: number

  constructor(private readonly deps: TaskManagerDeps) {
    this.owner = deps.owner ?? 'market-task-manager'
    this.now = deps.now ?? (() => new Date())
    this.maxEventHistory = deps.maxEventHistory ?? 200
  }

  /** Mark in-memory-only work left by a previous process for explicit reconciliation. */
  async reconcileInterrupted(environmentId: string): Promise<number> {
    return this.withLock(environmentId, async () => {
      const state = await this.deps.host.readState()
      let changed = 0
      for (const stored of await this.deps.store.list(environmentId)) {
        const active = ['queued', 'downloading', 'verifying', 'installing', 'applying', 'checking', 'cancelling']
        if (stored.task.status === 'awaiting-resume') {
          await this.prepareResumeLocked(stored)
          continue
        }
        if (!active.includes(stored.task.status)) continue
        let next = cloneRecord(stored)
        if (!state.activity.stable || state.activity.unknownSharedImpact) {
          next = await this.appendEvent(next, 'needs-attention', state.activity.reason ?? '恢复时无法证明旧包管理进程已停止', 'error')
          next = { ...next, task: { ...cloneState(next.task), status: 'needs-attention', nextAction: nextActionFor('needs-attention', next.task.items) } }
        } else {
          next = await this.appendEvent(next, 'interrupted', '检测到上次进程退出；磁盘状态需核对后才能继续', 'warning')
          next = { ...next, task: { ...cloneState(next.task), status: 'interrupted', nextAction: 'reconcile-before-retrying' } }
        }
        next = await this.save(next)
        changed += 1
        if (next.task.status === 'interrupted') await this.prepareResumeLocked(next)
      }
      return changed
    })
  }

  private queue(environmentId: string): SerialQueue {
    const queue = this.queues.get(environmentId) ?? new SerialQueue()
    this.queues.set(environmentId, queue)
    return queue
  }

  private async withLock<T>(environmentId: string, operation: () => Promise<T>): Promise<T> {
    const handle = await this.deps.locks.acquire(`profile:${environmentId}`, this.owner)
    try {
      return await operation()
    } finally {
      await handle.release()
    }
  }

  private async withLockFromTask<T>(taskId: string, operation: (record: TaskRecord) => Promise<T>): Promise<T> {
    const record = await this.deps.store.get(taskId)
    if (record === undefined) throw new MarketCoreError('task/not-found', '任务不存在', { nextAction: 'refresh-tasks' })
    return this.withLock(record.task.environmentId, () => operation(record))
  }

  private async appendEvent(record: TaskRecord, phase: TaskStatus, message: string, level: TaskEvent['level'], pluginId?: string): Promise<TaskRecord> {
    let persisted = await this.deps.store.get(record.task.taskId)
    if (persisted !== undefined && isTerminal(persisted.task.status) && (!isTerminal(record.task.status) || persisted.nextSequence > record.nextSequence)) {
      return cloneRecord(persisted)
    }
    if (persisted !== undefined && !isTerminal(persisted.task.status) && (persisted.nextSequence > record.nextSequence || persisted.cancellationRequested)) {
      record = mergeNonterminal(persisted, record)
    }
    const event: TaskEvent = {
      sequence: record.nextSequence,
      at: this.now().toISOString(),
      phase,
      message,
      level,
      ...(pluginId === undefined ? {} : { pluginId }),
    }
    if (this.deps.events !== undefined) await this.deps.events.append(record.task.taskId, event)
    const task: TaskState = {
      ...cloneState(record.task),
      events: [...record.task.events, event].slice(-this.maxEventHistory),
      updatedAt: event.at,
    }
    return { ...cloneRecord(record), task, nextSequence: record.nextSequence + 1 }
  }

  private async save(record: TaskRecord): Promise<TaskRecord> {
    const current = await this.deps.store.get(record.task.taskId)
    if (current !== undefined && isTerminal(current.task.status) && (!isTerminal(record.task.status) || current.nextSequence > record.nextSequence)) {
      return cloneRecord(current)
    }
    const next = current === undefined || isTerminal(current.task.status)
      ? cloneRecord(record)
      : mergeNonterminal(current, record)
    await this.deps.store.put(next)
    return next
  }

  async start(bundle: PlanBundle, request: TaskStartRequest, baseline: HostReadState): Promise<TaskStartOutcome> {
    if (!await verifyPlanBundle(bundle)) {
      throw new MarketCoreError('plan/digest-mismatch', '计划摘要与内容不一致', { nextAction: 'create-a-new-plan' })
    }
    if (request.planId !== bundle.plan.planId || request.planDigest !== bundle.plan.planDigest) {
      throw new MarketCoreError('plan/confirmation-mismatch', '确认的计划与 Host 保存的计划不一致', { nextAction: 'review-plan' })
    }
    if (Date.parse(bundle.plan.expiresAt) <= this.now().getTime()) {
      throw new MarketCoreError('plan/stale', '计划已过期，需要重新核对清单', { retryable: true, nextAction: 'create-a-new-plan' })
    }
    return this.withLock(bundle.plan.environmentId, async () => {
      const existing = await this.deps.store.getByPlan(bundle.plan.environmentId, bundle.plan.planId)
      if (existing !== undefined) {
        if (existing.task.planDigest !== request.planDigest) {
          throw new MarketCoreError('plan/conflict', '同一计划已有不同摘要的任务', { nextAction: 'review-plan' })
        }
        const prior = existing.idempotency[request.idempotencyKey]
        if (prior !== undefined && prior !== 'start') {
          throw new MarketCoreError('task/idempotency-conflict', '幂等键已用于其他操作', { nextAction: 'use-a-new-key' })
        }
        return { task: cloneState(existing.task), created: false }
      }
      const now = this.now()
      const taskId = `task-${(await sha256Hex(`${bundle.plan.environmentId}:${bundle.plan.planId}`)).slice(0, 32)}`
      const state: TaskState = {
        taskId,
        planId: bundle.plan.planId,
        planDigest: bundle.plan.planDigest,
        environmentId: bundle.plan.environmentId,
        status: 'queued',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        items: bundle.plan.items.map(itemResult),
        events: [],
        nextAction: 'queued',
      }
      const record: TaskRecord = {
        task: state,
        bundle,
        baseline: baseline.inventory,
        itemFacts: makeFacts(bundle),
        attempts: [],
        idempotency: { [request.idempotencyKey]: 'start' },
        approvalIdempotency: {},
        resumeIdempotency: {},
        attemptCounter: 0,
        nextSequence: 0,
        cancellationRequested: false,
        eventLogTruncated: false,
      }
      const withEvent = await this.appendEvent(record, 'queued', '任务已持久化，等待执行', 'info')
      await this.save(withEvent)
      void this.queue(bundle.plan.environmentId).enqueue(() => this.runTaskLockedId(taskId))
      return { task: cloneState(withEvent.task), created: true }
    })
  }

  async get(taskId: string): Promise<TaskState | undefined> {
    const record = await this.deps.store.get(taskId)
    return record === undefined ? undefined : cloneState(record.task)
  }

  async events(taskId: string, afterSequence = 0, limit = 100): Promise<EventLogPage> {
    if (this.deps.events !== undefined) return this.deps.events.read(taskId, afterSequence, limit)
    const record = await this.deps.store.get(taskId)
    return {
      events: record?.task.events.filter((event) => event.sequence > afterSequence).slice(0, limit) ?? [],
      nextSequence: record?.nextSequence ?? 0,
      truncated: record?.eventLogTruncated ?? false,
    }
  }

  async cancel(request: TaskCancelRequest): Promise<TaskState> {
    const initial = await this.deps.store.get(request.taskId)
    if (initial === undefined) throw new MarketCoreError('task/not-found', '任务不存在', { nextAction: 'refresh-tasks' })
    if (isTerminal(initial.task.status)) return cloneState(initial.task)
    const prior = initial.idempotency[request.idempotencyKey]
    if (prior !== undefined && prior !== 'cancel') {
      throw new MarketCoreError('task/idempotency-conflict', '幂等键已用于其他任务操作', { nextAction: 'use-a-new-key' })
    }
    // Cancellation must reach the official installer before waiting for the
    // market writer lock. A late install result cannot overwrite a terminal
    // cancellation because save/appendEvent re-read the persisted record.
    const cancellation = prior === undefined && initial.activeRequestId !== undefined
      ? await this.deps.host.cancel(initial.activeRequestId)
      : undefined
    return this.withLock(initial.task.environmentId, async () => {
      const record = await this.deps.store.get(request.taskId)
      if (record === undefined) throw new MarketCoreError('task/not-found', '任务不存在', { nextAction: 'refresh-tasks' })
      if (isTerminal(record.task.status)) return cloneState(record.task)
      let next = cloneRecord(record)
      if (prior === undefined) {
        next = {
          ...next,
          cancellationRequested: true,
          idempotency: { ...next.idempotency, [request.idempotencyKey]: 'cancel' },
        }
        next = await this.appendEvent(next, next.task.status, '收到取消申请，等待 Host 确认取消结论', 'warning')
        if (cancellation !== undefined) {
          next = await this.appendEvent(next, next.task.status, `取消结论：${cancellation.kind}`, cancellation.kind === 'unknown' ? 'error' : 'warning')
          if (cancellation.kind === 'cancelled') next = this.applyCancelToActive(next, cancellation.changed ?? false)
        } else if (next.activeRequestId === undefined) {
          next = this.applyCancelToActive(next, false)
        }
      }
      if (next.task.items.some((item) => item.status === 'cancelled') || (next.cancellationRequested && next.activeRequestId === undefined)) {
        next = this.finalize(next)
      }
      return cloneState((await this.save(next)).task)
    })
  }
  async approveBuilds(request: TaskApprovalRequest): Promise<TaskState> {
    return this.withLockFromTask(request.taskId, async (record) => {
      const replay = record.approvalIdempotency[request.idempotencyKey]
      if (replay !== undefined) {
        if (replay !== request.challengeId) throw new MarketCoreError('task/idempotency-conflict', '幂等键已用于其他批准操作', { nextAction: 'use-a-new-key' })
        return cloneState(record.task)
      }
      const attempt = record.attempts.find((candidate) => candidate.id === request.attemptId && candidate.phase === 'awaiting-approval')
      const challenge = record.task.approval
      if (attempt === undefined || challenge === undefined || challenge.id !== request.challengeId || challenge.attemptId !== request.attemptId) {
        throw new MarketCoreError('task/stale-approval', '批准挑战已失效或不属于当前尝试', { nextAction: 'refresh-task' })
      }
      const packages = [...request.approvedBuilds].sort()
      const digest = await pendingBuildsDigest(packages)
      const expected = [...challenge.packages].sort()
      if (digest !== request.pendingBuildsDigest || digest !== challenge.digest || packages.join('\n') !== expected.join('\n')) {
        throw new MarketCoreError('task/approval-mismatch', '批准清单与 Host 保存的挑战不一致', { nextAction: 'refresh-approval-list' })
      }
      let next: TaskRecord = {
        ...cloneRecord(record),
        attempts: record.attempts.map((candidate) => candidate.id === attempt.id ? {
          ...candidate,
          phase: 'approved',
          approvedBuilds: packages,
          approvedAt: this.now().toISOString(),
        } : candidate),
        approvalIdempotency: { ...record.approvalIdempotency, [request.idempotencyKey]: challenge.id },
        task: this.withoutApproval({ ...cloneState(record.task), status: 'installing', nextAction: 'resume-approved-install' }),
      }
      next = await this.appendEvent(next, 'installing', '精确构建脚本清单已批准，继续同一安装尝试', 'info', attempt.pluginId)
      await this.save(next)
      void this.queue(next.task.environmentId).enqueue(() => this.runTaskLockedId(request.taskId))
      return cloneState(next.task)
    })
  }

  async prepareResume(taskId: string): Promise<TaskState> {
    return this.withLockFromTask(taskId, (record) => this.prepareResumeLocked(record))
  }

  private async prepareResumeLocked(record: TaskRecord): Promise<TaskState> {
    const taskId = record.task.taskId
    if (record.task.status !== 'awaiting-resume' && record.task.status !== 'interrupted') return cloneState(record.task)
    const state = await this.deps.host.readState()
    record = this.refreshFacts(record, state.inventory)
      const remaining = record.task.items.filter((item) => !SUCCESS_ITEM_STATUS.has(item.status) && item.status !== 'cancelled' && item.status !== 'failed')
      const unresolvedDependency = remaining.some((item) => {
        const edge = record.bundle.dependencies.find((candidate) => candidate.consumerId === item.pluginId)
        return edge !== undefined && !this.edgeSatisfied(edge.prerequisiteId, edge.milestone, record)
      })
      if (!state.activity.stable || state.activity.unknownSharedImpact || unresolvedDependency) {
        const warned = await this.appendEvent(record, 'needs-attention', '重启后前置状态或活动写入尚不能证明安全', 'warning')
        const attention: TaskRecord = {
          ...warned,
          task: {
            ...cloneState(warned.task),
            status: 'needs-attention',
            nextAction: nextActionFor('needs-attention', warned.task.items),
          },
        }
        return cloneState((await this.save(attention)).task)
      }
      const remainingPluginIds = remaining.map((item) => item.pluginId)
      const digest = await sha256Hex(canonicalJson({
        taskId,
        environmentId: record.task.environmentId,
        remainingPluginIds: [...remainingPluginIds].sort(),
        sessionRevision: state.sessionRevision,
      }))
      const resume: ResumeChallenge = {
        id: `resume-${digest.slice(0, 24)}`,
        digest,
        remainingPluginIds,
        createdAt: this.now().toISOString(),
      }
      let next: TaskRecord = {
        ...cloneRecord(record),
        task: { ...cloneState(record.task), status: 'awaiting-resume', resume, nextAction: 'review-restart-and-resume' },
      }
      next = await this.appendEvent(next, 'awaiting-resume', '已核对重启后的剩余清单，等待用户确认继续', 'info')
      return cloneState((await this.save(next)).task)
  }

  async resume(request: TaskResumeRequest): Promise<TaskState> {
    return this.withLockFromTask(request.taskId, async (record) => {
      const replay = record.resumeIdempotency[request.idempotencyKey]
      if (replay !== undefined) {
        if (replay !== request.challengeId) throw new MarketCoreError('task/idempotency-conflict', '幂等键已用于其他恢复操作', { nextAction: 'use-a-new-key' })
        return cloneState(record.task)
      }
      const challenge = record.task.resume
      if (record.task.status !== 'awaiting-resume' || challenge === undefined || challenge.id !== request.challengeId || challenge.digest !== request.resumeDigest) {
        throw new MarketCoreError('task/stale-resume', '重启挑战已失效或状态已变化', { nextAction: 'reconcile-task' })
      }
      let next: TaskRecord = {
        ...cloneRecord(record),
        resumeIdempotency: { ...record.resumeIdempotency, [request.idempotencyKey]: challenge.id },
        task: this.withoutResume({ ...cloneState(record.task), status: 'installing', nextAction: 'resume-remaining-install' }),
      }
      next = await this.appendEvent(next, 'installing', '已确认重启挑战，继续剩余安装', 'info')
      await this.save(next)
      void this.queue(next.task.environmentId).enqueue(() => this.runTaskLockedId(request.taskId))
      return cloneState(next.task)
    })
  }

  /** Runs one queued task. Callers already enqueue on the environment's serial queue. */
  async runTaskLockedId(taskId: string): Promise<void> {
    const initial = await this.deps.store.get(taskId)
    if (initial === undefined || isTerminal(initial.task.status)) return
    try {
      await this.withLock(initial.task.environmentId, () => this.runTaskLocked(initial))
    } catch (error) {
      const current = await this.deps.store.get(taskId)
      if (current === undefined || isTerminal(current.task.status)) return
      const message = error instanceof Error ? error.message : '任务执行器发生未知错误'
      let failed = await this.appendEvent(current, 'needs-attention', `任务执行中断：${message}`, 'error')
      failed = {
        ...failed,
        task: { ...cloneState(failed.task), status: 'needs-attention', nextAction: nextActionFor('needs-attention', failed.task.items) },
      }
      await this.save(failed)
    }
  }
  private async runTaskLocked(startRecord: TaskRecord): Promise<void> {
    let record = cloneRecord(startRecord)
    const hostState = await this.deps.host.readState()
    if (!hostState.activity.stable || hostState.activity.unknownSharedImpact) {
      record = await this.appendEvent(record, 'needs-attention', hostState.activity.reason ?? 'Host 无法证明旧写入已停止', 'error')
      record = { ...record, task: { ...cloneState(record.task), status: 'needs-attention', nextAction: nextActionFor('needs-attention', record.task.items) } }
      await this.save(record)
      return
    }
    const drift = this.findDrift(record, hostState.inventory)
    if (drift.length > 0) {
      record = await this.appendEvent(record, 'needs-attention', `计划前置状态已变化：${drift.join(', ')}`, 'warning')
      record = { ...record, task: { ...cloneState(record.task), status: 'needs-attention', nextAction: nextActionFor('needs-attention', record.task.items) } }
      await this.save(record)
      return
    }
    record = this.refreshFacts(record, hostState.inventory)
    record = this.applyKeepItems(record, hostState.inventory)

    for (const step of record.bundle.steps) {
      const itemIndex = record.task.items.findIndex((item) => item.pluginId === step.pluginId)
      const item = record.task.items[itemIndex]
      const planItem = record.bundle.plan.items.find((candidate) => candidate.pluginId === step.pluginId)
      if (item === undefined || planItem === undefined || SUCCESS_ITEM_STATUS.has(item.status) || item.status === 'failed' || item.status === 'cancelled' || item.status === 'blocked-by-dependency') continue
      const dependencyBlock = this.dependencyBlock(step.pluginId, record)
      if (dependencyBlock !== undefined) {
        record = this.updateItem(record, itemIndex, { status: dependencyBlock.status, error: dependencyBlock.error, installOutcome: 'failed' })
        record = await this.appendEvent(record, record.task.status, dependencyBlock.error, 'warning', step.pluginId)
        continue
      }
      if (record.cancellationRequested) {
        record = this.updateItem(record, itemIndex, { status: 'cancelled', installOutcome: 'cancelled' })
        continue
      }
      const beforeWrite = await this.deps.host.readState()
      if (!beforeWrite.activity.stable || beforeWrite.activity.unknownSharedImpact) {
        record = await this.appendEvent(record, 'needs-attention', beforeWrite.activity.reason ?? '写入前复查发现不明共享影响', 'error', step.pluginId)
        record = { ...record, task: { ...cloneState(record.task), status: 'needs-attention', nextAction: nextActionFor('needs-attention', record.task.items) } }
        await this.save(record)
        return
      }
      const beforeDrift = this.findDrift(record, beforeWrite.inventory)
      if (beforeDrift.length > 0) {
        record = await this.appendEvent(record, 'needs-attention', `写入前状态漂移：${beforeDrift.join(', ')}`, 'warning', step.pluginId)
        record = { ...record, task: { ...cloneState(record.task), status: 'needs-attention', nextAction: nextActionFor('needs-attention', record.task.items) } }
        await this.save(record)
        return
      }

      let attempt = record.attempts.find((candidate) => candidate.pluginId === step.pluginId && candidate.phase !== 'finished')
      let artifact: ArtifactAcquisition
      if (attempt?.artifact === undefined) {
        record = this.updateItem(record, itemIndex, { status: 'downloading', installOutcome: 'unknown' })
        record = await this.appendEvent(record, 'downloading', '开始获取并校验精确制品', 'info', step.pluginId)
        await this.save(record)
        try {
          artifact = await this.deps.artifacts.acquire({
            requestId: `${record.task.taskId}:${record.attemptCounter + 1}`,
            pluginId: step.pluginId,
            packageName: step.packageName,
            version: item.targetVersion,
            artifactDigest: planItem.targetDigest,
            sourceRef: `catalog:${record.bundle.plan.catalogRevision}:${step.pluginId}`,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : '制品获取失败'
          record = this.updateItem(record, itemIndex, { status: 'failed', error: message, installOutcome: 'failed' })
          record = await this.appendEvent(record, 'failed', `制品获取/校验失败：${message}`, 'error', step.pluginId)
          continue
        }
        const attemptId = `attempt-${record.attemptCounter + 1}`
        attempt = {
          id: attemptId,
          requestId: `${record.task.taskId}:${step.pluginId}:${record.attemptCounter + 1}`,
          pluginId: step.pluginId,
          phase: 'installing',
          artifact,
        }
        record = {
          ...cloneRecord(record),
          attempts: [...record.attempts, attempt],
          attemptCounter: record.attemptCounter + 1,
          activeRequestId: attempt.requestId,
        }
        record = this.updateItem(record, itemIndex, { status: 'verifying', installOutcome: 'unknown' })
        record = await this.appendEvent(record, 'verifying', '摘要、身份和大小已由 ArtifactPort 核验', 'info', step.pluginId)
        await this.save(record)
      } else {
        artifact = attempt.artifact
        record = { ...cloneRecord(record), activeRequestId: attempt.requestId }
      }

      record = this.updateItem(record, itemIndex, { status: 'installing', installOutcome: 'unknown' })
      record = await this.appendEvent(record, 'installing', '调用 HostPort 安装同一份已核验制品', 'info', step.pluginId)
      await this.save(record)
      let outcome: HostInstallOutcome
      try {
        outcome = await this.deps.host.install({
          requestId: attempt.requestId,
          artifact,
          enabled: planItem.requestedEnabled,
          ...(attempt.approvedBuilds === undefined ? {} : { approvedBuilds: attempt.approvedBuilds }),
        })
      } catch (error) {
        outcome = { kind: 'unknown', error: error instanceof Error ? error.message : 'Host install threw', permissionChanges: [] }
      }
      const after = await this.deps.host.readState()
      record = this.applyOutcome(record, itemIndex, attempt, outcome, after.inventory)
      record = this.clearActiveRequest(cloneRecord(record))
      record = await this.appendEvent(record, record.task.status, `Host结果：${outcome.kind}`, outcome.kind === 'failed' || outcome.kind === 'unknown' ? 'error' : 'info', step.pluginId)
      await this.save(record)
      if (outcome.kind === 'unknown' || (outcome.kind === 'failed' && outcome.unknownSharedImpact === true)) {
        record = { ...record, task: { ...cloneState(record.task), status: 'needs-attention', nextAction: nextActionFor('needs-attention', record.task.items) } }
        await this.save(record)
        return
      }
      if (outcome.kind === 'awaiting-approval') return
    }

    record = this.finalize(record)
    await this.save(record)
  }
  private applyKeepItems(record: TaskRecord, inventory: InventorySnapshot): TaskRecord {
    let next = cloneRecord(record)
    for (let index = 0; index < next.task.items.length; index += 1) {
      const item = next.task.items[index]
      if (item === undefined) continue
      if (item === undefined) continue
      const planItem = next.bundle.plan.items.find((candidate) => candidate.pluginId === item.pluginId)
      if (planItem?.action !== 'keep' || SUCCESS_ITEM_STATUS.has(item.status)) continue
      const current = packageItem(inventory, item.packageName)
      if (current?.installed !== true || current.version !== item.targetVersion) {
        next = this.updateItem(next, index, {
          status: 'unknown',
          changed: false,
          installOutcome: 'unknown',
          error: '同版本保留前库存身份或版本未核实',
        })
        continue
      }
      next = this.updateItem(next, index, {
        status: current.bundleEnabled ? 'enabled' : 'disabled',
        changed: false,
        installOutcome: 'applied',
      })
      next = {
        ...next,
        itemFacts: { ...next.itemFacts, [item.pluginId]: this.factFromInventory(inventory, item.packageName) },
      }
    }
    return next
  }

  private applyOutcome(record: TaskRecord, itemIndex: number, attempt: TaskAttemptRecord, outcome: HostInstallOutcome, inventory: InventorySnapshot): TaskRecord {
    const item = record.task.items[itemIndex]
    if (item === undefined) return record
    const permissionChanges = outcome.permissionChanges.map((change) => ({ ...change }))
    if (outcome.kind === 'applied') {
      const current = packageItem(inventory, item.packageName)
      if (current?.installed !== true || current.version !== item.targetVersion) {
        return this.updateItem(record, itemIndex, {
          status: 'unknown',
          changed: outcome.changed,
          installOutcome: 'unknown',
          error: '官方结果已返回，但库存中的包身份或目标版本未核实',
          permissionChanges,
        })
      }
      const status: TaskItemStatus = outcome.restartRequired ? 'restart-required' : current?.bundleEnabled ? 'enabled' : 'disabled'
      return {
        ...this.updateItem(record, itemIndex, {
          status,
          changed: outcome.changed,
          installOutcome: outcome.restartRequired ? 'restart-required' : 'applied',
          permissionChanges,
          ...(outcome.packageResultCode === undefined ? {} : { packageResultCode: outcome.packageResultCode }),
        }),
        itemFacts: { ...record.itemFacts, [item.pluginId]: this.factFromInventory(inventory, item.packageName) },
        attempts: record.attempts.map((candidate) => candidate.id === attempt.id ? { ...candidate, phase: 'finished' } : candidate),
      }
    }
    if (outcome.kind === 'awaiting-approval') {
      const packages = [...outcome.pendingBuilds].sort()
      const challenge: ApprovalChallenge = {
        id: `approval-${attempt.id}-${outcome.pendingBuildsDigest.slice(0, 24)}`,
        attemptId: attempt.id,
        digest: outcome.pendingBuildsDigest,
        packages,
        createdAt: this.now().toISOString(),
      }
      return {
        ...this.updateItem(record, itemIndex, { status: 'installing', installOutcome: 'unknown', permissionChanges }),
        attempts: record.attempts.map((candidate) => candidate.id === attempt.id ? {
          ...candidate,
          phase: 'awaiting-approval',
          pendingBuilds: packages,
          pendingBuildsDigest: outcome.pendingBuildsDigest,
        } : candidate),
        task: {
          ...cloneState(record.task),
          status: 'awaiting-approval',
          approval: challenge,
          nextAction: nextActionFor('awaiting-approval', record.task.items),
        },
      }
    }
    const status: TaskItemStatus = outcome.kind === 'cancelled' ? 'cancelled' : outcome.kind === 'failed' ? 'failed' : 'unknown'
    const outcomeName = outcome.kind === 'cancelled' ? 'cancelled' : outcome.kind === 'failed' ? 'failed' : 'unknown'
    return {
      ...this.updateItem(record, itemIndex, {
        status,
        ...(outcome.kind === 'unknown' ? {} : { changed: outcome.changed }),
        installOutcome: outcomeName,
        permissionChanges,
        ...(outcome.kind === 'failed' || outcome.kind === 'unknown' ? {
          error: outcome.error,
          ...(outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode }),
          ...(outcome.diagnostic === undefined ? {} : { diagnostic: outcome.diagnostic }),
        } : {}),
        ...(outcome.kind !== 'unknown' && outcome.packageResultCode !== undefined ? { packageResultCode: outcome.packageResultCode } : {}),
      }),
      itemFacts: { ...record.itemFacts, [item.pluginId]: this.factFromInventory(inventory, item.packageName) },
      attempts: record.attempts.map((candidate) => candidate.id === attempt.id ? { ...candidate, phase: 'finished' } : candidate),
    }
  }

  private withoutApproval(state: TaskState): TaskState {
    const next = cloneState(state)
    Reflect.deleteProperty(next, 'approval')
    return next
  }

  private withoutResume(state: TaskState): TaskState {
    const next = cloneState(state)
    Reflect.deleteProperty(next, 'resume')
    return next
  }

  private clearActiveRequest(record: TaskRecord): TaskRecord {
    const next = cloneRecord(record)
    Reflect.deleteProperty(next, 'activeRequestId')
    return next
  }
  private updateItem(record: TaskRecord, index: number, patch: Partial<TaskItemResult>): TaskRecord {
    const items = record.task.items.map((item, itemIndex) => itemIndex === index
      ? { ...item, ...patch, permissionChanges: patch.permissionChanges ?? item.permissionChanges }
      : item)
    // TaskStatus exposes the current overall phase. Without this update a task
    // can be queued while its item is already installing, which hides work from
    // reconnecting Clients and makes cancellation races ambiguous.
    const phase = patch.status === 'downloading' || patch.status === 'verifying' || patch.status === 'installing'
      ? patch.status
      : record.task.status
    return { ...cloneRecord(record), task: { ...cloneState(record.task), status: phase, items } }
  }

  private refreshFacts(record: TaskRecord, inventory: InventorySnapshot): TaskRecord {
    const itemFacts = Object.fromEntries(record.bundle.expected.map((expected) => [
      expected.pluginId,
      this.factFromInventory(inventory, expected.packageName),
    ]))
    return {
      ...cloneRecord(record),
      itemFacts,
      task: {
        ...cloneState(record.task),
        items: record.task.items.map((item) => {
          const fact = itemFacts[item.pluginId]
          if (item.status !== 'restart-required' || fact?.installed !== true) return item
          if (fact.active) return { ...item, status: 'enabled' }
          const planItem = record.bundle.plan.items.find((candidate) => candidate.pluginId === item.pluginId)
          // A requested-on bundle that is installed but not loaded in this
          // session still needs restart; it is not proven disabled.
          return { ...item, status: planItem?.requestedEnabled === false ? 'disabled' : 'restart-required' }
        }),
      },
    }
  }
  private factFromInventory(inventory: InventorySnapshot, packageName: string): TaskItemFact {
    const item = packageItem(inventory, packageName)
    return {
      installed: item?.installed === true,
      active: item?.installed === true && item.bundleEnabled && !item.restartRequired,
    }
  }

  private edgeSatisfied(prerequisiteId: string, milestone: 'installed' | 'active', record: TaskRecord): boolean {
    const fact = record.itemFacts[prerequisiteId]
    const expected = record.bundle.expected.find((candidate) => candidate.pluginId === prerequisiteId)
    const installed = fact?.installed ?? expected?.version !== undefined
    const active = fact?.active ?? (expected !== undefined && expected.enabled)
    return milestone === 'installed' ? installed : active
  }

  private dependencyBlock(pluginId: string, record: TaskRecord): { status: TaskItemStatus; error: string } | undefined {
    for (const edge of record.bundle.dependencies) {
      if (edge.consumerId !== pluginId) continue
      const prerequisite = record.task.items.find((item) => item.pluginId === edge.prerequisiteId)
      const fact = record.itemFacts[edge.prerequisiteId]
      if (prerequisite?.status === 'failed' || prerequisite?.status === 'cancelled' || prerequisite?.status === 'unknown') {
        return { status: 'blocked-by-dependency', error: `前置 ${edge.prerequisiteId} 未成功` }
      }
      if (edge.milestone === 'installed' && fact?.installed !== true) {
        return { status: 'blocked-by-dependency', error: `前置 ${edge.prerequisiteId} 尚未安装` }
      }
      if (edge.milestone === 'active' && fact?.active !== true) {
        if (prerequisite?.status === 'restart-required' || prerequisite?.status === 'blocked-on-restart') {
          return { status: 'blocked-on-restart', error: `前置 ${edge.prerequisiteId} 需重启后才 active` }
        }
        return { status: 'blocked-by-dependency', error: `前置 ${edge.prerequisiteId} 尚未 active` }
      }
    }
    return undefined
  }

  private findDrift(record: TaskRecord, inventory: InventorySnapshot): readonly string[] {
    const drift: string[] = []
    for (const expected of record.bundle.expected) {
      const item = packageItem(inventory, expected.packageName)
      const fact = record.itemFacts[expected.pluginId]
      const taskItem = record.task.items.find((candidate) => candidate.pluginId === expected.pluginId)
      const installed = fact?.installed ?? expected.version !== undefined
      // Before a write, the baseline is the old version from the plan. Only a
      // completed item whose Host result was verified advances the expectation.
      const verifiedChange = taskItem !== undefined && SUCCESS_ITEM_STATUS.has(taskItem.status) && taskItem.installOutcome !== 'unknown'
      const expectedVersion = verifiedChange ? taskItem.targetVersion : expected.version
      if (installed && item?.installed !== true) drift.push(`${expected.packageName}:missing`)
      if (!installed && item?.installed === true) drift.push(`${expected.packageName}:unexpected-install`)
      if (expectedVersion !== undefined && item?.version !== undefined && item.version !== expectedVersion) {
        drift.push(`${expected.packageName}:version`)
      }
    }
    return drift
  }

  private applyCancelToActive(record: TaskRecord, changed: boolean): TaskRecord {
    const index = record.task.items.findIndex((item) => item.status === 'installing' || item.status === 'downloading' || item.status === 'verifying')
    return index < 0 ? record : this.updateItem(record, index, { status: 'cancelled', changed, installOutcome: 'cancelled' })
  }

  private finalize(record: TaskRecord): TaskRecord {
    const status = statusAfterItems(record.task.items, record.cancellationRequested)
    return { ...cloneRecord(record), task: { ...cloneState(record.task), status, nextAction: nextActionFor(status, record.task.items) } }
  }
}

/** Small in-memory queue used by Host assembly for one process. */
export class ProfileSerialQueues {
  private readonly queues = new Map<string, SerialQueue>()

  enqueue<T>(profileKey: string, operation: () => Promise<T>): Promise<T> {
    const queue = this.queues.get(profileKey) ?? new SerialQueue()
    this.queues.set(profileKey, queue)
    return queue.enqueue(operation)
  }
}
