import { describe, expect, it } from 'vitest'
import { SegmentedEventLog } from '../../packages/market-core/src/persistence/event-log.ts'
import { cleanupTaskLogs } from '../../packages/market-core/src/persistence/cleanup.ts'
import { JsonTaskStore } from '../../packages/market-core/src/persistence/task-store.ts'
import { makeBundle } from '../core/helpers.ts'
import { event, InMemoryFiles, makeTaskRecord, TestLocks } from './helpers.ts'

describe('segmented task event log', () => {
  it('rotates segments, paginates and enforces monotonic sequence', async () => {
    const files = new InMemoryFiles()
    const log = new SegmentedEventLog(files, 120)
    for (let sequence = 0; sequence < 6; sequence += 1) await log.append('task-test', event(sequence))
    const paths = await files.list('tasks/task-test/')
    expect(paths.filter((path) => path.endsWith('.jsonl')).length).toBeGreaterThan(1)

    const firstPage = await log.read('task-test', -1, 2)
    expect(firstPage.events.map((item) => item.sequence)).toEqual([0, 1])
    expect(firstPage.nextSequence).toBe(6)
    const nextPage = await log.read('task-test', firstPage.events.at(-1)?.sequence ?? -1, 10)
    expect(nextPage.events.map((item) => item.sequence)).toEqual([2, 3, 4, 5])
    await expect(log.append('task-test', event(5))).rejects.toMatchObject({ code: 'events/sequence' })
  })

  it('marks a torn final line truncated while preserving valid history', async () => {
    const files = new InMemoryFiles()
    const log = new SegmentedEventLog(files, 4096)
    await log.append('task-test', event(0))
    await files.append('tasks/task-test/events-000001.jsonl', new TextEncoder().encode('{"sequence":1,"at":"x"'))
    const page = await log.read('task-test', -1, 10)
    expect(page.events.map((item) => item.sequence)).toEqual([0])
    expect(page.truncated).toBe(true)
  })

  it('cleans old segments, retains summaries and records truncation', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const files = new InMemoryFiles()
    const store = new JsonTaskStore(files, new TestLocks())
    const record = await makeTaskRecord(bundle)
    await store.put(record)
    const log = new SegmentedEventLog(files, 90)
    for (let sequence = 0; sequence < 6; sequence += 1) await log.append('task-test', event(sequence))
    const results = await cleanupTaskLogs(store, log, ['task-test'], {
      maxBytesPerTask: 100,
      retainSummaries: true,
    })
    expect(results[0]?.summaryRetained).toBe(true)
    expect(results[0]?.truncated).toBe(true)
    expect(files.files.has('tasks/task-test/summary.json')).toBe(true)
    expect(files.files.has('tasks/task-test/event-log-meta.json')).toBe(true)
    await expect(store.get('task-test')).resolves.toMatchObject({ eventLogTruncated: true })
    const page = await log.read('task-test', -1, 10)
    expect(page.truncated).toBe(true)
    expect(page.events.length).toBeGreaterThan(0)
  })
})
