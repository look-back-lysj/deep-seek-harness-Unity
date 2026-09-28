/**
 * 作者资料 ZIP 的最小安全读写实现。
 *
 * 导出确定性 ZIP；导入只接受 STORE/DEFLATE 普通文件，拒绝绝对路径、../、
 * 重复/大小写碰撞、符号链接、加密、异常压缩比和解压膨胀。
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  readonly path: string
  readonly data: Uint8Array
}

export interface ZipLimits {
  readonly maxEntries?: number
  readonly maxCompressedBytes?: number
  readonly maxExpandedBytes?: number
  readonly maxEntryBytes?: number
  readonly maxCompressionRatio?: number
}

export const DEFAULT_ZIP_LIMITS: Required<ZipLimits> = {
  maxEntries: 128,
  maxCompressedBytes: 50 * 1024 * 1024,
  maxExpandedBytes: 100 * 1024 * 1024,
  maxEntryBytes: 20 * 1024 * 1024,
  maxCompressionRatio: 200,
}

export class ZipSecurityError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZipSecurityError'
    this.code = code
  }
}

const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  CRC_TABLE[index] = value >>> 0
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function safeZipPath(input: string): string {
  const path = input.replace(/\\/g, '/').replace(/^\.\//, '')
  if (
    !path ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new ZipSecurityError('zip/unsafe-path', `资料包包含不安全路径 ${JSON.stringify(input)}`)
  }
  return path
}

function localHeader(path: string, method: number, flags: number, crc: number, compressedSize: number, uncompressedSize: number): Buffer {
  const name = Buffer.from(path, 'utf8')
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(flags, 6)
  header.writeUInt16LE(method, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(0x21, 12)
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(compressedSize, 18)
  header.writeUInt32LE(uncompressedSize, 22)
  header.writeUInt16LE(name.length, 26)
  header.writeUInt16LE(0, 28)
  return Buffer.concat([header, name])
}

function centralHeader(path: string, method: number, flags: number, crc: number, compressedSize: number, uncompressedSize: number, offset: number): Buffer {
  const name = Buffer.from(path, 'utf8')
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(0x0314, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(flags, 8)
  header.writeUInt16LE(method, 10)
  header.writeUInt16LE(0, 12)
  header.writeUInt16LE(0x21, 14)
  header.writeUInt32LE(crc, 16)
  header.writeUInt32LE(compressedSize, 20)
  header.writeUInt32LE(uncompressedSize, 24)
  header.writeUInt16LE(name.length, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38)
  header.writeUInt32LE(offset, 42)
  return Buffer.concat([header, name])
}

export function createZip(input: readonly ZipEntry[], limits: ZipLimits = {}): Uint8Array {
  const options = { ...DEFAULT_ZIP_LIMITS, ...limits }
  if (input.length === 0 || input.length > options.maxEntries) throw new ZipSecurityError('zip/entry-count', 'ZIP 文件数超限')
  const sorted = [...input].sort((left, right) => left.path.localeCompare(right.path))
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  const seen = new Set<string>()
  const seenFolded = new Set<string>()
  let offset = 0
  let expanded = 0
  for (const entry of sorted) {
    const path = safeZipPath(entry.path)
    const folded = path.toLocaleLowerCase('en-US')
    if (seen.has(path) || seenFolded.has(folded)) throw new ZipSecurityError('zip/duplicate-path', `ZIP 路径重复或大小写碰撞 ${path}`)
    seen.add(path)
    seenFolded.add(folded)
    const data = Buffer.from(entry.data)
    expanded += data.length
    if (data.length > options.maxEntryBytes || expanded > options.maxExpandedBytes) throw new ZipSecurityError('zip/expanded-too-large', 'ZIP 解压体积超限')
    const method = data.length === 0 ? 0 : 8
    const stored = data.length === 0 ? data : deflateRawSync(data)
    const flags = 0x0800
    const crc = crc32(data)
    const local = localHeader(path, method, flags, crc, stored.length, data.length)
    locals.push(local, stored)
    centrals.push(centralHeader(path, method, flags, crc, stored.length, data.length, offset))
    offset += local.length + stored.length
  }
  const centralBuffer = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(sorted.length, 8)
  end.writeUInt16LE(sorted.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBuffer, end])
}

interface CentralEntry {
  readonly path: string
  readonly method: number
  readonly flags: number
  readonly crc: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly localOffset: number
  readonly externalAttributes: number
}

export function readZip(input: Uint8Array, limits: ZipLimits = {}): readonly ZipEntry[] {
  const options = { ...DEFAULT_ZIP_LIMITS, ...limits }
  const buffer = Buffer.from(input)
  if (buffer.length > options.maxCompressedBytes) throw new ZipSecurityError('zip/compressed-too-large', '资料包压缩体积超限')
  const minimum = Math.max(0, buffer.length - 65_557)
  let eocd = -1
  for (let index = buffer.length - 22; index >= minimum; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new ZipSecurityError('zip/invalid-end', 'ZIP 目录结尾无效')
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (entryCount > options.maxEntries || centralOffset + centralSize > eocd) throw new ZipSecurityError('zip/invalid-directory', 'ZIP 目录范围或数量无效')
  const entries: CentralEntry[] = []
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new ZipSecurityError('zip/invalid-directory', 'ZIP 中央目录损坏')
    const filenameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const end = cursor + 46 + filenameLength + extraLength + commentLength
    if (end > buffer.length) throw new ZipSecurityError('zip/invalid-directory', 'ZIP 目录条目越界')
    const path = safeZipPath(buffer.subarray(cursor + 46, cursor + 46 + filenameLength).toString('utf8'))
    entries.push({
      path,
      method: buffer.readUInt16LE(cursor + 10),
      flags: buffer.readUInt16LE(cursor + 8),
      crc: buffer.readUInt32LE(cursor + 16),
      compressedSize: buffer.readUInt32LE(cursor + 20),
      uncompressedSize: buffer.readUInt32LE(cursor + 24),
      localOffset: buffer.readUInt32LE(cursor + 42),
      externalAttributes: buffer.readUInt32LE(cursor + 38),
    })
    cursor = end
  }

  const seen = new Set<string>()
  const seenFolded = new Set<string>()
  const output: ZipEntry[] = []
  let totalExpanded = 0
  for (const entry of entries) {
    const folded = entry.path.toLocaleLowerCase('en-US')
    if (seen.has(entry.path) || seenFolded.has(folded)) throw new ZipSecurityError('zip/duplicate-path', `ZIP 路径重复或大小写碰撞 ${entry.path}`)
    seen.add(entry.path)
    seenFolded.add(folded)
    if ((entry.flags & 0x0001) !== 0) throw new ZipSecurityError('zip/encrypted', '不接受加密 ZIP')
    if ((entry.externalAttributes >>> 16 & 0xf000) === 0xa000) throw new ZipSecurityError('zip/symlink', '不接受 ZIP 符号链接')
    if (entry.method !== 0 && entry.method !== 8) throw new ZipSecurityError('zip/method', 'ZIP 压缩方法不受支持')
    if (entry.uncompressedSize > options.maxEntryBytes || entry.compressedSize > options.maxCompressedBytes) throw new ZipSecurityError('zip/entry-too-large', 'ZIP 条目体积超限')
    if (entry.uncompressedSize > 1024 && entry.uncompressedSize / Math.max(1, entry.compressedSize) > options.maxCompressionRatio) {
      throw new ZipSecurityError('zip/compression-ratio', 'ZIP 条目压缩比异常')
    }
    totalExpanded += entry.uncompressedSize
    if (totalExpanded > options.maxExpandedBytes) throw new ZipSecurityError('zip/expanded-too-large', 'ZIP 解压体积超限')
    const local = entry.localOffset
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw new ZipSecurityError('zip/invalid-local-header', 'ZIP 本地文件头损坏')
    const localNameLength = buffer.readUInt16LE(local + 26)
    const localExtraLength = buffer.readUInt16LE(local + 28)
    const dataStart = local + 30 + localNameLength + localExtraLength
    const localName = buffer.subarray(local + 30, local + 30 + localNameLength).toString('utf8')
    if (safeZipPath(localName) !== entry.path) throw new ZipSecurityError('zip/name-mismatch', 'ZIP 本地与中央目录文件名不一致')
    if (dataStart + entry.compressedSize > centralOffset) throw new ZipSecurityError('zip/data-overlap', 'ZIP 数据与目录重叠或越界')
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize)
    const data = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 })
    if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc) throw new ZipSecurityError('zip/crc', `ZIP 条目校验失败 ${entry.path}`)
    output.push({ path: entry.path, data })
  }
  return output
}
