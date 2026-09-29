import { describe, expect, it, vi } from 'vitest'
import { createPlanBundle } from '../../packages/market-core/src/core/planner.ts'
import { InstallTaskManager } from '../../packages/market-core/src/core/task-manager.ts'
import {
  FakeArtifactPort,
  FakeHost,
  InMemoryTaskStore,
  MemoryEventLog,
  inventoryItem,
  makeBundle,
  makeManager,
  waitForTask,
} from './helpers.ts'

import { TestLocks as NonReentrantLocks } from '../persistence/helpers.ts'

describe('AUD install state fixes', () => {
  it('AUD-F02 creates a new immutable plan identity for a later retry', async () => {
    const base = {
      catalogRevision: 'catalog-1',
      environmentId: 'env-test',
      hostFingerprint: 'host-test',
      inventory: [inventoryItem('a', undefined)],
      plugins: [{ pluginId: 'p0', packageName: 'a', version: '1.0.0', artifactDigest: 'digest-a', verification: 'verified' as const, requiresRestart: false, installable: true }],
      selections: [{ pluginId: 'p0', packageName: 'a', targetVersion: '1.0.0', targetDigest: 'digest-a', enabledIntent: true, tryUnverified: false }],
    }
    const first = await createPlanBundle({ ...base, now: new Date('2026-09-27T00:00:00Z') })
    const retry = await createPlanBundle({ ...base, now: new Date('2026-09-27T00:00:01Z') })
    expect(first.status).toBe('ready')
    expect(retry.status).toBe('ready')
    if (first.status !== 'ready' || retry.status !== 'ready') throw new Error('unreachable')
    expect(first.bundle?.plan.planId).not.toBe(retry.bundle?.plan.planId)
    expect(first.bundle?.plan.planDigest).not.toBe(retry.bundle?.plan.planDigest)
  })

  it('AUD-F05 uses the pre-write version baseline for upgrade', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'upgrade', version: '2.0.0', currentVersion: '1.0.0' }] })
    const host = new FakeHost([inventoryItem('upgrade', '1.0.0')])
    const { manager, taskId } = await makeManager(bundle, host)
    const task = await waitForTask(manager, taskId, (state) => state.status === 'completed')
    expect(task.items[0]?.status).toBe('enabled')
    expect(host.calls.map((call) => call.packageName)).toEqual(['upgrade'])
  })

  it('AUD-F06 completes same-version keep without an install call', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'keep', version: '1.0.0', currentVersion: '1.0.0', currentEnabled: false }] })
    const host = new FakeHost([inventoryItem('keep', '1.0.0', false)])
    const { manager, taskId } = await makeManager(bundle, host)
    const task = await waitForTask(manager, taskId, (state) => state.status === 'completed')
    expect(task.items[0]?.status).toBe('disabled')
    expect(task.items[0]?.changed).toBe(false)
    expect(host.calls).toHaveLength(0)
  })

  it('AUD-F08 sends cancellation to Host before waiting for the install lock', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'cancel', version: '1.0.0' }] })
    const host = new FakeHost()
    const gate: { resolve: () => void } = { resolve: () => {} }
    host.installGate = new Promise<void>((resolve) => { gate.resolve = resolve })
    const manager = new InstallTaskManager({
      host,
      artifacts: new FakeArtifactPort(),
      store: new InMemoryTaskStore(),
      locks: new NonReentrantLocks(),
      events: new MemoryEventLog(),
      now: () => new Date('2026-09-27T00:00:01.000Z'),
    })
    const started = await manager.start(bundle, {
      planId: bundle.plan.planId,
      planDigest: bundle.plan.planDigest,
      idempotencyKey: 'start-cancel',
      confirmed: true,
    }, await host.readState())
    await waitForTask(manager, started.task.taskId, (state) => state.status === 'installing')
    const cancelPromise = manager.cancel({ taskId: started.task.taskId, idempotencyKey: 'cancel-now' })
    await vi.waitFor(() => expect(host.cancelCalls).toHaveLength(1))
    gate.resolve()
    await cancelPromise
  })

  it('AUD-F08 does not invent cancellation before the actual install receipt', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'late', version: '1.0.0' }] })
    const host = new FakeHost()
    host.cancelOutcome = { kind: 'cancelled', changed: false }
    host.setOutcome('late', { kind: 'applied', changed: true, restartRequired: false, permissionChanges: [] })
    const gate: { resolve: () => void } = { resolve: () => {} }
    host.installGate = new Promise<void>((resolve) => { gate.resolve = resolve })
    const { manager, taskId } = await makeManager(bundle, host)
    await waitForTask(manager, taskId, (state) => state.status === 'installing')
    const cancelling = manager.cancel({ taskId, idempotencyKey: 'cancel-late' })
    await vi.waitFor(async () => expect((await manager.get(taskId))?.status).toBe('cancelling'))
    gate.resolve()
    await cancelling
    const task = await waitForTask(manager, taskId, (state) => state.status === 'completed')
    expect(task.items[0]?.status).toBe('enabled')
  })
})
