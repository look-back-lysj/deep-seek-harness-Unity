/**
 * Bounded task-log cleanup. Summary files are never deleted; only old event
 * segments may be removed and the truncation fact is persisted.
 */
import type { TaskEventLogPort, TaskRecord, TaskStorePort } from '../core/ports.ts'

export interface TaskLogCleanupPolicy {
  readonly maxBytesPerTask: number
  readonly retainSummaries: true
}

export interface TaskLogCleanupResult {
  readonly taskId: string
  readonly removedSegments: number
  readonly truncated: boolean
  readonly summaryRetained: boolean
}

export async function cleanupTaskLogs(
  store: TaskStorePort,
  events: TaskEventLogPort,
  taskIds: readonly string[],
  policy: TaskLogCleanupPolicy,
): Promise<readonly TaskLogCleanupResult[]> {
  const results: TaskLogCleanupResult[] = []
  for (const taskId of taskIds) {
    const outcome = await events.cleanup(taskId, policy.maxBytesPerTask)
    if (outcome.truncated) {
      const record = await store.get(taskId)
      if (record !== undefined) {
        const next: TaskRecord = { ...record, eventLogTruncated: true }
        await store.put(next)
      }
    }
    results.push({
      taskId,
      removedSegments: outcome.removedSegments,
      truncated: outcome.truncated,
      summaryRetained: policy.retainSummaries,
    })
  }
  return results
}
