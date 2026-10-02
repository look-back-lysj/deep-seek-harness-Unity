import { describe, expect, it } from 'vitest'
import type { CatalogPlugin, InventorySnapshot } from '../../packages/market-core/src/contracts/types.ts'
import { compareInstalledUpdates } from '../../packages/market-core/src/core/update-check.ts'

const inventory: InventorySnapshot = {
  environmentId: 'test', revision: 'inventory-1', unknownItems: [],
  items: [{ packageName: '@test/a', version: '1.0.0', source: 'profile', installed: true, bundleEnabled: true, removable: true, rows: [], restartRequired: false }],
}

const plugin = (version: string, installability: CatalogPlugin['installability'] = 'bundle-installable'): CatalogPlugin => ({
  id: 'test-a', name: 'A', packageName: '@test/a', version, summary: 'a', author: 'test', distribution: 'external', capabilityTier: 'standard', verification: 'verified', installability,
  presentationId: 'test-a', categories: [], screenshots: [], enabledPolicy: 'default-on', requiresRestart: false, requiresSetup: false, largeExternalResource: false,
})

describe('Core update check', () => {
  it('reports the highest catalog version without writing', () => {
    const result = compareInstalledUpdates(inventory, [plugin('1.5.0'), plugin('2.0.0')], 'catalog-2', { now: new Date('2026-10-01T00:00:00Z') })
    expect(result).toMatchObject({ sourceRevision: 'catalog-2', checkedAt: '2026-10-01T00:00:00.000Z' })
    expect(result.items[0]).toMatchObject({ status: 'update-available', installedVersion: '1.0.0', latestVersion: '2.0.0' })
  })

  it('keeps blocked catalog releases out of update candidates', () => {
    const result = compareInstalledUpdates(inventory, [plugin('2.0.0', 'hard-blocked')], 'catalog-3')
    expect(result.items[0]).toMatchObject({ status: 'incompatible', reason: 'catalog:hard-blocked' })
  })
})
