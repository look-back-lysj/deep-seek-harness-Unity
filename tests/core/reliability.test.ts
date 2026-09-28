import { tmpdir } from 'node:os'
/** F-level regression: real market locks/JSON; official services are explicitly synthetic. */
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AtomicProfileLocks, NodePersistenceFiles } from '../../packages/market/src/adapters/dsh/persistence-adapter.ts'
import { InstallTaskManager } from '../../packages/market/src/core/task-manager.ts'
import { createPlanBundle, compareVersions, verifyPlanBundle } from '../../packages/market/src/core/planner.ts'
import { executionOf, withExecution } from '../../packages/market/src/core/execution-state.ts'
import { canonicalJson, sha256Hex } from '../../packages/market/src/core/canonical.ts'
import type { ArtifactPort, HostInstallOutcome, PlanBundle } from '../../packages/market/src/core/ports.ts'
import { JsonTaskStore } from '../../packages/market/src/persistence/task-store.ts'
import { SegmentedEventLog } from '../../packages/market/src/persistence/event-log.ts'
import { encodeJson } from '../../packages/market/src/persistence/files.ts'
import { FakeHost, FakeArtifactPort, makeBundle, inventoryItem, waitForTask, approvalDigest } from './helpers.ts'
import { makeTaskRecord } from '../persistence/helpers.ts'

