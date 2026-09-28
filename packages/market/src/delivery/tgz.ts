/**
 * 本地 tgz 校验。
 *
 * 这里只证明“这一个本地文件的字节摘要、包身份和归档结构符合目录声明”。
 * 它不证明作者身份、供应链安全，也不替代官方 installBundle 对 dsh.bundle.patch 的检查。
 */
import { createReadStream, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'

export interface TgzLimits {
  readonly maxCompressedBytes?: number
  readonly maxExpandedBytes?: number
  readonly maxEntryBytes?: number
  readonly maxEntries?: number
  readonly maxPackageJsonBytes?: number
}

export const DEFAULT_TGZ_LIMITS: Required<TgzLimits> = {
  maxCompressedBytes: 200 * 1024 * 1024,
  maxExpandedBytes: 500 * 1024 * 1024,
  maxEntryBytes: 500 * 1024 * 1024,
  maxEntries: 20_000,
  maxPackageJsonBytes: 1024 * 1024,
}

export interface ExpectedTgzIdentity {
  readonly artifactDigest: string
  readonly packageName: string
  readonly version: string
  readonly requireBundle?: boolean
}

export interface VerifiedTgz {
  readonly path: string
  readonly artifactDigest: string
  readonly size: number
  readonly packageName: string
  readonly version: string
  readonly entryCount: number
  readonly expandedBytes: number
  readonly bundlePatch?: string
}

export class TgzVerificationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'TgzVerificationError'
    this.code = code
  }
}

const ZERO_BLOCK = Buffer.alloc(512)

function normalizeDigest(value: string): string {
  const raw = value.startsWith('sha256:') ? value.slice(7) : value
  if (!/^[a-f0-9]{64}$/.test(raw)) throw new TgzVerificationError('tgz/invalid-digest', '预期摘要格式无效')
  return `sha256:${raw}`
}

function parseOctal(buffer: Buffer, start: number, length: number): number {
  const field = buffer.subarray(start, start + length)
  if ((field[0] ?? 0) & 0x80) {
    let value = 0n
    for (const byte of field) value = (value << 8n) | BigInt(byte & 0xff)
    return Number(value)
  }
  const text = field.toString('ascii').replace(/\0.*$/, '').trim()
  if (!text) return 0
  const value = Number.parseInt(text, 8)
  if (!Number.isSafeInteger(value) || value < 0) throw new TgzVerificationError('tgz/invalid-header', 'Tar 大小字段无效')
  return value
}

function safeEntryPath(input: string): string {
  const path = input.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (
    !path ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TgzVerificationError('tgz/unsafe-path', `归档包含不安全路径 ${JSON.stringify(input)}`)
  }
  return path
}

function verifyChecksum(header: Buffer): void {
  const expected = parseOctal(header, 148, 8)
  const unsigned = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 0x20 : byte), 0)
  const signed = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 0x20 : byte > 127 ? byte - 256 : byte), 0)
  if (expected !== unsigned && expected !== signed) throw new TgzVerificationError('tgz/checksum', 'Tar 文件头校验失败')
}

interface PendingEntry {
  readonly path: string
  readonly size: number
  readonly type: string
  readonly linkName: string
  readonly data: Buffer[]
  collected: number
}

class TarVerifier {
  private buffer = Buffer.alloc(0)
  private mode: 'header' | 'data' | 'padding' | 'done' = 'header'
  private remainingData = 0
  private remainingPadding = 0
  private pending: PendingEntry | undefined
  private longPath: string | undefined
  private paxPath: string | undefined
  private readonly paths = new Set<string>()
  private readonly pathsFolded = new Set<string>()
  readonly entries: string[] = []
  private packageJson: string | undefined
  private packageJsonPath: string | undefined
  private expandedBytes = 0
  private root: string | undefined

  constructor(private readonly limits: Required<TgzLimits>) {}

