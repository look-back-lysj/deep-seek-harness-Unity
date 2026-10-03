import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '../../packages/market/node_modules/@deepseek-ai/cordis/lib/index.js'
import type { MarketBackend } from '../../packages/market-core/src/api.ts'
import { createDshMarketBackend } from '../../packages/market-core/src/dsh.ts'
import type { UpdateCheckResult, UpdatePolicy, UpdatePolicySnapshot } from '../../packages/market-core/src/contracts/types.ts'
import {
  UpdateCheckScheduleStore,
  UpdateCheckScheduler,
  UPDATE_CHECK_SCHEDULE_PATH,
  type UpdateCheckScheduleState,
} from '../../packages/market-core/src/core/update-check-scheduler.ts'
import { InMemoryFiles, TestLocks } from '../persistence/helpers.ts'
import { embedded, freshDirectory, identity, removeDirectory } from '../core-api/helpers.ts'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await waitForEventLoopTurn()
  }
  throw new Error('Timed out waiting for scheduler continuation')
}

async function waitForEventLoopTurn(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

async function waitForState(
  load: () => Promise<UpdateCheckScheduleState>,
  predicate: (state: UpdateCheckScheduleState) => boolean,
): Promise<UpdateCheckScheduleState> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await load()
    if (predicate(state)) return state
    await waitForEventLoopTurn()
  }
  throw new Error('Timed out waiting for persisted update scheduler state')
}

async function waitForRuntimeState(
  filename: string,
  predicate: (state: UpdateCheckScheduleState) => boolean,
): Promise<UpdateCheckScheduleState> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const document = JSON.parse(await readFile(filename, 'utf8')) as { readonly state: UpdateCheckScheduleState }
      if (predicate(document.state)) return document.state
    } catch { /* the scheduler may still be opening or atomically replacing the file */ }
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for DSH Runtime update scheduler state')
}

const BASE_TIME = '2026-10-02T00:00:00.000Z'

function policy(overrides: Partial<UpdatePolicy> = {}): UpdatePolicy {
  return {
    automaticChecksEnabled: true,
    automaticDownloadsEnabled: false,
    automaticInstallsEnabled: false,
    ...overrides,
  }
}

function result(checkedAt = BASE_TIME): UpdateCheckResult {
  return {
    checkedAt,
    sourceRevision: 'catalog-r1',
    catalogStale: false,
    inventoryRevision: 'inventory-r1',
    items: [{ packageName: '@test/plugin', installedVersion: '1.0.0', latestVersion: '1.1.0', status: 'update-available' }],
  }
}

function policySnapshot(value: UpdatePolicy, revision = 'policy-r1'): UpdatePolicySnapshot {
  return { revision, policy: value }
}

