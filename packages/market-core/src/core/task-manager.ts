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
  InstallLogAction,
  PlanAction,
  TaskItemResult,
  TaskItemStatus,
  TaskResumeRequest,
  TaskStartRequest,
  TaskState,
  TaskStatus,
} from '../contracts/types.ts'
import { canonicalJson, pendingBuildsDigest, sha256Hex } from './canonical.ts'
import { MarketCoreError } from './errors.ts'
import { isProtectedMarketPackage } from './identity.ts'
import { bundleInventoryReadFailed, inventoryIssueAffectsPackage } from './inventory-safety.ts'
import type {
  ArtifactAcquisition,
  ArtifactPort,
  EventLogPage,
  HostInstallOutcome,
  HostReadState,
  PlanBundle,
  PlanStep,
  ProfileLockPort,
  TaskAttemptRecord,
  TaskEventLogPort,
  InstallLogSink,
  TaskItemFact,
  TaskRecord,
  TaskStorePort,
} from './ports.ts'
import { verifyPlanBundle } from './planner.ts'
import { executionOf, hasUncertainWrite, withExecution, type RecoverableHostPort, type CoordinatedManagementRequest, type ManagementRecord, type ManagementCompletion } from './execution-state.ts'
import { completeManagementRecord, decodeManagementRecord } from './management-record.ts'
import { encodeJson, type PersistenceFilePort } from '../persistence/files.ts'
export type { CoordinatedManagementRequest } from './execution-state.ts'

const SUCCESS_ITEM_STATUS: ReadonlySet<TaskItemStatus> = new Set([
  'installed', 'enabled', 'disabled', 'restart-required',
])
const ACTIVE_ITEM_STATUS: ReadonlySet<TaskItemStatus> = new Set([
  'pending', 'downloading', 'verifying', 'installing', 'blocked-on-restart',
])
const TERMINAL_TASK_STATUS: ReadonlySet<TaskStatus> = new Set([
  'completed', 'partial', 'failed', 'cancelled',
])

export interface TaskManagerDeps {
  readonly host: RecoverableHostPort
  readonly coordinationFiles?: PersistenceFilePort
  /** Host revalidates release withdrawal/hard incompatibility by frozen identity,
   * independent of presentation revisions. Rejecting never authorizes a write. */
  readonly validateWrite?: (bundle: PlanBundle, pluginId: string, state?: HostReadState) => Promise<void>
  readonly validateStart?: (bundle: PlanBundle) => Promise<void>
  readonly artifacts: ArtifactPort
  readonly store: TaskStorePort
  readonly locks: ProfileLockPort
  readonly events?: TaskEventLogPort
  /** B 档安装日志；缺省时静默跳过，测试宿主无需它。 */
  readonly installLog?: InstallLogSink
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
    active: false,
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
  private readonly downloads = new Map<string, AbortController>()
  private readonly owner: string
  private readonly now: () => Date
  private readonly maxEventHistory: number

  constructor(private readonly deps: TaskManagerDeps) {
    this.owner = deps.owner ?? 'market-task-manager'
    this.now = deps.now ?? (() => new Date())
    this.maxEventHistory = deps.maxEventHistory ?? 200
  }

  /** Reconcile receipts under the same execution occupation as every new writer.
   * Disk version alone never proves which interrupted request produced it.
   */
  async reconcileInterrupted(environmentId: string): Promise<number> {
    const handle = await this.deps.locks.acquire('execution:' + environmentId, this.owner)
    try {
      await this.reconcileManagement(environmentId)
      let changed = 0
      for (const stored of await this.deps.store.list(environmentId)) {
        await this.flushEvents(stored)
        if (isTerminal(stored.task.status) && !hasUncertainWrite(stored)) continue
        let record = cloneRecord(stored)
        if (this.provenNoWrite(record)) {
          await this.cancelUnstarted(record, '旧任务在写入前停止，已自动关闭')
          changed++
          continue
        }
        const packageNames = [...new Set(record.task.items.map(item => item.packageName))]
        let state = await this.deps.host.readState()
        if (!this.installStateSettled(state, packageNames) || state.inventory.environmentId !== environmentId) { await this.pause(record, '恢复时仍有活动写入或目标状态未核实', true); changed++; continue }
        const wasUncertain = hasUncertainWrite(record)
        let unresolved = false
        let accounted = false
        for (const attempt of record.attempts) {
          const fact = executionOf(record)?.attempts[attempt.id]
          if (fact?.stage === 'prepared' || fact?.stage === 'verified' || attempt.phase === 'approved' || attempt.phase === 'awaiting-approval') continue
          if (!wasUncertain && attempt.phase === 'finished') continue
          const savedOutcome = fact?.outcome
          const outcome = savedOutcome !== undefined && savedOutcome.kind !== 'unknown' && !(savedOutcome.kind === 'failed' && savedOutcome.unknownSharedImpact)
            ? savedOutcome : await this.deps.host.reconcileInstall?.(attempt.requestId)
          if (outcome === undefined || outcome.kind === 'unknown' || (outcome.kind === 'failed' && outcome.unknownSharedImpact)) { unresolved = true; continue }
          state = await this.deps.host.readState()
          if (!this.installStateSettled(state, packageNames)) { unresolved = true; continue }
          const index = record.task.items.findIndex(item => item.pluginId === attempt.pluginId)
          record = this.applyOutcome(record, index, attempt, outcome, state.inventory)
          if (record.task.items[index]?.status === 'unknown') { unresolved = true; continue }
          const target = record.task.items[index]
          const observed = target === undefined ? undefined : packageItem(state.inventory, target.packageName)
          record = withExecution(record, { attempts: { ...executionOf(record)?.attempts,
            [attempt.id]: { stage: 'verified', sessionRevision: fact?.sessionRevision ?? '', outcome } },
            restartBarriers: { ...executionOf(record)?.restartBarriers,
              ...(outcome.kind === 'applied' && outcome.restartRequired ? { [attempt.pluginId]: fact?.sessionRevision ?? state.sessionRevision } : {}) },
            observed: { ...executionOf(record)?.observed, ...(observed === undefined ? {} : { [attempt.pluginId]: observed }) },
          })
          accounted = true
        }
        // Legacy unknown items without identifiable requests cannot be turned into success.
        if (wasUncertain && record.attempts.length === 0 && (record.activeRequestId !== undefined
          || record.task.items.some(item => item.status === 'unknown' || item.status === 'installing'))) unresolved = true
        if (unresolved) { await this.pause(record, '缺少旧请求的可靠回执；状态待核对且禁止重放', true); changed++; continue }
        record = withExecution(this.clearActiveRequest(record), { writeUncertain: false })
        record = this.refreshFacts(record, state)
        if (record.cancellationRequested) record = this.finalize(this.cancelPending(record))
        else if (record.task.status !== 'awaiting-approval') {
          const pendingAttention = record.task.status === 'needs-attention'
          const finalized = this.finalize(record)
          // 宽松模式：本来就是"结果未知（已提交）"的任务保持 needs-attention，
          // 不再升级成 interrupted，否则会重新变成后续安装的活动阻塞。
          record = isTerminal(finalized.task.status) || pendingAttention ? finalized : { ...record,
            task: { ...cloneState(record.task), status: 'interrupted', nextAction: 'reconcile-before-retrying' } }
        }
        record = await this.save(await this.appendEvent(record, record.task.status, accounted ? '已用旧回执和当前库存结算；未重放安装' : '已核对旧写入停止；剩余步骤等待明确确认', 'info'))
        if (!isTerminal(record.task.status) && record.task.status !== 'awaiting-approval') await this.prepareResumeLocked(record)
        changed++
      }
      return changed
    } finally { await handle.release() }
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
    return this.withLock(record.task.environmentId, async () => {
      const current = await this.deps.store.get(taskId)
      if (current === undefined) throw new MarketCoreError('task/not-found', '任务不存在')
      return operation(current)
    })
  }

