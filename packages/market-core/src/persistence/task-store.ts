/**
 * Persistent TaskStorePort backed by atomic JSON summaries plus a unique
 * environmentId/planId index. The index prevents two tabs or idempotency keys
 * from creating two tasks for one immutable plan.
 */
import type { TaskRecord, TaskStorePort } from '../core/ports.ts'
import { canonicalJson, sha256Hex } from '../core/canonical.ts'
import {
  decodeJson,
  encodeJson,
  PersistenceError,
  safeStoreId,
  taskDirectory,
  writeJsonDocument,
  type PersistenceFilePort,
} from './files.ts'
import { migrateTaskDocument, TASK_SCHEMA_VERSION, type TaskDocumentV3 } from './schema.ts'
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
  return status === 'completed' || status === 'partial' || status === 'failed' || status === 'cancelled'
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

  /** Index is a projection: enumerate summaries/journals even after a failed index write. */
  private async readIndex(): Promise<TaskIndexDocument> {
    let previous: TaskIndexDocument = { schemaVersion: 1, entries: {} }
    const indexBytes = await this.files.read('task-index.json')
    if (indexBytes !== undefined) {
      try { previous = parseIndex(decodeJson(indexBytes)) }
      catch { await this.files.writeAtomic('task-index.corrupt-backup.json', indexBytes) }
    }
    const ids = new Set(Object.values(previous.entries))
    for (const path of await this.files.list('tasks/')) {
      const match = /^tasks\/([^/]+)\/(?:summary|commit)\.json$/.exec(path)
      if (match !== null) ids.add(safeStoreId(match[1]!))
    }
    const entries: Record<string, string> = {}
    for (const id of ids) {
      const document = await this.readDocument(id)
      if (document === undefined) throw new PersistenceError('task/missing-summary', '索引引用的任务摘要缺失：' + id)
      const key = planKey(document.record.task.environmentId, document.record.task.planId)
      if (entries[key] !== undefined && entries[key] !== id) throw new PersistenceError('task/duplicate-plan', '恢复发现同一计划存在多个任务')
      entries[key] = id
    }
    const rebuilt: TaskIndexDocument = { schemaVersion: 1, entries }
    if (canonicalJson(rebuilt) !== canonicalJson(previous)) await this.files.writeAtomic('task-index.json', encodeJson(rebuilt))
    return rebuilt
  }

  private async readDocument(taskId: string): Promise<TaskDocumentV3 | undefined> {
    const directory = taskDirectory(taskId)
    const summary = await this.files.read(directory + '/summary.json')
    const commit = await this.files.read(directory + '/commit.json')
    if (commit === undefined) return summary === undefined ? undefined : migrateTaskDocument(decodeJson(summary))
    const journal = decodeJson(commit) as { schemaVersion?: number; digest?: string; document?: unknown }
    if (journal.schemaVersion !== 1 || journal.digest !== await sha256Hex(canonicalJson(journal.document))) {
      throw new PersistenceError('task/corrupt-commit', '任务提交记录校验失败：' + taskId)
    }
    const document = migrateTaskDocument(journal.document)
    if (document.record.task.taskId !== taskId) throw new PersistenceError('task/identity-mismatch', '任务目录与提交身份不一致')
    const committed = encodeJson(journal.document)
    if (summary === undefined || BufferlessText(summary) !== BufferlessText(committed)) {
      if (summary !== undefined) await this.files.writeAtomic(directory + '/summary.recovery-backup.json', summary)
      await this.files.writeAtomic(directory + '/summary.json', committed)
    }
    return document
  }

  async get(taskId: string): Promise<TaskRecord | undefined> {
    safeStoreId(taskId)
    return this.withStoreLock(async () => (await this.readDocument(taskId))?.record)
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
      const prior = await this.readDocument(taskId)
      if (prior !== undefined && terminalStatus(prior.record.task.status) && (
        record.task.status !== prior.record.task.status || record.nextSequence < prior.record.nextSequence
      )) {
        throw new PersistenceError('task/terminal-protected', '旧记录不能覆盖已结束任务')
      }
      const path = `${taskDirectory(taskId)}/summary.json`
      const oldBytes = await this.files.read(path)
      const oldVersion = oldBytes === undefined ? undefined : (decodeJson(oldBytes) as { schemaVersion?: number }).schemaVersion
      if (oldBytes !== undefined && (oldVersion === 1 || oldVersion === 2)) {
        const backup = taskDirectory(taskId) + '/summary.v' + oldVersion + '-backup.json'
        if (await this.files.read(backup) === undefined) await this.files.writeAtomic(backup, oldBytes)
      }
      const document = { schemaVersion: TASK_SCHEMA_VERSION, record } satisfies TaskDocumentV3
      // The durable intent precedes summary/index. Recovery can complete either missing projection.
      await writeJsonDocument(this.files, taskDirectory(taskId) + '/commit.json', {
        schemaVersion: 1, digest: await sha256Hex(canonicalJson(document)), document,
      })
      await writeJsonDocument(this.files, path, document)
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
        const record = (await this.readDocument(taskId))?.record
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

function BufferlessText(bytes: Uint8Array): string { return new TextDecoder().decode(bytes) }