  push(chunk: Uint8Array): void {
    if ((this.mode as string) === 'done') {
      if (chunk.some((byte) => byte !== 0)) throw new TgzVerificationError('tgz/trailing-data', 'Tar 结束后仍有非零数据')
      return
    }
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
    while (this.mode !== 'done') {
      if (this.mode === 'header') {
        if (this.buffer.length < 512) return
        const header = this.buffer.subarray(0, 512)
        this.buffer = this.buffer.subarray(512)
        this.handleHeader(header)
      } else if (this.mode === 'data') {
        const take = Math.min(this.remainingData, this.buffer.length)
        if (take > 0) this.handleData(this.buffer.subarray(0, take))
        this.buffer = this.buffer.subarray(take)
        this.remainingData -= take
        if (this.remainingData === 0) {
          this.finishEntry()
          this.remainingPadding = (512 - ((this.pending?.size ?? 0) % 512)) % 512
          this.pending = undefined
          this.mode = this.remainingPadding === 0 ? 'header' : 'padding'
        } else return
      } else if (this.mode === 'padding') {
        const take = Math.min(this.remainingPadding, this.buffer.length)
        this.buffer = this.buffer.subarray(take)
        this.remainingPadding -= take
        if (this.remainingPadding === 0) this.mode = 'header'
        else return
      }
    }
  }

