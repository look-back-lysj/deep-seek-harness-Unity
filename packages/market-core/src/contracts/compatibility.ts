/** Browser-safe compatibility rules shared by every presentation adapter.
 * A minor version may add operations; it cannot change existing semantics.
 * Unknown/prerelease protocol identifiers are rejected rather than guessed.
 */
export const CORE_API_VERSION = '1.1.0'
export const CORE_VERSION = '0.1.6'

function parseVersion(value: string): readonly number[] | undefined {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value)) return undefined
  const parts = value.split('.').map(Number)
  return parts.every(Number.isSafeInteger) ? parts : undefined
}

/** provider must implement every operation the consumer was built against. */
export function supportsApiVersion(provider: string, required: string): boolean {
  const actual = parseVersion(provider)
  const minimum = parseVersion(required)
  return actual !== undefined && minimum !== undefined
    && actual[0] === minimum[0] && actual[1]! >= minimum[1]!
}
