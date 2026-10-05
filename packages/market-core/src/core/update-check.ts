import type { CatalogPlugin, CatalogSnapshot, HostCoreSnapshot, InventorySnapshot, PackageReleaseSummary, UpdateCheckItem, UpdateCheckResult, UpdatePolicy } from '../contracts/types.ts'
import { evaluatePackageReleaseFacts, type ReleaseCandidate } from './release-facts.ts'
import { compareVersions, validVersion } from './semver.ts'
import { evaluateAutomaticUpdate, type UpdatePolicyInput } from './update-policy.ts'

export type UpdateCheckStatus = 'update-available' | 'up-to-date' | 'not-in-catalog' | 'unknown' | 'incompatible'

export type { UpdateCheckItem, UpdateCheckResult } from '../contracts/types.ts'

export interface UpdateCheckOptions {
  readonly now?: Date
  readonly policy?: UpdatePolicyInput | UpdatePolicy | null
  readonly hostCore?: HostCoreSnapshot
  readonly catalog?: Pick<CatalogSnapshot, 'revision' | 'stale' | 'deliveries'>
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
  const candidates: readonly ReleaseCandidate[] = plugins.map(plugin => ({ plugin, publication: plugin.publication ?? 'unknown' }))
  for (const item of inventory.items) {
    if (!item.installed) continue
    let releaseSummary: PackageReleaseSummary | undefined
    if (options.hostCore !== undefined && options.catalog !== undefined) {
      const facts = evaluatePackageReleaseFacts(options.hostCore, item.packageName, candidates, options.catalog, inventory)
      releaseSummary = {
        hostCore: facts.hostCore,
        installed: facts.installed,
        historyCoverage: facts.historyCoverage,
        latestPublished: facts.latestPublished,
        latestCompatible: facts.latestCompatible,
        latestPublishedCompatibility: facts.releases.find(release => release.identity === facts.latestPublished)?.compatibility ?? null,
        publishedAmbiguous: facts.publishedAmbiguous,
        compatibleAmbiguous: facts.compatibleAmbiguous,
      }
    }
    const summary = releaseSummary === undefined ? {} : { releaseSummary }
    if (inventory.unknownItems.includes(item.packageName) || releaseSummary?.installed.status === 'unknown' || item.version === undefined || !validVersion(item.version)) {
      items.push({ packageName: item.packageName, ...(item.pluginId === undefined ? {} : { pluginId: item.pluginId }), ...(item.version === undefined ? {} : { installedVersion: item.version }), status: 'unknown', reason: 'inventory-version-unknown', ...summary })
      continue
    }
    const latest = latestForPackage(plugins, item.packageName)
    if (latest === undefined) {
      items.push({ packageName: item.packageName, ...(item.pluginId === undefined ? {} : { pluginId: item.pluginId }), installedVersion: item.version, status: 'not-in-catalog', reason: 'package-not-in-current-catalog', ...summary })
      continue
    }
    if (!validVersion(latest.version)) {
      items.push({ packageName: item.packageName, pluginId: latest.id, installedVersion: item.version, latestVersion: latest.version, status: 'unknown', reason: 'catalog-version-unknown', ...summary })
      continue
    }
    if (latest.installability === 'hard-blocked' || latest.installability === 'missing-artifact' || latest.installability === 'needs-repair') {
      items.push({ packageName: item.packageName, pluginId: latest.id, installedVersion: item.version, latestVersion: latest.version, status: 'incompatible', reason: `catalog:${latest.installability}`, ...summary })
      continue
    }
    const order = compareVersions(latest.version, item.version)
    items.push({ packageName: item.packageName, pluginId: latest.id, installedVersion: item.version, latestVersion: latest.version, status: order > 0 ? 'update-available' : 'up-to-date', ...summary })
  }
  return { checkedAt, sourceRevision, catalogStale: options.catalogStale ?? false, inventoryRevision: inventory.revision, items }
}

/** Decide whether a scheduled check may run; it never grants write access. */
export function automaticUpdateCheckDecision(policy: UpdatePolicyInput | UpdatePolicy | null | undefined, input: Parameters<typeof evaluateAutomaticUpdate>[1] = {}) {
  return evaluateAutomaticUpdate(policy, input)
}