const output = process.env.EAC_TEST_OUTPUT ?? join(tmpdir(), 'eac-market-tests')
mkdirSync(output, { recursive: true })
function gate() { let resolve = (): void => {}; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
function setup(host = new FakeHost(), artifacts: ArtifactPort = new FakeArtifactPort()) {
  const root = mkdtempSync(join(output, 'core-'))
  const files = new NodePersistenceFiles(join(root, 'state'))
  const locks = new AtomicProfileLocks(root, 5000)
  const store = new JsonTaskStore(files, locks)
  const events = new SegmentedEventLog(files)
  const deps = { host, artifacts, store, locks, events, coordinationFiles: files, now: () => new Date('2026-09-27T00:00:05Z') }
  return { root, files, locks, store, deps, host, manager: new InstallTaskManager(deps) }
}
async function start(setup: ReturnType<typeof setup>, bundle: PlanBundle, key = bundle.plan.planId, retryOfTaskId?: string) {
  return setup.manager.start(bundle, { planId: bundle.plan.planId, planDigest: bundle.plan.planDigest,
    confirmed: true, idempotencyKey: key, ...(retryOfTaskId === undefined ? {} : { retryOfTaskId }) }, await setup.host.readState())
}

describe('REV-01/03/15 immutable planner', () => {
  it.each([false, true])('both single and pack gate unverified consent (pack=%s)', async pack => {
    for (const verification of ['unknown', 'unverified', 'hard-incompatible'] as const) {
      for (const consent of [false, true]) {
        const context = { environmentId: 'env-test', hostFingerprint: 'test-host', catalogRevision: 'test', inventory: [], now: new Date(),
          plugins: [{ pluginId: 'p0', packageName: 'test-pkg', version: '1.0.0', artifactDigest: 'a'.repeat(64), verification, installable: true, requiresRestart: false }],
          selections: [{ pluginId: 'p0', packageName: 'test-pkg', targetVersion: '1.0.0', targetDigest: 'a'.repeat(64), enabledIntent: false, tryUnverified: consent }] }
        const lockBytes = new TextEncoder().encode('test-only-lock')
        const result = await createPlanBundle(context, pack ? { packId: 'test', packVersion: '1.0.0', components: [{ pluginId: 'p0', required: true }], lockBytes,
          execution: { schemaVersion: '1', packId: 'test', packVersion: '1.0.0', lockDigest: await sha256Hex(lockBytes), coverage: 'complete', provenance: 'synthetic-test', edges: [] } } : undefined)
        const allowed = consent && verification !== 'hard-incompatible'
        expect(result.bundle?.plan.items[0]?.action).toBe(allowed ? 'add' : 'blocked')
        expect(result.bundle?.steps).toHaveLength(allowed ? 1 : 0)
      }
    }
  })

  it('freezes actual source descriptions and seals them in bundleDigest', async () => {
    const delivery = { pluginId: 'p0', packageName: 'test-pkg', version: '1.0.0', artifactDigest: 'a'.repeat(64), sources: [{ ref: 'https://approved.invalid/test.tgz', kind: 'https-artifact' as const, priority: 0 }] }
    const result = await createPlanBundle({ environmentId: 'env-test', hostFingerprint: 'host', catalogRevision: 'test', inventory: [], now: new Date(),
      plugins: [{ ...delivery, verification: 'verified', installable: true, requiresRestart: false, delivery }],
      selections: [{ pluginId: 'p0', packageName: 'test-pkg', targetVersion: '1.0.0', targetDigest: 'a'.repeat(64), enabledIntent: false, tryUnverified: false }] })
    delivery.sources[0]!.ref = 'https://unconfirmed.invalid/new.tgz'
    expect(result.bundle?.deliveries?.[0]?.sources[0]?.ref).toBe('https://approved.invalid/test.tgz')
    expect(await verifyPlanBundle(result.bundle!)).toBe(true)
    expect(await verifyPlanBundle({ ...result.bundle!, deliveries: [delivery] })).toBe(false)
  })

  it('orders strict SemVer prereleases numerically and ignores build metadata', () => {
    const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0-rc.2', '1.0.0-rc.10', '1.0.0']
    for (let i = 1; i < chain.length; i++) {
      expect(compareVersions(chain[i - 1]!, chain[i]!)).toBe(-1)
      expect(compareVersions(chain[i]!, chain[i - 1]!)).toBe(1)
    }
    expect(compareVersions('1.0.0+old', '1.0.0+new')).toBe(0)
    expect(compareVersions('1.0.0-999999999999999999', '1.0.0-1000000000000000000')).toBe(-1)
    for (const invalid of ['v1.0.0', '1.0', '01.0.0', '1.0.0-01', '1.0.0-', '1.0.0+']) expect(() => compareVersions(invalid, invalid)).toThrow('invalid-semver')
  })
})

describe('REV-03/04/06/07 production coordination', () => {
  it('requires a new preflight for legacy cached/approved artifacts without frozen delivery', async () => {
    const s = setup()
    Object.assign(s.host, { requiresFrozenDelivery: true })
    const b = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const record = await makeTaskRecord(b, 'legacy-cached')
    const artifact = await new FakeArtifactPort().acquire({ requestId: 'old', pluginId: 'p0', packageName: 'a', version: '1.0.0', artifactDigest: 'digest-a', sourceRef: 'old-catalog' })
    await s.store.put(withExecution({ ...record, attempts: [{ id: 'attempt-1', requestId: 'old', pluginId: 'p0', phase: 'approved', artifact }], attemptCounter: 1 }, { writeUncertain: false }))
    await s.manager.runTaskLockedId(record.task.taskId)
    expect((await s.manager.get(record.task.taskId))?.status).toBe('needs-attention')
    expect(s.host.calls).toHaveLength(0)
  })
  it('persists download cancellation immediately and writes no remaining component', async () => {
    const entered = gate(); const release = gate(); const fallback = new FakeArtifactPort()
    let seenSignal: AbortSignal | undefined
    const s = setup(new FakeHost(), { async acquire(request, signal) { seenSignal = signal; entered.resolve(); await release.promise; return fallback.acquire(request) }, async release() {} })
    const started = await start(s, await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }, { packageName: 'b', version: '1.0.0' }] }))
    await entered.promise
    await s.manager.cancel({ taskId: started.task.taskId, idempotencyKey: 'cancel' })
    expect((await s.store.get(started.task.taskId))?.cancellationRequested).toBe(true)
    expect(seenSignal?.aborted).toBe(true)
    expect(s.host.calls).toHaveLength(0)
    release.resolve()
    const task = await waitForTask(s.manager, started.task.taskId, task => task.status === 'cancelled')
    expect(task.items.every(item => item.status === 'cancelled')).toBe(true)
    expect(s.host.calls).toHaveLength(0)
  })

  it('cancel during first install keeps occupation until its receipt and stops the next item', async () => {
    const release = gate(); const host = new FakeHost(); host.installGate = release.promise
    host.setOutcome('a', { kind: 'cancelled', changed: false, permissionChanges: [] })
    host.cancelOutcome = { kind: 'cancelled' }
    const s = setup(host)
    const first = await start(s, await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }, { packageName: 'b', version: '1.0.0' }] }))
    await vi.waitFor(() => expect(host.calls).toHaveLength(1))
    await s.manager.cancel({ taskId: first.task.taskId, idempotencyKey: 'cancel' })
    expect((await s.manager.get(first.task.taskId))?.status).toBe('cancelling')
    await expect(start(s, await makeBundle({ plugins: [{ packageName: 'c', version: '1.0.0' }] }))).rejects.toMatchObject({ code: 'task/write-unresolved' })
    release.resolve()
    await waitForTask(s.manager, first.task.taskId, task => task.status === 'cancelled')
    expect(host.calls.map(call => call.packageName)).toEqual(['a'])
    host.installGate = undefined
    const next = await start(s, await makeBundle({ plugins: [{ packageName: 'c', version: '1.0.0' }] }))
    await waitForTask(s.manager, next.task.taskId, task => task.status === 'completed')
  })

  it.each(['version', 'enabled', 'source', 'inventory'] as const)('rechecks %s after acquisition before any write', async change => {
    const entered = gate(); const release = gate(); const fallback = new FakeArtifactPort()
    const host = new FakeHost([inventoryItem('a', '1.0.0', false)])
    const s = setup(host, { async acquire(request) { entered.resolve(); await release.promise; return fallback.acquire(request) }, async release() {} })
    const task = await start(s, await makeBundle({ plugins: [{ packageName: 'a', version: '2.0.0', currentVersion: '1.0.0', currentEnabled: false }] }))
    await entered.promise
    if (change === 'version') host.items.set('a', inventoryItem('a', '9.0.0', false))
    if (change === 'enabled') host.items.set('a', inventoryItem('a', '1.0.0', true))
    if (change === 'source') host.items.set('a', { ...inventoryItem('a', '1.0.0', false), source: 'unknown' })
    if (change === 'inventory') {
      const read = host.readState.bind(host)
      host.readState = async () => { const state = await read(); return { ...state, inventory: { ...state.inventory, unknownItems: ['listBundles:failure'] } } }
    }
    release.resolve()
    await waitForTask(s.manager, task.task.taskId, task => task.status === 'needs-attention')
    expect(host.calls).toHaveLength(0)
  })

  it('permits a freshly confirmed plan after safe pre-write drift instead of permanently disabling that intent', async () => {
    const host = new FakeHost([inventoryItem('a', '1.0.0', false)])
    const s = setup(host)
    const stale = await makeBundle({ plugins: [{ packageName: 'a', version: '2.0.0', currentVersion: '1.0.0', currentEnabled: false }] })
    host.items.set('a', inventoryItem('a', '1.5.0', false))
    const old = await start(s, stale)
    await waitForTask(s.manager, old.task.taskId, task => task.status === 'needs-attention')
    const reviewed = await makeBundle({ plugins: [{ packageName: 'a', version: '2.0.0', currentVersion: '1.5.0', currentEnabled: false }] })
    const replacement = await start(s, reviewed)
    expect(replacement.created).toBe(true)
    await waitForTask(s.manager, replacement.task.taskId, task => task.status === 'completed')
    expect(host.calls).toHaveLength(1)
  })

  it('rechecks state after script approval and never writes changed targets', async () => {
    const s = setup()
    s.host.setOutcome('a', { kind: 'awaiting-approval', attemptId: 'official', pendingBuilds: ['script'], pendingBuildsDigest: await approvalDigest(['script']), permissionChanges: [] })
    const task = await start(s, await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] }))
    const waiting = await waitForTask(s.manager, task.task.taskId, task => task.status === 'awaiting-approval')
    s.host.items.set('a', inventoryItem('a', '9.0.0'))
    const challenge = waiting.approval!
    await s.manager.approveBuilds({ taskId: task.task.taskId, attemptId: challenge.attemptId, challengeId: challenge.id,
      pendingBuildsDigest: challenge.digest, approvedBuilds: challenge.packages, idempotencyKey: 'approve' })
    await waitForTask(s.manager, task.task.taskId, task => task.status === 'needs-attention')
    expect(s.host.calls).toHaveLength(1)
  })

  it.each(['download', 'approval'] as const)('rejects a release withdrawn during %s at the final write boundary', async phase => {
    const host = new FakeHost(); const entered = gate(); const release = gate(); const artifacts = new FakeArtifactPort()
    if (phase === 'approval') host.setOutcome('a', { kind: 'awaiting-approval', attemptId: 'official', pendingBuilds: ['script'], pendingBuildsDigest: await approvalDigest(['script']), permissionChanges: [] })
    const s = setup(host, { async acquire(request) { if (phase === 'download') { entered.resolve(); await release.promise } return artifacts.acquire(request) }, async release() {} })
    let withdrawn = false
    const validateWrite = vi.fn(async (bundle: PlanBundle, pluginId: string) => {
      expect(bundle.plan.items.find(item => item.pluginId === pluginId)).toMatchObject({ packageName: 'a', targetVersion: '1.0.0', targetDigest: 'digest-a' })
      if (withdrawn) throw Object.assign(new Error('测试发行已由团队撤回'), { code: 'release/withdrawn' })
    })
    const manager = new InstallTaskManager({ ...s.deps, validateWrite })
    const task = await start({ ...s, manager }, await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] }))
    if (phase === 'download') {
      await entered.promise; withdrawn = true; release.resolve()
    } else {
      const waiting = await waitForTask(manager, task.task.taskId, task => task.status === 'awaiting-approval')
      withdrawn = true
      const approval = waiting.approval!
      await manager.approveBuilds({ taskId: task.task.taskId, attemptId: approval.attemptId, challengeId: approval.id,
        pendingBuildsDigest: approval.digest, approvedBuilds: approval.packages, idempotencyKey: 'approve-withdrawn' })
    }
    const stopped = await waitForTask(manager, task.task.taskId, task => task.status === 'needs-attention')
    expect(stopped.items[0]).toMatchObject({ status: 'failed', errorCode: 'release/withdrawn', error: '测试发行已由团队撤回' })
    expect(host.calls).toHaveLength(phase === 'download' ? 0 : 1)
    expect(validateWrite).toHaveBeenCalledTimes(phase === 'download' ? 1 : 2)
  })

  it('a late cancellation reports the last real success after its receipt under real locks', async () => {
    const host = new FakeHost(); const release = gate(); host.installGate = release.promise
    const s = setup(host)
    const task = await start(s, await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] }))
    await vi.waitFor(() => expect(host.calls).toHaveLength(1))
    await s.manager.cancel({ taskId: task.task.taskId, idempotencyKey: 'too-late' })
    expect((await s.manager.get(task.task.taskId))?.status).toBe('cancelling')
    release.resolve()
    const completed = await waitForTask(s.manager, task.task.taskId, task => task.status === 'completed')
    expect(completed.items[0]?.installOutcome).toBe('applied')
    expect((await s.manager.cancel({ taskId: task.task.taskId, idempotencyKey: 'after-completion' })).status).toBe('completed')
  })

  it('reuses equivalent plans during script approval, cancels the gate, and persists explicit retry links', async () => {
    const s = setup()
    s.host.setOutcome('a', { kind: 'awaiting-approval', attemptId: 'official', pendingBuilds: ['test-script'], pendingBuildsDigest: await approvalDigest(['test-script']), permissionChanges: [] })
    const make = () => makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const first = await start(s, await make(), 'one')
    await waitForTask(s.manager, first.task.taskId, task => task.status === 'awaiting-approval')
    const second = await start(s, await make(), 'two')
    expect(second.created).toBe(false)
    expect(second.task.taskId).toBe(first.task.taskId)
    expect(s.host.calls).toHaveLength(1)
    await s.manager.cancel({ taskId: first.task.taskId, idempotencyKey: 'cancel' })
    await waitForTask(s.manager, first.task.taskId, task => task.status === 'cancelled')
    const retry = await start(s, await make(), 'retry', first.task.taskId)
    const completed = await waitForTask(s.manager, retry.task.taskId, task => task.status === 'completed')
    expect(completed.retryOfTaskId).toBe(first.task.taskId)
    expect(s.host.calls).toHaveLength(2)
    expect((await s.store.list('env-test')).length).toBe(2)
  })

  it('never replays a legacy unknown request even when disk already has the target', async () => {
    const s = setup(new FakeHost([{ ...inventoryItem('a', '1.0.0'), source: 'market-cache-file' }]))
    const b = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const old = await makeTaskRecord(b, 'legacy-interrupted')
    const record = { ...old, task: { ...old.task, status: 'installing' as const, items: old.task.items.map(item => ({ ...item, status: 'installing' as const })) },
      activeRequestId: 'old-unknown', attempts: [{ id: 'old', requestId: 'old-unknown', pluginId: 'p0', phase: 'installing' as const }], attemptCounter: 1 }
    await s.store.put(record)
    await s.manager.reconcileInterrupted('env-test')
    const restored = await s.manager.get(record.task.taskId)
    expect(restored?.status).toBe('needs-attention')
    expect(restored?.resume).toBeUndefined()
    await s.manager.prepareResume(record.task.taskId)
    expect(s.host.calls).toHaveLength(0)
    await expect(start(s, await makeBundle({ plugins: [{ packageName: 'b', version: '1.0.0' }] }))).rejects.toMatchObject({ code: 'task/write-unresolved' })
  })

  it('settles a received success after restart without reinstalling and permits unrelated work', async () => {
    const host = new FakeHost([{ ...inventoryItem('a', '1.0.0'), source: 'market-cache-file' }]); const s = setup(host)
    const b = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const old = await makeTaskRecord(b, 'received-before-crash')
    const outcome: HostInstallOutcome = { kind: 'applied', changed: true, restartRequired: false, permissionChanges: [] }
    const record = withExecution({ ...old, task: { ...old.task, status: 'installing' }, activeRequestId: 'received',
      attempts: [{ id: 'attempt-1', requestId: 'received', pluginId: 'p0', phase: 'installing' }], attemptCounter: 1 },
    { writeUncertain: true, attempts: { 'attempt-1': { stage: 'received', sessionRevision: 'old-host', outcome } } })
    await s.store.put(record)
    const restarted = new InstallTaskManager(s.deps)
    await restarted.reconcileInterrupted('env-test')
    expect((await restarted.get(record.task.taskId))?.status).toBe('completed')
    expect(host.calls).toHaveLength(0)
    expect(executionOf((await s.store.get(record.task.taskId))!)?.writeUncertain).toBe(false)
    const next = await start(s, await makeBundle({ plugins: [{ packageName: 'b', version: '1.0.0' }] }))
    await waitForTask(s.manager, next.task.taskId, task => task.status === 'completed')
  })

  it('keeps old active members behind the restart barrier and requires all target members after restart', async () => {
    const s = setup()
    s.host.setOutcome('a', { kind: 'applied', changed: true, restartRequired: true, permissionChanges: [] })
    const task = await start(s, await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }, { packageName: 'b', version: '1.0.0' }], edges: [{ prerequisiteId: 'p0', consumerId: 'p1', milestone: 'active' }] }))
    await waitForTask(s.manager, task.task.taskId, task => task.status === 'awaiting-resume')
    const active = s.host.items.get('a')!
    s.host.items.set('a', { ...active, restartRequired: false })
    expect((await s.manager.prepareResume(task.task.taskId)).resume).toBeUndefined()
    s.host.sessionRevision = 'real-new-process-synthetic'
    s.host.items.set('a', { ...active, restartRequired: false, rows: [] })
    expect((await s.manager.prepareResume(task.task.taskId)).resume).toBeUndefined()
    s.host.items.set('a', { ...active, restartRequired: false, rows: [{ id: 'new', name: 'a', state: 'load-error', fiberPhase: 'failed' }] })
    expect((await s.manager.prepareResume(task.task.taskId)).resume).toBeUndefined()
    s.host.items.set('a', { ...active, restartRequired: false })
    const ready = await s.manager.prepareResume(task.task.taskId)
    expect(ready.resume?.remainingPluginIds).toEqual(['p1'])
    await s.manager.resume({ taskId: task.task.taskId, challengeId: ready.resume!.id, resumeDigest: ready.resume!.digest, idempotencyKey: 'resume' })
    await waitForTask(s.manager, task.task.taskId, task => task.status === 'completed')
    expect(s.host.calls.map(call => call.packageName)).toEqual(['a', 'b'])
  })
})

