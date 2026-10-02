import type {
  CoreMaintenanceSnapshot,
  InventoryItem,
  InventorySnapshot,
  MaintenancePackageState,
  TaskItemStatus,
  TaskState,
  UpdatePolicy,
} from '../contracts/types.ts'
import {
  computePackageSync,
  type PackageDependencyEdge,
  type PackageSyncState,
} from './sync-state.ts'
import { normalizeUpdatePolicy, type UpdatePolicyInput } from './update-policy.ts'

export type MaintenanceAction = 'install' | 'update' | 'remove' | 'retain' | 'enable' | 'disable' | 'blocked'
export type MaintenanceOperationPhase = 'pending' | 'in-progress' | 'succeeded' | 'failed' | 'awaiting-restart' | 'unknown'

export interface MaintenanceTarget {
  readonly packageName: string
  readonly pluginId?: string
  readonly targetVersion?: string
  readonly enabled?: boolean
  readonly action?: MaintenanceAction
  readonly reason?: string
}

export interface MaintenanceOperation {
  readonly packageName: string
  readonly action: MaintenanceAction
  readonly phase: MaintenanceOperationPhase
  readonly targetVersion?: string
  readonly reason?: string
  readonly restartRequired?: boolean
}

export interface MaintenanceSnapshotInput {
  readonly environmentId: string
  readonly inventory: InventorySnapshot
  readonly revision?: string
  readonly generatedAt?: Date | string
  readonly updatePolicy?: UpdatePolicyInput | UpdatePolicy | null
  readonly tasks?: readonly TaskState[]
  readonly activeTaskIds?: readonly string[]
  readonly targets?: readonly MaintenanceTarget[]
  readonly operations?: readonly MaintenanceOperation[]
  readonly explicitPackages?: readonly string[]
  readonly selectedPackages?: readonly string[]
  readonly dependencyEdges?: readonly PackageDependencyEdge[]
  readonly unknownPackages?: readonly string[]
}

interface PackageFacts {
  readonly packageName: string
  readonly pluginId?: string
  readonly inventory?: InventoryItem
  readonly target?: MaintenanceTarget
  readonly operation?: MaintenanceOperation
  readonly sync: PackageSyncState
  readonly task?: TaskItemFact
  readonly unknown: boolean
}

interface TaskItemFact {
  readonly status: TaskItemStatus
  readonly taskStatus: TaskState['status']
  readonly targetVersion: string
  readonly pluginId: string
  readonly taskId: string
}

const ACTIVE_TASK_STATUSES: ReadonlySet<TaskState['status']> = new Set([
  'queued', 'downloading', 'verifying', 'installing', 'awaiting-approval',
  'awaiting-resume', 'cancelling', 'applying', 'checking', 'interrupted',
  'needs-attention', 'unknown',
])

const UNKNOWN_TASK_STATUSES: ReadonlySet<TaskState['status']> = new Set(['unknown', 'needs-attention', 'interrupted'])

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(value => value.trim().length > 0))].sort()
}

function dateValue(value: Date | string | undefined): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? new Date(0).toISOString() : value.toISOString()
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  return new Date().toISOString()
}

function inventoryInstalled(inventory: InventoryItem | undefined): boolean {
  return inventory?.installed === true
}

function latestTaskFacts(tasks: readonly TaskState[]): Map<string, TaskItemFact> {
  const result = new Map<string, TaskItemFact>()
  const ordered = tasks.slice().sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt)
    const rightTime = Date.parse(right.updatedAt)
    return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0)
  })
  for (const task of ordered) {
    // A terminal task is history, not the current package fact. Only active or
    // unresolved tasks may project an in-progress/unknown package state.
    if (!ACTIVE_TASK_STATUSES.has(task.status)) continue
    for (const item of task.items) {
      result.set(item.packageName, {
        status: item.status,
        taskStatus: task.status,
        targetVersion: item.targetVersion,
        pluginId: item.pluginId,
        taskId: task.taskId,
      })
    }
  }
  return result
}

function taskInstallState(fact: TaskItemFact | undefined, installed: boolean): MaintenancePackageState['installState'] | undefined {
  if (fact === undefined || !ACTIVE_TASK_STATUSES.has(fact.taskStatus)) return undefined
  if (UNKNOWN_TASK_STATUSES.has(fact.taskStatus) || fact.status === 'unknown') return 'unknown'
  if (fact.status === 'downloading' || fact.status === 'verifying' || fact.status === 'installing' || fact.status === 'pending') {
    return installed ? 'updating' : 'installing'
  }
  if (fact.status === 'blocked-by-dependency' || fact.status === 'blocked-on-restart') return 'unknown'
  // Active task receipts are not authoritative installed facts. Keep the live
  // inventory as the state; the item status is represented by the active task.
  return undefined
}

