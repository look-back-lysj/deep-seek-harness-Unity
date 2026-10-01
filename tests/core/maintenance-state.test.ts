import { describe, expect, it } from 'vitest'
import type { InventoryItem, InventorySnapshot, TaskState } from '../../packages/market-core/src/contracts/types.ts'
import { buildMaintenanceSnapshot } from '../../packages/market-core/src/core/maintenance-state.ts'
import { computeDependencySync, computeExplicitSync } from '../../packages/market-core/src/core/sync-state.ts'
import {
  DEFAULT_UPDATE_POLICY,
  evaluateAutomaticUpdate,
  normalizeUpdatePolicy,
} from '../../packages/market-core/src/core/update-policy.ts'

function item(packageName: string, version: string | undefined, enabled = true, restartRequired = false): InventoryItem {
  return {
    packageName,
    ...(version === undefined ? {} : { version }),
    source: 'profile',
    installed: version !== undefined,
    bundleEnabled: enabled,
    removable: true,
    rows: [],
    restartRequired,
  }
}

function inventory(items: readonly InventoryItem[]): InventorySnapshot {
  return { environmentId: 'env-test', revision: 'inventory-1', items, unknownItems: [] }
}

function task(overrides: Partial<TaskState>): TaskState {
  return {
    taskId: 'task-1',
    planId: 'plan-1',
    planDigest: 'digest',
    environmentId: 'env-test',
    status: 'installing',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:01.000Z',
    items: [{
      pluginId: 'plugin-a', packageName: 'a', targetVersion: '2.0.0', status: 'installing',
      changed: false, installOutcome: 'unknown', permissionChanges: [],
    }],
    events: [],
    nextAction: 'waiting',
    ...overrides,
  }
}

describe('Core maintenance state', () => {
  it('keeps automatic checks on while download and install remain off by default', () => {
    expect(DEFAULT_UPDATE_POLICY).toEqual({
      automaticChecksEnabled: true,
      automaticDownloadsEnabled: false,
      automaticInstallsEnabled: false,
    })
    expect(normalizeUpdatePolicy({ automaticInstallsEnabled: true })).toEqual({
      automaticChecksEnabled: true,
      automaticDownloadsEnabled: false,
      automaticInstallsEnabled: true,
    })
    expect(evaluateAutomaticUpdate(undefined, { now: new Date('2026-10-01T00:00:00Z') })).toMatchObject({
      check: true, download: false, install: false,
    })
  })

  it('reports direct and transitive dependency consumers', () => {
    const result = computeDependencySync({
      packageNames: ['a', 'b', 'c'],
      edges: [{ prerequisite: 'a', consumer: 'b' }, { prerequisite: 'b', consumer: 'c' }],
      installedPackages: ['b', 'c'],
    })
    expect(result.a).toEqual({ dependencyOf: ['b', 'c'], requiredByCount: 2, releasable: false })
    expect(result.b).toEqual({ dependencyOf: ['c'], requiredByCount: 1, releasable: false })
    expect(result.c).toEqual({ dependencyOf: [], requiredByCount: 0, releasable: true })
  })

  it('does not infer explicit intent and preserves unknown state', () => {
    expect(computeExplicitSync({ packageNames: ['a', 'b'], explicitPackages: ['a'], unknownPackages: ['b'] })).toEqual({
      a: 'explicit', b: 'unknown',
    })
  })

  it('projects install, update, restart and unknown states for the adapter', () => {
    const snapshot = buildMaintenanceSnapshot({
      environmentId: 'env-test',
      inventory: inventory([item('installed', '1.0.0', true, true), item('keep', '1.0.0')]),
      targets: [
        { packageName: 'installed', targetVersion: '2.0.0', action: 'update' },
        { packageName: 'new', targetVersion: '1.0.0', action: 'install' },
      ],
      operations: [{ packageName: 'new', action: 'install', phase: 'in-progress', targetVersion: '1.0.0' }],
      unknownPackages: ['unknown'],
      explicitPackages: ['new'],
      generatedAt: new Date('2026-10-01T00:00:00Z'),
    })
    expect(snapshot.pendingRestart).toBe(true)
    expect(snapshot.packages.find(row => row.packageName === 'installed')).toMatchObject({
      installState: 'installed', enabledState: 'pending-restart', effectiveState: 'update',
    })
    expect(snapshot.packages.find(row => row.packageName === 'new')).toMatchObject({
      installState: 'installing', effectiveState: 'install', explicitState: 'explicit',
    })
    expect(snapshot.packages.find(row => row.packageName === 'unknown')).toMatchObject({
      installState: 'unknown', enabledState: 'unknown', effectiveState: 'unknown', explicitState: 'unknown',
    })
  })

  it('maps an active task to an updating state without adapter inference', () => {
    const snapshot = buildMaintenanceSnapshot({
      environmentId: 'env-test', inventory: inventory([item('a', '1.0.0')]), tasks: [task({})],
      generatedAt: new Date('2026-10-01T00:00:00Z'),
    })
    expect(snapshot.activeTaskIds).toEqual(['task-1'])
    expect(snapshot.packages[0]).toMatchObject({ installState: 'updating', targetVersion: '2.0.0', effectiveState: 'update' })
  })
})
