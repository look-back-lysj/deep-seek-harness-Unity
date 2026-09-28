import { describe, expect, it } from 'vitest'
import { FakeHost, InMemoryLocks, InMemoryTaskStore, MemoryEventLog, FakeArtifactPort, makeBundle, waitForTask } from './helpers.ts'
import { InstallTaskManager } from '../../packages/market/src/core/task-manager.ts'

describe('interrupted task reconciliation', () => {
  it('marks in-flight work interrupted and prepares an explicit resume challenge', async () => {
    const host = new FakeHost()
    const gate: { release?: () => void } = {}
    host.installGate = new Promise<void>((resolve) => { gate.release = resolve })
    const bundle = await makeBundle({ plugins: [{ packageName: '@test/recovery', version: '1.0.0' }] })
    const store = new InMemoryTaskStore()
    const first = new InstallTaskManager({
      host,
      artifacts: new FakeArtifactPort(),
      store,
      locks: new InMemoryLocks(),
      events: new MemoryEventLog(),
      now: () => new Date('2026-09-27T00:00:01.000Z'),
    })
    const started = await first.start(bundle, {
      planId: bundle.plan.planId,
      planDigest: bundle.plan.planDigest,
      idempotencyKey: 'start',
      confirmed: true,
    }, await host.readState())
    await waitForTask(first, started.task.taskId, (task) => task.status === 'installing')

    const restartedHost = new FakeHost()
    const restarted = new InstallTaskManager({
      host: restartedHost,
      artifacts: new FakeArtifactPort(),
      store,
      locks: new InMemoryLocks(),
      events: new MemoryEventLog(),
      now: () => new Date('2026-09-27T00:00:02.000Z'),
    })
    await restarted.reconcileInterrupted('env-test')
    const task = await restarted.get(started.task.taskId)
    expect(task?.status).toBe('awaiting-resume')
    expect(task?.resume?.remainingPluginIds).toEqual(['p0'])
    gate.release?.()
  })

  it('keeps unresolved dependency recovery as needs-attention instead of queued', async () => {
    const host = new FakeHost()
    const gate: { release?: () => void } = {}
    host.installGate = new Promise<void>((resolve) => { gate.release = resolve })
    const bundle = await makeBundle({
      plugins: [
        { packageName: '@test/prerequisite', version: '1.0.0' },
        { packageName: '@test/consumer', version: '1.0.0' },
      ],
      edges: [{ prerequisiteId: 'p0', consumerId: 'p1', milestone: 'active' }],
    })
    const store = new InMemoryTaskStore()
    const first = new InstallTaskManager({
      host,
      artifacts: new FakeArtifactPort(),
      store,
      locks: new InMemoryLocks(),
      events: new MemoryEventLog(),
      now: () => new Date('2026-09-27T00:00:01.000Z'),
    })
    const started = await first.start(bundle, {
      planId: bundle.plan.planId,
      planDigest: bundle.plan.planDigest,
      idempotencyKey: 'start-dependency',
      confirmed: true,
    }, await host.readState())
    await waitForTask(first, started.task.taskId, (task) => task.status === 'installing')

    const restarted = new InstallTaskManager({
      host: new FakeHost(),
      artifacts: new FakeArtifactPort(),
      store,
      locks: new InMemoryLocks(),
      events: new MemoryEventLog(),
      now: () => new Date('2026-09-27T00:00:02.000Z'),
    })
    await restarted.reconcileInterrupted('env-test')
    const task = await restarted.get(started.task.taskId)
    expect(task?.status).toBe('needs-attention')
    expect(task?.resume).toBeUndefined()
    gate.release?.()
  })
})
