import type { CatalogHostRequirements, CatalogPlugin, CatalogSnapshot, CoreCompatibility, HostCoreSnapshot, InventorySnapshot, ReleaseIdentity, ReleaseFact, InstalledVersionFact, PackageReleaseFacts } from '../contracts/types.ts'
import { canonicalJson } from './canonical.ts'
import { evaluateHostCompatibility } from './host-compatibility.ts'
import { bundleInventoryReadFailed, inventoryIssueAffectsPackage } from './inventory-safety.ts'
import { compareVersions, validVersion } from './semver.ts'

export type { ReleaseIdentity, ReleaseFact, InstalledVersionFact, PackageReleaseFacts } from '../contracts/types.ts'

export interface ReleaseCandidate {
  readonly plugin: CatalogPlugin
  readonly publication: 'active' | 'withdrawn' | 'unknown'
}

function identity(plugin: CatalogPlugin): ReleaseIdentity {
  return {
    pluginId: plugin.id, packageName: plugin.packageName, version: plugin.version,
    ...(plugin.metadataDigest === undefined ? {} : { metadataDigest: plugin.metadataDigest }),
    ...(plugin.artifactDigest === undefined ? {} : { artifactDigest: plugin.artifactDigest }),
    ...(plugin.releaseId === undefined ? {} : { releaseId: plugin.releaseId }),
  }
}

function installedVersion(inventory: InventorySnapshot, packageName: string): InstalledVersionFact {
  if (inventory.unknownItems.some(issue => issue === packageName || bundleInventoryReadFailed(issue) || inventoryIssueAffectsPackage(issue, packageName))) {
    return { status: 'unknown', version: null, reason: 'inventory-state-unknown' }
  }
  const installed = inventory.items.filter(item => item.packageName === packageName && item.installed)
  if (installed.length > 1) return { status: 'unknown', version: null, reason: 'inventory-identity-conflict' }
  if (installed.length === 0) return { status: 'absent', version: null }
  const version = installed[0]!.version
  if (version === undefined || !validVersion(version)) return { status: 'unknown', version: null, reason: 'inventory-version-unknown' }
  return { status: 'known', version }
}

function artifactFact(plugin: CatalogPlugin, catalog: Pick<CatalogSnapshot, 'deliveries'>): ReleaseFact['artifact'] {
  if (plugin.installability === 'hard-blocked' || plugin.installability === 'needs-repair') return { status: 'blocked', installability: plugin.installability }
  if (plugin.installability !== 'bundle-installable' || plugin.artifactDigest === undefined) return { status: 'missing', installability: plugin.installability }
  const delivery = catalog.deliveries.find(item => item.pluginId === plugin.id && item.packageName === plugin.packageName
    && item.version === plugin.version && item.artifactDigest === plugin.artifactDigest)
  return { status: delivery !== undefined && delivery.sources.length > 0 ? 'available' : 'missing', installability: plugin.installability }
}

function latest(candidates: readonly ReleaseFact[]): readonly ReleaseIdentity[] {
  if (candidates.length === 0) return []
  const highest = candidates[0]!.identity.version
  const identities = candidates.filter(candidate => compareVersions(candidate.identity.version, highest) === 0).map(candidate => candidate.identity)
  return [...new Map(identities.map(identity => [canonicalJson(identity), identity])).values()]
}

function coverage(candidates: readonly ReleaseCandidate[]): CatalogHostRequirements['historyCoverage'] {
  if (candidates.length === 0) return 'unknown'
  const ranks = ['unknown', 'latest-only', 'partial', 'complete'] as const
  return ranks.find(rank => candidates.some(candidate => (candidate.plugin.hostRequirements?.historyCoverage ?? 'unknown') === rank))!
}

