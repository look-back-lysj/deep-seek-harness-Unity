import { describe, expect, it } from 'vitest'
import { InstallTaskManager } from '../../packages/market-core/src/core/task-manager.ts'
import {
  approvalDigest,
  FakeArtifactPort,
  FakeHost,
  InMemoryLocks,
  InMemoryTaskStore,
  makeBundle,
  makeManager,
  MemoryEventLog,
  waitForTask,
} from './helpers.ts'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {}
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('InstallTaskManager', () => {
  it('keeps one task for environment + plan even with a different idempotency key', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const host = new FakeHost()
    host.setOutcome('a', {
      kind: 'awaiting-approval',
      attemptId: 'ignored-host-attempt',
      pendingBuilds: ['esbuild'],
      pendingBuildsDigest: await approvalDigest(['esbuild']),
      permissionChanges: [],
    })
    const first = await makeManager(bundle, host)
    const second = await first.manager.start(bundle, {
      planId: bundle.plan.planId,
      planDigest: bundle.plan.planDigest,
      idempotencyKey: 'other-tab',
      confirmed: true,
    }, await host.readState())
    expect(second.created).toBe(false)
    expect(second.task.taskId).toBe(first.taskId)
    expect(first.store.records.size).toBe(1)
  })

  it('continues unrelated items after a safe failure and reports partial', async () => {
    const bundle = await makeBundle({
      plugins: [{ packageName: 'fails', version: '1.0.0' }, { packageName: 'works', version: '2.0.0' }],
    })
    const host = new FakeHost()
    host.setOutcome('fails', {
      kind: 'failed',
      changed: false,
      error: 'official rejection',
      permissionChanges: [],
    })
    const { manager, taskId } = await makeManager(bundle, host)
    const task = await waitForTask(manager, taskId, (state) => state.status === 'partial')
    expect(task.items.map((item) => [item.packageName, item.status])).toEqual([
      ['fails', 'failed'],
      ['works', 'enabled'],
    ])
    expect(host.calls.map((call) => call.packageName)).toEqual(['fails', 'works'])
  })

  it('blocks consumers when their PackExecution prerequisite fails', async () => {
    const bundle = await makeBundle({
      plugins: [{ packageName: 'consumer', version: '1.0.0' }, { packageName: 'prerequisite', version: '1.0.0' }],
      edges: [{ prerequisiteId: 'p1', consumerId: 'p0', milestone: 'installed' }],
    })
    const host = new FakeHost()
    host.setOutcome('prerequisite', { kind: 'failed', changed: false, error: 'failed', permissionChanges: [] })
    const { manager, taskId } = await makeManager(bundle, host)
    const task = await waitForTask(manager, taskId, (state) => state.status === 'failed')
    expect(task.items.find((item) => item.packageName === 'consumer')?.status).toBe('blocked-by-dependency')
    expect(host.calls.map((call) => call.packageName)).toEqual(['prerequisite'])
  })

  it('blocks active dependents on restart and resumes only after an explicit challenge', async () => {
    const bundle = await makeBundle({
      plugins: [
        { packageName: 'consumer', version: '1.0.0' },
        { packageName: 'prerequisite', version: '1.0.0', requiresRestart: true },
      ],
      edges: [{ prerequisiteId: 'p1', consumerId: 'p0', milestone: 'active' }],
    })
    const host = new FakeHost()
    host.setOutcome('prerequisite', { kind: 'applied', changed: true, restartRequired: true, permissionChanges: [] })
    const { manager, taskId } = await makeManager(bundle, host)
    const waiting = await waitForTask(manager, taskId, (state) => state.status === 'awaiting-resume')
    expect(waiting.items.find((item) => item.packageName === 'consumer')?.status).toBe('blocked-on-restart')
    expect(waiting.resume).toBeUndefined()

    const restarted = host.items.get('prerequisite')
    if (restarted === undefined) throw new Error('missing prerequisite inventory')
    host.items.set('prerequisite', { ...restarted, restartRequired: false })
    host.sessionRevision = 'session-after-restart'
    const challenged = await manager.prepareResume(taskId)
    expect(challenged.resume).toBeDefined()
    if (challenged.resume === undefined) throw new Error('missing resume challenge')

    await manager.resume({
      taskId,
      challengeId: challenged.resume.id,
      resumeDigest: challenged.resume.digest,
      idempotencyKey: 'resume-1',
    })
    await manager.resume({
      taskId,
      challengeId: challenged.resume.id,
      resumeDigest: challenged.resume.digest,
      idempotencyKey: 'resume-1',
    })
    const task = await waitForTask(manager, taskId, (state) => state.status === 'completed')
    expect(task.items.map((item) => [item.packageName, item.status])).toEqual([
      ['prerequisite', 'enabled'],
      ['consumer', 'enabled'],
    ])
    expect(host.calls.map((call) => call.packageName)).toEqual(['prerequisite', 'consumer'])
  })

  it('binds build approval to an exact challenge and replays idempotently', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'needs-build', version: '1.0.0' }] })
    const host = new FakeHost()
    const digest = await approvalDigest(['sharp', 'esbuild'])
    host.setOutcome('needs-build', {
      kind: 'awaiting-approval',
      attemptId: 'host-attempt',
      pendingBuilds: ['sharp', 'esbuild'],
      pendingBuildsDigest: digest,
      permissionChanges: [{ packageName: 'sharp', decision: 'already-approved' }],
    })
    const { manager, taskId } = await makeManager(bundle, host)
    const waiting = await waitForTask(manager, taskId, (state) => state.status === 'awaiting-approval')
    const challenge = waiting.approval
    if (challenge === undefined) throw new Error('missing approval challenge')
    const request = {
      taskId,
      attemptId: challenge.attemptId,
      challengeId: challenge.id,
      pendingBuildsDigest: challenge.digest,
      approvedBuilds: ['esbuild', 'sharp'],
      idempotencyKey: 'approve-1',
    }
    await manager.approveBuilds(request)
    await manager.approveBuilds(request)
    await waitForTask(manager, taskId, (state) => state.status === 'completed')
    expect(host.calls[1]?.approvedBuilds).toEqual(['esbuild', 'sharp'])
  })

  it('rechecks before write and does not treat unstable activity as success', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const host = new FakeHost()
    host.stable = false
    const { manager, taskId } = await makeManager(bundle, host)
    const task = await waitForTask(manager, taskId, (state) => state.status === 'needs-attention')
    expect(task.items[0]?.installOutcome).toBe('unknown')
    expect(host.calls).toHaveLength(0)
  })

  it('reports Host unknown as needs-attention, never applied', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const host = new FakeHost()
    host.setOutcome('a', { kind: 'unknown', error: 'active request vanished', permissionChanges: [] })
    const { manager, taskId } = await makeManager(bundle, host)
    const task = await waitForTask(manager, taskId, (state) => state.status === 'needs-attention')
    expect(task.items[0]?.installOutcome).toBe('unknown')
  })

  it('executes a second plan after the first profile operation settles', async () => {
    const firstBundle = await makeBundle({ plugins: [{ packageName: 'first', version: '1.0.0' }], planId: 'plan-first' })
    const secondBundle = await makeBundle({ plugins: [{ packageName: 'second', version: '1.0.0' }], planId: 'plan-second' })
    const host = new FakeHost()
    const gate = deferred()
    host.installGate = gate.promise
    const artifacts = new FakeArtifactPort()
    const store = new InMemoryTaskStore()
    const manager = new InstallTaskManager({
      host,
      artifacts,
      store,
      locks: new InMemoryLocks(),
      events: new MemoryEventLog(),
      now: () => new Date('2026-09-27T00:00:05.000Z'),
    })
    const baseline = await host.readState()
    const first = await manager.start(firstBundle, {
      planId: firstBundle.plan.planId,
      planDigest: firstBundle.plan.planDigest,
      idempotencyKey: 'first',
      confirmed: true,
    }, baseline)
    await waitForTask(manager, first.task.taskId, (task) => task.status === 'installing')
    expect(host.calls).toHaveLength(1)
    gate.resolve()
    await waitForTask(manager, first.task.taskId, (task) => task.status === 'completed')
    const second = await manager.start(secondBundle, {
      planId: secondBundle.plan.planId,
      planDigest: secondBundle.plan.planDigest,
      idempotencyKey: 'second',
      confirmed: true,
    }, baseline)
    await waitForTask(manager, second.task.taskId, (task) => task.status === 'completed')
    expect(host.calls.map((call) => call.packageName)).toEqual(['first', 'second'])
  })

  it('keeps a low-space artifact failure as failed without claiming Host success', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const host = new FakeHost()
    const artifacts = new FakeArtifactPort()
    artifacts.fail = true
    const store = new InMemoryTaskStore()
    const manager = new InstallTaskManager({
      host,
      artifacts,
      store,
      locks: new InMemoryLocks(),
      events: new MemoryEventLog(),
      now: () => new Date('2026-09-27T00:00:05.000Z'),
    })
    const started = await manager.start(bundle, {
      planId: bundle.plan.planId,
      planDigest: bundle.plan.planDigest,
      idempotencyKey: 'low-space',
      confirmed: true,
    }, await host.readState())
    const task = await waitForTask(manager, started.task.taskId, (state) => state.status === 'failed')
    expect(task.items[0]?.status).toBe('failed')
    expect(task.items[0]?.error).toBe('disk-full')
    expect(host.calls).toHaveLength(0)
  })

  it('keeps a too-late cancellation as running until the Host install conclusion', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    const host = new FakeHost()
    const gate = deferred()
    host.installGate = gate.promise
    const { manager, taskId } = await makeManager(bundle, host)
    await waitForTask(manager, taskId, (task) => task.status === 'installing')
    const cancelling = await manager.cancel({ taskId, idempotencyKey: 'cancel-1' })
    expect(cancelling.status).toBe('cancelling')
    expect(cancelling.items[0]?.status).toBe('installing')
    gate.resolve()
    const task = await waitForTask(manager, taskId, (state) => state.status === 'completed')
    expect(task.items[0]?.status).toBe('enabled')
  })
})