function operationInstallState(operation: MaintenanceOperation | undefined, installed: boolean): MaintenancePackageState['installState'] | undefined {
  if (operation === undefined) return undefined
  if (operation.phase === 'unknown') return 'unknown'
  if (operation.phase === 'failed') return 'failed'
  if (operation.action === 'remove') {
    if (operation.phase === 'pending' || operation.phase === 'in-progress') return 'uninstalling'
    return installed ? 'installed' : 'not-installed'
  }
  if (operation.action === 'install') {
    if (operation.phase === 'pending' || operation.phase === 'in-progress') return 'installing'
    return installed ? 'installed' : 'not-installed'
  }
  if (operation.action === 'update') {
    if (operation.phase === 'pending' || operation.phase === 'in-progress') return 'updating'
    return installed ? 'installed' : 'not-installed'
  }
  return undefined
}

function installStateFor(facts: PackageFacts): MaintenancePackageState['installState'] {
  if (facts.unknown) return 'unknown'
  const installed = inventoryInstalled(facts.inventory)
  const operationState = operationInstallState(facts.operation, installed)
  if (operationState !== undefined) return operationState
  const taskState = taskInstallState(facts.task, installed)
  if (taskState !== undefined) return taskState
  // A settled host inventory takes precedence over a terminal historical task.
  return installed ? 'installed' : 'not-installed'
}

function enabledStateFor(facts: PackageFacts, installState: MaintenancePackageState['installState']): MaintenancePackageState['enabledState'] {
  if (facts.unknown || installState === 'unknown') return 'unknown'
  if (facts.operation?.phase === 'awaiting-restart' || facts.operation?.restartRequired === true) return 'pending-restart'
  if (facts.inventory?.restartRequired === true
    || (facts.task?.status === 'restart-required' && facts.task.taskStatus === 'awaiting-resume')) return 'pending-restart'
  if (!inventoryInstalled(facts.inventory)) return 'unknown'
  // Targets describe desired state, never a successful Host state transition.
  return facts.inventory?.bundleEnabled === true ? 'enabled' : 'disabled'
}

function explicitStateFor(facts: PackageFacts): MaintenancePackageState['explicitState'] {
  if (facts.unknown || facts.sync.explicitState === 'unknown') return 'unknown'
  return facts.sync.explicitState
}

function effectiveStateFor(
  facts: PackageFacts,
  installState: MaintenancePackageState['installState'],
  explicitState: MaintenancePackageState['explicitState'],
): MaintenancePackageState['effectiveState'] {
  if (facts.unknown || installState === 'unknown' || explicitState === 'unknown') return 'unknown'
  // A task receipt is not a substitute for the post-write inventory read.
  // Keep the action unknown until Core receives that host fact.
  if (facts.inventory === undefined && facts.task !== undefined && !UNKNOWN_TASK_STATUSES.has(facts.task.taskStatus)) return 'unknown'
  if (facts.operation?.phase === 'failed' || facts.target?.action === 'blocked') return 'blocked'
  if (facts.operation?.action === 'remove' || facts.target?.action === 'remove') {
    return inventoryInstalled(facts.inventory) ? 'remove' : 'blocked'
  }
  if (facts.operation?.action === 'install' || facts.target?.action === 'install') return 'install'
  const targetVersion = facts.operation?.targetVersion ?? facts.target?.targetVersion ?? facts.task?.targetVersion
  if (!inventoryInstalled(facts.inventory)) {
    if (targetVersion !== undefined) return 'install'
    return explicitState === 'explicit' ? 'blocked' : 'retain'
  }
  if (targetVersion !== undefined && targetVersion !== facts.inventory?.version) return 'update'
  return 'retain'
}

function reasonsFor(
  facts: PackageFacts,
  installState: MaintenancePackageState['installState'],
  enabledState: MaintenancePackageState['enabledState'],
  effectiveState: MaintenancePackageState['effectiveState'],
): string[] {
  const reasons: string[] = []
  if (facts.operation?.reason) reasons.push(facts.operation.reason)
  if (facts.target?.reason) reasons.push(facts.target.reason)
  if (facts.task?.taskId) reasons.push(`task:${facts.task.taskId}`)
  if (facts.sync.dependencyState.requiredByCount > 0) reasons.push(`dependency-of:${facts.sync.dependencyState.dependencyOf.join(',')}`)
  if (facts.sync.explicitState === 'explicit') reasons.push('explicit-intent')
  if (facts.target?.targetVersion !== undefined && facts.target.targetVersion !== facts.inventory?.version) reasons.push('target-version')
  if (effectiveState === 'install') reasons.push('install-requested')
  if (effectiveState === 'update') reasons.push('update-available')
  if (effectiveState === 'remove') reasons.push('remove-requested')
  if (effectiveState === 'blocked') reasons.push('action-blocked')
  if (facts.inventory?.restartRequired === true || enabledState === 'pending-restart') reasons.push('pending-restart')
  if (installState === 'failed') reasons.push('operation-failed')
  if (installState === 'unknown' || effectiveState === 'unknown') reasons.push('state-unknown')
  return uniqueSorted(reasons)
}

