/**
 * Persistence boundary. The production Host supplies an adapter for the
 * official atomic-write/file APIs; tests use an in-memory implementation.
 * Keeping Node filesystem details out of the algorithm makes the store safe to
 * typecheck in the Client project while still requiring atomic replacement.
 */
import { canonicalJson } from '../core/canonical.ts'

export interface PersistenceFilePort {
  read(path: string): Promise<Uint8Array | undefined>
  writeAtomic(path: string, data: Uint8Array): Promise<void>
  append(path: string, data: Uint8Array): Promise<void>
  list(prefix: string): Promise<readonly string[]>
  remove(path: string): Promise<void>
  size(path: string): Promise<number | undefined>
}

export class PersistenceError extends Error {
  readonly code: string
  readonly preserveOldData: boolean

  constructor(code: string, message: string, preserveOldData = true, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'PersistenceError'
    this.code = code
    this.preserveOldData = preserveOldData
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function safeStoreId(value: string): string {
  if (!SAFE_ID.test(value) || value === '.' || value === '..') {
    throw new PersistenceError('path/unsafe-id', '存储 ID 不是安全的单一路径段')
  }
  return value
}

export function taskDirectory(taskId: string): string {
  return `tasks/${safeStoreId(taskId)}`
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(`${canonicalJson(value)}\n`)
}

export function decodeJson(data: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(data))
  } catch (error) {
    throw new PersistenceError('json/corrupt', 'JSON 文件损坏或不是 UTF-8', true, { cause: error })
  }
}

/** Reads a versioned document without silently replacing corrupt data. */
export async function readJsonDocument<T>(
  files: PersistenceFilePort,
  path: string,
  parse: (raw: unknown) => T,
): Promise<T | undefined> {
  const data = await files.read(path)
  if (data === undefined) return undefined
  return parse(decodeJson(data))
}

/** Uses the adapter's atomic replace; callers must not report success before this resolves. */
export async function writeJsonDocument(
  files: PersistenceFilePort,
  path: string,
  value: unknown,
): Promise<void> {
  await files.writeAtomic(path, encodeJson(value))
}