export function evaluatePackageReleaseFacts(
  hostCore: HostCoreSnapshot,
  packageName: string,
  candidates: readonly ReleaseCandidate[],
  catalog: Pick<CatalogSnapshot, 'revision' | 'stale' | 'deliveries'>,
  inventory: InventorySnapshot,
  options: { readonly includePrerelease?: boolean } = {},
): PackageReleaseFacts {
  const packageCandidates = candidates.filter(candidate => candidate.plugin.packageName === packageName)
  const installed = installedVersion(inventory, packageName)
  const groups = new Map<string, ReleaseCandidate[]>()
  for (const candidate of packageCandidates) {
    const group = groups.get(candidate.plugin.version) ?? []
    group.push(candidate)
    groups.set(candidate.plugin.version, group)
  }
  const releases: ReleaseFact[] = []
  for (const group of groups.values()) {
    const identityFacts = new Set(group.map(({ plugin }) => canonicalJson({ identity: identity(plugin),
      requirements: plugin.hostRequirements?.declarations.map(({ sourceId: _sourceId, sourceRevision: _sourceRevision, ...declaration }) => declaration).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))) })))
    const conflicting = identityFacts.size > 1
    const unique = new Map(group.map(candidate => [canonicalJson(candidate.plugin), candidate]))
    const withdrawn = group.some(candidate => candidate.publication === 'withdrawn')
    const publication = withdrawn ? 'withdrawn' : group.some(candidate => candidate.publication === 'unknown') ? 'unknown' : 'active'
    for (const candidate of [...unique.values()].sort((left, right) => canonicalJson(identity(left.plugin)).localeCompare(canonicalJson(identity(right.plugin))))) {
      const plugin = candidate.plugin
      const valid = validVersion(plugin.version)
      const compatibility: CoreCompatibility = conflicting ? { status: 'conflict', reason: 'metadata-conflict', declaredRanges: [] }
        : evaluateHostCompatibility(hostCore, plugin.hostRequirements)
      const artifact = artifactFact(plugin, catalog)
      const relation = installed.status !== 'known' || !valid ? 'unknown' : (() => {
        const order = compareVersions(plugin.version, installed.version!)
        return order > 0 ? 'upgrade' : order < 0 ? 'downgrade' : 'same'
      })()
      const prerelease = valid && plugin.version.split('+')[0]!.includes('-')
      const exclusionReason = !valid ? 'release-version-invalid' : publication === 'withdrawn' ? 'release-withdrawn'
        : conflicting || compatibility.status === 'conflict' ? 'metadata-conflict'
          : compatibility.reason === 'target-agent-mismatch' ? 'target-agent-mismatch'
            : !options.includePrerelease && prerelease ? 'release-channel-excluded' : undefined
      const blockers = [
        ...(exclusionReason === undefined ? [] : [exclusionReason]),
        ...(publication === 'unknown' ? ['release-publication-unknown'] : []),
        ...(artifact.status === 'available' ? [] : [`artifact:${artifact.status}`]),
        ...(compatibility.status === 'incompatible' || compatibility.status === 'conflict' ? [compatibility.reason ?? 'core-range-mismatch'] : []),
        ...(plugin.verification === 'hard-incompatible' ? ['verification:hard-incompatible'] : []),
        ...(installed.status === 'unknown' ? ['inventory-state-unknown'] : []),
      ]
      releases.push({ identity: identity(plugin), ...(plugin.hostRequirements === undefined ? {} : { hostRequirements: plugin.hostRequirements }), compatibility,
        publication, artifact, verification: plugin.verification, selectable: blockers.length === 0, blockers: [...new Set(blockers)], relation,
        confirmationRequirements: relation === 'downgrade' ? ['ordinary-plan', 'downgrade'] : ['ordinary-plan'],
        ...(exclusionReason === undefined ? {} : { exclusionReason }),
      })
    }
  }
  releases.sort((left, right) => {
    const leftValid = validVersion(left.identity.version); const rightValid = validVersion(right.identity.version)
    if (leftValid !== rightValid) return leftValid ? -1 : 1
    const order = leftValid ? compareVersions(right.identity.version, left.identity.version) : 0
    return order || canonicalJson(left).localeCompare(canonicalJson(right))
  })
  const accepted = releases.filter(release => release.exclusionReason === undefined && release.publication === 'active')
  const latestPublishedCandidates = latest(accepted)
  const latestCompatibleCandidates = latest(accepted.filter(release => release.compatibility.status === 'compatible'))
  return {
    packageName, hostCore, catalogRevision: catalog.revision, catalogStale: catalog.stale, inventoryRevision: inventory.revision, installed,
    historyCoverage: coverage(packageCandidates), evaluatedRecords: packageCandidates.length,
    latestPublished: latestPublishedCandidates.length === 1 ? latestPublishedCandidates[0]! : null,
    latestCompatible: latestCompatibleCandidates.length === 1 ? latestCompatibleCandidates[0]! : null,
    latestPublishedCandidates, latestCompatibleCandidates,
    publishedAmbiguous: latestPublishedCandidates.length > 1, compatibleAmbiguous: latestCompatibleCandidates.length > 1, releases,
  }
}