function collectFacts(input: MaintenanceSnapshotInput, sync: Readonly<Record<string, PackageSyncState>>): PackageFacts[] {
  const inventoryByName = new Map(input.inventory.items.map(item => [item.packageName, item]))
  const targets = new Map((input.targets ?? []).map(target => [target.packageName, target]))
  const operations = new Map((input.operations ?? []).map(operation => [operation.packageName, operation]))
  const tasks = latestTaskFacts(input.tasks ?? [])
  const unknown = new Set(input.unknownPackages ?? [])
  const names = new Set<string>([
    ...input.inventory.items.map(item => item.packageName),
    ...(input.targets ?? []).map(target => target.packageName),
    ...(input.operations ?? []).map(operation => operation.packageName),
    ...tasks.keys(),
    ...(input.tasks ?? []).flatMap(task => task.items.map(item => item.packageName)),
    ...Object.keys(sync),
    ...unknown,
  ])
  return uniqueSorted(names).map(packageName => {
    const inventory = inventoryByName.get(packageName)
    const target = targets.get(packageName)
    const operation = operations.get(packageName)
    const task = tasks.get(packageName)
    return {
      packageName,
      ...(inventory?.pluginId === undefined ? {} : { pluginId: inventory.pluginId }),
      ...(target?.pluginId !== undefined ? { pluginId: target.pluginId } : {}),
      ...(inventory === undefined ? {} : { inventory }),
      ...(target === undefined ? {} : { target }),
      ...(operation === undefined ? {} : { operation }),
      ...(task === undefined ? {} : { task }),
      sync: sync[packageName] ?? { explicitState: 'none', dependencyState: { dependencyOf: [], requiredByCount: 0, releasable: true } },
      unknown: unknown.has(packageName) || (input.inventory.unknownItems.length > 0 && inventory === undefined),
    }
  })
}

function targetVersionFor(facts: PackageFacts): string | undefined {
  return facts.operation?.targetVersion ?? facts.target?.targetVersion ?? (facts.task && ACTIVE_TASK_STATUSES.has(facts.task.taskStatus) ? facts.task.targetVersion : undefined)
}

/** Build an Adapter-consumable snapshot from Core-owned facts only. */
export function buildMaintenanceSnapshot(input: MaintenanceSnapshotInput): CoreMaintenanceSnapshot {
  const tasks = input.tasks ?? []
  const selected = input.selectedPackages ?? (input.targets ?? []).map(target => target.packageName)
  const installed = input.inventory.items.filter(item => item.installed).map(item => item.packageName)
  const factsUnknown = input.inventory.unknownItems.length > 0
    ? [...new Set([...(input.unknownPackages ?? []), ...(input.targets ?? []).filter(target => !input.inventory.items.some(item => item.packageName === target.packageName)).map(target => target.packageName)])]
    : input.unknownPackages
  const sync = computePackageSync({
    packageNames: input.inventory.items.map(item => item.packageName),
    ...(input.explicitPackages === undefined ? {} : { explicitPackages: input.explicitPackages }),
    ...(factsUnknown === undefined ? {} : { unknownPackages: factsUnknown }),
    ...(input.dependencyEdges === undefined ? {} : { edges: input.dependencyEdges }),
    selectedPackages: selected,
    installedPackages: installed,
  })
  const packages = collectFacts(input, sync).map(facts => {
    const installState = installStateFor(facts)
    const enabledState = enabledStateFor(facts, installState)
    const explicitState = explicitStateFor(facts)
    const effectiveState = effectiveStateFor(facts, installState, explicitState)
    const targetVersion = targetVersionFor(facts)
    const state: MaintenancePackageState = {
      ...(facts.pluginId === undefined ? {} : { pluginId: facts.pluginId }),
      packageName: facts.packageName,
      ...(facts.inventory?.version === undefined ? {} : { installedVersion: facts.inventory.version }),
      ...(targetVersion === undefined ? {} : { targetVersion }),
      installState,
      enabledState,
      explicitState,
      dependencyState: facts.sync.dependencyState,
      effectiveState,
      reasons: reasonsFor(facts, installState, enabledState, effectiveState),
    }
    return state
  })
  const activeTaskIds = uniqueSorted([
    ...(input.activeTaskIds ?? []),
    ...tasks.filter(task => ACTIVE_TASK_STATUSES.has(task.status)).map(task => task.taskId),
  ])
  const pendingRestart = packages.some(item => item.enabledState === 'pending-restart')
    || (input.operations ?? []).some(operation => operation.restartRequired === true || operation.phase === 'awaiting-restart')
  const policy = normalizeUpdatePolicy(input.updatePolicy)
  const revision = input.revision ?? `maintenance:${input.inventory.revision}:${activeTaskIds.join(',')}:${packages.length}`
  return {
    schemaVersion: '1',
    revision,
    environmentId: input.environmentId,
    generatedAt: dateValue(input.generatedAt),
    updatePolicy: policy,
    packages,
    activeTaskIds,
    pendingRestart,
  }
}

export const createMaintenanceSnapshot = buildMaintenanceSnapshot
export const computeMaintenanceSnapshot = buildMaintenanceSnapshot
