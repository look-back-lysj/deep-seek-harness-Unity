/** 将已校验离线包中的制品写入内容寻址缓存。
 *
 * 这里不接受 manifest 中的任意路径，目标只由摘要派生；写入结果可直接作为
 * ArtifactCache 的受控本地来源。Core 仍需在安装计划中再次调用 tgz 校验器。
 */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, sep, join, resolve } from 'node:path'
import type { OfflinePackArtifact } from '../contracts/types.ts'
import type { OfflinePackContents } from '../catalog/offline-pack.ts'

export class OfflineArtifactError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'OfflineArtifactError'
    this.code = code
  }
}

export interface MaterializedOfflineArtifact {
  readonly digest: string
  readonly path: string
  readonly size: number
}

function fail(code: string, message: string): never { throw new OfflineArtifactError(`offline-artifact/${code}`, message) }

function normalizeDigest(value: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) fail('invalid-digest', '制品摘要格式无效')
  return value
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..'))
}

function materializedPath(realRoot: string, digest: string): string {
  return join(realRoot, 'sha256', `${normalizeDigest(digest).slice(7)}.tgz`)
}

function cachedBytes(path: string, digest: string, size: number): Uint8Array | undefined {
  let entry
  try { entry = lstatSync(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (!entry.isFile() || entry.isSymbolicLink()) fail('cache-corrupt', '缓存目标不是普通文件，拒绝跟随链接')
  const fd = openSync(path, 'r')
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.isSymbolicLink() || opened.dev !== entry.dev || opened.ino !== entry.ino || opened.size !== size) fail('cache-corrupt', '缓存目标在读取时改变或体积不符')
    const bytes = readFileSync(fd)
    if (bytes.byteLength !== size || digestOf(bytes) !== digest) fail('cache-corrupt', `缓存中的 ${digest} 已损坏，拒绝覆盖`)
    return bytes
  } finally {
    closeSync(fd)
  }
}

function digestOf(bytes: Uint8Array): string { return `sha256:${createHash('sha256').update(bytes).digest('hex')}` }

/** 只写入 manifest 声明且摘要相符的制品；已存在且内容不符时拒绝覆盖。 */
export function materializeOfflineArtifacts(contents: Pick<OfflinePackContents, 'artifacts' | 'artifactEntries'>, cacheDir: string): readonly MaterializedOfflineArtifact[] {
  mkdirSync(resolve(cacheDir), { recursive: true })
  const realRoot = realpathSync(resolve(cacheDir))
  const shardDir = join(realRoot, 'sha256')
  mkdirSync(shardDir, { recursive: true })
  const realShardDir = realpathSync(shardDir)
  if (lstatSync(shardDir).isSymbolicLink() || !inside(realRoot, realShardDir) || !statSync(realShardDir).isDirectory()) fail('cache-path-escape', '离线制品缓存目录不能通过链接离开 Host 提供的缓存根目录')
  const output: MaterializedOfflineArtifact[] = []
  for (const artifact of contents.artifactEntries) {
    const digest = normalizeDigest(artifact.digest)
    const bytes = contents.artifacts.get(digest)
    if (!bytes) fail('missing-artifact', `离线包缺少 ${digest}`)
    if (bytes.byteLength !== artifact.size || digestOf(bytes) !== digest) fail('artifact-mismatch', `${digest} 的内容与 manifest 不一致`)
    const path = materializedPath(realRoot, digest)
    let existing = cachedBytes(path, digest, artifact.size)
    if (existing === undefined) {
      const temporary = join(realShardDir, `${digest.slice(7)}.${randomUUID()}.tmp`)
      try {
        writeFileSync(temporary, bytes, { flag: 'wx' })
        try {
          renameSync(temporary, path)
        } catch (error) {
          // Another writer may have atomically materialized this same digest.
          existing = cachedBytes(path, digest, artifact.size)
          if (existing === undefined) throw error
        }
      } finally {
        try { unlinkSync(temporary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
      existing ??= cachedBytes(path, digest, artifact.size)
      if (existing === undefined) fail('cache-write-failed', `无法将 ${digest} 原子写入缓存`)
    }
    if (cachedBytes(path, digest, artifact.size) === undefined) fail('cache-write-failed', `缓存中的 ${digest} 写入后未能复核`)
    output.push({ digest, path, size: artifact.size })
  }
  return output
}

/** 在构建离线包索引时核对一个制品声明，供上层生成 manifest 使用。 */
export function describeOfflineArtifact(bytes: Uint8Array, filename: string, relativePath?: string): OfflinePackArtifact {
  const digest = digestOf(bytes)
  const safeFilename = filename.split(/[\\/]/).pop() ?? ''
  if (!safeFilename || safeFilename === '.' || safeFilename === '..') fail('invalid-filename', '制品文件名无效')
  const expectedPath = `artifacts/sha256/${digest.slice(7)}/${safeFilename}`
  if (relativePath !== undefined && relativePath !== expectedPath) fail('invalid-path', '制品路径必须按摘要寻址')
  return { digest, filename: safeFilename, size: bytes.byteLength, relativePath: expectedPath }
}
