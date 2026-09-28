/**
 * Persistent TaskStorePort backed by atomic JSON summaries plus a unique
 * environmentId/planId index. The index prevents two tabs or idempotency keys
 * from creating two tasks for one immutable plan.
 */
import type { TaskRecord, TaskStorePort } from '../core/ports.ts'
import {
  decodeJson,
  encodeJson,
  PersistenceError,
  readJsonDocument,
  safeStoreId,
  taskDirectory,
  writeJsonDocument,
  type PersistenceFilePort,
} from './files.ts'
import { migrateTaskDocument, TASK_SCHEMA_VERSION, type TaskDocumentV2 } from './schema.ts'
import type { ProfileLockPort } from '../core/ports.ts'

interface TaskIndexDocument {
  readonly schemaVersion: 1
  readonly entries: Readonly<Record<string, string>>
}

function parseIndex(raw: unknown): TaskIndexDocument {
  const value = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  if (value.schemaVersion !== 1 || typeof value.entries !== 'object' || value.entries === null) {
    throw new PersistenceError('schema/invalid', '任务索引 schemaVersion 或 entries 无效')
  }
  const entries: Record<string, string> = {}
  for (const [key, taskId] of Object.entries(value.entries as Record<string, unknown>)) {
    if (typeof taskId !== 'string') throw new PersistenceError('schema/invalid', '任务索引值必须是字符串')
    safeStoreId(taskId)
    entries[key] = taskId
  }
  return { schemaVersion: 1, entries }
}

function terminalStatus(status: string): boolean {
  return status === 'completed' || status === 'partial' || status === 'failed' || status === 'cancelled' || status === 'needs-attention' || status === 'unknown'
}

function planKey(environmentId: string, planId: string): string {
  return `${environmentId}\u0000${planId}`
}

export class JsonTaskStore implements TaskStorePort {
  constructor(
    private readonly files: PersistenceFilePort,
    private readonly locks: ProfileLockPort,
    private readonly owner = 'json-task-store',
  ) {}

  private async withStoreLock<T>(operation: () => Promise<T>): Promise<T> {
    const handle = await this.locks.acquire('market-task-store', this.owner)
    try {
      return await operation()
    } finally {
      await handle.release()
    }
  }

  private async readIndex(): Promise<TaskIndexDocument> {
    return (await readJsonDocument(this.files, 'task-index.json', parseIndex)) ?? { schemaVersion: 1, entries: {} }
  }

  private async readDocument(taskId: string): Promise<TaskDocumentV2 | undefined> {
    const path = `${taskDirectory(taskId)}/summary.json`
    return readJsonDocument(this.files, path, migrateTaskDocument)
  }

  async get(taskId: string): Promise<TaskRecord | undefined> {
    safeStoreId(taskId)
    const document = await this.readDocument(taskId)
    return document?.record
  }

  async getByPlan(environmentId: string, planId: string): Promise<TaskRecord | undefined> {
    return this.withStoreLock(async () => {
      const taskId = (await this.readIndex()).entries[planKey(environmentId, planId)]
      return taskId === undefined ? undefined : (await this.readDocument(taskId))?.record
    })
  }

  async put(record: TaskRecord): Promise<void> {
    await this.withStoreLock(async () => {
      const taskId = safeStoreId(record.task.taskId)
      const key = planKey(record.task.environmentId, record.task.planId)
      const index = await this.readIndex()
      const priorTaskId = index.entries[key]
      if (priorTaskId !== undefined && priorTaskId !== taskId) {
        throw new PersistenceError('task/duplicate-plan', 'environmentId + planId 已绑定其他任务')
      }
      const prior = priorTaskId === undefined ? undefined : await this.readDocument(priorTaskId)
      if (prior !== undefined && terminalStatus(prior.record.task.status) && (
        record.task.status !== prior.record.task.status || record.nextSequence < prior.record.nextSequence
      )) {
        throw new PersistenceError('task/terminal-protected', '旧记录不能覆盖已结束任务')
      }
      const path = `${taskDirectory(taskId)}/summary.json`
      await writeJsonDocument(this.files, path, {
        schemaVersion: TASK_SCHEMA_VERSION,
        record,
      } satisfies TaskDocumentV2)
      const nextIndex: TaskIndexDocument = {
        schemaVersion: 1,
        entries: { ...index.entries, [key]: taskId },
      }
      await this.files.writeAtomic('task-index.json', encodeJson(nextIndex))
    })
  }

  async list(environmentId: string): Promise<readonly TaskRecord[]> {
    return this.withStoreLock(async () => {
      const index = await this.readIndex()
      const taskIds = new Set<string>()
      for (const [key, taskId] of Object.entries(index.entries)) {
        if (key.startsWith(`${environmentId}\u0000`)) taskIds.add(taskId)
      }
      const records: TaskRecord[] = []
      for (const taskId of taskIds) {
        const record = await this.get(taskId)
        if (record !== undefined) records.push(record)
      }
      return records
    })
  }

  /** Recovery helper: reads one summary while preserving a corrupt file for inspection. */
  async inspectRaw(taskId: string): Promise<unknown> {
    safeStoreId(taskId)
    const data = await this.files.read(`${taskDirectory(taskId)}/summary.json`)
    return data === undefined ? undefined : decodeJson(data)
  }
}