describe('REV-08 shared ordinary management', () => {
  it('allows installation-supplied optional bundles to enable while refusing removal', async () => {
    const optional = { ...inventoryItem('optional-feature', '1.0.0', false), installed: false, removable: false, source: 'installation' as const }
    const s = setup(new FakeHost([optional]))
    const request = { environmentId: 'env-test', packageName: optional.packageName, expectedVersion: '1.0.0', idempotencyKey: 'optional-on', action: 'enable' as const }
    const write = vi.fn(async (): Promise<HostInstallOutcome> => { s.host.items.set(optional.packageName, { ...optional, bundleEnabled: true }); return { kind: 'applied', changed: true, restartRequired: false, permissionChanges: [] } })
    expect((await s.manager.manage(request, write)).kind).toBe('applied')
    await expect(s.manager.manage({ ...request, action: 'remove', idempotencyKey: 'remove' }, write)).rejects.toMatchObject({ code: 'management/not-removable' })
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('ordinary management cannot overtake an installation holding the production execution lock', async () => {
    const host = new FakeHost([inventoryItem('managed', '1.0.0')]); const release = gate(); host.installGate = release.promise
    const s = setup(host)
    const task = await start(s, await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] }))
    await vi.waitFor(() => expect(host.calls).toHaveLength(1))
    const write = vi.fn(async (): Promise<HostInstallOutcome> => { host.items.set('managed', inventoryItem('managed', '1.0.0', false)); return { kind: 'applied', changed: true, restartRequired: false, permissionChanges: [] } })
    const pending = s.manager.manage({ environmentId: 'env-test', packageName: 'managed', expectedVersion: '1.0.0', action: 'disable', idempotencyKey: 'disable' }, write)
    expect(write).not.toHaveBeenCalled()
    release.resolve()
    await waitForTask(s.manager, task.task.taskId, task => task.status === 'completed')
    expect((await pending).kind).toBe('applied')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('reconciles a known management receipt after a temporary inventory outage without replay', async () => {
    const host = new FakeHost([inventoryItem('managed', '1.0.0', false)]); const s = setup(host)
    const read = host.readState.bind(host)
    const request = { environmentId: 'env-test', packageName: 'managed', expectedVersion: '1.0.0', idempotencyKey: 'enable-outage', action: 'enable' as const }
    const write = vi.fn(async (): Promise<HostInstallOutcome> => {
      host.items.set('managed', inventoryItem('managed', '1.0.0'))
      host.readState = async () => { throw new Error('temporary inventory outage') }
      return { kind: 'applied', changed: true, restartRequired: false, permissionChanges: [] }
    })
    await expect(s.manager.manage(request, write)).rejects.toThrow('inventory outage')
    host.readState = read
    const fresh = new InstallTaskManager(s.deps)
    await fresh.reconcileInterrupted('env-test')
    expect((await fresh.manage(request, write)).kind).toBe('applied')
    expect(write).toHaveBeenCalledTimes(1)
  })
  it('persists dedupe across service recreation, rejects version drift and verifies successful enable/remove', async () => {
    const s = setup(new FakeHost([inventoryItem('managed', '1.0.0', false)]))
    const request = { environmentId: 'env-test', packageName: 'managed', expectedVersion: '1.0.0', idempotencyKey: 'enable', action: 'enable' as const }
    const write = vi.fn(async (): Promise<HostInstallOutcome> => { s.host.items.set('managed', inventoryItem('managed', '1.0.0')); return { kind: 'applied', changed: true, restartRequired: false, permissionChanges: [] } })
    expect((await s.manager.manage(request, write)).kind).toBe('applied')
    expect((await new InstallTaskManager(s.deps).manage(request, write)).kind).toBe('applied')
    expect(write).toHaveBeenCalledTimes(1)
    await expect(s.manager.manage({ ...request, expectedVersion: '0.9.0', idempotencyKey: 'drift' }, write)).rejects.toMatchObject({ code: 'management/version-drift' })
    const remove = vi.fn(async (): Promise<HostInstallOutcome> => { s.host.items.delete('managed'); return { kind: 'applied', changed: true, restartRequired: false, permissionChanges: [] } })
    const removal = { ...request, idempotencyKey: 'remove', action: 'remove' as const }
    await s.manager.manage(removal, remove)
    await s.manager.manage(removal, remove)
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('unknown management receipt blocks installation after recreation without replay', async () => {
    const s = setup(new FakeHost([inventoryItem('managed', '1.0.0', false)]))
    const request = { environmentId: 'env-test', packageName: 'managed', expectedVersion: '1.0.0', idempotencyKey: 'unknown', action: 'remove' as const }
    const write = vi.fn(async (): Promise<HostInstallOutcome> => ({ kind: 'unknown', error: 'lost receipt', permissionChanges: [] }))
    await s.manager.manage(request, write)
    const next = new InstallTaskManager(s.deps)
    await expect(next.manage(request, write)).rejects.toMatchObject({ code: 'management/write-unresolved' })
    await expect(start({ ...s, manager: next }, await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] }))).rejects.toMatchObject({ code: 'management/write-unresolved' })
    expect(write).toHaveBeenCalledTimes(1)
  })
})

