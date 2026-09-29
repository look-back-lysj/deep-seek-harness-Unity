/**
 * Host-only persistence backed by the official atomic-write package. All
 * paths are relative to the market-owned profile directory and cannot escape
 * it. Locks protect only market files and never nest the official package lock.
 *
 * The official package is loaded lazily because it is a host peer that may be
 * absent in a future core. A missing or changed package fails loudly: replacing
 * it with ordinary writes would silently remove atomic replacement and
 * cross-process lock guarantees.
 */
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, normalize, parse, relative, resolve } from 'node:path'
import { PersistenceError } from '../../persistence/files.ts'
import type { PersistenceFilePort } from '../../persistence/files.ts'
import type { ProfileLockHandle, ProfileLockPort } from '../../core/ports.ts'

interface WriteFileAtomicOptions {
  readonly mode: number
  readonly dirMode?: number
}

interface FileLockOptions {
  readonly waitMs?: number
}

interface AtomicWriteCapability {
  writeFileAtomic(filename: string, content: string, options: WriteFileAtomicOptions): Promise<void>
  withFileLock<T>(filename: string, operation: () => Promise<T>, options?: FileLockOptions): Promise<T>
}

export type AtomicWriteCapabilityLoader = () => Promise<unknown>

const loadOfficialAtomicWrite: AtomicWriteCapabilityLoader = () => import('@deepseek-ai/dsh-atomic-write')

function unavailable(cause: unknown): PersistenceError {
  return new PersistenceError(
    'persistence/atomic-write-unavailable',
    '官方 @deepseek-ai/dsh-atomic-write 不可用或签名已变化；拒绝使用非原子写入/锁降级',
    true,
    { cause },
  )
}

async function requireCapability(loader: AtomicWriteCapabilityLoader): Promise<AtomicWriteCapability> {
  let moduleValue: Record<string, unknown>
  try {
    const loaded = await loader()
    moduleValue = typeof loaded === 'object' && loaded !== null ? loaded as Record<string, unknown> : {}
  } catch (error) {
    throw unavailable(error)
  }
  if (typeof moduleValue.writeFileAtomic !== 'function' || typeof moduleValue.withFileLock !== 'function') {
    throw unavailable(new Error('expected exports writeFileAtomic and withFileLock'))
  }
  return {
    writeFileAtomic: moduleValue.writeFileAtomic.bind(moduleValue) as AtomicWriteCapability['writeFileAtomic'],
    withFileLock: moduleValue.withFileLock.bind(moduleValue) as AtomicWriteCapability['withFileLock'],
  }
}

class LazyAtomicWriteCapability {
  private loading: Promise<AtomicWriteCapability> | undefined

  constructor(private readonly loader: AtomicWriteCapabilityLoader) {}

  async use(): Promise<AtomicWriteCapability> {
    const loading = this.loading ??= requireCapability(this.loader)
    try {
      return await loading
    } catch (error) {
      // Do not cache a transient loader failure; a later Host activation may
      // make the official package available without losing strict semantics.
      if (this.loading === loading) this.loading = undefined
      throw error
    }
  }
}

function safeRelative(value: string): string {
  const normalized = normalize(value.replaceAll('\\', '/')).replaceAll('\\', '/')
  if (normalized === '' || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error('market persistence path must be relative')
  }
  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '..' || segment === '')) {
    throw new Error('market persistence path escapes its root')
  }
  return segments.join('/')
}

export class NodePersistenceFiles implements PersistenceFilePort {
  private readonly atomic: LazyAtomicWriteCapability

  constructor(private readonly root: string, loader: AtomicWriteCapabilityLoader = loadOfficialAtomicWrite) {
    this.atomic = new LazyAtomicWriteCapability(loader)
  }

  private path(value: string): string {
    const safe = safeRelative(value)
    const full = resolve(this.root, safe)
    const rel = relative(resolve(this.root), full)
    if (rel === '' || rel.startsWith('..') || parse(rel).root !== '') throw new Error('market persistence path escapes its root')
    return full
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(this.path(path)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async writeAtomic(path: string, data: Uint8Array): Promise<void> {
    const capability = await this.atomic.use()
    const target = this.path(path)
    await capability.writeFileAtomic(target, Buffer.from(data).toString('utf8'), { mode: 0o600, dirMode: 0o700 })
  }

  async append(path: string, data: Uint8Array): Promise<void> {
    const target = this.path(path)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await appendFile(target, data, { mode: 0o600 })
  }

  async list(prefix: string): Promise<readonly string[]> {
    const safe = safeRelative(prefix.endsWith('/') ? prefix.slice(0, -1) : prefix)
    const directory = resolve(this.root, safe)
    try {
      const walk = async (dir: string, prefix: string): Promise<string[]> => {
        const result: string[] = []
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          // Do not traverse symlinks/junctions outside market-owned storage.
          if (entry.isFile()) result.push(prefix + '/' + entry.name)
          else if (entry.isDirectory() && !entry.isSymbolicLink()) result.push(...await walk(join(dir, entry.name), prefix + '/' + entry.name))
        }
        return result
      }
      return (await walk(directory, safe)).sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async remove(path: string): Promise<void> {
    await rm(this.path(path), { force: true })
  }

  async size(path: string): Promise<number | undefined> {
    try {
      return (await stat(this.path(path))).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
}

type LockOperationSettlement =
  | { readonly status: 'fulfilled' }
  | { readonly status: 'rejected'; readonly error: unknown }

export class AtomicProfileLocks implements ProfileLockPort {
  private readonly atomic: LazyAtomicWriteCapability

  constructor(
    private readonly root: string,
    private readonly waitMs = 30_000,
    loader: AtomicWriteCapabilityLoader = loadOfficialAtomicWrite,
  ) {
    this.atomic = new LazyAtomicWriteCapability(loader)
  }

  async acquire(profileKey: string, owner: string): Promise<ProfileLockHandle> {
    // Validate both official primitives before creating any lock file. Locking
    // without atomic replacement would not preserve the documented pair.
    const capability = await this.atomic.use()
    const key = createHash('sha256').update(profileKey).digest('hex')
    const filename = join(resolve(this.root), `.locks`, `${key}.lock`)
    await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
    let releaseOperation: (() => void) | undefined
    let signalAcquired: (() => void) | undefined
    let signalFailed: ((error: unknown) => void) | undefined
    const held = new Promise<void>((resolveRelease) => { releaseOperation = resolveRelease })
    const acquired = new Promise<void>((resolveAcquire, rejectAcquire) => {
      signalAcquired = resolveAcquire
      signalFailed = rejectAcquire
    })
    const operation = (async () => capability.withFileLock(filename, async () => {
      await capability.writeFileAtomic(filename, `${JSON.stringify({ owner, pid: process.pid, at: new Date().toISOString() })}\n`, { mode: 0o600 })
      signalAcquired?.()
      await held
    }, { waitMs: this.waitMs }))()
    const settledOperation: Promise<LockOperationSettlement> = operation.then(
      () => ({ status: 'fulfilled' }),
      (error: unknown) => {
        signalFailed?.(error)
        return { status: 'rejected', error }
      },
    )
    await acquired
    let released = false
    return {
      release: async () => {
        if (released) return
        released = true
        releaseOperation?.()
        const settlement = await settledOperation
        if (settlement.status === 'rejected') throw settlement.error
      },
    }
  }
}
