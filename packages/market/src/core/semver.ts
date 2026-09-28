/** Strict SemVer 2.0 ordering, including arbitrarily large numeric identifiers.
 * We cannot depend on an undeclared/transitive semver package in the shipped plugin.
 * Build metadata has no precedence; invalid input is refused instead of guessing a downgrade.
 */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export function validVersion(value: string): boolean { return SEMVER.test(value) }

function numeric(left: string, right: string): number {
  return left.length === right.length ? left === right ? 0 : left < right ? -1 : 1 : left.length < right.length ? -1 : 1
}

export function compareVersions(left: string, right: string): number {
  const a = SEMVER.exec(left)
  const b = SEMVER.exec(right)
  if (a === null || b === null) throw new Error('version/invalid-semver')
  for (const index of [1, 2, 3]) {
    const order = numeric(a[index]!, b[index]!)
    if (order !== 0) return order
  }
  if (a[4] === undefined || b[4] === undefined) return a[4] === b[4] ? 0 : a[4] === undefined ? 1 : -1
  const ap = a[4].split('.')
  const bp = b[4].split('.')
  for (let index = 0; index < Math.max(ap.length, bp.length); index++) {
    const av = ap[index]; const bv = bp[index]
    if (av === bv) continue
    if (av === undefined || bv === undefined) return av === undefined ? -1 : 1
    const an = /^\d+$/.test(av); const bn = /^\d+$/.test(bv)
    if (an && bn) return numeric(av, bv)
    if (an !== bn) return an ? -1 : 1
    return av < bv ? -1 : 1
  }
  return 0
}
