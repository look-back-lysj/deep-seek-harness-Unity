/** Deliberately bounded range grammar; unsupported npm shorthand fails closed.
 * Exact versions, ^/~ full versions, comparator intersections and || are supported.
 * Prereleases require a comparator with the same prerelease base, as in npm SemVer.
 */
import { compareVersions, validVersion } from '../../core/semver.ts'

interface Comparator { op: string; version: string }
const base = (version: string): string => version.split(/[+-]/)[0]!

function expand(token: string): Comparator[] {
  const match = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(token)
  if (!match || !validVersion(match[2]!)) throw new Error('extension/unsupported-range')
  const op = match[1] ?? '='; const version = match[2]!
  if (op !== '^' && op !== '~') return [{ op, version }]
  const parts = base(version).split('.').map(BigInt)
  const index = op === '~' ? 1 : parts[0] !== 0n ? 0 : parts[1] !== 0n ? 1 : 2
  parts[index] = parts[index]! + 1n
  for (let i = index + 1; i < 3; i++) parts[i] = 0n
  return [{ op: '>=', version }, { op: '<', version: `${parts.join('.')}-0` }]
}

export function compatibleVersion(version: string, range: string): boolean {
  if (!validVersion(version) || typeof range !== 'string' || range.length > 512 || !range.trim()) {
    throw new Error('extension/invalid-version-range')
  }
  // Validate all arms before testing: an invalid second arm cannot hide behind a match.
  const sets = range.split('||').map((part) => {
    if (!part.trim()) throw new Error('extension/unsupported-range')
    return part.trim().split(/\s+/).flatMap(expand)
  })
  return sets.some((set) => {
    if (version.split('+')[0]!.includes('-') && !set.some((c) => c.version.split('+')[0]!.includes('-') && base(c.version) === base(version))) return false
    return set.every((c) => {
      const result = compareVersions(version, c.version)
      return c.op === '=' ? result === 0 : c.op === '>' ? result > 0 : c.op === '>=' ? result >= 0 : c.op === '<' ? result < 0 : result <= 0
    })
  })
}
