import type { CatalogPlugin, InventorySnapshot, UpdateCheckItem, UpdateCheckResult, UpdatePolicy } from '../contracts/types.ts'
import { compareVersions, validVersion } from './semver.ts'
import { evaluateAutomaticUpdate, type UpdatePolicyInput } from './update-policy.ts'

export type UpdateCheckStatus = 'update-available' | 'up-to-date' | 'not-in-catalog' | 'unknown' | 'incompatible'

export type { UpdateCheckItem, UpdateCheckResult } from '../contracts/types.ts'

export interface UpdateCheckOptions {
  readonly now?: Date
  readonly policy?: UpdatePolicyInput | UpdatePolicy | null
}

function latestForPackage(plugins: readonly CatalogPlugin[], packageName: string): CatalogPlugin | undefined {
  const candidates = plugins.filter(plugin => plugin.packageName === packageName)
  return candidates.slice().sort((left, right) => {
    if (!validVersion(left.version) || !validVersion(right.version)) return 0
    return compareVersions(right.version, left.version)
  })[0]
}

/**
 * Compare the verified inventory with a catalog snapshot. This function is
 * deliberately read-only: an update result never authorizes download or
 * installation, and unknown inventory remains unknown instead of becoming a
 * silent update candidate.
 */
export function compareInstalledUpdates(
  inventory: InventorySnapshot,
  plugins: readonly CatalogPlugin[],
  sourceRevision: string,
  options: UpdateCheckOptions & { readonly catalogStale?: boolean } = {},
): UpdateCheckResult {
  const checkedAt = (options.now ?? new Date()).toISOString()
  const items: UpdateCheckItem[] = []
  for (const item of inventory.items) {
    if (!item.installed) continue
    if (inventory.unknownItems.includes(item.packageName) || item.version === undefined || !validVersion(item.version)) {
      items.push({ packageName: item.packageName, ...(item.pluginId === undefined ? {} : { pluginId: item.pluginId }), ...(item.version === undefined ? {} : { installedVersion: item.version }), status: 'unknown', reason: 'inventory-version-unknown' })
      continue
    }
    const latest = latestForPackage(plugins, item.packageName)
    if (latest === undefined) {
      items.push({ packageName: item.packageName, ...(item.pluginId === undefined ? {} : { pluginId: item.pluginId }), installedVersion: item.version, status: 'not-in-catalog', reason: 'package-not-in-current-catalog' })
      continue
    }
    if (!validVersion(latest.version)) {
      items.push({ packageName: item.packageName, pluginId: latest.id, installedVersion: item.version, latestVersion: latest.version, status: 'unknown', reason: 'catalog-version-unknown' })
      continue
    }
    if (latest.installability === 'hard-blocked' || latest.installability === 'missing-artifact' || latest.installability === 'needs-repair') {
      items.push({ packageName: item.packageName, pluginId: latest.id, installedVersion: item.version, latestVersion: latest.version, status: 'incompatible', reason: `catalog:${latest.installability}` })
      continue
    }
    const order = compareVersions(latest.version, item.version)
    items.push({ packageName: item.packageName, pluginId: latest.id, installedVersion: item.version, latestVersion: latest.version, status: order > 0 ? 'update-available' : 'up-to-date' })
  }
  return { checkedAt, sourceRevision, catalogStale: options.catalogStale ?? false, inventoryRevision: inventory.revision, items }
}

/** Decide whether a scheduled check may run; it never grants write access. */
export function automaticUpdateCheckDecision(policy: UpdatePolicyInput | UpdatePolicy | null | undefined, input: Parameters<typeof evaluateAutomaticUpdate>[1] = {}) {
  return evaluateAutomaticUpdate(policy, input)
}
