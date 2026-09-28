/**
 * Host-only persistence backed by the official atomic-write package. All
 * paths are relative to the market-owned profile directory and cannot escape
 * it. Locks protect only market files and never nest the official package lock.
 */
import { appendFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, normalize, parse, relative, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { PersistenceFilePort } from '../../persistence/files.ts'
import type { ProfileLockHandle, ProfileLockPort } from '../../core/ports.ts'

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
  constructor(private readonly root: string) {}

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
    const target = this.path(path)
    await writeFileAtomic(target, Buffer.from(data).toString('utf8'), { mode: 0o600, dirMode: 0o700 })
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
      const entries = await readdir(directory, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => `${safe}/${entry.name}`)
        .sort()
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

export class AtomicProfileLocks implements ProfileLockPort {
  constructor(private readonly root: string, private readonly waitMs = 30_000) {}

  async acquire(profileKey: string, owner: string): Promise<ProfileLockHandle> {
    const key = profileKey.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
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
    const operation = withFileLock(filename, async () => {
      await writeFileAtomic(filename, `${JSON.stringify({ owner, pid: process.pid, at: new Date().toISOString() })}\n`, { mode: 0o600 })
      signalAcquired?.()
      await held
    }, { waitMs: this.waitMs }).catch((error: unknown) => {
      signalFailed?.(error)
    })
    await acquired
    let released = false
    return {
      release: async () => {
        if (released) return
        released = true
        releaseOperation?.()
        await operation
      },
    }
  }
}
