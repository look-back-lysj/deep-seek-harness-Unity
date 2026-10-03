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
    expect(firstPage.nextSequence).toBe(2)
    const nextPage = await log.read('task-test', firstPage.nextSequence - 1, 10)
    expect(nextPage.events.map((item) => item.sequence)).toEqual([2, 3, 4, 5])
    await expect(log.append('task-test', event(5))).rejects.toMatchObject({ code: 'events/sequence' })
  })

  it('keeps page cursors local while reading more than two pages', async () => {
    const files = new InMemoryFiles()
    const log = new SegmentedEventLog(files, 4096)
    for (let sequence = 0; sequence < 205; sequence += 1) await log.append('task-pages', event(sequence))
    expect((await files.list('tasks/task-pages/')).filter((path) => path.endsWith('.jsonl')).length).toBeGreaterThan(1)

    const pages = []
    let afterSequence = -1
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const page = await log.read('task-pages', afterSequence, 100)
      pages.push(page)
      afterSequence = page.nextSequence - 1
    }

    expect(pages.map((page) => page.events.map((item) => item.sequence))).toEqual([
      Array.from({ length: 100 }, (_, index) => index),
      Array.from({ length: 100 }, (_, index) => index + 100),
      [200, 201, 202, 203, 204],
    ])
    expect(pages.map((page) => page.nextSequence)).toEqual([100, 200, 205])
    const sequences = pages.flatMap((page) => page.events.map((item) => item.sequence))
    expect(sequences).toEqual(Array.from({ length: 205 }, (_, index) => index))
    expect(new Set(sequences).size).toBe(205)

    const emptyPage = await log.read('task-pages', 204, 100)
    expect(emptyPage.events).toEqual([])
    expect(emptyPage.nextSequence).toBe(205)
    expect(await log.read('task-pages', 99, 0)).toEqual({ events: [], nextSequence: 100, truncated: false })
    expect(await log.read('task-pages', 500, 100)).toEqual({ events: [], nextSequence: 501, truncated: false })
    expect(await log.read('task-empty', -1, 100)).toEqual({ events: [], nextSequence: 0, truncated: false })
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
