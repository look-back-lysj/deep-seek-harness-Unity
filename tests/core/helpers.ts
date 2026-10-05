import { vi } from 'vitest'
import type {
  InventoryItem,
  InventorySnapshot,
  PackExecution,
  TaskEvent,
  TaskState,
} from '../../packages/market-core/src/contracts/types.ts'
import { canonicalJson, sha256Hex } from '../../packages/market-core/src/core/canonical.ts'
import type {
  ArtifactAcquireRequest,
  ArtifactAcquisition,
  ArtifactPort,
  HostCancelOutcome,
  HostInstallOutcome,
  HostPort,
  HostReadState,
  PackExecutionContext,
  PlanBundle,
  PlanCatalogContext,
  ProfileLockHandle,
  ProfileLockPort,
  TaskEventLogPort,
  TaskRecord,
  TaskStorePort,
} from '../../packages/market-core/src/core/ports.ts'
import { createPlanBundle } from '../../packages/market-core/src/core/planner.ts'
import { InstallTaskManager, type TaskManagerDeps } from '../../packages/market-core/src/core/task-manager.ts'

export function inventoryItem(packageName: string, version: string | undefined, enabled = true): InventoryItem {
  return {
    packageName,
    ...(version === undefined ? {} : { version }),
    source: 'profile',
    installed: version !== undefined,
    bundleEnabled: enabled,
    removable: true,
    rows: [],
    restartRequired: false,
  }
}

export function snapshot(items: readonly InventoryItem[]): InventorySnapshot {
  return { environmentId: 'env-test', revision: 'inventory-test', items, unknownItems: [] }
}

export class InMemoryTaskStore implements TaskStorePort {
  readonly records = new Map<string, TaskRecord>()
  private readonly byPlan = new Map<string, string>()
  async getByPlan(environmentId: string, planId: string): Promise<TaskRecord | undefined> {
    const taskId = this.byPlan.get(`${environmentId}\u0000${planId}`)
    return taskId === undefined ? undefined : this.records.get(taskId)
  }
  async get(taskId: string): Promise<TaskRecord | undefined> { return this.records.get(taskId) }
  async put(record: TaskRecord): Promise<void> {
    const key = `${record.task.environmentId}\u0000${record.task.planId}`
    const prior = this.byPlan.get(key)
    if (prior !== undefined && prior !== record.task.taskId) throw new Error('duplicate plan task')
    this.records.set(record.task.taskId, record)
    this.byPlan.set(key, record.task.taskId)
  }
  async list(environmentId: string): Promise<readonly TaskRecord[]> {
    return [...this.records.values()].filter((record) => record.task.environmentId === environmentId)
  }
}

export class InMemoryLocks implements ProfileLockPort {
  private readonly tails = new Map<string, Promise<void>>()
  private readonly active = new Map<string, { owner: string; refs: number }>()
  async acquire(profileKey: string, owner = 'anonymous'): Promise<ProfileLockHandle> {
    const held = this.active.get(profileKey)
    if (held?.owner === owner) {
      held.refs += 1
      return this.handle(profileKey, owner)
    }
    const prior = this.tails.get(profileKey) ?? Promise.resolve()
    let releasePrior = (): void => {}
    const turn = new Promise<void>((resolve) => { releasePrior = resolve })
    this.tails.set(profileKey, prior.then(() => turn))
    await prior
    this.active.set(profileKey, { owner, refs: 1 })
    const handle = this.handle(profileKey, owner)
    const originalRelease = handle.release
    return {
      release: async () => {
        await originalRelease()
        releasePrior()
      },
    }
  }
  private handle(profileKey: string, owner: string): ProfileLockHandle {
    return {
      release: async () => {
        const held = this.active.get(profileKey)
        if (held === undefined || held.owner !== owner) throw new Error('lock owner mismatch')
        held.refs -= 1
        if (held.refs === 0) this.active.delete(profileKey)
      },
    }
  }
  isHeld(profileKey: string): boolean { return this.active.has(profileKey) }
}

