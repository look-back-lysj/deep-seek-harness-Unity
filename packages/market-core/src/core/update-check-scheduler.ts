import type { UpdateCheckResult, UpdatePolicySnapshot } from '../contracts/types.ts'
import { canonicalJson, sha256Hex } from './canonical.ts'
import type { ProfileLockPort } from './ports.ts'
import { decodeJson, encodeJson, type PersistenceFilePort, PersistenceError } from '../persistence/files.ts'
import { shouldAutomaticallyCheck } from './update-policy.ts'

const PATH = 'settings/update-check-state.json'
const OWNER = 'market-update-check-state'
const SCHEMA_VERSION = '1' as const

type TimerHandle = ReturnType<typeof setTimeout>

type UpdateCheckRequest = { readonly sourceId?: string; readonly refreshFirst?: boolean }

/** Core-private state. It is persisted for restart recovery but is not a wire DTO. */
export interface UpdateCheckScheduleState {
  readonly lastCheckedAt?: string
  readonly nextCheckAt?: string
  readonly lastResult?: UpdateCheckResult
  readonly lastError?: 'automatic-check-failed'
}

interface StoredUpdateCheckState {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly revision: string
  readonly state: UpdateCheckScheduleState
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validUpdateCheckResult(value: unknown): value is UpdateCheckResult {
  if (!isRecord(value)
    || !validTimestamp(value.checkedAt)
    || typeof value.sourceRevision !== 'string'
    || typeof value.catalogStale !== 'boolean'
    || typeof value.inventoryRevision !== 'string'
    || !Array.isArray(value.items)) return false
  return value.items.every(item => isRecord(item)
    && typeof item.packageName === 'string'
    && (item.pluginId === undefined || typeof item.pluginId === 'string')
    && (item.installedVersion === undefined || typeof item.installedVersion === 'string')
    && (item.latestVersion === undefined || typeof item.latestVersion === 'string')
    && (item.status === 'update-available' || item.status === 'up-to-date' || item.status === 'not-in-catalog' || item.status === 'unknown' || item.status === 'incompatible')
    && (item.reason === undefined || typeof item.reason === 'string'))
}

function normalizeState(value: unknown): UpdateCheckScheduleState {
  if (!isRecord(value)) throw new PersistenceError('update-check-state/corrupt', '自动更新检查状态不是对象')
  const allowed = new Set(['lastCheckedAt', 'nextCheckAt', 'lastResult', 'lastError'])
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw new PersistenceError('update-check-state/corrupt', '自动更新检查状态包含未知字段')
  }
  if (value.lastCheckedAt !== undefined && !validTimestamp(value.lastCheckedAt)) {
    throw new PersistenceError('update-check-state/corrupt', '自动更新检查状态的最近检查时间无效')
  }
  if (value.nextCheckAt !== undefined && !validTimestamp(value.nextCheckAt)) {
    throw new PersistenceError('update-check-state/corrupt', '自动更新检查状态的下次检查时间无效')
  }
  if (value.lastError !== undefined && value.lastError !== 'automatic-check-failed') {
    throw new PersistenceError('update-check-state/corrupt', '自动更新检查状态的失败标记无效')
  }
  if (value.lastResult !== undefined && !validUpdateCheckResult(value.lastResult)) {
    throw new PersistenceError('update-check-state/corrupt', '自动更新检查状态的检查结果无效')
  }
  return {
    ...(value.lastCheckedAt === undefined ? {} : { lastCheckedAt: value.lastCheckedAt }),
    ...(value.nextCheckAt === undefined ? {} : { nextCheckAt: value.nextCheckAt }),
    ...(value.lastResult === undefined ? {} : { lastResult: value.lastResult }),
    ...(value.lastError === undefined ? {} : { lastError: value.lastError }),
  }
}

function cloneResult(result: UpdateCheckResult): UpdateCheckResult {
  return {
    checkedAt: result.checkedAt,
    sourceRevision: result.sourceRevision,
    catalogStale: result.catalogStale,
    inventoryRevision: result.inventoryRevision,
    items: result.items.map(item => ({ ...item })),
  }
}

export class UpdateCheckScheduleStore {
  constructor(
    private readonly files: PersistenceFilePort,
    private readonly locks: ProfileLockPort,
  ) {}

