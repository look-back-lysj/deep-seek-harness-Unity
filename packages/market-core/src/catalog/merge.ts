import { createHash } from 'node:crypto'
import type { CatalogHostRequirements, CatalogPlugin, CatalogSnapshot, CatalogSourceMergeIssue, CatalogSourceRevision } from '../contracts/types.ts'
import { canonicalJson } from '../core/canonical.ts'
import { buildCatalogDiscovery } from './discovery.ts'

export interface CatalogMergeSource {
  readonly sourceId: string
  readonly snapshot: CatalogSnapshot
  readonly sourceRevision?: string
}

export type CatalogMergeSourceRevision = CatalogSourceRevision
export type CatalogMergeCandidate = CatalogSourceMergeIssue['candidates'][number]
export type CatalogMergeIssue = CatalogSourceMergeIssue

export interface CatalogMergeResult {
  readonly snapshot: CatalogSnapshot
  readonly issues: readonly CatalogMergeIssue[]
  readonly sourceRevisions: readonly CatalogMergeSourceRevision[]
}

interface Entry<Value> {
  readonly source: CatalogMergeSource
  readonly value: Value
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

function orderedUnique<Value>(values: readonly Value[]): Value[] {
  return [...new Map(values.map(value => [canonicalJson(value), value])).entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, value]) => value)
}

function releaseKey(id: string, version: string): string {
  return canonicalJson([id, version])
}

function sourceRevision(source: CatalogMergeSource): CatalogMergeSourceRevision {
  return { sourceId: source.sourceId, revision: source.sourceRevision ?? source.snapshot.revision }
}

function comparableRequirements(requirements: CatalogHostRequirements | undefined): unknown {
  if (!requirements) return undefined
  return orderedUnique(requirements.declarations.map(({ sourceId: _sourceId, sourceRevision: _sourceRevision, ...declaration }) => declaration))
}

function mergeRequirements(values: readonly { readonly hostRequirements?: CatalogHostRequirements }[]): CatalogHostRequirements | undefined {
  const requirements = values.flatMap(value => value.hostRequirements ? [value.hostRequirements] : [])
  if (!requirements.length) return undefined
  const coverage = ['unknown', 'latest-only', 'partial', 'complete'] as const
  return {
    historyCoverage: coverage.find(value => requirements.some(item => item.historyCoverage === value))!,
    declarations: orderedUnique(requirements.flatMap(value => value.declarations)),
  }
}