export class FakeArtifactPort implements ArtifactPort {
  readonly acquired: ArtifactAcquireRequest[] = []
  fail = false
  async acquire(request: ArtifactAcquireRequest): Promise<ArtifactAcquisition> {
    this.acquired.push(request)
    if (this.fail) throw new Error('disk-full')
    return {
      pluginId: request.pluginId,
      packageName: request.packageName,
      version: request.version,
      artifactDigest: request.artifactDigest,
      localRef: `cache/${request.artifactDigest}.tgz`,
      size: 1024,
    }
  }
  async release(): Promise<void> {}
}

export class FakeHost implements HostPort {
  readonly calls: { packageName: string; approvedBuilds?: readonly string[] }[] = []
  readonly cancelCalls: string[] = []
  readonly items = new Map<string, InventoryItem>()
  readonly outcomes = new Map<string, HostInstallOutcome[]>()
  sessionRevision = 'session-1'
  stable = true
  unknownSharedImpact = false
  writeBarrier = false
  unknownItems: string[] = []
  cancelOutcome: HostCancelOutcome = { kind: 'too-late' }
  installGate: Promise<void> | undefined
  constructor(items: readonly InventoryItem[] = []) {
    for (const item of items) this.items.set(item.packageName, item)
  }
  setOutcome(packageName: string, outcome: HostInstallOutcome): void { this.outcomes.set(packageName, [outcome]) }
  async readState(): Promise<HostReadState> {
    return {
      inventory: { ...snapshot([...this.items.values()].map((item) => ({ ...item, rows: item.rows.map((row) => ({ ...row })) }))), unknownItems: [...this.unknownItems] },
      sessionRevision: this.sessionRevision,
      activeRequests: [],
      activity: {
        stable: this.stable,
        unknownSharedImpact: this.unknownSharedImpact,
        writeBarrier: this.writeBarrier,
        ...(this.stable || !this.writeBarrier ? {} : { reason: 'old writer still active' }),
      },
    }
  }
  async install(request: { artifact: ArtifactAcquisition; enabled: boolean; approvedBuilds?: readonly string[] }): Promise<HostInstallOutcome> {
    const packageName = request.artifact.packageName
    this.calls.push({ packageName, ...(request.approvedBuilds === undefined ? {} : { approvedBuilds: request.approvedBuilds }) })
    if (this.installGate !== undefined) await this.installGate
    const queue = this.outcomes.get(packageName)
    const outcome = queue?.shift() ?? { kind: 'applied' as const, changed: true, restartRequired: false, permissionChanges: [] }
    if (outcome.kind === 'applied' || (outcome.kind === 'failed' && outcome.changed) || (outcome.kind === 'cancelled' && outcome.changed)) {
      this.items.set(packageName, {
        packageName,
        version: request.artifact.version,
        source: 'market-cache-file',
        installed: true,
        bundleEnabled: request.enabled,
        removable: true,
        rows: request.enabled ? [{ id: packageName + '-test-entry', name: packageName, state: 'enabled', fiberPhase: 'active' }] : [],
        restartRequired: outcome.kind === 'applied' && outcome.restartRequired,
      })
    }
    return outcome
  }
  async cancel(requestId: string): Promise<HostCancelOutcome> {
    this.cancelCalls.push(requestId)
    return this.cancelOutcome
  }
}

export class MemoryEventLog implements TaskEventLogPort {
  readonly byTask = new Map<string, TaskEvent[]>()
  async append(taskId: string, event: TaskEvent): Promise<void> {
    this.byTask.set(taskId, [...this.byTask.get(taskId) ?? [], event])
  }
  async read(taskId: string, afterSequence: number, limit: number): Promise<{ events: readonly TaskEvent[]; nextSequence: number; truncated: boolean }> {
    const events = (this.byTask.get(taskId) ?? []).filter((event) => event.sequence > afterSequence)
    return { events: events.slice(0, limit), nextSequence: (events.at(-1)?.sequence ?? afterSequence) + 1, truncated: false }
  }
  async cleanup(): Promise<{ removedSegments: number; truncated: boolean }> { return { removedSegments: 0, truncated: false } }
}

export interface SyntheticPlugin {
  readonly packageName: string
  readonly version: string
  readonly requiresRestart?: boolean
  readonly currentVersion?: string
  readonly currentEnabled?: boolean
  readonly localIdentity?: 'file' | 'link' | 'fork' | 'registry' | 'unknown'
}

