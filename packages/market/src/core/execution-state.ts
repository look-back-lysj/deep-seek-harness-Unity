/** Host-private recovery facts. Absence on legacy records is never proof that a write did not run. */
import type { InventoryItem } from '../contracts/types.ts'
import type { HostInstallOutcome, HostPort, TaskRecord } from './ports.ts'

export interface ExecutionState {
  readonly intentDigest: string
  readonly sessionRevision: string
  readonly writeUncertain: boolean
  readonly attempts: Readonly<Record<string, {
    readonly stage: 'prepared' | 'dispatched' | 'received' | 'verified'
    readonly sessionRevision: string
    readonly outcome?: HostInstallOutcome
  }>>
  readonly restartBarriers: Readonly<Record<string, string>>
  readonly observed: Readonly<Record<string, InventoryItem>>
}

export type ExecutionRecord = TaskRecord & { readonly execution?: ExecutionState }

export interface RecoverableHostPort extends HostPort {
  /** Production adapters reject legacy plans even when an artifact was cached before approval. */
  readonly requiresFrozenDelivery?: boolean
  /** Only a persisted receipt/current official result may settle an old request; null proves nothing. */
  reconcileInstall?(requestId: string): Promise<HostInstallOutcome | undefined>
}

export interface CoordinatedManagementRequest {
  readonly environmentId: string
  readonly packageName: string
  readonly expectedVersion: string
  readonly idempotencyKey: string
  readonly action: 'enable' | 'disable' | 'remove'
}

export interface ManagementRecord {
  readonly schemaVersion: 1
  readonly request: CoordinatedManagementRequest
  readonly fingerprint: string
  readonly stage: 'dispatched' | 'settled' | 'unknown'
  readonly outcome?: HostInstallOutcome
  readonly receipt?: HostInstallOutcome
  readonly before?: InventoryItem
}

export function executionOf(record: TaskRecord): ExecutionState | undefined {
  return (record as ExecutionRecord).execution
}

export function withExecution(record: TaskRecord, patch: Partial<ExecutionState>): ExecutionRecord {
  return { ...record, execution: {
    intentDigest: '', sessionRevision: '', writeUncertain: false,
    attempts: {}, restartBarriers: {}, observed: {},
    ...executionOf(record), ...patch,
  } }
}

export function hasUncertainWrite(record: TaskRecord): boolean {
  const execution = executionOf(record)
  if (execution !== undefined) return execution.writeUncertain
  // Legacy tasks did not record dispatch/receipt boundaries. Never replay an ambiguous attempt.
  return record.activeRequestId !== undefined
    || record.attempts.some(attempt => attempt.phase === 'installing')
    || record.task.items.some(item => item.status === 'unknown')
    || ['installing', 'applying', 'checking'].includes(record.task.status)
}