  // Events are committed with the authoritative summary first. The JSONL log is
  // a repairable projection; an event append can never authorize an uncommitted write.
  private async appendEvent(record: TaskRecord, phase: TaskStatus, message: string, level: TaskEvent['level'], pluginId?: string): Promise<TaskRecord> {
    const event: TaskEvent = { sequence: record.nextSequence, at: this.now().toISOString(), phase, message, level,
      ...(pluginId === undefined ? {} : { pluginId }) }
    return { ...cloneRecord(record), task: { ...cloneState(record.task),
      events: [...record.task.events, event].slice(-this.maxEventHistory), updatedAt: event.at }, nextSequence: record.nextSequence + 1 }
  }

  private async save(record: TaskRecord, cancellationOnly = false): Promise<TaskRecord> {
    const handle = await this.deps.locks.acquire('record:' + record.task.taskId, this.owner)
    try {
      const current = await this.deps.store.get(record.task.taskId)
      if (current !== undefined && isTerminal(current.task.status)) return cloneRecord(current)
      if (current !== undefined && cancellationOnly) record = {
        ...cloneRecord(current), cancellationRequested: true, idempotency: { ...current.idempotency, ...record.idempotency },
        task: { ...cloneState(current.task), status: 'cancelling', nextAction: 'waiting-for-cancellation-result', events: record.task.events },
      }
      const identity = (event: TaskEvent): string => canonicalJson({ ...event, sequence: 0 })
      const seen = new Set(current?.task.events.map(identity) ?? [])
      let sequence = current?.nextSequence ?? 0
      const events = [...current?.task.events ?? [], ...record.task.events.filter(event => !seen.has(identity(event))).map(event => ({ ...event, sequence: sequence++ }))]
      const next: TaskRecord = { ...cloneRecord(record),
        cancellationRequested: record.cancellationRequested || current?.cancellationRequested === true,
        idempotency: { ...current?.idempotency, ...record.idempotency },
        task: { ...cloneState(record.task), events: events.slice(-this.maxEventHistory) },
        nextSequence: sequence,
      }
      await this.deps.store.put(next)
      await this.flushEvents(next)
      return next
    } finally { await handle.release() }
  }

  private async flushEvents(record: TaskRecord): Promise<void> {
    if (this.deps.events === undefined) return
    const page = await this.deps.events.read(record.task.taskId, -1, Number.MAX_SAFE_INTEGER)
    for (const event of record.task.events) {
      if (event.sequence >= page.nextSequence) await this.deps.events.append(record.task.taskId, event)
    }
  }