  async load(): Promise<UpdateCheckScheduleState> {
    const bytes = await this.files.read(PATH)
    if (bytes === undefined) return {}
    let raw: unknown
    try { raw = decodeJson(bytes) }
    catch (error) {
      throw new PersistenceError('update-check-state/corrupt', '自动更新检查状态文件损坏；保留原文件供诊断', true, { cause: error })
    }
    if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION || typeof raw.revision !== 'string' || !('state' in raw)) {
      throw new PersistenceError('update-check-state/corrupt', '自动更新检查状态封套无效；保留原文件供诊断')
    }
    const state = normalizeState(raw.state)
    const expected = await sha256Hex(canonicalJson(state))
    if (expected !== raw.revision) {
      throw new PersistenceError('update-check-state/checksum', '自动更新检查状态校验失败；保留原文件供诊断')
    }
    return state
  }

  async save(state: UpdateCheckScheduleState): Promise<void> {
    const lock = await this.locks.acquire('settings:update-check-state', OWNER)
    try {
      // Revalidate under the write lock: damage may have appeared since start.
      // Never replace unverified bytes with an apparently healthy snapshot.
      await this.load()
      const normalized = normalizeState(state)
      const revision = await sha256Hex(canonicalJson(normalized))
      const document: StoredUpdateCheckState = { schemaVersion: SCHEMA_VERSION, revision, state: normalized }
      await this.files.writeAtomic(PATH, encodeJson(document))
    } finally {
      await lock.release()
    }
  }
}

export interface UpdateCheckSchedulerOptions {
  readonly files: PersistenceFilePort
  readonly locks: ProfileLockPort
  readonly getPolicy: () => Promise<UpdatePolicySnapshot>
  readonly checkUpdates: (request?: UpdateCheckRequest) => Promise<UpdateCheckResult>
  readonly now?: () => Date
  readonly onError?: (error: unknown) => void
}

/**
 * Host-lifecycle-owned, read-only update checker. It never creates a plan,
 * downloads an artifact, or starts an install; those remain explicit actions.
 */
export class UpdateCheckScheduler {
  private readonly store: UpdateCheckScheduleStore
  private readonly now: () => Date
  private readonly onError: (error: unknown) => void
  private timer: TimerHandle | undefined
  private started = false
  private running = false
  private persistenceBlocked = false
  private lifecycle = 0
  private scheduleGeneration = 0
  private checkIntervalMs = 60 * 60_000
  private state: UpdateCheckScheduleState = {}

  constructor(private readonly options: UpdateCheckSchedulerOptions) {
    this.store = new UpdateCheckScheduleStore(options.files, options.locks)
    this.now = options.now ?? (() => new Date())
    this.onError = options.onError ?? (() => {})
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const lifecycle = ++this.lifecycle
    try {
      const state = await this.store.load()
      if (!this.isActive(lifecycle)) return
      this.state = state
      this.persistenceBlocked = false
    } catch (error) {
      if (!this.isActive(lifecycle)) return
      // Do not overwrite a corrupt state file. A fresh read-only cycle may
      // still proceed, while the original bytes remain available for diagnosis.
      this.persistenceBlocked = true
      this.state = {}
      this.report(error)
    }
    if (this.isActive(lifecycle)) await this.reschedule()
  }

  stop(): void {
    this.started = false
    this.lifecycle += 1
    this.scheduleGeneration += 1
    this.clearTimer()
  }

  async refresh(): Promise<void> {
    if (!this.started) return
    this.clearTimer()
    await this.reschedule()
  }

