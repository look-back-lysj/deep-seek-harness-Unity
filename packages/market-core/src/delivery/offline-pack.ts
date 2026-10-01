/** 将已校验离线包中的制品写入内容寻址缓存。
 *
 * 这里不接受 manifest 中的任意路径，目标只由摘要派生；写入结果可直接作为
 * ArtifactCache 的受控本地来源。Core 仍需在安装计划中再次调用 tgz 校验器。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

function materializedPath(root: string, digest: string): string {
  return join(resolve(root), 'sha256', `${normalizeDigest(digest).slice(7)}.tgz`)
}

function digestOf(bytes: Uint8Array): string { return `sha256:${createHash('sha256').update(bytes).digest('hex')}` }

/** 只写入 manifest 声明且摘要相符的制品；已存在且内容不符时拒绝覆盖。 */
export function materializeOfflineArtifacts(contents: Pick<OfflinePackContents, 'artifacts' | 'artifactEntries'>, cacheDir: string): readonly MaterializedOfflineArtifact[] {
  const root = resolve(cacheDir)
  const output: MaterializedOfflineArtifact[] = []
  mkdirSync(join(root, 'sha256'), { recursive: true })
  for (const artifact of contents.artifactEntries) {
    const digest = normalizeDigest(artifact.digest)
    const bytes = contents.artifacts.get(digest)
    if (!bytes) fail('missing-artifact', `离线包缺少 ${digest}`)
    if (bytes.byteLength !== artifact.size || digestOf(bytes) !== digest) fail('artifact-mismatch', `${digest} 的内容与 manifest 不一致`)
    const path = materializedPath(root, digest)
    if (existsSync(path)) {
      const existing = readFileSync(path)
      if (existing.byteLength !== artifact.size || digestOf(existing) !== digest) fail('cache-corrupt', `缓存中的 ${digest} 已损坏，拒绝覆盖`)
    } else {
      const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
      writeFileSync(temporary, bytes, { flag: 'wx' })
      renameSync(temporary, path)
    }
    const stat = statSync(path)
    output.push({ digest, path, size: stat.size })
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