  private handleHeader(header: Buffer): void {
    if (header.equals(ZERO_BLOCK)) {
      this.mode = 'done'
      return
    }
    verifyChecksum(header)
    const size = parseOctal(header, 124, 12)
    const type = String.fromCharCode(header[156] ?? 0)
    const linkName = header.subarray(157, 257).toString('utf8').replace(/\0.*$/, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const path = safeEntryPath(this.paxPath ?? this.longPath ?? (prefix ? `${prefix}/${rawName}` : rawName))
    this.paxPath = undefined
    this.longPath = undefined
    if (type === 'L' || type === 'x' || type === 'g') {
      if (size > 64 * 1024) throw new TgzVerificationError('tgz/unsafe-header', 'Tar 扩展头过大')
      this.pending = { path, size, type, linkName, data: [], collected: 0 }
      this.remainingData = size
      this.mode = 'data'
      return
    }
    if (type === '1' || type === '2') throw new TgzVerificationError('tgz/link-forbidden', `归档禁止链接 ${path}`)
    if (type !== '0' && type !== '\0' && type !== '5' && type !== '7') {
      throw new TgzVerificationError('tgz/special-entry', `归档包含不支持的特殊文件 ${path}`)
    }
    if (size > this.limits.maxEntryBytes || this.expandedBytes + size > this.limits.maxExpandedBytes) {
      throw new TgzVerificationError('tgz/expanded-too-large', '归档声明的解压体积超限')
    }
    if (this.entries.length >= this.limits.maxEntries) throw new TgzVerificationError('tgz/too-many-entries', '归档文件数过多')
    const folded = path.toLocaleLowerCase('en-US')
    if (this.paths.has(path) || this.pathsFolded.has(folded)) {
      throw new TgzVerificationError('tgz/duplicate-path', `归档存在重复或大小写碰撞路径 ${path}`)
    }
    this.paths.add(path)
    this.pathsFolded.add(folded)
    this.entries.push(path)
    const root = path.split('/')[0]
    if (this.root === undefined) this.root = root
    if (root !== this.root) throw new TgzVerificationError('tgz/multiple-roots', '归档必须只有一个顶层目录')
    this.pending = {
      path,
      size,
      type,
      linkName,
      data: [],
      collected: 0,
    }
    this.remainingData = size
    this.mode = 'data'
    if (size === 0) {
      this.finishEntry()
      this.pending = undefined
      this.remainingPadding = 0
      this.mode = 'header'
    }
  }

  private handleData(chunk: Buffer): void {
    const pending = this.pending
    if (!pending) throw new TgzVerificationError('tgz/internal-state', 'Tar 数据状态异常')
    this.expandedBytes += chunk.length
    if (this.expandedBytes > this.limits.maxExpandedBytes) throw new TgzVerificationError('tgz/expanded-too-large', '归档解压后体积超限')
    const collect = pending.type === 'x' || pending.type === 'g' || pending.type === 'L' || pending.path === `${this.root}/package.json`
    if (collect) {
      const next = pending.collected + chunk.length
      const max = pending.type === 'x' || pending.type === 'g' || pending.type === 'L' ? 64 * 1024 : this.limits.maxPackageJsonBytes
      if (next > max) throw new TgzVerificationError('tgz/entry-too-large', `归档条目 ${pending.path} 超限`)
      pending.data.push(Buffer.from(chunk))
      pending.collected = next
    }
  }

  private finishEntry(): void {
    const pending = this.pending
    if (!pending) return
    const content = Buffer.concat(pending.data)
    if (pending.type === 'x') {
      const text = content.toString('utf8')
      for (const line of text.split('\n')) {
        const match = /^(\d+) path=(.*)$/.exec(line)
        if (match?.[2]) this.paxPath = match[2]
      }
    } else if (pending.type === 'g') {
      // 全局 PAX 只接受 path；其他属性不改变安全判断。
      const match = /(?:^|\n)\d+ path=(.*)/.exec(content.toString('utf8'))
      if (match?.[1]) this.longPath = match[1]
    } else if (pending.type === 'L') {
      this.longPath = content.toString('utf8').replace(/\0.*$/, '')
    } else {
      if (pending.path === `${this.root}/package.json`) {
        this.packageJson = content.toString('utf8')
        this.packageJsonPath = pending.path
      }
    }
  }

  result(): { packageName: string; version: string; bundlePatch?: string; entryCount: number; expandedBytes: number } {
    if ((this.mode as string) !== 'done') throw new TgzVerificationError('tgz/incomplete', 'Tar 数据不完整')
    if (!this.packageJson || !this.packageJsonPath) throw new TgzVerificationError('tgz/missing-package-json', '归档缺少顶层 package.json')
    let metadata: unknown
    try {
      metadata = JSON.parse(this.packageJson)
    } catch {
      throw new TgzVerificationError('tgz/invalid-package-json', 'package.json 不是合法 JSON')
    }
    if (typeof metadata !== 'object' || metadata === null) throw new TgzVerificationError('tgz/invalid-package-json', 'package.json 结构无效')
    const record = metadata as { name?: unknown; version?: unknown; dsh?: { bundle?: { patch?: unknown } } }
    if (typeof record.name !== 'string' || typeof record.version !== 'string') {
      throw new TgzVerificationError('tgz/missing-identity', 'package.json 缺少 name/version')
    }
    const bundlePatch = record.dsh?.bundle?.patch
    if (bundlePatch !== undefined && typeof bundlePatch !== 'string') {
      throw new TgzVerificationError('tgz/invalid-bundle-patch', 'dsh.bundle.patch 必须是字符串')
    }
    return {
      packageName: record.name,
      version: record.version,
      ...(bundlePatch === undefined ? {} : { bundlePatch }),
      entryCount: this.entries.length,
      expandedBytes: this.expandedBytes,
    }
  }
}

export async function verifyTgzFile(path: string, expected: ExpectedTgzIdentity, options: TgzLimits = {}): Promise<VerifiedTgz> {
  const limits = { ...DEFAULT_TGZ_LIMITS, ...options }
  const stat = statSync(path)
  if (!stat.isFile()) throw new TgzVerificationError('tgz/not-file', '制品不是普通文件')
  if (stat.size > limits.maxCompressedBytes) throw new TgzVerificationError('tgz/compressed-too-large', 'tgz 压缩体积超限')
  const hash = createHash('sha256')
  const source = createReadStream(path)
  source.on('data', (chunk) => hash.update(chunk))
  const gunzip = createGunzip()
  const tar = new TarVerifier(limits)
  const transport = pipeline(source, gunzip)
  let parseError: unknown
  try {
    for await (const chunk of gunzip) tar.push(chunk)
  } catch (error) {
    parseError = error
    source.destroy()
    gunzip.destroy()
  }
  try {
    await transport
  } catch (error) {
    parseError ??= error
  }
  if (parseError) {
    if (parseError instanceof TgzVerificationError) throw parseError
    throw new TgzVerificationError('tgz/decompress-failed', parseError instanceof Error ? parseError.message : 'tgz 解压失败')
  }
  const actualDigest = `sha256:${hash.digest('hex')}`
  const expectedDigest = normalizeDigest(expected.artifactDigest)
  if (actualDigest !== expectedDigest) {
    throw new TgzVerificationError('tgz/digest-mismatch', `制品摘要不符：expected ${expectedDigest}, actual ${actualDigest}`)
  }
  const identity = tar.result()
  if (identity.packageName !== expected.packageName || identity.version !== expected.version) {
    throw new TgzVerificationError('tgz/identity-mismatch', `tgz 包身份不符：${identity.packageName}@${identity.version}`)
  }
  if (expected.requireBundle && !identity.bundlePatch) {
    throw new TgzVerificationError('tgz/missing-bundle-declaration', '目录要求有效 bundle 声明，但 tgz 未声明 dsh.bundle.patch')
  }
  return {
    path,
    artifactDigest: actualDigest,
    size: stat.size,
    packageName: identity.packageName,
    version: identity.version,
    entryCount: identity.entryCount,
    expandedBytes: identity.expandedBytes,
    ...(identity.bundlePatch === undefined ? {} : { bundlePatch: identity.bundlePatch }),
  }
}