export function mergeCatalogSnapshots(base: CatalogMergeSource, extras: readonly CatalogMergeSource[]): CatalogMergeResult {
  const inputs = [base, ...extras]
  if (inputs.some(source => !['1', '2'].includes(source.snapshot.schemaVersion))) throw new TypeError('未知目录 schemaVersion，不能合并')
  const sourceRevisions = orderedUnique(inputs.map(sourceRevision))
  const knownBlockedEntries = inputs.flatMap(source => source.snapshot.plugins
    .filter(plugin => plugin.installability === 'hard-blocked' || plugin.publication === 'withdrawn').map(value => ({ source, value })))
  const issues: CatalogMergeIssue[] = []
  const report = <Value>(code: CatalogMergeIssue['code'], table: CatalogMergeIssue['table'], key: string,
    message: string, entries: readonly Entry<Value>[]): void => {
    issues.push({ code, table, key, message, candidates: orderedUnique(entries.map(entry => {
      const value = entry.value as { artifactDigest?: string; metadataDigest?: string; hostRequirements?: CatalogHostRequirements }
      return {
        ...sourceRevision(entry.source), contentDigest: digest(entry.value),
        ...(value.artifactDigest === undefined ? {} : { artifactDigest: value.artifactDigest }),
        ...(value.metadataDigest === undefined ? {} : { metadataDigest: value.metadataDigest }),
        ...(value.hostRequirements === undefined ? {} : { hostRequirements: value.hostRequirements }),
      }
    })) })
  }
  const groups = <Value>(entries: readonly Entry<Value>[], keyOf: (value: Value) => string): Map<string, Entry<Value>[]> => {
    const result = new Map<string, Entry<Value>[]>()
    for (const entry of entries) {
      const key = keyOf(entry.value)
      result.set(key, [...(result.get(key) ?? []), entry])
    }
    return result
  }
  const rejectedSources = new Set<string>()
  for (const [key, entries] of groups(inputs.map(source => ({ source, value: source })), source => source.sourceId)) {
    if (orderedUnique(entries.map(entry => entry.value)).length > 1) {
      rejectedSources.add(key)
      report('source-conflict', 'sources', key, '同一来源提供了不一致的快照或 revision，暂停该来源候选', entries)
    }
  }
  const sources = orderedUnique(inputs.filter(source => !rejectedSources.has(source.sourceId)))
  const collect = <Value>(read: (snapshot: CatalogSnapshot) => readonly Value[]): Entry<Value>[] =>
    sources.flatMap(source => read(source.snapshot).map(value => ({ source, value })))
  const mergeExact = <Value>(table: CatalogMergeIssue['table'], entries: readonly Entry<Value>[], keyOf: (value: Value) => string): Value[] => {
    const result: Value[] = []
    for (const [key, candidates] of groups(entries, keyOf)) {
      const values = orderedUnique(candidates.map(entry => entry.value))
      if (values.length !== 1) report('content-conflict', table, key, '相同身份的内容不一致，暂停全部冲突候选', candidates)
      else result.push(values[0]!)
    }
    return orderedUnique(result)
  }
  const presentations = mergeExact('presentations', collect(snapshot => snapshot.presentations), value => value.id)
  const presentationIds = new Set(presentations.map(value => value.id))
  const pluginEntries = collect(snapshot => snapshot.plugins)
  const deliveryEntries = collect(snapshot => snapshot.deliveries)
  const blockedIds = new Set<string>()
  const blockedPackages = new Set<string>()
  for (const [key, candidates] of groups(pluginEntries, plugin => releaseKey(plugin.packageName, plugin.version))) {
    if (new Set(candidates.map(entry => entry.value.id)).size > 1) {
      blockedPackages.add(key)
      report('identity-conflict', 'plugins', key, '同包同版对应多个插件 id，暂停全部候选', candidates)
    }
  }
  const deliveries: CatalogSnapshot['deliveries'][number][] = []
  for (const [key, candidates] of groups(deliveryEntries, delivery => releaseKey(delivery.pluginId, delivery.version))) {
    const identities = orderedUnique(candidates.map(({ value: { sources: _sources, ...identity } }) => identity))
    if (identities.length !== 1) {
      blockedIds.add(key)
      report('content-conflict', 'deliveries', key, '同发行的交付摘要或包身份不一致，暂停全部候选', candidates)
    } else deliveries.push({ ...identities[0]!, sources: orderedUnique(candidates.flatMap(entry => entry.value.sources)) })
  }
  for (const [key, candidates] of groups(deliveryEntries, delivery => releaseKey(delivery.packageName, delivery.version))) {
    if (new Set(candidates.map(entry => canonicalJson([entry.value.pluginId, entry.value.artifactDigest]))).size > 1) {
      blockedPackages.add(key)
      report('identity-conflict', 'deliveries', key, '同包同版的交付身份或摘要冲突，暂停全部候选', candidates)
    }
  }
  const plugins: CatalogPlugin[] = []
  for (const [key, candidates] of groups(pluginEntries, plugin => releaseKey(plugin.id, plugin.version))) {
    const content = orderedUnique(candidates.map(({ value: { installability: _installability, publication: _publication, hostRequirements, ...plugin } }) =>
      ({ ...plugin, hostRequirements: comparableRequirements(hostRequirements) })))
    const activeStates = new Set(candidates.map(entry => entry.value.installability).filter(state => state !== 'hard-blocked'))
    if (content.length !== 1 || activeStates.size > 1) {
      report('content-conflict', 'plugins', key, '跨候选的发行内容、摘要或声明存在待评估差异，保守暂停；不判定范围语义矛盾', candidates)
      continue
    }
    const plugin = candidates[0]!.value
    if (blockedIds.has(key) || blockedPackages.has(releaseKey(plugin.packageName, plugin.version))) continue
    if (!presentationIds.has(plugin.presentationId)) {
      report('reference-conflict', 'plugins', key, '展示资料缺失或冲突，暂停对应发行', candidates)
      continue
    }
    const relatedDeliveries = deliveryEntries.filter(entry => releaseKey(entry.value.pluginId, entry.value.version) === key)
    if (plugin.installability === 'bundle-installable' && relatedDeliveries.length === 0) {
      report('reference-conflict', 'plugins', key, '可安装发行缺少绑定的交付记录，暂停对应发行', candidates)
      continue
    }
    if (relatedDeliveries.some(entry => entry.value.packageName !== plugin.packageName || entry.value.artifactDigest !== plugin.artifactDigest)) {
      report<unknown>('reference-conflict', 'plugins', key, '插件与交付的包身份或摘要不一致，暂停对应发行', [...candidates, ...relatedDeliveries])
      continue
    }
    const knownBlocked = knownBlockedEntries.filter(entry => entry.value.packageName === plugin.packageName
      && entry.value.version === plugin.version && entry.value.artifactDigest === plugin.artifactDigest)
    const publicationStates = new Set(candidates.map(entry => entry.value.publication ?? 'unknown'))
    const withdrawn = knownBlocked.some(entry => entry.value.id === plugin.id && entry.value.publication === 'withdrawn')
    const publication: NonNullable<CatalogPlugin['publication']> = withdrawn ? 'withdrawn' : publicationStates.has('unknown') ? 'unknown' : 'active'
    const blocked = knownBlocked.length > 0 || publicationStates.size > 1
    if (blocked) report('known-blocked', 'plugins', key, '已知撤回、hard-blocked 或生命周期不一致保持阻断，镜像不能解除', [...candidates, ...knownBlocked])
    const hostRequirements = mergeRequirements(candidates.map(entry => entry.value))
    plugins.push({ ...plugin, ...(withdrawn || candidates.some(entry => entry.value.publication !== undefined) ? { publication } : {}), ...(blocked ? { installability: 'hard-blocked' as const } : {}), ...(hostRequirements ? { hostRequirements } : {}) })
  }
  const orderedPlugins = orderedUnique(plugins)
  const available = orderedPlugins.filter(plugin => plugin.installability !== 'hard-blocked')
  const listingEntries = collect(snapshot => snapshot.listings ?? [])
  const conflictingListings = new Set<string>()
  for (const [key, candidates] of groups(listingEntries, listing => releaseKey(listing.packageName, listing.requestedVersion ?? ''))) {
    if (new Set(candidates.map(entry => entry.value.id)).size > 1) {
      conflictingListings.add(key)
      report('identity-conflict', 'listings', key, '同包同请求版本的 Listing 身份冲突，不升级为可安装发行', candidates)
    }
  }
  const listings: NonNullable<CatalogSnapshot['listings']>[number][] = []
  for (const [key, candidates] of groups(listingEntries, listing => releaseKey(listing.id, listing.requestedVersion ?? ''))) {
    const values = orderedUnique(candidates.map(({ value: { hostRequirements, ...listing } }) =>
      ({ ...listing, hostRequirements: comparableRequirements(hostRequirements) })))
    if (values.length !== 1) {
      report('content-conflict', 'listings', key, '跨候选的 Listing 内容或声明存在待评估差异，保守暂停；不判定范围语义矛盾', candidates)
    } else {
      const listing = candidates[0]!.value
      if (conflictingListings.has(releaseKey(listing.packageName, listing.requestedVersion ?? ''))) continue
      const hostRequirements = mergeRequirements(candidates.map(entry => entry.value))
      listings.push({ ...listing, ...(hostRequirements ? { hostRequirements } : {}) })
    }
  }
  const hasRelease = (id: string, version: string, artifactDigest?: string): boolean =>
    available.some(plugin => plugin.id === id && plugin.version === version && (artifactDigest === undefined || plugin.artifactDigest === artifactDigest))
  const packs = mergeExact('packs', collect(snapshot => snapshot.packs), pack => releaseKey(pack.id, pack.version))
    .filter(pack => {
      const valid = pack.components.every(component => hasRelease(component.pluginId, component.version))
      if (!valid) report('reference-conflict', 'packs', releaseKey(pack.id, pack.version), '套餐引用被暂停、阻断或缺失的发行，暂停套餐', collect(snapshot => snapshot.packs.filter(value => value.id === pack.id && value.version === pack.version)))
      return valid
    })
  const collections = mergeExact('collections', collect(snapshot => snapshot.collections ?? []), collection => releaseKey(collection.id, collection.version))
    .filter(collection => {
      const valid = collection.components.every(component => hasRelease(component.pluginId, component.version, component.artifactDigest))
      if (!valid) report('reference-conflict', 'collections', releaseKey(collection.id, collection.version), '集合引用被暂停、阻断、摘要不符或缺失的发行，暂停集合', collect(snapshot => (snapshot.collections ?? []).filter(value => value.id === collection.id && value.version === collection.version)))
      return valid
    })
  const recommendations = orderedUnique(sources.flatMap(source => source.snapshot.recommendations ?? []))
    .filter(item => item.version === undefined ? available.filter(plugin => plugin.id === item.pluginId).length === 1 : hasRelease(item.pluginId, item.version))
  const snapshot: CatalogSnapshot = {
    schemaVersion: base.snapshot.schemaVersion, revision: `merge:${digest(sourceRevisions)}`,
    generatedAt: inputs.map(source => source.snapshot.generatedAt).sort().at(-1)!,
    origin: inputs.some(source => source.snapshot.origin === 'online') ? 'online' : inputs.some(source => source.snapshot.origin === 'cache') ? 'cache' : 'embedded',
    stale: inputs.some(source => source.snapshot.stale),
    plugins: orderedPlugins, listings: orderedUnique(listings), packs, collections,
    presentations: presentations.filter(value => orderedPlugins.some(plugin => plugin.presentationId === value.id)),
    deliveries: orderedUnique(deliveries.filter(delivery => available.some(plugin => plugin.id === delivery.pluginId
      && plugin.packageName === delivery.packageName && plugin.version === delivery.version && plugin.artifactDigest === delivery.artifactDigest))),
    recommendations, discovery: buildCatalogDiscovery({ plugins: available, presentations, recommendations }),
    sourceRevisions, mergeIssues: orderedUnique(issues),
  }
  return { snapshot, issues: snapshot.mergeIssues!, sourceRevisions }
}