describe('REV-06 real JSON commit recovery', () => {
  it('recovers summary-authoritative events after the event append failed', async () => {
    const s = setup(); const b = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const append = s.files.append.bind(s.files); let fail = true
    s.files.append = async (path, data) => { if (fail) { fail = false; throw new Error('event-write-interruption') } return append(path, data) }
    await expect(start(s, b)).rejects.toThrow('event-write-interruption')
    const record = (await s.store.list('env-test'))[0]!
    expect(record.task.events).toHaveLength(1)
    expect((await s.manager.events(record.task.taskId, -1)).events).toHaveLength(1)
    await new InstallTaskManager(s.deps).reconcileInterrupted('env-test')
    expect((await s.deps.events.read(record.task.taskId, -1, 100)).events[0]?.sequence).toBe(0)
    expect(s.host.calls).toHaveLength(0)
  })
  it.each(['summary', 'index'] as const)('recovers a committed task if %s write fails', async point => {
    const s = setup(); const b = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const record = await makeTaskRecord(b, 'orphan-' + point)
    const write = s.files.writeAtomic.bind(s.files); let failed = false
    s.files.writeAtomic = async (path, bytes) => {
      if (!failed && (point === 'summary' ? path.endsWith('/summary.json') : path === 'task-index.json')) { failed = true; throw new Error('simulated ' + point + ' interruption') }
      return write(path, bytes)
    }
    await expect(s.store.put(record)).rejects.toThrow('interruption')
    const rebuilt = new JsonTaskStore(new NodePersistenceFiles(join(s.root, 'state')), s.locks)
    expect((await rebuilt.list('env-test')).map(record => record.task.taskId)).toEqual([record.task.taskId])
    expect(await rebuilt.get(record.task.taskId)).toEqual(record)
  })

  it('discovers an orphan legacy summary and refuses corrupt orphan or checksum journals', async () => {
    const s = setup(); const b = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const record = await makeTaskRecord(b, 'legacy-orphan')
    await s.files.writeAtomic('tasks/legacy-orphan/summary.json', encodeJson({ schemaVersion: 1, record }))
    expect((await s.store.list('env-test')).length).toBe(1)
    await s.store.put(record)
    expect(await s.files.read('tasks/legacy-orphan/summary.v1-backup.json')).toBeDefined()
    await s.files.writeAtomic('tasks/legacy-orphan/commit.json', encodeJson({ schemaVersion: 1, digest: 'wrong', document: { schemaVersion: 2, record } }))
    await expect(s.store.list('env-test')).rejects.toMatchObject({ code: 'task/corrupt-commit' })
    const separate = setup()
    await separate.files.writeAtomic('tasks/corrupt/summary.json', new TextEncoder().encode('{ broken'))
    await expect(separate.store.list('env-test')).rejects.toMatchObject({ code: 'json/corrupt' })
    expect(canonicalJson(record)).toContain('legacy-orphan')
  })
})
