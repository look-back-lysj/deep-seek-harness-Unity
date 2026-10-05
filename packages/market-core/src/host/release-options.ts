import { createHash } from 'node:crypto'
import type { CatalogSnapshot, CatalogSourceRevision, HostCoreSnapshot, InventorySnapshot, ReleaseOption, ReleaseOptionsRequest, ReleaseOptionsResult } from '../contracts/types.ts'
import { canonicalJson } from '../core/canonical.ts'
import { MarketCoreError } from '../core/errors.ts'
import { evaluatePackageReleaseFacts } from '../core/release-facts.ts'

export interface ReleaseOptionsSource {
  readonly sourceId: string
  readonly snapshot: CatalogSnapshot
  readonly provenance?: CatalogSourceRevision
}

interface ReleaseOptionsInput {
  readonly environmentId: string
  readonly hostCore: HostCoreSnapshot
  readonly catalog: CatalogSnapshot
  readonly inventory: InventorySnapshot
  readonly sources: readonly ReleaseOptionsSource[]
  readonly now?: Date
}

export function parseReleaseOptionsRequest(value: ReleaseOptionsRequest): Required<Pick<ReleaseOptionsRequest, 'packageName' | 'includePrerelease' | 'limit'>> & Pick<ReleaseOptionsRequest, 'cursor'> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !['packageName', 'includePrerelease', 'limit', 'cursor'].includes(key))
    || typeof value.packageName !== 'string' || value.packageName.length > 214
    || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/u.test(value.packageName)
    || value.includePrerelease !== undefined && typeof value.includePrerelease !== 'boolean'
    || value.limit !== undefined && (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 100)
    || value.cursor !== undefined && (typeof value.cursor !== 'string' || value.cursor.length === 0 || value.cursor.length > 2048)) {
    throw new MarketCoreError('release-options/invalid-request', '版本列表请求无效；只接受已收录包名、通道和有界分页参数')
  }
  return { packageName: value.packageName, includePrerelease: value.includePrerelease ?? false, limit: value.limit ?? 20,
    ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function cursorOffset(cursor: string | undefined, binding: string, length: number): number {
  if (cursor === undefined) return 0
  let value: { schemaVersion?: unknown; binding?: unknown; offset?: unknown }
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error('invalid encoding')
    const bytes = Buffer.from(cursor, 'base64url')
    if (bytes.toString('base64url') !== cursor) throw new Error('invalid encoding')
    value = JSON.parse(bytes.toString('utf8')) as typeof value
    if (typeof value !== 'object' || value === null || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'binding,offset,schemaVersion'
      || value.schemaVersion !== 1 || typeof value.binding !== 'string'
      || !Number.isSafeInteger(value.offset) || (value.offset as number) < 1) throw new Error('invalid payload')
  } catch {
    throw new MarketCoreError('release-options/invalid-cursor', '分页位置无效，请重新读取首屏')
  }
  if (value.binding !== binding) throw new MarketCoreError('release-options/stale-cursor', '宿主、目录、库存或通道已变化，请重新读取首屏')
  if ((value.offset as number) > length) throw new MarketCoreError('release-options/invalid-cursor', '分页位置无效，请重新读取首屏')
  return value.offset as number
}

export function sourceRevisions(option: ReleaseOption['identity'], sources: readonly ReleaseOptionsSource[]): readonly CatalogSourceRevision[] {
  const revisions = sources.flatMap(source => source.snapshot.plugins.filter(plugin => plugin.id === option.pluginId && plugin.packageName === option.packageName
    && plugin.version === option.version && plugin.metadataDigest === option.metadataDigest && plugin.artifactDigest === option.artifactDigest
    && plugin.releaseId === option.releaseId).flatMap(plugin => source.provenance === undefined
      ? (plugin.hostRequirements?.declarations ?? []).flatMap(declaration => declaration.origin === 'agent-forge-target'
        && declaration.sourceId !== undefined && declaration.sourceRevision !== undefined
        ? [{ sourceId: declaration.sourceId, revision: declaration.sourceRevision }] : [])
      : [source.provenance]))
  return [...new Map(revisions.map(revision => [canonicalJson(revision), revision])).values()].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
}

