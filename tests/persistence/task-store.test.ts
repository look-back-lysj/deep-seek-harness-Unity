import { describe, expect, it } from 'vitest'
import { PersistenceError, decodeJson, encodeJson, writeJsonDocument } from '../../packages/market/src/persistence/files.ts'
import { JsonTaskStore } from '../../packages/market/src/persistence/task-store.ts'
import { migrateTaskDocument } from '../../packages/market/src/persistence/schema.ts'
import { makeBundle } from '../core/helpers.ts'
import { InMemoryFiles, makeTaskRecord, TestLocks } from './helpers.ts'

describe('JsonTaskStore', () => {
  it('persists summaries and enforces environmentId + planId uniqueness', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const files = new InMemoryFiles()
    const store = new JsonTaskStore(files, new TestLocks())
    const first = await makeTaskRecord(bundle, 'task-first')
    await store.put(first)
    await expect(store.getByPlan(bundle.plan.environmentId, bundle.plan.planId)).resolves.toEqual(first)
    await expect(store.list(bundle.plan.environmentId)).resolves.toEqual([first])

    const duplicate = await makeTaskRecord(bundle, 'task-other')
    await expect(store.put(duplicate)).rejects.toMatchObject({ code: 'task/duplicate-plan' })
    expect(files.files.has('tasks/task-first/summary.json')).toBe(true)
    expect(files.files.has('tasks/task-other/summary.json')).toBe(false)
  })

  it('isolates the same planId between two environments', async () => {
    const bundleA = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const bundleB = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const other = {
      ...bundleB,
      plan: { ...bundleB.plan, environmentId: 'env-other' },
    }
    const files = new InMemoryFiles()
    const store = new JsonTaskStore(files, new TestLocks())
    const a = await makeTaskRecord(bundleA, 'task-a')
    const b = await makeTaskRecord(other, 'task-b')
    await store.put(a)
    await store.put(b)
    await expect(store.getByPlan('env-test', bundleA.plan.planId)).resolves.toMatchObject({ task: { taskId: 'task-a' } })
    await expect(store.getByPlan('env-other', bundleB.plan.planId)).resolves.toMatchObject({ task: { taskId: 'task-b' } })
  })

  it('does not replace old data when atomic write fails', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const files = new InMemoryFiles()
    const store = new JsonTaskStore(files, new TestLocks())
    const record = await makeTaskRecord(bundle)
    await store.put(record)
    const oldBytes = files.files.get('tasks/task-test/summary.json')
    files.failNextAtomic = true
    await expect(store.put({ ...record, nextSequence: 99 })).rejects.toThrow(/atomic write failure/)
    expect(files.files.get('tasks/task-test/summary.json')).toEqual(oldBytes)
    await expect(store.get('task-test')).resolves.toMatchObject({ nextSequence: 0 })
  })

  it('fails closed on corrupt summary instead of returning an empty store', async () => {
    const files = new InMemoryFiles()
    files.files.set('tasks/task-test/summary.json', new TextEncoder().encode('{ broken'))
    const store = new JsonTaskStore(files, new TestLocks())
    await expect(store.get('task-test')).rejects.toThrow(PersistenceError)
    await expect(store.get('task-test')).rejects.toMatchObject({ code: 'json/corrupt' })
    expect(files.files.has('tasks/task-test/summary.json')).toBe(true)
  })

  it('migrates v1 without inventing empty success data and rejects future versions', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const record = await makeTaskRecord(bundle)
    const legacy = JSON.parse(JSON.stringify({
      schemaVersion: 1,
      record: {
        ...record,
        idempotency: undefined,
        approvalIdempotency: undefined,
        resumeIdempotency: undefined,
        eventLogTruncated: undefined,
      },
    })) as Record<string, unknown>
    const migrated = migrateTaskDocument(legacy)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.record.idempotency).toEqual({})
    expect(migrated.record.approvalIdempotency).toEqual({})
    expect(migrated.record.eventLogTruncated).toBe(false)
    expect(() => migrateTaskDocument({ schemaVersion: 99, record: legacy.record })).toThrow(PersistenceError)
  })

  it('does not let stale writes replace a terminal task record', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const files = new InMemoryFiles()
    const store = new JsonTaskStore(files, new TestLocks())
    const terminal = await makeTaskRecord(bundle)
    const terminalRecord = {
      ...terminal,
      task: { ...terminal.task, status: 'cancelled' as const },
      nextSequence: 7,
    }
    await store.put(terminalRecord)
    await expect(store.put({ ...terminal, nextSequence: 1 })).rejects.toMatchObject({ code: 'task/terminal-protected' })
    await expect(store.get('task-test')).resolves.toMatchObject({ task: { status: 'cancelled' }, nextSequence: 7 })
  })
  it('uses atomic JSON writes only after encoding succeeds', async () => {
    const files = new InMemoryFiles()
    await writeJsonDocument(files, 'state.json', { ok: true })
    expect(decodeJson(files.files.get('state.json') ?? new Uint8Array())).toEqual({ ok: true })
    expect(files.atomicWrites).toEqual(['state.json'])
    await expect(writeJsonDocument(files, 'bad.json', { bad: Number.NaN })).rejects.toThrow()
    expect(files.files.has('bad.json')).toBe(false)
    expect(encodeJson({ a: 1 }).byteLength).toBeGreaterThan(0)
  })
})
