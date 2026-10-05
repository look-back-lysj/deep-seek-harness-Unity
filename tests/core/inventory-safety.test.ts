import { describe, expect, it, vi } from 'vitest'
import { bundleInventoryReadFailed, inventoryIssueAffectsPackage } from '../../packages/market-core/src/core/inventory-safety.ts'
import { InstallTaskManager } from '../../packages/market-core/src/core/task-manager.ts'
import { FakeArtifactPort, FakeHost, InMemoryLocks, InMemoryTaskStore, makeBundle, waitForTask } from './helpers.ts'

const packageName = '@test/plugin'

describe('bundle inventory diagnostic safety', () => {
  it.each([
    ['pluginManager:unavailable', true],
    ['listBundles:unavailable', true],
    ['listBundles:synthetic read failure', true],
    ['listBundles:invalid:object', true],
    ['bundle-entry:missing-name', true],
    [`bundle-entry:duplicate:${packageName}`, false],
    [`bundle-version:${packageName}`, false],
    [`bundle:${packageName}:invalid-rows`, false],
    ['listPlugins:unavailable', false],
    ['source-evidence:synthetic read failure', false],
    ['plugin-entry:duplicate:other-entry', false],
  ] as const)('classifies global bundle read diagnostic %s as %s', (issue, expected) => {
    expect(bundleInventoryReadFailed(issue)).toBe(expected)
  })

  it.each([
    [`bundle-version:${packageName}`, true],
    [`bundle-entry:duplicate:${packageName}`, true],
    [`bundle:${packageName}:invalid-rows`, true],
    [`bundle:${packageName}:unverified-management-error`, true],
    ['listBundles:unavailable', true],
    ['listBundles:synthetic read failure', true],
    ['bundle-entry:missing-name', true],
    [`bundle-version:${packageName}-extra`, false],
    [`bundle-entry:duplicate:${packageName}-extra`, false],
    [`bundle:${packageName}-extra:invalid-rows`, false],
    [`bundle-version:${packageName}/other`, false],
    [`bundle-entry:duplicate:${packageName}/other`, false],
    ['bundle:@other/plugin:invalid-rows', false],
    ['plugin-entry:duplicate:other-entry', false],
  ] as const)('attributes diagnostic %s to the exact target: %s', (issue, expected) => {
    expect(inventoryIssueAffectsPackage(issue, packageName)).toBe(expected)
  })
})

async function startTask(issues: string[], afterAcquire = false) {
  const bundle = await makeBundle({ plugins: [{ packageName, version: '1.0.0' }] })
  const host = new FakeHost()
  const artifacts = new FakeArtifactPort()
  const acquire = artifacts.acquire.bind(artifacts)
  vi.spyOn(artifacts, 'acquire').mockImplementation(async request => {
    const acquired = await acquire(request)
    if (afterAcquire) {
      host.unknownItems = issues
      host.stable = false
      host.unknownSharedImpact = true
    }
    return acquired
  })
  if (!afterAcquire) {
    host.unknownItems = issues
    host.stable = issues.length === 0
    host.unknownSharedImpact = issues.length > 0
  }
  const manager = new InstallTaskManager({
    host, artifacts, store: new InMemoryTaskStore(), locks: new InMemoryLocks(),
    now: () => new Date('2026-09-27T00:00:01.000Z'),
  })
  const started = await manager.start(bundle, {
    planId: bundle.plan.planId, planDigest: bundle.plan.planDigest,
    idempotencyKey: 'inventory-safety-start', confirmed: true,
  }, await host.readState())
  const task = await waitForTask(manager, started.task.taskId, state =>
    ['cancelled', 'completed', 'needs-attention', 'failed'].includes(state.status))
  return { task, host, artifacts }
}

describe('HC-1 actual InstallTaskManager inventory gate', () => {
  it.each([
    `bundle-version:${packageName}`,
    `bundle:${packageName}:invalid-rows`,
    `bundle-entry:duplicate:${packageName}`,
    'listBundles:unavailable',
    'listBundles:synthetic read failure',
    'listBundles:invalid:object',
    'bundle-entry:missing-name',
  ])('rejects %s without dispatch or artifact acquisition', async issue => {
    const current = await startTask([issue])
    expect(current.task.status).toBe('cancelled')
    expect(current.task.items[0]).toMatchObject({ changed: false, installOutcome: 'cancelled' })
    expect(current.host.writeBarrier).toBe(false)
    expect(current.host.calls).toHaveLength(0)
    expect(current.artifacts.acquired).toHaveLength(0)
  })

  it.each([
    `bundle-entry:duplicate:${packageName}`,
    'listBundles:synthetic read failure',
  ])('rechecks %s after acquisition and rejects before dispatch', async issue => {
    const current = await startTask([issue], true)
    expect(current.task.status).toBe('needs-attention')
    expect(current.host.calls).toHaveLength(0)
    expect(current.artifacts.acquired).toHaveLength(1)
  })

  it.each([false, true])('allows unrelated diagnostics without poisoning the outcome (after acquisition: %s)', async afterAcquire => {
    const current = await startTask([
      `bundle-version:${packageName}-extra`,
      `bundle:${packageName}-extra:invalid-rows`,
      `bundle-entry:duplicate:${packageName}-extra`,
      'plugin-entry:duplicate:other-entry',
    ], afterAcquire)
    expect(current.task.status).toBe('completed')
    expect(current.task.items[0]).toMatchObject({ changed: true, installOutcome: 'applied' })
    expect(current.host.calls.map(call => call.packageName)).toEqual([packageName])
    expect(current.artifacts.acquired).toHaveLength(1)
  })
})