export interface SyntheticPlanOptions {
  readonly plugins: readonly SyntheticPlugin[]
  readonly edges?: PackExecution['edges']
  readonly lockBytes?: Uint8Array
  readonly coverage?: PackExecution['coverage']
  readonly planId?: string
  readonly now?: Date
}

export async function makeBundle(options: SyntheticPlanOptions): Promise<PlanBundle> {
  const lockBytes = options.lockBytes ?? new TextEncoder().encode('exact-lock-bytes')
  const components = options.plugins.map((plugin, index) => ({ pluginId: `p${index}`, required: true }))
  const execution: PackExecution = {
    schemaVersion: '1',
    packId: 'pack-test',
    packVersion: '1.0.0',
    lockDigest: await sha256Hex(lockBytes),
    coverage: options.coverage ?? 'complete',
    edges: options.edges ?? [],
    provenance: 'synthetic-test-only',
  }
  const plugins = options.plugins.map((plugin, index) => ({
    pluginId: `p${index}`,
    packageName: plugin.packageName,
    version: plugin.version,
    artifactDigest: `digest-${plugin.packageName}`,
    verification: 'verified' as const,
    requiresRestart: plugin.requiresRestart ?? false,
    installable: true,
  }))
  const inventory = options.plugins.map((plugin) => inventoryItem(plugin.packageName, plugin.currentVersion, plugin.currentEnabled ?? true))
  const context: PlanCatalogContext = {
    ...(options.planId === undefined ? {} : { planId: options.planId }),
    catalogRevision: 'catalog-1',
    environmentId: 'env-test',
    hostFingerprint: 'host-test',
    inventory,
    plugins,
    selections: plugins.map((plugin) => ({
      pluginId: plugin.pluginId,
      packageName: plugin.packageName,
      targetVersion: plugin.version,
      targetDigest: plugin.artifactDigest,
      enabledIntent: true,
      tryUnverified: false,
    })),
    now: options.now ?? new Date('2026-09-27T00:00:00.000Z'),
    ttlMs: 60_000,
    marketManagedPackageNames: options.plugins.filter((plugin) => plugin.localIdentity === undefined || plugin.localIdentity === 'registry').map((plugin) => plugin.packageName),
    localIdentityByPackage: Object.fromEntries(options.plugins.map((plugin) => [plugin.packageName, plugin.localIdentity ?? 'registry'])),
  }
  const pack: PackExecutionContext = {
    packId: 'pack-test',
    packVersion: '1.0.0',
    components,
    execution,
    lockBytes,
  }
  const result = await createPlanBundle(context, pack)
  if (result.status !== 'ready' || result.bundle === undefined) {
    throw new Error(`plan not ready: ${result.reason ?? ''} ${(result.details ?? []).join(',')}`)
  }
  return result.bundle
}

export async function makeManager(bundle: PlanBundle, host = new FakeHost(), store = new InMemoryTaskStore(), extra: Partial<TaskManagerDeps> = {}): Promise<{
  manager: InstallTaskManager
  host: FakeHost
  store: InMemoryTaskStore
  artifacts: FakeArtifactPort
  taskId: string
}> {
  const artifacts = new FakeArtifactPort()
  let clock = Date.parse('2026-09-27T00:00:01.000Z')
  const manager = new InstallTaskManager({
    host,
    artifacts,
    store,
    locks: new InMemoryLocks(),
    events: new MemoryEventLog(),
    now: () => new Date(clock++),
    ...extra,
  })
  const outcome = await manager.start(bundle, {
    planId: bundle.plan.planId,
    planDigest: bundle.plan.planDigest,
    idempotencyKey: 'start-' + bundle.plan.planId,
    confirmed: true,
  }, await host.readState())
  return { manager, host, store, artifacts, taskId: outcome.task.taskId }
}

export async function waitForTask(
  manager: InstallTaskManager,
  taskId: string,
  predicate: (task: TaskState) => boolean,
): Promise<TaskState> {
  return vi.waitFor(async () => {
    const task = await manager.get(taskId)
    if (task === undefined || !predicate(task)) throw new Error(`task not ready: ${task?.status ?? 'missing'} ${JSON.stringify(task)}`)
    return task
  }, { timeout: 2000, interval: 10 })
}

export async function approvalDigest(packages: readonly string[]): Promise<string> {
  return sha256Hex(canonicalJson([...packages].sort()))
}