  /** Test/diagnostic access to the in-memory view; never exposed through Remote. */
  stateSnapshot(): UpdateCheckScheduleState {
    return {
      ...(this.state.lastCheckedAt === undefined ? {} : { lastCheckedAt: this.state.lastCheckedAt }),
      ...(this.state.nextCheckAt === undefined ? {} : { nextCheckAt: this.state.nextCheckAt }),
      ...(this.state.lastResult === undefined ? {} : { lastResult: cloneResult(this.state.lastResult) }),
      ...(this.state.lastError === undefined ? {} : { lastError: this.state.lastError }),
    }
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private report(error: unknown): void {
    try { this.onError(error) } catch { /* diagnostics must not break the scheduler */ }
  }

  private isActive(lifecycle: number): boolean {
    return this.started && this.lifecycle === lifecycle
  }

  private async persist(): Promise<void> {
    if (!this.started || this.persistenceBlocked) return
    try { await this.store.save(this.state) }
    catch (error) {
      if (error instanceof PersistenceError
        && (error.code === 'update-check-state/corrupt' || error.code === 'update-check-state/checksum')) this.persistenceBlocked = true
      this.report(error)
    }
  }

  private recordFailure(error: unknown): void {
    const failedAt = this.now()
    this.state = {
      lastCheckedAt: failedAt.toISOString(),
      nextCheckAt: new Date(failedAt.getTime() + this.checkIntervalMs).toISOString(),
      lastError: 'automatic-check-failed',
    }
    this.report(error)
  }

  private intervalMs(policy: UpdatePolicySnapshot['policy']): number {
    return (policy.intervalMinutes ?? 60) * 60_000
  }

  private dueAt(policy: UpdatePolicySnapshot['policy'], now: Date): number {
    const last = this.state.lastCheckedAt === undefined ? undefined : Date.parse(this.state.lastCheckedAt)
    if (!Number.isFinite(last)) return now.getTime()
    return last! + this.intervalMs(policy)
  }

  private async reschedule(): Promise<void> {
    if (!this.started) return
    const lifecycle = this.lifecycle
    const generation = ++this.scheduleGeneration
    const current = (): boolean => this.isActive(lifecycle) && generation === this.scheduleGeneration
    this.clearTimer()
    let nextCheckAt: number
    try {
      const snapshot = await this.options.getPolicy()
      if (!current()) return
      this.checkIntervalMs = this.intervalMs(snapshot.policy)
      if (!snapshot.policy.automaticChecksEnabled) {
        const { nextCheckAt: _nextCheckAt, ...withoutNextCheck } = this.state
        this.state = withoutNextCheck
        await this.persist()
        return
      }
      const now = this.now()
      nextCheckAt = Math.max(now.getTime(), this.dueAt(snapshot.policy, now))
      this.state = { ...this.state, nextCheckAt: new Date(nextCheckAt).toISOString() }
    } catch (error) {
      if (!current()) return
      // A policy read is part of the attempt too. Use the last known period
      // (or the 60-minute default) rather than hot-looping or stopping forever.
      this.recordFailure(error)
      nextCheckAt = Date.parse(this.state.nextCheckAt!)
    }
    await this.persist()
    // stop/refresh can invalidate this operation during either awaited read or
    // save. Only the latest schedule may own a timer; an active check rearms it.
    if (!current() || this.running) return
    this.timer = setTimeout(() => {
      if (!current()) return
      this.timer = undefined
      void this.runScheduledCheck().catch(error => this.report(error))
    }, Math.max(0, nextCheckAt - this.now().getTime()))
  }

  private async runScheduledCheck(): Promise<void> {
    if (!this.started || this.running) return
    const lifecycle = this.lifecycle
    const generation = this.scheduleGeneration
    let dispatched = false
    this.running = true
    try {
      const policy = await this.options.getPolicy()
      if (!this.isActive(lifecycle) || generation !== this.scheduleGeneration) return
      this.checkIntervalMs = this.intervalMs(policy.policy)
      const now = this.now()
      if (!policy.policy.automaticChecksEnabled
        || !shouldAutomaticallyCheck(policy.policy, { ...(this.state.lastCheckedAt === undefined ? {} : { lastCheckedAt: this.state.lastCheckedAt }), now })) return
      // Refresh may update the accepted catalog cache, but never creates a
      // plan, downloads an artifact, or invokes pluginManager writes.
      dispatched = true
      const result = await this.options.checkUpdates({ refreshFirst: true })
      if (!this.isActive(lifecycle)) return
      const completedAt = this.now()
      this.state = {
        lastCheckedAt: completedAt.toISOString(),
        nextCheckAt: new Date(completedAt.getTime() + this.checkIntervalMs).toISOString(),
        lastResult: cloneResult(result),
      }
      await this.persist()
    } catch (error) {
      if (!this.isActive(lifecycle) || (!dispatched && generation !== this.scheduleGeneration)) return
      this.recordFailure(error)
      await this.persist()
    } finally {
      this.running = false
      if (this.started) await this.reschedule()
    }
  }

}

export const UPDATE_CHECK_SCHEDULE_PATH = PATH