  async start(bundle: PlanBundle, request: TaskStartRequest, baseline: HostReadState): Promise<TaskStartOutcome> {
    if (request.confirmed !== true || !request.idempotencyKey) throw new MarketCoreError('plan/not-confirmed', '缺少明确确认或幂等键')
    if (!await verifyPlanBundle(bundle)) {
      throw new MarketCoreError('plan/digest-mismatch', '计划摘要与内容不一致', { nextAction: 'create-a-new-plan' })
    }
    if (request.planId !== bundle.plan.planId || request.planDigest !== bundle.plan.planDigest) {
      throw new MarketCoreError('plan/confirmation-mismatch', '确认的计划与 Host 保存的计划不一致', { nextAction: 'review-plan' })
    }
    const preexisting = await this.deps.store.list(bundle.plan.environmentId)
    const activeBeforeStart = preexisting.find(record => !isTerminal(record.task.status) && !['needs-attention', 'unknown'].includes(record.task.status))
    if (activeBeforeStart === undefined) await this.reconcileInterrupted(bundle.plan.environmentId)
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
      if (Date.parse(bundle.plan.expiresAt) <= this.now().getTime()) {
        throw new MarketCoreError('plan/stale', '计划已过期，需要重新核对清单', { retryable: true, nextAction: 'create-a-new-plan' })
      }
      const intentDigest = await this.intentDigest(bundle)
      const records = await this.deps.store.list(bundle.plan.environmentId)
      for (const prior of records) {
        const same = (executionOf(prior)?.intentDigest || await this.intentDigest(prior.bundle)) === intentDigest
        if (prior.idempotency[request.idempotencyKey] === 'start') {
          if (!same) throw new MarketCoreError('task/idempotency-conflict', '幂等键已用于不同安装意图')
          return { task: cloneState(prior.task), created: false }
        }
        const waitingForWriter = hasUncertainWrite(prior) || !['needs-attention', 'unknown'].includes(prior.task.status)
        if (same && !isTerminal(prior.task.status) && waitingForWriter) return { task: cloneState(prior.task), created: false }
      }
      await this.assertNoUncertainWriter(bundle.plan.environmentId)
      if (request.retryOfTaskId !== undefined) {
        const prior = await this.deps.store.get(request.retryOfTaskId)
        if (prior === undefined || prior.task.environmentId !== bundle.plan.environmentId
          || !['failed', 'partial', 'cancelled'].includes(prior.task.status) || hasUncertainWrite(prior)
          || !prior.task.items.some(item => bundle.plan.items.some(target => target.packageName === item.packageName))) {
          throw new MarketCoreError('task/invalid-retry', '只允许关联本环境中结果已核定的失败、部分完成或取消任务')
        }
      }
      const active = records.find(prior => !isTerminal(prior.task.status) && !['needs-attention', 'unknown'].includes(prior.task.status))
      if (active !== undefined) throw new MarketCoreError('task/environment-busy', '环境已有活动任务：' + active.task.taskId)
      await this.deps.validateStart?.(bundle)
      const now = this.now()
      const taskId = `task-${(await sha256Hex(`${bundle.plan.environmentId}:${bundle.plan.planId}`)).slice(0, 32)}`
      const state: TaskState = {
        taskId,
        planId: bundle.plan.planId,
        planDigest: bundle.plan.planDigest,
        environmentId: bundle.plan.environmentId,
        status: 'queued',
        ...(request.retryOfTaskId === undefined ? {} : { retryOfTaskId: request.retryOfTaskId }),
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
      const withEvent = await this.appendEvent(withExecution(record, { intentDigest, sessionRevision: baseline.sessionRevision }), 'queued', '任务已持久化，等待执行', 'info')
      await this.save(withEvent)
      void this.queue(bundle.plan.environmentId).enqueue(() => this.runTaskLockedId(taskId))
      return { task: cloneState(withEvent.task), created: true }
    })
  }

  private async intentDigest(bundle: PlanBundle): Promise<string> {
    return sha256Hex(canonicalJson({ environmentId: bundle.plan.environmentId, host: bundle.plan.hostFingerprint,
      items: bundle.plan.items.map(item => ({ packageName: item.packageName, version: item.targetVersion,
        digest: item.targetDigest, enabled: item.requestedEnabled, verification: item.verification,
        blocked: item.action === 'blocked' })).sort((a, b) => a.packageName.localeCompare(b.packageName)),
      dependencies: [...bundle.dependencies].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))), deliveries: [...bundle.deliveries ?? []].sort((a, b) => a.pluginId.localeCompare(b.pluginId)),
    }))
  }

  private async managementRecords(): Promise<readonly { path: string; record: ManagementRecord }[]> {
    const files = this.deps.coordinationFiles
    if (files === undefined) return []
    const result: { path: string; record: ManagementRecord }[] = []
    for (const path of await files.list('management/')) {
      if (!path.endsWith('.json')) continue
      const bytes = await files.read(path)
      if (bytes === undefined) throw new MarketCoreError('management/missing', '管理记录在读取时消失')
      const record = decodeManagementRecord(bytes)
      result.push({ path, record })
    }
    return result
  }

  private async assertNoUncertainWriter(environmentId: string, exceptTask?: string, exceptManagement?: string): Promise<void> {
    const unresolved = (await this.deps.store.list(environmentId)).find(record => record.task.taskId !== exceptTask && hasUncertainWrite(record))
    if (unresolved !== undefined) throw new MarketCoreError('task/write-unresolved', '旧任务写入尚未核对：' + unresolved.task.taskId)
    const management = (await this.managementRecords()).find(({ path, record }) => path !== exceptManagement && record.request.environmentId === environmentId && record.stage !== 'settled')
    if (management !== undefined) throw new MarketCoreError('management/write-unresolved', '旧管理操作的结果尚未核对')
  }

  private managementVerified(record: ManagementRecord, state: HostReadState, receipt: HostInstallOutcome): boolean {
    if (!this.installStateSettled(state, [record.request.packageName]) || state.inventory.environmentId !== record.request.environmentId
      || receipt.kind === 'unknown' || receipt.kind === 'awaiting-approval'
      || (receipt.kind === 'failed' && receipt.unknownSharedImpact)) return false
    const target = packageItem(state.inventory, record.request.packageName)
    const desired = record.request.action === 'remove' ? target?.installed !== true
      : target !== undefined && target.version === record.request.expectedVersion
        && target.bundleEnabled === (record.request.action === 'enable')
        && (record.before === undefined || target.installed === record.before.installed)
    if (receipt.kind === 'applied') return desired
    const before = record.before
    const unchanged = before !== undefined && target !== undefined && before.installed === target.installed
      && before.version === target.version && before.bundleEnabled === target.bundleEnabled && before.source === target.source
    return unchanged || (receipt.changed && desired)
  }

  /** A saved real receipt can be rechecked after an inventory outage. A missing
   * or unknown receipt never grants permission to run the management callback again. */
  private async reconcileManagement(environmentId: string): Promise<void> {
    const files = this.deps.coordinationFiles
    if (files === undefined) return
    for (const { path, record } of await this.managementRecords()) {
      if (record.request.environmentId !== environmentId || record.stage === 'settled') continue
      const receipt = record.receipt ?? record.outcome
      if (receipt === undefined) continue
      const state = await this.deps.host.readState()
      if (this.managementVerified(record, state, receipt)) await files.writeAtomic(path, encodeJson({ ...record, stage: 'settled', outcome: receipt }))
    }
  }

  /** Host supplies the single confirmed official action. Every caller shares the
   * same execution lock and persistent unknown-write barrier with install tasks.
   * Risk/impact confirmation is the Host's responsibility; this method still
   * verifies object protection, expectedVersion, idempotency and post-write facts.
   */
  async manage(request: CoordinatedManagementRequest, write: () => Promise<HostInstallOutcome>,
    settleBusiness?: (record: ManagementRecord) => Promise<ManagementCompletion['maintenance']>, preflight?: () => Promise<void>): Promise<HostInstallOutcome> {
    const files = this.deps.coordinationFiles
    if (files === undefined) throw new MarketCoreError('management/persistence-unavailable', '管理写入需要持久去重记录')
    if (!request.idempotencyKey || !request.expectedVersion || !['enable', 'disable', 'remove'].includes(request.action))
      throw new MarketCoreError('management/invalid-request', '管理请求缺少目标版本、动作或幂等键')
    const path = 'management/' + await sha256Hex(request.environmentId + ':' + request.idempotencyKey) + '.json'
    const fingerprint = await sha256Hex(canonicalJson(request))
    const existing = await this.deps.store.list(request.environmentId)
    const activeBeforeManagement = existing.find(record => !isTerminal(record.task.status) && !['needs-attention', 'unknown'].includes(record.task.status))
    if (activeBeforeManagement === undefined) await this.reconcileInterrupted(request.environmentId)
    const handle = await this.deps.locks.acquire('execution:' + request.environmentId, this.owner)
    try {
      const bytes = await files.read(path)
      if (bytes !== undefined) {
        const prior = decodeManagementRecord(bytes)
        if (prior.fingerprint !== fingerprint) throw new MarketCoreError('task/idempotency-conflict', '管理幂等键已用于其他内容')
        if (prior.stage === 'settled' && prior.outcome !== undefined) {
          if (settleBusiness !== undefined && prior.completion === undefined) {
            const state = await this.deps.host.readState()
            if (!this.managementVerified(prior, state, prior.outcome)) throw new MarketCoreError('management/business-unverified', '原官方回执对应的目标状态已变化，不能补写维护结果')
            const maintenance = await settleBusiness(prior)
            await files.writeAtomic(path, encodeJson(completeManagementRecord(prior, maintenance)))
          }
          return prior.outcome
        }
        throw new MarketCoreError('management/write-unresolved', '同一操作已有未知或执行中的回执，禁止重放')
      }
      await preflight?.()
      await this.assertNoUncertainWriter(request.environmentId)
      const active = (await this.deps.store.list(request.environmentId)).find(record => !isTerminal(record.task.status) && !['needs-attention', 'unknown'].includes(record.task.status))
      if (active !== undefined) throw new MarketCoreError('task/environment-busy', '安装任务仍占用当前环境：' + active.task.taskId)
      const before = await this.deps.host.readState()
      if (!this.installStateSettled(before, [request.packageName]) || before.inventory.environmentId !== request.environmentId) throw new MarketCoreError('management/state-unknown', '目标或活动写入状态无法核实')
      const item = packageItem(before.inventory, request.packageName)
      if (isProtectedMarketPackage(request.packageName) || item === undefined || item.readOnlyReason !== undefined)
        throw new MarketCoreError('management/protected-target', '目标不存在、受保护或需使用官方管理入口')
      if (item.version !== request.expectedVersion) throw new MarketCoreError('management/version-drift', '目标版本已变化，请重新确认')
      // Installation-supplied optional bundles legitimately have installed:false.
      // Their activation is supported; only removal requires profile ownership.
      if (request.action === 'remove' && (!item.installed || !item.removable)) throw new MarketCoreError('management/not-removable', '官方库存未允许卸载此目标')
      const dispatched: ManagementRecord = { schemaVersion: 1, request, fingerprint, stage: 'dispatched', before: item }
      await files.writeAtomic(path, encodeJson(dispatched))
      let outcome: HostInstallOutcome
      try { outcome = await write() }
      catch (error) { outcome = { kind: 'unknown', error: error instanceof Error ? error.message : '管理调用没有可靠回执', permissionChanges: [] } }
      // Persist the receipt before inventory reads, which can themselves fail.
      const receipt = outcome
      await files.writeAtomic(path, encodeJson({ ...dispatched, stage: 'unknown', outcome, receipt }))
      const after = await this.deps.host.readState()
      const known = this.managementVerified(dispatched, after, receipt)
      if (!known && outcome.kind !== 'unknown') outcome = { kind: 'unknown', error: '官方回执后状态未核实，禁止重复写入', permissionChanges: outcome.permissionChanges }
      const settled: ManagementRecord = { ...dispatched, stage: known ? 'settled' : 'unknown', outcome, receipt }
      await files.writeAtomic(path, encodeJson(settled))
      if (known && settleBusiness !== undefined) {
        const maintenance = await settleBusiness(settled)
        await files.writeAtomic(path, encodeJson(completeManagementRecord(settled, maintenance)))
      }
      this.logManagement(request, outcome)
      return outcome
    } finally { await handle.release() }
  }

  /** Native-like installation gate: unrelated inventory uncertainty must not
   * prevent a target install. Real active writers and official run records still
   * block; target identity/drift checks remain in findDrift and applyOutcome. */
  private installStateSettled(state: HostReadState, packageNames: readonly string[] = []): boolean {
    if (state.activeRequests.length > 0 || state.activity.writeBarrier === true) return false
    return !state.inventory.unknownItems.some(issue => bundleInventoryReadFailed(issue)
      || packageNames.some(name => inventoryIssueAffectsPackage(issue, name)))
  }

  /** Explicit execution state proves that no official install request was dispatched. */
  private provenNoWrite(record: TaskRecord): boolean {
    const execution = executionOf(record)
    if (execution === undefined || record.activeRequestId !== undefined) return false
    return record.attempts.every(attempt => {
      const stage = execution.attempts[attempt.id]?.stage
      return stage === 'prepared' || (stage === undefined && !['installing', 'applying'].includes(attempt.phase))
    }) && !record.task.items.some(item => ['installing', 'unknown'].includes(item.status))
  }

  private async cancelUnstarted(record: TaskRecord, message: string): Promise<void> {
    const next = withExecution(this.clearActiveRequest(record), { writeUncertain: false })
    const cancelled: TaskRecord = {
      ...next,
      task: {
        ...cloneState(next.task),
        status: 'cancelled',
        items: next.task.items.map(item => SUCCESS_ITEM_STATUS.has(item.status) || item.status === 'failed'
          ? item : { ...item, status: 'cancelled', installOutcome: 'cancelled', changed: false, error: message }),
        nextAction: 'review-cancelled-items',
      },
    }
    await this.save(await this.appendEvent(cancelled, 'cancelled', message + '；未调用官方安装器，可重新预检。', 'warning'))
  }

  async get(taskId: string): Promise<TaskState | undefined> {
    const record = await this.deps.store.get(taskId)
    return record === undefined ? undefined : cloneState(record.task)
  }

  async events(taskId: string, afterSequence = 0, limit = 100): Promise<EventLogPage> {
    const record = await this.deps.store.get(taskId)
    if (this.deps.events !== undefined) {
      const page = await this.deps.events.read(taskId, afterSequence, limit)
      const events = new Map(page.events.map(event => [event.sequence, event]))
      for (const event of record?.task.events ?? []) if (event.sequence > afterSequence) events.set(event.sequence, event)
      const pageEvents = [...events.values()].sort((a, b) => a.sequence - b.sequence).slice(0, Math.max(0, limit))
      return { events: pageEvents,
        nextSequence: (pageEvents.at(-1)?.sequence ?? afterSequence) + 1, truncated: page.truncated || record?.eventLogTruncated === true }
    }
    const pageEvents = record?.task.events.filter((event) => event.sequence > afterSequence).slice(0, Math.max(0, limit)) ?? []
    return {
      events: pageEvents,
      nextSequence: (pageEvents.at(-1)?.sequence ?? afterSequence) + 1,
      truncated: record?.eventLogTruncated ?? false,
    }
  }

  async cancel(request: TaskCancelRequest): Promise<TaskState> {
    const initial = await this.deps.store.get(request.taskId)
    if (initial === undefined) throw new MarketCoreError('task/not-found', '任务不存在')
    if (isTerminal(initial.task.status)) return cloneState(initial.task)
    const used = initial.idempotency[request.idempotencyKey]
    if (!request.idempotencyKey || (used !== undefined && used !== 'cancel')) throw new MarketCoreError('task/idempotency-conflict', '取消幂等键无效或已用于其他操作')
    // Signal immediately; the runner also reloads the durable flag before each write.
    this.downloads.get(request.taskId)?.abort()
    const next = await this.withLock(initial.task.environmentId, async () => {
      const record = (await this.deps.store.get(request.taskId))!
      if (isTerminal(record.task.status)) return record
      const prior = record.idempotency[request.idempotencyKey]
      if (prior !== undefined && prior !== 'cancel') throw new MarketCoreError('task/idempotency-conflict', '幂等键已用于其他操作')
      let cancelled = { ...cloneRecord(record), cancellationRequested: true,
        idempotency: { ...record.idempotency, [request.idempotencyKey]: 'cancel' },
        task: { ...cloneState(record.task), status: 'cancelling' as const, nextAction: 'waiting-for-cancellation-result' } }
      const saved = await this.save(await this.appendEvent(cancelled, 'cancelling', '已登记取消；正在执行的官方写入仍需等待真实回执', 'warning'), true)
      return saved
    })
    if (next.activeRequestId !== undefined) {
      // A cancellation acknowledgement is not the install receipt. Never settle
      // or release the execution barrier based on cancel/not-running alone.
      await this.deps.host.cancel(next.activeRequestId)
    } else {
      void this.queue(next.task.environmentId).enqueue(() => this.runTaskLockedId(request.taskId))
    }
    return cloneState((await this.deps.store.get(request.taskId))!.task)
  }
  async approveBuilds(request: TaskApprovalRequest): Promise<TaskState> {
    return this.withLockFromTask(request.taskId, async (record) => {
      const replay = record.approvalIdempotency[request.idempotencyKey]
      if (replay !== undefined) {
        if (replay !== request.challengeId) throw new MarketCoreError('task/idempotency-conflict', '幂等键已用于其他批准操作', { nextAction: 'use-a-new-key' })
        return cloneState(record.task)
      }
      if (record.cancellationRequested || record.task.status !== 'awaiting-approval') throw new MarketCoreError('task/stale-approval', '当前任务不再等待脚本批准')
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
    const stored = await this.deps.store.get(taskId)
    if (stored === undefined) throw new MarketCoreError('task/not-found', '任务不存在')
    if (hasUncertainWrite(stored) || stored.task.status === 'needs-attention') await this.reconcileInterrupted(stored.task.environmentId)
    return this.withLockFromTask(taskId, record => this.prepareResumeLocked(record))
  }

  private async prepareResumeLocked(record: TaskRecord): Promise<TaskState> {
    if (!['awaiting-resume', 'interrupted'].includes(record.task.status)) return cloneState(record.task)
    const state = await this.deps.host.readState()
    if (!this.installStateSettled(state, record.bundle.plan.items.map(item => item.packageName)) || hasUncertainWrite(record)) {
      await this.pause(record, '旧写入停止或库存状态仍未核实', true)
      return (await this.deps.store.get(record.task.taskId))!.task
    }
    record = this.refreshFacts(record, state)
    const remaining = record.task.items.filter(item => !SUCCESS_ITEM_STATUS.has(item.status) && !['cancelled', 'failed'].includes(item.status))
    const waiting = record.task.items.some(item => item.status === 'restart-required') || remaining.some(item =>
      record.bundle.dependencies.some(edge => edge.consumerId === item.pluginId && !this.edgeSatisfied(edge.prerequisiteId, edge.milestone, record)))
    if (waiting) {
      record = { ...record, task: this.withoutResume({ ...cloneState(record.task), status: 'awaiting-resume', nextAction: 'review-restart-and-resume' }) }
      return cloneState((await this.save(record)).task)
    }
    const drift = this.findDrift(record, state)
    if (drift.length > 0) { await this.pause(record, '恢复前状态漂移：' + drift.join(', ')); return (await this.deps.store.get(record.task.taskId))!.task }
    if (remaining.length === 0) return cloneState((await this.save(this.finalize(record))).task)
    const remainingPluginIds = remaining.map(item => item.pluginId)
    const digest = await sha256Hex(canonicalJson({ taskId: record.task.taskId, environmentId: record.task.environmentId,
      remainingPluginIds: [...remainingPluginIds].sort(), sessionRevision: state.sessionRevision, inventory: state.inventory }))
    const resume: ResumeChallenge = { id: 'resume-' + digest.slice(0, 24), digest, remainingPluginIds, createdAt: this.now().toISOString() }
    const next = { ...record, task: { ...cloneState(record.task), status: 'awaiting-resume' as const, resume, nextAction: 'review-restart-and-resume' } }
    return cloneState((await this.save(await this.appendEvent(next, 'awaiting-resume', '已核对剩余清单，等待用户确认继续', 'info'))).task)
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
      const refreshed = await this.prepareResumeLocked(record)
      if (refreshed.resume?.digest !== request.resumeDigest) throw new MarketCoreError('task/stale-resume', '恢复前提已变化，请重新确认')
      record = await this.deps.store.get(request.taskId) ?? record
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
      const execution = await this.deps.locks.acquire('execution:' + initial.task.environmentId, this.owner)
      try {
        const current = await this.deps.store.get(taskId)
        if (current !== undefined && !isTerminal(current.task.status)) {
          await this.assertNoUncertainWriter(current.task.environmentId, taskId)
          await this.runTaskLocked(current)
        }
      } finally { await execution.release() }
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
  private async pause(record: TaskRecord, message: string, uncertain = hasUncertainWrite(record)): Promise<void> {
    record = withExecution(record, { writeUncertain: uncertain })
    record = await this.appendEvent(record, 'needs-attention', message, 'warning')
    await this.save({ ...record, task: { ...cloneState(record.task), status: 'needs-attention', nextAction: 'reconcile-before-retrying' } })
  }

  private async runTaskLocked(startRecord: TaskRecord): Promise<void> {
    let record = cloneRecord(startRecord)
    if (['needs-attention', 'unknown', 'awaiting-approval', 'awaiting-resume'].includes(record.task.status) && !record.cancellationRequested) return
    const hostState = await this.deps.host.readState()
    if (!this.installStateSettled(hostState, record.bundle.plan.items.map(item => item.packageName))) {
      const message = hostState.activity.reason ?? 'Host 仍有活动写入或目标状态未知'
      if (this.provenNoWrite(record)) await this.cancelUnstarted(record, message)
      else await this.pause(record, message, true)
      return
    }
    if (hasUncertainWrite(record)) { await this.pause(record, '旧尝试尚未核对，不能重放'); return }
    const drift = this.findDrift(record, hostState)
    if (drift.length > 0) { await this.pause(record, '计划前置状态已变化：' + drift.join(', ')); return }
    record = this.refreshFacts(record, hostState)
    record = await this.save(this.applyKeepItems(record, hostState.inventory))

    for (const step of record.bundle.steps) {
      record = await this.deps.store.get(record.task.taskId) ?? record
      const itemIndex = record.task.items.findIndex(item => item.pluginId === step.pluginId)
      const item = record.task.items[itemIndex]
      const planItem = record.bundle.plan.items.find(candidate => candidate.pluginId === step.pluginId)
      if (item === undefined || planItem === undefined || SUCCESS_ITEM_STATUS.has(item.status) || ['failed', 'cancelled', 'blocked-by-dependency'].includes(item.status)) continue
      if (record.cancellationRequested) {
        record = await this.save(this.updateItem(record, itemIndex, { status: 'cancelled', installOutcome: 'cancelled' })); continue
      }
      // 旧持久化方案也必须遵守当前自保护边界，不能靠恢复/批准绕过预检。
      if (isProtectedMarketPackage(step.packageName) || isProtectedMarketPackage(planItem.packageName)) {
        await this.pause(record, '市场及核心包应通过官方管理入口处理', false); return
      }
      if (this.deps.host.requiresFrozenDelivery === true && !record.bundle.deliveries?.some(delivery =>
        delivery.pluginId === step.pluginId && delivery.packageName === step.packageName
        && delivery.version === item.targetVersion && delivery.artifactDigest === planItem.targetDigest)) {
        await this.pause(record, '旧计划缺少冻结来源，即使已有缓存或脚本批准也必须重新预检'); return
      }
      const dependencyBlock = this.dependencyBlock(step.pluginId, record)
      if (dependencyBlock !== undefined) {
        record = this.updateItem(record, itemIndex, { status: dependencyBlock.status, error: dependencyBlock.error, installOutcome: 'failed' })
        record = await this.save(await this.appendEvent(record, record.task.status, dependencyBlock.error, 'warning', step.pluginId)); continue
      }
      try {
        await this.deps.validateWrite?.(record.bundle, step.pluginId)
      } catch (error) {
        const reason = error instanceof Error ? error.message : '制品获取前发行状态校验失败'
        const code = typeof (error as { code?: unknown } | null)?.code === 'string'
          ? (error as { code: string }).code : 'release/acquire-rejected'
        record = this.updateItem(record, itemIndex, { status: 'failed', installOutcome: 'failed', error: reason, errorCode: code })
        await this.pause(record, '制品获取前发行状态校验拒绝：' + reason, false)
        return
      }
      let attempt = record.attempts.find(candidate => candidate.pluginId === step.pluginId && candidate.phase !== 'finished')
      if (attempt !== undefined && attempt.phase !== 'approved' && executionOf(record)?.attempts[attempt.id]?.stage !== 'prepared') {
        await this.pause(record, '安装尝试没有已核定回执，禁止自动重放', true); return
      }
      let artifact: ArtifactAcquisition
      if (attempt?.artifact === undefined) {
        record = this.updateItem(record, itemIndex, { status: 'downloading', installOutcome: 'unknown' })
        record = await this.save(await this.appendEvent(record, 'downloading', '开始获取并校验已确认的精确制品', 'info', step.pluginId))
        const abort = new AbortController()
        this.downloads.set(record.task.taskId, abort)
        try {
          if ((await this.deps.store.get(record.task.taskId))?.cancellationRequested) abort.abort()
          abort.signal.throwIfAborted()
          const delivery = record.bundle.deliveries?.find(entry => entry.pluginId === step.pluginId)
          artifact = await this.deps.artifacts.acquire({
            requestId: record.task.taskId + ':' + (record.attemptCounter + 1), pluginId: step.pluginId,
            packageName: step.packageName, version: item.targetVersion, artifactDigest: planItem.targetDigest,
            sourceRef: 'catalog:' + record.bundle.plan.catalogRevision + ':' + step.pluginId,
            ...(delivery === undefined ? {} : { delivery }),
            onProgress: async progress => {
              const phase: TaskStatus = progress.stage === 'verifying' ? 'verifying' : 'downloading'
              const total = progress.totalBytes === undefined ? '?' : String(progress.totalBytes)
              const message = `${progress.stage === 'retrying' ? '重试获取' : phase === 'verifying' ? '校验制品' : '下载制品'}：${progress.receivedBytes}/${total} bytes${progress.resumed ? '（断点续传）' : ''}`
              record = await this.save(await this.appendEvent(record, phase, message, 'info', step.pluginId))
            },
          }, abort.signal)
          abort.signal.throwIfAborted()
          if (artifact.packageName !== step.packageName || artifact.pluginId !== step.pluginId || artifact.version !== item.targetVersion || artifact.artifactDigest !== planItem.targetDigest)
            throw new MarketCoreError('artifact/identity-mismatch', '获取到的制品与确认的身份、版本或摘要不同')
        } catch (error) {
          const cancelled = abort.signal.aborted || (await this.deps.store.get(record.task.taskId))?.cancellationRequested === true
          record = this.updateItem(record, itemIndex, { status: cancelled ? 'cancelled' : 'failed',
            error: error instanceof Error ? error.message : '制品获取失败', installOutcome: cancelled ? 'cancelled' : 'failed' })
          record = await this.save(await this.appendEvent(record, cancelled ? 'cancelling' : 'failed', cancelled ? '下载已取消，未进入官方写入' : '制品获取或校验失败', cancelled ? 'warning' : 'error', step.pluginId))
          continue
        } finally { this.downloads.delete(record.task.taskId) }
        const attemptId = 'attempt-' + (record.attemptCounter + 1)
        attempt = { id: attemptId, requestId: record.task.taskId + ':' + step.pluginId + ':' + (record.attemptCounter + 1),
          pluginId: step.pluginId, phase: 'installing', artifact }
        record = { ...record, attempts: [...record.attempts, attempt], attemptCounter: record.attemptCounter + 1 }
      } else {
        artifact = attempt.artifact
        if (attempt.phase === 'approved') {
          // Approval authorizes a new call after a known ended script-gate receipt.
          attempt = { ...attempt, requestId: attempt.requestId + ':approved', phase: 'installing' }
          record = { ...record, attempts: record.attempts.map(candidate => candidate.id === attempt!.id ? attempt! : candidate) }
        }
      }
      record = withExecution(record, { attempts: { ...executionOf(record)?.attempts,
        [attempt.id]: { stage: 'prepared', sessionRevision: hostState.sessionRevision } } })
      record = await this.save(record)
      const beforeWrite = await this.deps.host.readState()
      if (!this.installStateSettled(beforeWrite, [planItem.packageName])) { await this.pause(record, '写入前仍有安装写入活动，稍后重试', true); return }
      const beforeDrift = this.findDrift(record, beforeWrite)
      if (beforeDrift.length > 0) { await this.pause(record, '写入前状态漂移：' + beforeDrift.join(', ')); return }
      try {
        await this.deps.validateWrite?.(record.bundle, step.pluginId, beforeWrite)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        const code = typeof (error as { code?: unknown } | null)?.code === 'string'
          ? (error as { code: string }).code : 'release/write-rejected'
        record = this.updateItem(record, itemIndex, { status: 'failed', installOutcome: 'failed', error: reason, errorCode: code })
        await this.pause(record, '写入前发行状态校验拒绝：' + reason, false)
        return
      }
      // Acquisition and approval can take minutes. This is the actual write-point check.
      record = await this.deps.store.get(record.task.taskId) ?? record
      if (record.cancellationRequested) {
        record = await this.save(this.updateItem(record, itemIndex, { status: 'cancelled', installOutcome: 'cancelled' })); continue
      }
      record = withExecution({ ...record, activeRequestId: attempt.requestId }, { writeUncertain: true,
        attempts: { ...executionOf(record)?.attempts, [attempt.id]: { stage: 'dispatched', sessionRevision: beforeWrite.sessionRevision } } })
      record = this.updateItem(record, itemIndex, { status: 'installing', installOutcome: 'unknown' })
      record = await this.save(await this.appendEvent(record, 'installing', '已保存发起记录，调用官方安装器', 'info', step.pluginId))
      // The control lock is never held while official code runs. Cancel may persist meanwhile.
      if ((await this.deps.store.get(record.task.taskId))?.cancellationRequested) {
        record = withExecution(this.clearActiveRequest(record), { writeUncertain: false,
          attempts: { ...executionOf(record)?.attempts, [attempt.id]: { stage: 'prepared', sessionRevision: beforeWrite.sessionRevision } } })
        record = await this.save(this.updateItem(record, itemIndex, { status: 'cancelled', installOutcome: 'cancelled' })); continue
      }
      let outcome: HostInstallOutcome
      try { outcome = await this.deps.host.install({ requestId: attempt.requestId, artifact,
        enabled: planItem.requestedEnabled, ...(attempt.approvedBuilds === undefined ? {} : { approvedBuilds: attempt.approvedBuilds }) }) }
      catch (error) { outcome = { kind: 'unknown', error: error instanceof Error ? error.message : 'Host install threw', permissionChanges: [] } }
      record = withExecution(record, { attempts: { ...executionOf(record)?.attempts,
        [attempt.id]: { stage: 'received', sessionRevision: beforeWrite.sessionRevision, outcome } } })
      record = await this.save(record)
      const after = await this.deps.host.readState()
      record = this.applyOutcome(record, itemIndex, attempt, outcome, after.inventory)
      this.logOutcome(record, step, InstallTaskManager.logAction(planItem.action), outcome, planItem.targetDigest)
      // 宽松模式（方案 1）：只有"官方明确失败且共享影响未知"仍按原语义暂停并设写入阻塞。
      // 官方异常/回执不可识别、写后库存未安定、装后核对存疑一律只写日志——
      // 不暂停任务、不阻塞后续安装、启动恢复也不再因此卡住。
      const blocked = outcome.kind === 'failed' && outcome.unknownSharedImpact === true
      const loggedOnly = !blocked && (outcome.kind === 'unknown'
        || !this.installStateSettled(after, [item.packageName])
        || record.task.items[itemIndex]?.status === 'unknown')
      const observed = packageItem(after.inventory, item.packageName)
      const barriers = { ...executionOf(record)?.restartBarriers }
      if (outcome.kind === 'applied' && outcome.restartRequired) barriers[step.pluginId] = beforeWrite.sessionRevision
      record = withExecution(record, { writeUncertain: blocked, restartBarriers: barriers,
        observed: { ...executionOf(record)?.observed, ...(observed === undefined ? {} : { [step.pluginId]: observed }) },
        attempts: { ...executionOf(record)?.attempts, [attempt.id]: { stage: blocked ? 'received' : 'verified', sessionRevision: beforeWrite.sessionRevision, outcome } } })
      if (!blocked) record = this.clearActiveRequest(record)
      record = this.refreshFacts(record, after)
      const message = outcome.kind === 'unknown' ? '已提交，结果未核实，详见安装日志'
        : loggedOnly ? '装后核对或写后库存未安定，已记入安装日志'
        : 'Host结果：' + outcome.kind
      record = await this.save(await this.appendEvent(record, record.task.status, message, blocked ? 'error' : loggedOnly ? 'warning' : 'info', step.pluginId))
      if (blocked) { await this.pause(record, '写入回执或写后库存尚未核定', true); return }
      if (outcome.kind === 'awaiting-approval') {
        if (record.cancellationRequested) { record = await this.save(this.finalize(this.cancelPending(record))); }
        return
      }
    }
    await this.save(this.finalize(record))
  }

  private cancelPending(record: TaskRecord): TaskRecord {
    return { ...record, task: this.withoutApproval({ ...cloneState(record.task), items: record.task.items.map(item =>
      SUCCESS_ITEM_STATUS.has(item.status) || item.status === 'failed' ? item : { ...item, status: 'cancelled', installOutcome: 'cancelled' }) }) }
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
        error: undefined,
        errorCode: undefined,
        diagnostic: undefined,
      })
      next = {
        ...next,
        itemFacts: { ...next.itemFacts, [item.pluginId]: this.factFromInventory(inventory, item.packageName) },
      }
    }
    return next
  }

  /** 安装日志动作映射：计划动作 → 日志动作（降级/重试都按版本变更记录）。 */
  private static logAction(action: PlanAction): InstallLogAction {
    return action === 'upgrade' || action === 'downgrade' ? 'update' : 'install'
  }

  /** 官方结果返回点的 B 档日志埋点；失败只打印，绝不影响任务推进。 */
  private logOutcome(record: TaskRecord, step: PlanStep, action: InstallLogAction, outcome: HostInstallOutcome, artifactDigest?: string): void {
    const sink = this.deps.installLog
    if (sink === undefined) return
    try {
      const delivery = record.bundle.deliveries?.find(entry => entry.pluginId === step.pluginId && entry.packageName === step.packageName)
      const source = delivery?.sources[0]
      const version = record.bundle.plan.items.find(candidate => candidate.pluginId === step.pluginId)?.targetVersion
      const error = outcome.kind === 'failed' || outcome.kind === 'unknown' ? outcome.error : undefined
      sink.append({
        at: this.now().toISOString(),
        action,
        packageName: step.packageName,
        ...(version === undefined ? {} : { version }),
        ...(artifactDigest === undefined ? {} : { artifactDigest }),
        ...(source === undefined ? {} : { source: source.kind + ':' + sha256Hex(canonicalJson(source)) }),
        officialResult: {
          kind: outcome.kind,
          ...('changed' in outcome ? { changed: outcome.changed } : {}),
          ...(error === undefined ? {} : { error }),
        },
        taskId: record.task.taskId,
      })
    } catch (error) {
      console.error('[eac-market/install-log] 记录官方结果失败', error)
    }
  }

  /** 管理动作（卸载/启用/停用）的 B 档日志埋点。 */
  private logManagement(request: CoordinatedManagementRequest, outcome: HostInstallOutcome): void {
    const sink = this.deps.installLog
    if (sink === undefined) return
    try {
      const error = outcome.kind === 'failed' || outcome.kind === 'unknown' ? outcome.error : undefined
      sink.append({
        at: this.now().toISOString(),
        action: request.action,
        packageName: request.packageName,
        version: request.expectedVersion,
        officialResult: {
          kind: outcome.kind,
          ...('changed' in outcome ? { changed: outcome.changed } : {}),
          ...(error === undefined ? {} : { error }),
        },
      })
    } catch (error) {
      console.error('[eac-market/install-log] 记录管理结果失败', error)
    }
  }

  private applyOutcome(record: TaskRecord, itemIndex: number, attempt: TaskAttemptRecord, outcome: HostInstallOutcome, inventory: InventorySnapshot): TaskRecord {
    const item = record.task.items[itemIndex]
    if (item === undefined) return record
    const permissionChanges = outcome.permissionChanges.map((change) => ({ ...change }))
    if (outcome.kind === 'applied') {
      const current = packageItem(inventory, item.packageName)
      const targetUnknown = inventory.unknownItems.some(issue => inventoryIssueAffectsPackage(issue, item.packageName))
      const requestedEnabled = record.bundle.plan.items.find(target => target.pluginId === item.pluginId)?.requestedEnabled
      if (targetUnknown || current?.installed !== true || current.source !== 'market-cache-file' || current.version !== item.targetVersion || current.bundleEnabled !== requestedEnabled) {
        // 宽松模式（方案 1）：官方已明确 applied，我方核对存疑只写日志并按已安装完成，
        // 不再把任务判成未核定；具体哪一项存疑由 host-port 装后核对日志承载。
        const status: TaskItemStatus = outcome.restartRequired ? 'restart-required'
          : current?.installed === true && current.version === item.targetVersion
            ? (current.bundleEnabled ? 'enabled' : 'disabled')
            : 'installed'
        return {
          ...this.updateItem(record, itemIndex, {
            status,
            changed: outcome.changed,
            installOutcome: outcome.restartRequired ? 'restart-required' : 'applied',
            error: '官方安装结果已确认；我方装后核对存在存疑项，已记入安装日志',
            errorCode: 'postcheck/logged',
            permissionChanges,
            ...(outcome.packageResultCode === undefined ? {} : { packageResultCode: outcome.packageResultCode }),
          }),
          itemFacts: { ...record.itemFacts, [item.pluginId]: this.factFromInventory(inventory, item.packageName) },
          attempts: record.attempts.map((candidate) => candidate.id === attempt.id ? { ...candidate, phase: 'finished' } : candidate),
        }
      }
      const status: TaskItemStatus = outcome.restartRequired ? 'restart-required' : current?.bundleEnabled ? 'enabled' : 'disabled'
      return {
        ...this.updateItem(record, itemIndex, {
          status,
          changed: outcome.changed,
          installOutcome: outcome.restartRequired ? 'restart-required' : 'applied',
          error: undefined,
          errorCode: undefined,
          diagnostic: undefined,
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
      const next = this.updateItem(record, itemIndex, { status: 'installing', installOutcome: 'unknown', permissionChanges })
      return {
        ...next,
        attempts: record.attempts.map((candidate) => candidate.id === attempt.id ? {
          ...candidate,
          phase: 'awaiting-approval',
          pendingBuilds: packages,
          pendingBuildsDigest: outcome.pendingBuildsDigest,
        } : candidate),
        task: {
          ...cloneState(next.task),
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

  private refreshFacts(record: TaskRecord, state: HostReadState): TaskRecord {
    const itemFacts = Object.fromEntries(record.bundle.plan.items.map(target => {
      const barrier = executionOf(record)?.restartBarriers[target.pluginId]
      const blocked = barrier !== undefined && (barrier === '' || barrier === state.sessionRevision)
      return [target.pluginId, this.factFromInventory(state.inventory, target.packageName, target.targetVersion, blocked)]
    }))
    return { ...cloneRecord(record), itemFacts, task: { ...cloneState(record.task), items: record.task.items.map(item => {
      if (item.status !== 'restart-required') return item
      const fact = itemFacts[item.pluginId]
      const barrier = executionOf(record)?.restartBarriers[item.pluginId]
      if (barrier === undefined || barrier === '' || barrier === state.sessionRevision || fact?.installed !== true) return item
      const target = record.bundle.plan.items.find(target => target.pluginId === item.pluginId)
      if (target?.requestedEnabled === false) return { ...item, status: 'disabled' }
      return fact.active ? { ...item, status: 'enabled' } : item
    }) } }
  }

  private factFromInventory(inventory: InventorySnapshot, packageName: string, version?: string, barrier = false): TaskItemFact {
    const item = packageItem(inventory, packageName)
    const installed = item?.installed === true && (version === undefined || item.version === version)
    return { installed, active: installed && item !== undefined && !barrier && item.bundleEnabled && !item.restartRequired
      && item.rows.length > 0 && item.rows.every(row => row.fiberPhase === 'active' && row.state === 'enabled' && row.error === undefined) }
  }

  private edgeSatisfied(prerequisiteId: string, milestone: 'installed' | 'active', record: TaskRecord): boolean {
    const fact = record.itemFacts[prerequisiteId]
    const expected = record.bundle.expected.find((candidate) => candidate.pluginId === prerequisiteId)
    const installed = fact?.installed ?? expected?.version !== undefined
    const active = fact?.active === true
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

  private findDrift(record: TaskRecord, state: HostReadState): readonly string[] {
    const drift: string[] = []
    const inventory = state.inventory
    if (inventory.environmentId !== record.task.environmentId) drift.push('environment:changed')
    const fingerprint = (state as HostReadState & { hostFingerprint?: string }).hostFingerprint
    if (fingerprint !== undefined && fingerprint !== record.bundle.plan.hostFingerprint) drift.push('host:changed')
    for (const expected of record.bundle.expected) {
      const item = packageItem(inventory, expected.packageName)
      const result = record.task.items.find(candidate => candidate.pluginId === expected.pluginId)
      const verified = result !== undefined && SUCCESS_ITEM_STATUS.has(result.status)
      const ownWrite = verified && result.changed
      const observed = executionOf(record)?.observed[expected.pluginId]
      const version = ownWrite ? result.targetVersion : expected.version
      const enabled = ownWrite ? record.bundle.plan.items.find(target => target.pluginId === expected.pluginId)?.requestedEnabled : expected.enabled
      const source = ownWrite ? observed?.source : expected.source
      const identity = ownWrite ? (observed as InventoryItem & { localIdentity?: string } | undefined)?.localIdentity : expected.localIdentity
      const present = version !== undefined
      if (present !== (item?.installed === true)) drift.push(expected.packageName + ':presence')
      if (!present) continue
      if (item?.version !== version) drift.push(expected.packageName + ':version')
      if (item?.bundleEnabled !== enabled) drift.push(expected.packageName + ':enabled')
      if (source !== undefined && item?.source !== source) drift.push(expected.packageName + ':source')
      const actualIdentity = (item as InventoryItem & { localIdentity?: string } | undefined)?.localIdentity
      if (identity !== undefined && actualIdentity !== undefined && identity !== actualIdentity) drift.push(expected.packageName + ':local-identity')
      if (item?.readOnlyReason !== undefined) drift.push(expected.packageName + ':protected')
    }
    return drift
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