describe('UpdateCheckScheduler', () => {
  it('runs only the read-only check, persists its result, and resumes at the saved due time', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const files = new InMemoryFiles()
    const locks = new TestLocks()
    const store = new UpdateCheckScheduleStore(files, locks)
    let activePolicy = policy()
    const checkUpdates = vi.fn(async () => result(new Date().toISOString()))
    const first = new UpdateCheckScheduler({
      files,
      locks,
      getPolicy: async () => policySnapshot(activePolicy),
      checkUpdates,
    })

    await first.start()
    expect(checkUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(checkUpdates).toHaveBeenCalledTimes(1)
    expect(checkUpdates).toHaveBeenLastCalledWith({ refreshFirst: true })

    const persisted = await waitForState(() => store.load(), state => state.lastResult !== undefined)
    expect(persisted).toMatchObject({
      lastCheckedAt: BASE_TIME,
      nextCheckAt: new Date(Date.parse(BASE_TIME) + 60 * 60_000).toISOString(),
      lastResult: result(BASE_TIME),
    })
    await waitForCondition(() => vi.getTimerCount() === 1)
    expect(vi.getTimerCount()).toBe(1)
    first.stop()
    expect(vi.getTimerCount()).toBe(0)

    vi.setSystemTime(new Date(Date.parse(BASE_TIME) + 59 * 60_000))
    const restarted = new UpdateCheckScheduler({
      files,
      locks,
      getPolicy: async () => policySnapshot(activePolicy),
      checkUpdates,
    })
    await restarted.start()
    expect(restarted.stateSnapshot()).toMatchObject({ lastCheckedAt: BASE_TIME, nextCheckAt: persisted.nextCheckAt })
    await vi.advanceTimersByTimeAsync(59_000)
    expect(checkUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(checkUpdates).toHaveBeenCalledTimes(2)
    await waitForState(() => store.load(), state => state.lastCheckedAt !== BASE_TIME)
    restarted.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('re-schedules when policy changes and stop prevents a later check', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const files = new InMemoryFiles()
    const locks = new TestLocks()
    const store = new UpdateCheckScheduleStore(files, locks)
    let activePolicy = policy()
    const checkUpdates = vi.fn(async () => result(new Date().toISOString()))
    const scheduler = new UpdateCheckScheduler({
      files,
      locks,
      getPolicy: async () => policySnapshot(activePolicy),
      checkUpdates,
    })

    await scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    await waitForState(() => store.load(), state => state.lastResult !== undefined)
    await waitForCondition(() => vi.getTimerCount() === 1)
    expect(checkUpdates).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)

    vi.setSystemTime(new Date(Date.parse(BASE_TIME) + 5 * 60_000))
    activePolicy = policy({ automaticChecksEnabled: false })
    await scheduler.refresh()
    expect(vi.getTimerCount()).toBe(0)
    expect(scheduler.stateSnapshot()).not.toHaveProperty('nextCheckAt')

    activePolicy = policy({ intervalMinutes: 10 })
    await scheduler.refresh()
    expect(scheduler.stateSnapshot().nextCheckAt).toBe(new Date(Date.parse(BASE_TIME) + 10 * 60_000).toISOString())
    expect(vi.getTimerCount()).toBe(1)
    scheduler.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(checkUpdates).toHaveBeenCalledTimes(1)
  })

  it.each(['policy', 'persist'] as const)('does not rearm a refresh stopped while awaiting %s', async stage => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const files = new InMemoryFiles()
    const locks = new TestLocks()
    const entered = deferred()
    const release = deferred()
    let blocked = false
    let activePolicy = policy({ automaticChecksEnabled: false })
    const checkUpdates = vi.fn(async () => result())
    const writeAtomic = files.writeAtomic.bind(files)
    vi.spyOn(files, 'writeAtomic').mockImplementation(async (path, data) => {
      if (blocked && stage === 'persist') { entered.resolve(); await release.promise }
      await writeAtomic(path, data)
    })
    const scheduler = new UpdateCheckScheduler({
      files, locks, checkUpdates,
      getPolicy: async () => {
        const snapshot = policySnapshot(activePolicy)
        if (blocked && stage === 'policy') { entered.resolve(); await release.promise }
        return snapshot
      },
    })
    await scheduler.start()
    activePolicy = policy()
    blocked = true
    const refresh = scheduler.refresh()
    await entered.promise
    scheduler.stop()
    expect(vi.getTimerCount()).toBe(0)
    release.resolve()
    await refresh
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(checkUpdates).not.toHaveBeenCalled()
  })

  it.each(['policy', 'check'] as const)('ignores a scheduled cycle stopped while awaiting %s', async stage => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const files = new InMemoryFiles()
    const entered = deferred()
    const release = deferred()
    let reads = 0
    const checkUpdates = vi.fn(async () => {
      if (stage === 'check') { entered.resolve(); await release.promise }
      return result()
    })
    const scheduler = new UpdateCheckScheduler({
      files, locks: new TestLocks(), checkUpdates,
      getPolicy: async () => {
        reads += 1
        if (reads === 2 && stage === 'policy') { entered.resolve(); await release.promise }
        return policySnapshot(policy())
      },
    })
    await scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    await entered.promise
    const writesAtStop = files.atomicWrites.length
    scheduler.stop()
    release.resolve()
    await waitForEventLoopTurn()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(vi.getTimerCount()).toBe(0)
    expect(checkUpdates).toHaveBeenCalledTimes(stage === 'policy' ? 0 : 1)
    expect(files.atomicWrites).toHaveLength(writesAtStop)
    expect(scheduler.stateSnapshot().lastResult).toBeUndefined()
  })

  it.each(['policy', 'check'] as const)('leaves no timer when disabling a cycle awaiting %s', async stage => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const files = new InMemoryFiles()
    const locks = new TestLocks()
    const store = new UpdateCheckScheduleStore(files, locks)
    const entered = deferred()
    const release = deferred()
    let reads = 0
    let activePolicy = policy()
    const checkUpdates = vi.fn(async () => {
      if (stage === 'check') { entered.resolve(); await release.promise }
      return result()
    })
    const scheduler = new UpdateCheckScheduler({
      files, locks, checkUpdates,
      getPolicy: async () => {
        const snapshot = policySnapshot(activePolicy)
        reads += 1
        if (reads === 2 && stage === 'policy') { entered.resolve(); await release.promise }
        return snapshot
      },
    })
    await scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    await entered.promise
    activePolicy = policy({ automaticChecksEnabled: false })
    await scheduler.refresh()
    expect(vi.getTimerCount()).toBe(0)
    release.resolve()
    if (stage === 'check') await waitForState(() => store.load(), state => state.lastResult !== undefined && state.nextCheckAt === undefined)
    await waitForCondition(() => reads >= 4)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(checkUpdates).toHaveBeenCalledTimes(stage === 'policy' ? 0 : 1)
    expect(vi.getTimerCount()).toBe(0)
    expect(scheduler.stateSnapshot()).not.toHaveProperty('nextCheckAt')
    scheduler.stop()
  })

  it.each([false, true])('keeps only the latest concurrent refresh, enabled=%s', async enabled => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const files = new InMemoryFiles()
    const locks = new TestLocks()
    await new UpdateCheckScheduleStore(files, locks).save({ lastCheckedAt: BASE_TIME })
    const entered = deferred()
    const release = deferred()
    const getPolicy = vi.fn()
      .mockResolvedValueOnce(policySnapshot(policy({ automaticChecksEnabled: false })))
      .mockImplementationOnce(async () => {
        entered.resolve(); await release.promise
        return policySnapshot(policy({ intervalMinutes: 1 }))
      })
      .mockResolvedValue(policySnapshot(policy({ automaticChecksEnabled: enabled, intervalMinutes: 10 })))
    const scheduler = new UpdateCheckScheduler({ files, locks, getPolicy, checkUpdates: async () => result() })
    await scheduler.start()
    const staleRefresh = scheduler.refresh()
    await entered.promise
    await scheduler.refresh()
    release.resolve()
    await staleRefresh
    expect(vi.getTimerCount()).toBe(enabled ? 1 : 0)
    if (enabled) expect(scheduler.stateSnapshot().nextCheckAt).toBe(new Date(Date.parse(BASE_TIME) + 10 * 60_000).toISOString())
    else expect(scheduler.stateSnapshot()).not.toHaveProperty('nextCheckAt')
    scheduler.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not resurrect an enabled timer when its pending save finishes after disabling', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const files = new InMemoryFiles()
    const locks = new TestLocks()
    await new UpdateCheckScheduleStore(files, locks).save({ lastCheckedAt: BASE_TIME })
    const entered = deferred()
    const disabledRead = deferred()
    const release = deferred()
    let blocked = false
    let activePolicy = policy()
    const writeAtomic = files.writeAtomic.bind(files)
    vi.spyOn(files, 'writeAtomic').mockImplementation(async (path, data) => {
      if (blocked) { entered.resolve(); await release.promise }
      await writeAtomic(path, data)
    })
    const scheduler = new UpdateCheckScheduler({
      files, locks, checkUpdates: async () => result(),
      getPolicy: async () => {
        if (!activePolicy.automaticChecksEnabled) disabledRead.resolve()
        return policySnapshot(activePolicy)
      },
    })
    await scheduler.start()
    blocked = true
    const staleRefresh = scheduler.refresh()
    await entered.promise
    activePolicy = policy({ automaticChecksEnabled: false })
    const disable = scheduler.refresh()
    await disabledRead.promise
    expect(vi.getTimerCount()).toBe(0)
    release.resolve()
    await Promise.all([staleRefresh, disable])
    expect(vi.getTimerCount()).toBe(0)
    expect(scheduler.stateSnapshot()).not.toHaveProperty('nextCheckAt')
    scheduler.stop()
  })

  it('does not apply a stale startup load after stop and restart', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const files = new InMemoryFiles()
    const locks = new TestLocks()
    const store = new UpdateCheckScheduleStore(files, locks)
    await store.save({ lastCheckedAt: new Date(Date.parse(BASE_TIME) - 60 * 60_000).toISOString() })
    const oldBytes = files.files.get(UPDATE_CHECK_SCHEDULE_PATH)!
    await store.save({ lastCheckedAt: BASE_TIME })
    const entered = deferred()
    const release = deferred<Uint8Array>()
    vi.spyOn(files, 'read').mockImplementationOnce(async () => { entered.resolve(); return release.promise })
    const scheduler = new UpdateCheckScheduler({
      files, locks, getPolicy: async () => policySnapshot(policy({ intervalMinutes: 1 })), checkUpdates: async () => result(),
    })
    const staleStart = scheduler.start()
    await entered.promise
    scheduler.stop()
    await scheduler.start()
    release.resolve(oldBytes)
    await staleStart
    expect(vi.getTimerCount()).toBe(1)
    expect(scheduler.stateSnapshot()).toMatchObject({
      lastCheckedAt: BASE_TIME,
      nextCheckAt: new Date(Date.parse(BASE_TIME) + 60_000).toISOString(),
    })
    scheduler.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries failed checks only at the configured period, never in an immediate loop', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const files = new InMemoryFiles()
    const locks = new TestLocks()
    const error = new Error('synthetic check failure')
    const checkUpdates = vi.fn().mockRejectedValue(error)
    const onError = vi.fn()
    const scheduler = new UpdateCheckScheduler({
      files, locks, getPolicy: async () => policySnapshot(policy({ intervalMinutes: 1 })), checkUpdates, onError,
    })
    await scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    await waitForCondition(() => scheduler.stateSnapshot().lastError === 'automatic-check-failed' && vi.getTimerCount() === 1)
    expect(scheduler.stateSnapshot()).toMatchObject({ lastCheckedAt: BASE_TIME, nextCheckAt: new Date(Date.parse(BASE_TIME) + 60_000).toISOString() })
    expect(checkUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(checkUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await waitForCondition(() => checkUpdates.mock.calls.length === 2 && vi.getTimerCount() === 1)
    expect(checkUpdates).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledWith(error)
    scheduler.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('backs off a policy-read failure during a due cycle instead of rearming at zero delay', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const error = new Error('synthetic policy read failure')
    const getPolicy = vi.fn()
      .mockResolvedValueOnce(policySnapshot(policy({ intervalMinutes: 1 })))
      .mockRejectedValueOnce(error)
      .mockResolvedValue(policySnapshot(policy({ intervalMinutes: 1 })))
    const checkUpdates = vi.fn(async () => result())
    const onError = vi.fn()
    const scheduler = new UpdateCheckScheduler({ files: new InMemoryFiles(), locks: new TestLocks(), getPolicy, checkUpdates, onError })
    await scheduler.start()
    await vi.advanceTimersToNextTimerAsync()
    await waitForCondition(() => vi.getTimerCount() === 1)
    expect(scheduler.stateSnapshot()).toMatchObject({ lastError: 'automatic-check-failed', nextCheckAt: new Date(Date.parse(BASE_TIME) + 60_000).toISOString() })
    expect(checkUpdates).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(error)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(checkUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await waitForCondition(() => checkUpdates.mock.calls.length === 1 && vi.getTimerCount() === 1)
    scheduler.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('backs off initial policy-read failures by the default period without plugin checks', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const getPolicy = vi.fn().mockRejectedValue(new Error('policy unavailable'))
    const checkUpdates = vi.fn(async () => result())
    const scheduler = new UpdateCheckScheduler({ files: new InMemoryFiles(), locks: new TestLocks(), getPolicy, checkUpdates })
    await scheduler.start()
    expect(vi.getTimerCount()).toBe(1)
    expect(scheduler.stateSnapshot().nextCheckAt).toBe(new Date(Date.parse(BASE_TIME) + 60 * 60_000).toISOString())
    await vi.advanceTimersByTimeAsync(60 * 60_000 - 1)
    expect(getPolicy).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await waitForCondition(() => vi.getTimerCount() === 1)
    expect(checkUpdates).not.toHaveBeenCalled()
    expect(getPolicy).toHaveBeenCalledTimes(3)
    scheduler.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['invalid-json', '{broken'],
    ['invalid-envelope', JSON.stringify({ schemaVersion: '2', revision: 'invalid', state: {} })],
    ['invalid-timestamp', JSON.stringify({ schemaVersion: '1', revision: 'invalid', state: { lastCheckedAt: 'not-a-date' } })],
    ['invalid-result', JSON.stringify({ schemaVersion: '1', revision: 'invalid', state: { lastResult: { checkedAt: BASE_TIME } } })],
    ['invalid-checksum', JSON.stringify({ schemaVersion: '1', revision: 'invalid', state: {} })],
  ])('preserves a %s state file while continuing read-only checks', async (_name, content) => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const files = new InMemoryFiles()
    const bytes = new TextEncoder().encode(content)
    files.files.set(UPDATE_CHECK_SCHEDULE_PATH, bytes)
    const onError = vi.fn()
    const checkUpdates = vi.fn(async () => result())
    const scheduler = new UpdateCheckScheduler({
      files, locks: new TestLocks(), getPolicy: async () => policySnapshot(policy({ intervalMinutes: 1 })), checkUpdates, onError,
    })
    await scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    await waitForCondition(() => scheduler.stateSnapshot().lastResult !== undefined && vi.getTimerCount() === 1)
    await vi.advanceTimersByTimeAsync(60_000)
    await waitForCondition(() => checkUpdates.mock.calls.length === 2 && vi.getTimerCount() === 1)
    expect(checkUpdates).toHaveBeenCalledTimes(2)
    expect(files.files.get(UPDATE_CHECK_SCHEDULE_PATH)).toEqual(bytes)
    expect(files.atomicWrites).toEqual([])
    expect(onError).toHaveBeenCalledTimes(1)
    scheduler.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves state corrupted after startup and refuses store writes over it', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const files = new InMemoryFiles()
    const locks = new TestLocks()
    const store = new UpdateCheckScheduleStore(files, locks)
    await store.save({ lastCheckedAt: BASE_TIME })
    const onError = vi.fn()
    const checkUpdates = vi.fn(async () => result())
    const scheduler = new UpdateCheckScheduler({ files, locks, getPolicy: async () => policySnapshot(policy({ intervalMinutes: 1 })), checkUpdates, onError })
    await scheduler.start()
    const corruptBytes = new TextEncoder().encode('{corrupt-after-start')
    files.files.set(UPDATE_CHECK_SCHEDULE_PATH, corruptBytes)
    const writesBeforeCorruption = files.atomicWrites.length
    await expect(store.save({ lastCheckedAt: BASE_TIME })).rejects.toMatchObject({ code: 'update-check-state/corrupt' })
    await vi.advanceTimersByTimeAsync(60_000)
    await waitForCondition(() => checkUpdates.mock.calls.length === 1 && vi.getTimerCount() === 1)
    await vi.advanceTimersByTimeAsync(60_000)
    await waitForCondition(() => checkUpdates.mock.calls.length === 2 && vi.getTimerCount() === 1)
    expect(files.files.get(UPDATE_CHECK_SCHEDULE_PATH)).toEqual(corruptBytes)
    expect(files.atomicWrites).toHaveLength(writesBeforeCorruption)
    expect(onError).toHaveBeenCalledTimes(1)
    scheduler.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves the last disk state on write failures and keeps failed checks on their period', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const files = new InMemoryFiles()
    const locks = new TestLocks()
    const store = new UpdateCheckScheduleStore(files, locks)
    await store.save({ lastCheckedAt: BASE_TIME })
    const originalBytes = files.files.get(UPDATE_CHECK_SCHEDULE_PATH)!
    const diskError = new Error('synthetic disk write failure')
    const write = vi.spyOn(files, 'writeAtomic').mockRejectedValue(diskError)
    const checkError = new Error('synthetic check failure')
    const checkUpdates = vi.fn().mockRejectedValue(checkError)
    const onError = vi.fn()
    const scheduler = new UpdateCheckScheduler({ files, locks, getPolicy: async () => policySnapshot(policy({ intervalMinutes: 1 })), checkUpdates, onError })
    await scheduler.start()
    await vi.advanceTimersByTimeAsync(60_000)
    await waitForCondition(() => scheduler.stateSnapshot().lastError === 'automatic-check-failed' && vi.getTimerCount() === 1)
    expect(scheduler.stateSnapshot().nextCheckAt).toBe(new Date(Date.parse(BASE_TIME) + 120_000).toISOString())
    expect(files.files.get(UPDATE_CHECK_SCHEDULE_PATH)).toEqual(originalBytes)
    expect(onError).toHaveBeenCalledWith(diskError)
    expect(onError).toHaveBeenCalledWith(checkError)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(checkUpdates).toHaveBeenCalledTimes(1)
    write.mockRestore()
    await vi.advanceTimersByTimeAsync(1)
    await waitForState(() => store.load(), state => state.lastCheckedAt === new Date(Date.parse(BASE_TIME) + 120_000).toISOString())
    await waitForCondition(() => vi.getTimerCount() === 1)
    expect(checkUpdates).toHaveBeenCalledTimes(2)
    scheduler.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('contains diagnostic callback failures even when startup state is corrupt', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(BASE_TIME))
    const files = new InMemoryFiles()
    files.files.set(UPDATE_CHECK_SCHEDULE_PATH, new TextEncoder().encode('{corrupt'))
    const checkUpdates = vi.fn(async () => result())
    const scheduler = new UpdateCheckScheduler({
      files, locks: new TestLocks(), getPolicy: async () => policySnapshot(policy()), checkUpdates,
      onError: () => { throw new Error('diagnostics failed') },
    })
    await expect(scheduler.start()).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(0)
    await waitForCondition(() => checkUpdates.mock.calls.length === 1 && vi.getTimerCount() === 1)
    expect(files.atomicWrites).toEqual([])
    scheduler.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('follows the owning Cordis Fiber lifecycle and policy saves without plugin writes', async () => {
    const directory = freshDirectory()
    const app = new Context()
    let fiber: { dispose(): Promise<void> } | undefined
    let backend: MarketBackend | undefined
    let inventoryReads = 0
    let pluginWrites = 0
    const stopSpy = vi.spyOn(UpdateCheckScheduler.prototype, 'stop')
    const refreshSpy = vi.spyOn(UpdateCheckScheduler.prototype, 'refresh')
    const manager = {
      listBundles: async () => { inventoryReads += 1; return [] },
      listPlugins: async () => [],
      installBundle: async () => { pluginWrites += 1; return { application: 'applied', changed: true, stage: 'install', target: '@test/plugin' } },
      setBundleEnabled: async () => { pluginWrites += 1; return { application: 'applied', changed: true, stage: 'enable', target: '@test/plugin' } },
      removeBundle: async () => { pluginWrites += 1; return { application: 'applied', changed: true, stage: 'remove', target: '@test/plugin' } },
    }
    const dataDirectory = join(directory, 'market')
    const stateFile = join(dataDirectory, 'state', UPDATE_CHECK_SCHEDULE_PATH)

    try {
      fiber = await app.plugin({
        apply: scope => {
          scope.reflect.provide('profileContext', { dir: join(directory, 'profile'), name: identity.profileName })
          scope.reflect.provide('pluginManager', manager)
          backend = createDshMarketBackend(
            scope as unknown as Parameters<typeof createDshMarketBackend>[0],
            identity,
            dataDirectory,
            { embeddedCatalogBytes: Buffer.from(JSON.stringify(embedded)), catalogSources: [] },
          )
        },
      })

      expect(backend).toBeDefined()
      const firstState = await waitForRuntimeState(stateFile, state => state.lastResult !== undefined)
      expect(firstState.nextCheckAt).toBe(new Date(Date.parse(firstState.lastCheckedAt!) + 60 * 60_000).toISOString())
      expect(inventoryReads).toBeGreaterThan(0)
      expect(pluginWrites).toBe(0)

      const initialPolicy = await backend!.updatePolicyGet()
      expect(initialPolicy.policy).toMatchObject({ automaticChecksEnabled: true, automaticDownloadsEnabled: false, automaticInstallsEnabled: false })
      const disabled = await backend!.updatePolicySave({
        expectedRevision: initialPolicy.revision,
        policy: policy({ automaticChecksEnabled: false }),
      })
      expect(disabled.policy.automaticChecksEnabled).toBe(false)

      const enabled = await backend!.updatePolicySave({
        expectedRevision: disabled.revision,
        policy: policy({ intervalMinutes: 1 }),
      })
      expect(enabled.policy).toMatchObject({ automaticChecksEnabled: true, automaticDownloadsEnabled: false, automaticInstallsEnabled: false, intervalMinutes: 1 })
      expect(refreshSpy).toHaveBeenCalledTimes(2)
      const reScheduled = await waitForRuntimeState(stateFile, state => state.lastCheckedAt === firstState.lastCheckedAt
        && state.nextCheckAt !== firstState.nextCheckAt)
      expect(reScheduled.nextCheckAt).toBe(new Date(Date.parse(firstState.lastCheckedAt!) + 60_000).toISOString())

      const readsAtStop = inventoryReads
      await fiber.dispose()
      fiber = undefined
      expect(stopSpy).toHaveBeenCalledTimes(1)
      await new Promise<void>(resolve => setTimeout(resolve, 30))
      expect(inventoryReads).toBe(readsAtStop)
      expect(pluginWrites).toBe(0)
      await backend!.taskList()
    } finally {
      if (fiber !== undefined) await fiber.dispose()
      await app.fiber.dispose()
      removeDirectory(directory)
    }
  })
})