export function buildReleaseOptions(request: ReleaseOptionsRequest, input: ReleaseOptionsInput): ReleaseOptionsResult {
  const selection = parseReleaseOptionsRequest(request)
  const rawPlugins = input.sources.flatMap(source => source.snapshot.plugins.filter(plugin => plugin.packageName === selection.packageName))
  const listings = input.sources.flatMap(source => (source.snapshot.listings ?? []).filter(listing => listing.packageName === selection.packageName))
  if (rawPlugins.length === 0 && listings.length === 0 && !input.catalog.plugins.some(plugin => plugin.packageName === selection.packageName)) {
    throw new MarketCoreError('release-options/package-not-found', '该包未收录在当前已接受目录中')
  }
  const candidates = input.catalog.plugins.filter(plugin => plugin.packageName === selection.packageName)
    .map(plugin => ({ plugin, publication: plugin.publication ?? 'unknown' as const }))
  const facts = evaluatePackageReleaseFacts(input.hostCore, selection.packageName, candidates, input.catalog, input.inventory, selection)
  const releases: ReleaseOption[] = facts.releases.map(release => ({ ...release, sources: sourceRevisions(release.identity, input.sources) }))
  const pluginIds = new Set(rawPlugins.map(plugin => plugin.id))
  const listingIds = new Set(listings.map(listing => listing.id))
  const issues = (input.catalog.mergeIssues ?? []).filter(issue => {
    if (issue.table === 'sources') return issue.candidates.some(candidate => input.sources.some(source => source.sourceId === candidate.sourceId
      && (source.snapshot.plugins.some(plugin => plugin.packageName === selection.packageName) || source.snapshot.listings?.some(listing => listing.packageName === selection.packageName))))
    try {
      const key = JSON.parse(issue.key) as unknown
      return Array.isArray(key) && typeof key[0] === 'string' && (key[0] === selection.packageName || pluginIds.has(key[0]) || listingIds.has(key[0]))
    } catch { return false }
  })
  const ranks = ['unknown', 'latest-only', 'partial', 'complete'] as const
  const coverages = [...(candidates.length === 0 ? [] : [facts.historyCoverage]), ...listings.map(listing => listing.hostRequirements?.historyCoverage ?? 'unknown')]
  const historyCoverage = ranks.find(rank => coverages.includes(rank)) ?? 'unknown'
  const context = {
    environmentId: input.environmentId, hostRevision: input.hostCore.hostRevision, catalogRevision: input.catalog.revision,
    inventoryRevision: input.inventory.revision, checkedAt: (input.now ?? new Date()).toISOString(), catalogStale: input.catalog.stale,
  }
  const binding = digest({ packageName: selection.packageName, includePrerelease: selection.includePrerelease,
    environmentId: context.environmentId, hostCore: input.hostCore, catalogRevision: context.catalogRevision,
    inventoryRevision: context.inventoryRevision, inventory: facts.installed, catalogStale: context.catalogStale, releases, issues,
  })
  const offset = cursorOffset(selection.cursor, binding, releases.length)
  const page = releases.slice(offset, offset + selection.limit)
  const nextOffset = offset + page.length
  const hasMore = nextOffset < releases.length
  return {
    packageName: selection.packageName, includePrerelease: selection.includePrerelease, context, hostCore: input.hostCore, installed: facts.installed,
    coverage: { historyCoverage, obtainedRecords: rawPlugins.length + listings.length, evaluatedRecords: facts.evaluatedRecords,
      totalKnownRecords: historyCoverage === 'complete' ? new Set(rawPlugins.map(plugin => canonicalJson([plugin.id, plugin.version, plugin.metadataDigest, plugin.artifactDigest]))).size : null,
      reasons: [...(historyCoverage === 'complete' ? [] : ['release-history-incomplete']), ...(listings.length === 0 ? [] : ['research-only-records']),
        ...(issues.length === 0 ? [] : ['catalog-merge-issues']), ...(releases.some(release => release.sources.length === 0) ? ['release-source-unknown'] : [])],
    },
    latestPublished: facts.latestPublished, latestCompatible: facts.latestCompatible,
    latestPublishedCandidates: facts.latestPublishedCandidates, latestCompatibleCandidates: facts.latestCompatibleCandidates,
    publishedAmbiguous: facts.publishedAmbiguous, compatibleAmbiguous: facts.compatibleAmbiguous, releases: page, issues,
    pagination: { cursor: hasMore ? Buffer.from(canonicalJson({ schemaVersion: 1, binding, offset: nextOffset })).toString('base64url') : null, hasMore },
  }
}
