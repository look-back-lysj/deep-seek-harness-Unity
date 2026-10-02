import type { MaintenancePackageState } from '../contracts/types.ts'

export type ExplicitSyncState = MaintenancePackageState['explicitState']
export type DependencySyncState = MaintenancePackageState['dependencyState']

/** A dependency edge points from a prerequisite to the package consuming it. */
export interface PackageDependencyEdge {
  readonly prerequisite: string
  readonly consumer: string
}

export interface ExplicitSyncInput {
  readonly packageNames: readonly string[]
  readonly explicitPackages?: readonly string[]
  readonly unknownPackages?: readonly string[]
}

export interface DependencySyncInput {
  readonly packageNames?: readonly string[]
  readonly edges: readonly PackageDependencyEdge[]
  /** Selected or installed consumers keep a dependency live. */
  readonly selectedPackages?: readonly string[]
  readonly installedPackages?: readonly string[]
  readonly unknownPackages?: readonly string[]
}

export interface PackageSyncInput extends ExplicitSyncInput {
  readonly edges?: readonly PackageDependencyEdge[]
  readonly selectedPackages?: readonly string[]
  readonly installedPackages?: readonly string[]
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(value => value.trim().length > 0))].sort()
}

function setOf(values: readonly string[] | undefined): Set<string> {
  return new Set(values ?? [])
}

/** Compute explicit intent without inferring user intent from adapter inventory. */
export function computeExplicitSync(input: ExplicitSyncInput): Readonly<Record<string, ExplicitSyncState>> {
  const names = uniqueSorted([...input.packageNames, ...(input.explicitPackages ?? []), ...(input.unknownPackages ?? [])])
  const explicit = setOf(input.explicitPackages)
  const unknown = setOf(input.unknownPackages)
  const result: Record<string, ExplicitSyncState> = {}
  for (const name of names) {
    result[name] = unknown.has(name) ? 'unknown' : explicit.has(name) ? 'explicit' : 'none'
  }
  return result
}

/**
 * Compute live dependency consumers. Edges from packages which are neither
 * selected nor installed are intentionally ignored: they describe metadata,
 * not a current cancellation protection.
 */
export function computeDependencySync(input: DependencySyncInput): Readonly<Record<string, DependencySyncState>> {
  const selected = setOf(input.selectedPackages)
  const installed = setOf(input.installedPackages)
  const unknown = setOf(input.unknownPackages)
  const names = new Set<string>([
    ...(input.packageNames ?? []),
    ...input.edges.flatMap(edge => [edge.prerequisite, edge.consumer]),
    ...selected,
    ...installed,
    ...unknown,
  ])
  const directDependents = new Map<string, Set<string>>()
  for (const edge of input.edges) {
    if (!edge.prerequisite || !edge.consumer || edge.prerequisite === edge.consumer) continue
    if (!selected.has(edge.consumer) && !installed.has(edge.consumer)) continue
    const current = directDependents.get(edge.prerequisite) ?? new Set<string>()
    current.add(edge.consumer)
    directDependents.set(edge.prerequisite, current)
  }
  const result: Record<string, DependencySyncState> = {}
  for (const name of uniqueSorted(names)) {
    const dependencyOf = unknown.has(name) ? [] : uniqueSorted(transitiveDependents(name, directDependents))
    result[name] = {
      dependencyOf,
      requiredByCount: dependencyOf.length,
      releasable: !unknown.has(name) && dependencyOf.length === 0,
    }
  }
  return result
}

function transitiveDependents(name: string, direct: ReadonlyMap<string, Set<string>>): Set<string> {
  const result = new Set<string>()
  const queue = [...(direct.get(name) ?? [])]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const dependent = queue[cursor]
    if (dependent === undefined || result.has(dependent)) continue
    result.add(dependent)
    for (const next of direct.get(dependent) ?? []) queue.push(next)
  }
  return result
}

export interface PackageSyncState {
  readonly explicitState: ExplicitSyncState
  readonly dependencyState: DependencySyncState
}

/** Merge the two Core-owned facts in one deterministic package-indexed map. */
export function computePackageSync(input: PackageSyncInput): Readonly<Record<string, PackageSyncState>> {
  const dependency = computeDependencySync({
    packageNames: input.packageNames,
    edges: input.edges ?? [],
    ...(input.selectedPackages === undefined ? {} : { selectedPackages: input.selectedPackages }),
    ...(input.installedPackages === undefined ? {} : { installedPackages: input.installedPackages }),
    ...(input.unknownPackages === undefined ? {} : { unknownPackages: input.unknownPackages }),
  })
  const explicit = computeExplicitSync(input)
  const names = uniqueSorted([...Object.keys(explicit), ...Object.keys(dependency)])
  const result: Record<string, PackageSyncState> = {}
  for (const name of names) {
    result[name] = {
      explicitState: explicit[name] ?? 'none',
      dependencyState: dependency[name] ?? { dependencyOf: [], requiredByCount: 0, releasable: true },
    }
  }
  return result
}

export function isDependencyProtected(state: DependencySyncState): boolean {
  return state.requiredByCount > 0 || !state.releasable
}

export const syncExplicit = computeExplicitSync
export const syncDependency = computeDependencySync
