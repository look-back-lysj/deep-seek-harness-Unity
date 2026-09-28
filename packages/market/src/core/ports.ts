/** Ports used by install planning and task execution. */
import type {
  InventorySnapshot,
  PackExecutionEdge,
  PermissionChange,
  PlanSelection,
  TaskEvent,
  TaskState,
  VerificationState,
  InventoryItem,
} from '../contracts/types.ts'

export interface HostWriteActivity {
  readonly stable: boolean
  readonly unknownSharedImpact: boolean
  readonly reason?: string
}

export interface HostReadState {
  readonly inventory: InventorySnapshot
  readonly sessionRevision: string
  readonly activeRequests: readonly string[]
  readonly activity: HostWriteActivity
}

export interface ArtifactAcquisition {
  readonly pluginId: string
  readonly packageName: string
  readonly version: string
  readonly artifactDigest: string
  readonly localRef: string
  readonly size: number
}

export interface ArtifactAcquireRequest {
  readonly requestId: string
  readonly pluginId: string
  readonly packageName: string
  readonly version: string
  readonly artifactDigest: string
  readonly sourceRef: string
}

export interface ArtifactPort {
  acquire(request: ArtifactAcquireRequest, signal?: AbortSignal): Promise<ArtifactAcquisition>
  release(localRef: string): Promise<void>
}

export interface HostInstallRequest {
  readonly requestId: string
  readonly artifact: ArtifactAcquisition
  readonly enabled: boolean
  readonly approvedBuilds?: readonly string[]
}

export type HostInstallOutcome =
  | {
      readonly kind: 'applied'
      readonly changed: boolean
      readonly restartRequired: boolean
      readonly packageResultCode?: string
      readonly permissionChanges: readonly PermissionChange[]
    }
  | {
      readonly kind: 'awaiting-approval'
      readonly attemptId: string
      readonly pendingBuilds: readonly string[]
      readonly pendingBuildsDigest: string
      readonly permissionChanges: readonly PermissionChange[]
    }
  | {
      readonly kind: 'failed'
      readonly changed: boolean
      readonly packageResultCode?: string
      readonly error: string
      readonly errorCode?: string | undefined
      readonly diagnostic?: string | undefined
      readonly permissionChanges: readonly PermissionChange[]
      readonly unknownSharedImpact?: boolean
    }
  | {
      readonly kind: 'cancelled'
      readonly changed: boolean
      readonly packageResultCode?: string
      readonly permissionChanges: readonly PermissionChange[]
    }
  | {
      readonly kind: 'unknown'
      readonly error: string
      readonly errorCode?: string | undefined
      readonly diagnostic?: string | undefined
      readonly permissionChanges: readonly PermissionChange[]
    }

export interface HostCancelOutcome {
  readonly kind: 'cancelled' | 'too-late' | 'not-running' | 'unknown'
  readonly changed?: boolean
  readonly reason?: string
}

export interface HostPort {
  readState(): Promise<HostReadState>
  install(request: HostInstallRequest): Promise<HostInstallOutcome>
  cancel(requestId: string): Promise<HostCancelOutcome>
  setEnabled?(packageName: string, enabled: boolean): Promise<HostInstallOutcome>
}

export interface ProfileLockHandle {
  release(): Promise<void>
}

export interface ProfileLockPort {
  acquire(profileKey: string, owner: string): Promise<ProfileLockHandle>
}

export interface PlanFacts {
  readonly pluginId: string
  readonly packageName: string
  readonly version: string
  readonly artifactDigest: string
  readonly verification: VerificationState
  readonly requiresRestart: boolean
  readonly installable: boolean
}

export interface PlanCatalogContext {
  readonly planId?: string
  readonly catalogRevision: string
  readonly environmentId: string
  readonly hostFingerprint: string
  readonly inventory: readonly InventoryItem[]
  readonly plugins: readonly PlanFacts[]
  readonly selections: readonly PlanSelection[]
  readonly now: Date
  readonly ttlMs?: number
  readonly marketManagedPackageNames?: readonly string[]
  readonly localIdentityByPackage?: Readonly<Record<string, 'file' | 'link' | 'fork' | 'registry' | 'unknown'>>
}

export interface PackExecutionContext {
  readonly packId: string
  readonly packVersion: string
  readonly components: readonly { readonly pluginId: string; readonly required: boolean }[]
  readonly execution: import('../contracts/types.ts').PackExecution
  readonly lockBytes: Uint8Array
}

export interface PlanStep {
  readonly order: number
  readonly pluginId: string
  readonly packageName: string
  readonly dependencyMilestone?: 'installed' | 'active'
}

export interface ExpectedItemState {
  readonly pluginId: string
  readonly packageName: string
  readonly version?: string
  readonly enabled: boolean
  readonly source: InventoryItem['source']
  readonly localIdentity?: 'file' | 'link' | 'fork' | 'registry' | 'unknown'
}

export interface PlanBundle {
  readonly plan: import('../contracts/types.ts').InstallPlan
  readonly steps: readonly PlanStep[]
  readonly dependencies: readonly PackExecutionEdge[]
  readonly expected: readonly ExpectedItemState[]
  readonly bundleDigest: string
}

export interface PreparedPlanResult {
  readonly status: 'ready' | 'stale' | 'blocked'
  readonly bundle?: PlanBundle
  readonly reason?: string
  readonly details?: readonly string[]
  readonly blockers?: readonly string[]
}

export interface TaskItemFact {
  readonly installed: boolean
  readonly active: boolean
}

export interface TaskAttemptRecord {
  readonly id: string
  readonly requestId: string
  readonly pluginId: string
  readonly phase: 'installing' | 'awaiting-approval' | 'approved' | 'finished'
  readonly pendingBuilds?: readonly string[]
  readonly pendingBuildsDigest?: string
  readonly approvedBuilds?: readonly string[]
  readonly approvedAt?: string
  readonly artifact?: ArtifactAcquisition
}

export interface TaskRecord {
  readonly task: TaskState
  readonly bundle: PlanBundle
  readonly baseline: InventorySnapshot
  readonly itemFacts: Readonly<Record<string, TaskItemFact>>
  readonly attempts: readonly TaskAttemptRecord[]
  readonly idempotency: Readonly<Record<string, string>>
  readonly approvalIdempotency: Readonly<Record<string, string>>
  readonly resumeIdempotency: Readonly<Record<string, string>>
  readonly activeRequestId?: string
  readonly attemptCounter: number
  readonly nextSequence: number
  readonly cancellationRequested: boolean
  readonly eventLogTruncated: boolean
}

export interface TaskStorePort {
  getByPlan(environmentId: string, planId: string): Promise<TaskRecord | undefined>
  get(taskId: string): Promise<TaskRecord | undefined>
  put(record: TaskRecord): Promise<void>
  list(environmentId: string): Promise<readonly TaskRecord[]>
}

export interface EventLogPage {
  readonly events: readonly TaskEvent[]
  readonly nextSequence: number
  readonly truncated: boolean
}

export interface TaskEventLogPort {
  append(taskId: string, event: TaskEvent): Promise<void>
  read(taskId: string, afterSequence: number, limit: number): Promise<EventLogPage>
  cleanup(taskId: string, maxBytes: number): Promise<{ readonly removedSegments: number; readonly truncated: boolean }>
}
