/**
 * Versioned task summary schema and migration.
 *
 * Migration failure preserves the old bytes and makes writes fail closed. A
 * missing/corrupt summary is never treated as an empty successful store.
 */
import type { TaskRecord } from '../core/ports.ts'
import { PersistenceError } from './files.ts'

export const TASK_SCHEMA_VERSION = 2

export interface TaskDocumentV2 {
  readonly schemaVersion: 2
  readonly record: TaskRecord
}

function objectAt(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function stringAt(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PersistenceError('schema/invalid', `字段 ${field} 必须是非空字符串`)
  }
  return value
}

function numberAt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new PersistenceError('schema/invalid', `字段 ${field} 必须是非负整数`)
  }
  return value
}

function recordAt(value: unknown): TaskRecord {
  const raw = objectAt(value)
  const task = objectAt(raw.task)
  const items = Array.isArray(task.items) ? task.items : []
  const events = Array.isArray(task.events) ? task.events : []
  const attempts = Array.isArray(raw.attempts) ? raw.attempts : []
  if (items.length === 0) throw new PersistenceError('schema/invalid', '任务必须至少有一个组件')
  stringAt(task.taskId, 'task.taskId')
  stringAt(task.planId, 'task.planId')
  stringAt(task.planDigest, 'task.planDigest')
  stringAt(task.environmentId, 'task.environmentId')
  stringAt(task.status, 'task.status')
  numberAt(raw.attemptCounter, 'attemptCounter')
  numberAt(raw.nextSequence, 'nextSequence')
  const bundle = objectAt(raw.bundle)
  const plan = objectAt(bundle.plan)
  stringAt(plan.planId, 'bundle.plan.planId')
  stringAt(bundle.bundleDigest, 'bundle.bundleDigest')
  return {
    ...(raw as unknown as TaskRecord),
    task: {
      ...(task as unknown as TaskRecord['task']),
      items: items.map((item) => ({ ...(objectAt(item) as unknown as TaskRecord['task']['items'][number]) })),
      events: events.map((event) => ({ ...(objectAt(event) as unknown as TaskRecord['task']['events'][number]) })),
    },
    attempts: attempts.map((attempt) => ({ ...(objectAt(attempt) as unknown as TaskRecord['attempts'][number]) })),
    idempotency: objectAt(raw.idempotency) as Record<string, string>,
    approvalIdempotency: objectAt(raw.approvalIdempotency) as Record<string, string>,
    resumeIdempotency: objectAt(raw.resumeIdempotency) as Record<string, string>,
    itemFacts: objectAt(raw.itemFacts) as TaskRecord['itemFacts'],
  }
}

/**
 * Accepts the known v1 shape and adds v2 idempotency/cleanup fields. Unknown
 * future versions fail closed so a downgrade cannot erase new data.
 */
export function migrateTaskDocument(raw: unknown): TaskDocumentV2 {
  const document = objectAt(raw)
  const version = document.schemaVersion
  if (version === TASK_SCHEMA_VERSION) {
    return { schemaVersion: 2, record: recordAt(document.record) }
  }
  if (version === 1) {
    const record = objectAt(document.record)
    const migrated = {
      ...record,
      idempotency: objectAt(record.idempotency),
      approvalIdempotency: objectAt(record.approvalIdempotency),
      resumeIdempotency: objectAt(record.resumeIdempotency),
      eventLogTruncated: record.eventLogTruncated === true,
    }
    return { schemaVersion: 2, record: recordAt(migrated) }
  }
  throw new PersistenceError('schema/unsupported', `不支持的任务 schemaVersion：${String(version)}`)
}
