/**
 * Delivery：多源下载、摘要核验、同一本地文件交付与引用缓存。
 *
 * 下载成功不是安装成功；只有本地 tgz 的 SHA-256、包名和版本都符合精确 Delivery 后，
 * 返回的本地路径才允许交给官方安装器。缓存文件在仍有 active-task/installed 引用时绝不清理。
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { CatalogDelivery, DeliverySource } from '../contracts/types.ts'
import { DeliverySecurityError, readLimitedResponse, safeFetch, type RemoteSecurityOptions } from './security.ts'
import { verifyTgzFile, type TgzLimits, type VerifiedTgz } from './tgz.ts'

export type CacheReferenceKind = 'active-task' | 'installed'

export interface CacheReference {
  readonly id: string
  readonly kind: CacheReferenceKind
  readonly createdAt: string
}

export interface ArtifactCacheOptions extends RemoteSecurityOptions {
  readonly cacheDir: string
  readonly maxCompressedBytes?: number
  readonly allowLocalFileSources?: readonly string[]
  readonly fetch?: typeof fetch
  readonly now?: () => Date
}

export interface DownloadArtifactOptions {
  readonly signal?: AbortSignal | undefined
  readonly requireBundle?: boolean
  readonly referenceId: string
  readonly referenceKind: CacheReferenceKind
  readonly tgzLimits?: TgzLimits
  readonly allowLocalFileSources?: readonly string[]
}

export interface DeliveryAttempt {
  readonly source: DeliverySource
  readonly status: 'accepted' | 'network-failed' | 'digest-mismatch' | 'unsafe' | 'identity-mismatch'
  readonly reason?: string
}

export interface AcquiredArtifact {
  readonly verified: VerifiedTgz
  readonly localPath: string
  readonly attempts: readonly DeliveryAttempt[]
}

export class DeliveryError extends Error {
  readonly code: string
  readonly attempts: readonly DeliveryAttempt[]
  constructor(code: string, message: string, attempts: readonly DeliveryAttempt[] = []) {
    super(message)
    this.name = 'DeliveryError'
    this.code = code
    this.attempts = attempts
  }
}

interface ReferenceFile {
  readonly schemaVersion: '1'
  readonly references: Record<string, readonly CacheReference[]>
}

function digestOf(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function normalizeDigest(value: string): string {
  const raw = value.startsWith('sha256:') ? value.slice(7) : value
  if (!/^[a-f0-9]{64}$/.test(raw)) throw new DeliveryError('delivery/invalid-digest', 'artifactDigest 格式无效')
  return `sha256:${raw}`
}

function atomicJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' })
  renameSync(temporary, path)
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..'))
}

export class ArtifactCache {
  private readonly root: string
  private readonly options: ArtifactCacheOptions
  private readonly now: () => Date

  constructor(options: ArtifactCacheOptions) {
    this.root = resolve(options.cacheDir)
    this.options = options
    this.now = options.now ?? (() => new Date())
    mkdirSync(join(this.root, 'tmp'), { recursive: true })
    mkdirSync(join(this.root, 'refs'), { recursive: true })
    if (!existsSync(this.referencesPath)) atomicJson(this.referencesPath, { schemaVersion: '1', references: {} })
  }

  private get referencesPath(): string {
    return join(this.root, 'refs', 'index.json')
  }

  private readReferences(): ReferenceFile {
    const value = JSON.parse(readFileSync(this.referencesPath, 'utf8')) as ReferenceFile
    if (value.schemaVersion !== '1' || typeof value.references !== 'object') {
      throw new DeliveryError('delivery/reference-schema', '缓存引用索引结构无效')
    }
    return value
  }

  retain(digest: string, reference: Omit<CacheReference, 'createdAt'>): void {
    const normalized = normalizeDigest(digest)
    const file = this.readReferences()
    const current = file.references[normalized] ?? []
    if (current.some((item) => item.id === reference.id)) return
    const next: ReferenceFile = {
      schemaVersion: '1',
      references: {
        ...file.references,
        [normalized]: [...current, { ...reference, createdAt: this.now().toISOString() }],
      },
    }
    atomicJson(this.referencesPath, next)
  }

  release(digest: string, referenceId: string): void {
    const normalized = normalizeDigest(digest)
    const file = this.readReferences()
    const current = file.references[normalized] ?? []
    const next: ReferenceFile = {
      schemaVersion: '1',
      references: {
        ...file.references,
        [normalized]: current.filter((item) => item.id !== referenceId),
      },
    }
    atomicJson(this.referencesPath, next)
  }

  pathFor(digest: string): string {
    const normalized = normalizeDigest(digest)
    return join(this.root, 'sha256', `${normalized.slice(7)}.tgz`)
  }

  /**
   * 只删除已证明无 active-task/installed 引用的旧缓存。
   * 这里采用保守策略：引用索引损坏或读取失败时直接停止清理，不猜测“没人用”。
   */
  pruneUnreferenced(before: Date): readonly string[] {
    const file = this.readReferences()
    const removed: string[] = []
    const directory = join(this.root, 'sha256')
    if (!existsSync(directory)) return removed
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      const digest = `sha256:${name.replace(/\.tgz$/, '')}`
      if ((file.references[digest] ?? []).length > 0) continue
      const stat = statSync(path)
      if (stat.mtimeMs >= before.getTime()) continue
      unlinkSync(path)
      removed.push(name)
    }
    return removed
  }

  private allowedLocalRoots(override?: readonly string[]): readonly string[] {
    return (override ?? this.options.allowLocalFileSources ?? []).map((root) => realpathSync(resolve(root)))
  }

  private localFileBytes(source: DeliverySource, allowedRoots: readonly string[], maxBytes: number): Uint8Array {
    if (!isAbsolute(source.ref)) throw new DeliveryError('delivery/unsafe-local-source', 'local-file 必须由 Host 给出绝对路径')
    const path = realpathSync(resolve(source.ref))
    if (!allowedRoots.some((root) => isInside(root, path))) {
      throw new DeliveryError('delivery/unsafe-local-source', 'local-file 不在允许的测试/受控目录内')
    }
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > maxBytes) throw new DeliveryError('delivery/too-large', '本地制品不是普通文件或体积超限')
    return readFileSync(path)
  }

  private async remoteBytes(source: DeliverySource, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30_000)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const response = await safeFetch(source.ref, { ...this.options, signal: combined })
    return readLimitedResponse(response, maxBytes, combined)
  }

  async download(delivery: CatalogDelivery, options: DownloadArtifactOptions): Promise<AcquiredArtifact> {
    options.signal?.throwIfAborted()
    // 复制全部来源描述；调用者在 await 期间修改目录不能改变本次下载目标。
    delivery = structuredClone(delivery)
    const expectedDigest = normalizeDigest(delivery.artifactDigest)
    const target = this.pathFor(expectedDigest)
    mkdirSync(join(this.root, 'sha256'), { recursive: true })
    const tgzLimits = options.tgzLimits ?? {}
    const verify = (path: string): Promise<VerifiedTgz> =>
      verifyTgzFile(
        path,
        {
          artifactDigest: expectedDigest,
          packageName: delivery.packageName,
          version: delivery.version,
          ...(options.requireBundle === undefined ? {} : { requireBundle: options.requireBundle }),
        },
        { ...tgzLimits, signal: options.signal },
      )

    if (existsSync(target)) {
      try {
        const verified = await verify(target)
        options.signal?.throwIfAborted()
        if (delivery.sources.some(source => source.size !== undefined && source.size !== verified.size)) throw new DeliveryError('delivery/size-mismatch', '缓存体积与冻结来源不符')
        this.retain(expectedDigest, { id: options.referenceId, kind: options.referenceKind })
        return { verified, localPath: target, attempts: [] }
      } catch (error) {
        options.signal?.throwIfAborted()
        const references = this.readReferences().references[expectedDigest] ?? []
        if (references.length > 0) throw new DeliveryError('delivery/referenced-cache-corrupt', '缓存已被引用但校验失败，禁止覆盖或删除', [])
        unlinkSync(target)
      }
    }

    const attempts: DeliveryAttempt[] = []
    const sources = [...delivery.sources].sort((left, right) => left.priority - right.priority)
    const allowedRoots = this.allowedLocalRoots(options.allowLocalFileSources)
    const maxBytes = this.options.maxCompressedBytes ?? 200 * 1024 * 1024
    for (const source of sources) {
      options.signal?.throwIfAborted()
      let bytes: Uint8Array
      try {
        if (source.kind === 'local-file') {
          if (allowedRoots.length === 0) throw new DeliveryError('delivery/unsafe-local-source', '未显式允许 local-file 来源')
          bytes = this.localFileBytes(source, allowedRoots, maxBytes)
        } else if (source.kind === 'cache') {
          const path = source.ref === expectedDigest ? target : resolve(source.ref)
          if (path !== target) throw new DeliveryError('delivery/unsafe-cache-source', 'cache 来源只接受目标摘要')
          bytes = readFileSync(path)
        } else {
          bytes = await this.remoteBytes(source, maxBytes, options.signal)
        }
      } catch (error) {
        options.signal?.throwIfAborted()
        const unsafe = error instanceof DeliverySecurityError && !['delivery/http-failed', 'delivery/dns-failed'].includes(error.code) || error instanceof DeliveryError && error.code.includes('unsafe')
        attempts.push({ source, status: unsafe ? 'unsafe' : 'network-failed', reason: error instanceof Error ? error.message : 'download failed' })
        continue
      }
      options.signal?.throwIfAborted()
      if (source.size !== undefined && source.size !== bytes.byteLength) {
        attempts.push({ source, status: 'identity-mismatch', reason: '实际字节大小与冻结来源不符' })
        continue
      }
      const actualDigest = digestOf(bytes)
      if (actualDigest !== expectedDigest) {
        attempts.push({ source, status: 'digest-mismatch', reason: `expected ${expectedDigest}, actual ${actualDigest}` })
        continue
      }
      const temporary = join(this.root, 'tmp', `${expectedDigest.slice(7)}.${randomUUID()}.tgz`)
      writeFileSync(temporary, bytes, { flag: 'wx' })
      try {
        const verified = await verify(temporary)
        options.signal?.throwIfAborted()
        renameSync(temporary, target)
        this.retain(expectedDigest, { id: options.referenceId, kind: options.referenceKind })
        attempts.push({ source, status: 'accepted' })
        return { verified: { ...verified, path: target }, localPath: target, attempts }
      } catch (error) {
        if (existsSync(temporary)) unlinkSync(temporary)
        options.signal?.throwIfAborted()
        attempts.push({
          source,
          status: error instanceof DeliveryError ? 'network-failed' : 'identity-mismatch',
          reason: error instanceof Error ? error.message : 'verification failed',
        })
      }
    }
    throw new DeliveryError('delivery/unavailable', '所有候选来源均未得到同摘要的已验证制品', attempts)
  }
}

/** Host-only 结果转 UI 时只交摘要/大小/来源，不交本机绝对路径。 */
export function publicArtifactView(artifact: AcquiredArtifact): Omit<VerifiedTgz, 'path' | 'packageJson' | 'files'> {
  const { path: _path, packageJson: _packageJson, files: _files, ...publicView } = artifact.verified
  return publicView
}
