/**
 * Deterministic JSON serialization and hashing for immutable market plans.
 *
 * Why: the digest must be reproducible in both Host and Client-safe code without
 * depending on Node filesystem or crypto packages. Web Crypto is available in
 * the official runtime and keeps this module portable.
 */
export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

function normalize(value: unknown, seen: Set<object>): JsonValue {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number is not JSON-safe')
    return value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('cycle in canonical JSON')
    seen.add(value)
    const result = value.map((item) => normalize(item, seen))
    seen.delete(value)
    return result
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (seen.has(object)) throw new TypeError('cycle in canonical JSON')
    seen.add(object)
    const result: Record<string, JsonValue> = {}
    for (const key of Object.keys(object).sort()) {
      const item = object[key]
      if (item === undefined) continue
      result[key] = normalize(item, seen)
    }
    seen.delete(object)
    return result
  }
  throw new TypeError(`unsupported canonical JSON value: ${typeof value}`)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set<object>()))
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Shared challenge digest for an exact, sorted package approval list. */
export async function pendingBuildsDigest(packages: readonly string[]): Promise<string> {
  return sha256Hex(canonicalJson([...new Set(packages)].sort()))
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}
