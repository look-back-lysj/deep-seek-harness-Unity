import semver from 'semver'
import type { CatalogHostRequirements, CoreCompatibility, CoreCompatibilityReason, HostCoreSnapshot, VersionScheme } from '../contracts/types.ts'
import { validVersion } from './semver.ts'

const MAX_BRANCHES = 4096

function schemeReason(scheme: VersionScheme | undefined, kind: 'version' | 'range'): CoreCompatibilityReason | undefined {
  if (scheme === undefined || scheme === 'unknown') return `core-${kind}-scheme-unknown`
  if (scheme !== 'npm' && scheme !== 'semver') return `core-${kind}-scheme-unsupported`
  return undefined
}

function precise(version: semver.SemVer): boolean {
  return version.prerelease.every(identifier => typeof identifier === 'number'
    || !/^\d+$/.test(identifier) || Number.isSafeInteger(Number(identifier)))
}

function coreVersion(version: semver.SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}`
}

function nextStable(version: semver.SemVer): semver.SemVer {
  if (version.patch < Number.MAX_SAFE_INTEGER) return new semver.SemVer(`${version.major}.${version.minor}.${version.patch + 1}`)
  if (version.minor < Number.MAX_SAFE_INTEGER) return new semver.SemVer(`${version.major}.${version.minor + 1}.0`)
  if (version.major < Number.MAX_SAFE_INTEGER) return new semver.SemVer(`${version.major + 1}.0.0`)
  throw new Error('range-proof-limit')
}

function witness(comparators: readonly semver.Comparator[], prereleaseCore?: string): semver.SemVer | undefined {
  let candidate = new semver.SemVer(prereleaseCore === undefined ? '0.0.0' : `${prereleaseCore}-0`)
  const ceiling = prereleaseCore === undefined ? undefined : new semver.SemVer(prereleaseCore)
  for (const comparator of comparators) {
    if (comparator.value === '' || comparator.operator === '<' || comparator.operator === '<=') continue
    const bound = comparator.semver
    let lower: semver.SemVer
    if (ceiling === undefined) {
      lower = bound.prerelease.length > 0 ? new semver.SemVer(coreVersion(bound))
        : comparator.operator === '>' ? nextStable(bound) : bound
    } else {
      if (semver.gte(bound, ceiling)) return undefined
      lower = comparator.operator === '>' && bound.prerelease.length > 0
        ? new semver.SemVer(`${bound.version}.0`) : bound
    }
    if (semver.gt(lower, candidate)) candidate = lower
  }
  if (ceiling !== undefined && semver.gte(candidate, ceiling)) return undefined
  return comparators.every(comparator => comparator.test(candidate)) ? candidate : undefined
}

function prereleaseCores(branches: readonly (readonly semver.Comparator[])[]): readonly string[] {
  let common: Set<string> | undefined
  for (const branch of branches) {
    const cores = new Set(branch.filter(comparator => comparator.value !== '' && comparator.semver.prerelease.length > 0)
      .map(comparator => coreVersion(comparator.semver)))
    common = common === undefined ? cores : new Set([...common].filter(core => cores.has(core)))
  }
  return [...common ?? []]
}

function hasWitness(comparators: readonly semver.Comparator[], cores: readonly string[]): boolean {
  return witness(comparators) !== undefined || cores.some(core => witness(comparators, core) !== undefined)
}

function intersectionReason(ranges: readonly semver.Range[], host: semver.SemVer): CoreCompatibilityReason {
  let visited = 0
  let nonempty = false
  let below = false
  let above = false
  let hostPrereleases = false
  const hostCore = coreVersion(host)
  const lowerSide = new semver.Comparator(`<=${host.version}`)
  const upperSide = new semver.Comparator(`>=${host.version}`)

  function visit(index: number, branches: readonly (readonly semver.Comparator[])[]): void {
    if (++visited > MAX_BRANCHES) throw new Error('range-proof-limit')
    if (index < ranges.length) {
      for (const branch of ranges[index]!.set) {
        visit(index + 1, [...branches, branch])
        if (below && above) return
      }
      return
    }
    const comparators = branches.flat()
    const cores = prereleaseCores(branches)
    if (!hasWitness(comparators, cores)) return
    nonempty = true
    hostPrereleases ||= cores.includes(hostCore) && witness(comparators, hostCore) !== undefined
    below ||= hasWitness([...comparators, lowerSide], cores)
    above ||= hasWitness([...comparators, upperSide], cores)
  }

  visit(0, [])
  if (!nonempty) return 'metadata-conflict'
  if (host.prerelease.length > 0) {
    const numericMatch = ranges.every(range => range.set.some(branch => branch.every(comparator => comparator.test(host))))
    const stable = new semver.SemVer(hostCore)
    const stableMatch = ranges.every(range => range.test(stable))
    if (numericMatch || (stableMatch && !hostPrereleases)) return 'core-range-mismatch'
  }
  if (!below && above) return 'core-too-old'
  if (below && !above) return 'core-too-new'
  return 'core-range-mismatch'
}

export function evaluateHostCompatibility(host: HostCoreSnapshot, requirements?: CatalogHostRequirements): CoreCompatibility {
  const declarations = requirements?.declarations ?? []
  const matching = declarations.filter(declaration => declaration.agentId === host.agentId)
  const declaredRanges = (matching.length > 0 ? matching : declarations)
    .flatMap(declaration => declaration.range === null ? [] : [declaration.range])
  const unknown = (reason: CoreCompatibilityReason): CoreCompatibility => ({ status: 'unknown', reason, declaredRanges })

  if (host.agentId === null || host.agentId.trim() === '' || host.status !== 'known' || host.version === null) return unknown('core-version-unknown')
  if (declarations.length === 0) return unknown('core-range-unknown')
  if (matching.length === 0) return declarations.some(declaration => declaration.agentId.trim() === '')
    ? unknown('core-range-unknown') : { status: 'incompatible', reason: 'target-agent-mismatch', declaredRanges }
  if (matching.length > 128) return unknown('core-range-evaluation-limited')
  const versionSchemeReason = schemeReason(host.versionScheme, 'version')
  if (versionSchemeReason !== undefined) return unknown(versionSchemeReason)
  if (!validVersion(host.version)) return unknown('core-version-invalid')

  let version: semver.SemVer
  try {
    version = new semver.SemVer(host.version, { loose: false })
    if (!precise(version)) return unknown('core-version-invalid')
  } catch {
    return unknown('core-version-invalid')
  }

  const ranges: semver.Range[] = []
  for (const declaration of matching) {
    if (declaration.range === null) return unknown('core-range-unknown')
    if (!declaration.range.trim()) return unknown('core-range-invalid')
    if (declaration.range.length > 4096) return unknown('core-range-evaluation-limited')
    const rangeSchemeReason = schemeReason(declaration.versionScheme, 'range')
    if (rangeSchemeReason !== undefined) return unknown(rangeSchemeReason)
    try {
      const range = new semver.Range(declaration.range, { loose: false, includePrerelease: false })
      if (range.set.some(branch => branch.some(comparator => comparator.value !== '' && !precise(comparator.semver)))) return unknown('core-range-invalid')
      ranges.push(range)
    } catch {
      return unknown('core-range-invalid')
    }
  }
  if (ranges.every(range => range.test(version))) return { status: 'compatible', declaredRanges }
  try {
    const reason = intersectionReason(ranges, version)
    return { status: reason === 'metadata-conflict' ? 'conflict' : 'incompatible', reason, declaredRanges }
  } catch {
    return unknown('core-range-evaluation-limited')
  }
}
