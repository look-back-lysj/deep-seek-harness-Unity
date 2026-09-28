import { describe, expect, it } from 'vitest'
import { createPlanBundle } from '../../packages/market/src/core/planner.ts'
import {
  FakeHost,
  InMemoryTaskStore,
  inventoryItem,
  makeBundle,
  makeManager,
  waitForTask,
} from './helpers.ts'

describe('remaining AUD install coverage', () => {
  it('AUD-F02 runs a failed plan as a new retry plan and preserves history', async () => {
    const plugin = { packageName: 'retry', version: '1.0.0' }
    const firstBundle = await makeBundle({ plugins: [plugin], now: new Date('2026-09-27T00:00:00Z') })
    const host = new FakeHost()
    host.setOutcome('retry', { kind: 'failed', changed: false, error: 'network', permissionChanges: [] })
    const store = new InMemoryTaskStore()
    const first = await makeManager(firstBundle, host, store)
    await waitForTask(first.manager, first.taskId, (task) => task.status === 'failed')

    const retryBundle = await makeBundle({ plugins: [plugin], now: new Date('2026-09-27T00:00:02Z') })
    expect(retryBundle.plan.planId).not.toBe(firstBundle.plan.planId)
    host.setOutcome('retry', { kind: 'applied', changed: true, restartRequired: false, permissionChanges: [] })
    const retry = await makeManager(retryBundle, host, store)
    await waitForTask(retry.manager, retry.taskId, (task) => task.status === 'completed')
    expect(store.records.size).toBe(2)
    await expect(first.manager.get(first.taskId)).resolves.toMatchObject({ status: 'failed' })
  })

  it('AUD-F05 downgrades using the old version as the pre-write baseline', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'downgrade', version: '1.0.0', currentVersion: '2.0.0' }] })
    const host = new FakeHost([inventoryItem('downgrade', '2.0.0')])
    const { manager, taskId } = await makeManager(bundle, host)
    const task = await waitForTask(manager, taskId, (state) => state.status === 'completed')
    expect(task.items[0]?.status).toBe('enabled')
    expect(host.calls.map((call) => call.packageName)).toEqual(['downgrade'])
  })

  it('AUD-F06 finishes a mixed plan and preserves the kept item disabled state', async () => {
    const bundle = await makeBundle({
      plugins: [
        { packageName: 'kept', version: '1.0.0', currentVersion: '1.0.0', currentEnabled: false },
        { packageName: 'installed', version: '2.0.0' },
      ],
    })
    const host = new FakeHost([inventoryItem('kept', '1.0.0', false)])
    const { manager, taskId } = await makeManager(bundle, host)
    const task = await waitForTask(manager, taskId, (state) => state.status === 'completed')
    expect(task.items.map((item) => [item.packageName, item.status])).toEqual([
      ['kept', 'disabled'],
      ['installed', 'enabled'],
    ])
    expect(host.calls.map((call) => call.packageName)).toEqual(['installed'])
  })
  it('AUD-F21 blocks unproven profile identity but allows proven market cache', async () => {
    const base = {
      catalogRevision: 'catalog-1',
      environmentId: 'env-test',
      hostFingerprint: 'host-test',
      plugins: [{ pluginId: 'p0', packageName: 'local', version: '1.0.0', artifactDigest: 'digest-local', verification: 'verified' as const, requiresRestart: false, installable: true }],
      selections: [{ pluginId: 'p0', packageName: 'local', targetVersion: '1.0.0', targetDigest: 'digest-local', enabledIntent: true, tryUnverified: false }],
      now: new Date('2026-09-27T00:00:00Z'),
    }
    const blocked = await createPlanBundle({
      ...base,
      inventory: [{ ...inventoryItem('local', '0.9.0'), source: 'profile' }],
      marketManagedPackageNames: [],
    })
    expect(blocked.status).toBe('ready')
    if (blocked.status !== 'ready') throw new Error('unreachable')
    expect(blocked.bundle?.plan.items[0]?.action).toBe('blocked')

    const allowed = await createPlanBundle({
      ...base,
      inventory: [{ ...inventoryItem('local', '0.9.0'), source: 'market-cache-file' }],
      marketManagedPackageNames: ['local'],
      localIdentityByPackage: { local: 'file' },
    })
    expect(allowed.status).toBe('ready')
    if (allowed.status !== 'ready') throw new Error('unreachable')
    expect(allowed.bundle?.plan.items[0]?.action).toBe('upgrade')
  })
})
