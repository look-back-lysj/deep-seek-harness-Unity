/**
 * 作者媒体存储：只接收有限的静态位图，不接收 SVG/HTML/脚本。
 * 文件名由内容摘要生成，用户文件名永远不会成为磁盘路径。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface MediaLimits {
  readonly maxFileBytes?: number
  readonly maxFiles?: number
  readonly maxTotalBytes?: number
}

export interface StoredMedia {
  readonly id: string
  readonly filename: string
  readonly mediaType: string
  readonly size: number
  readonly sha256: string
}

export class MediaValidationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MediaValidationError'
    this.code = code
  }
}

function detectImage(bytes: Uint8Array): string | undefined {
  const buffer = Buffer.from(bytes)
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    buffer.subarray(12, 16).toString('ascii') === 'IHDR' &&
    buffer.readUInt32BE(16) > 0 &&
    buffer.readUInt32BE(20) > 0
  ) return 'image/png'
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) {
    return 'image/jpeg'
  }
  if (
    buffer.length >= 10 &&
    /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii')) &&
    buffer.readUInt16LE(6) > 0 &&
    buffer.readUInt16LE(8) > 0
  ) return 'image/gif'
  if (
    buffer.length >= 20 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP' &&
    buffer.readUInt32LE(4) === buffer.length - 8
  ) return 'image/webp'
  return undefined
}

function safeFilename(value: string): string {
  const filename = value.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f<>:"|?*]/g, '_').slice(0, 200)
  return filename || 'image.bin'
}

export class MediaStore {
  private readonly root: string
  private readonly maxFileBytes: number
  private readonly maxFiles: number
  private readonly maxTotalBytes: number

  constructor(root: string, limits: MediaLimits = {}) {
    this.root = root
    this.maxFileBytes = limits.maxFileBytes ?? 8 * 1024 * 1024
    this.maxFiles = limits.maxFiles ?? 128
    this.maxTotalBytes = limits.maxTotalBytes ?? 64 * 1024 * 1024
    mkdirSync(this.root, { recursive: true })
  }

  save(bytes: Uint8Array, filename: string): StoredMedia {
    if (bytes.byteLength === 0 || bytes.byteLength > this.maxFileBytes) throw new MediaValidationError('media/size', '图片为空或体积超限')
    const mediaType = detectImage(bytes)
    if (!mediaType) throw new MediaValidationError('media/type', '只允许 PNG/JPEG/GIF/WebP 静态位图')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const id = `img_${sha256.slice(0, 24)}`
    const stored: StoredMedia = { id, filename: safeFilename(filename), mediaType, size: bytes.byteLength, sha256: `sha256:${sha256}` }
    const metadataPath = join(this.root, `${id}.json`)
    const filePath = join(this.root, `${id}.bin`)
    if (!existsSync(metadataPath)) {
      const files = this.list()
      if (files.length >= this.maxFiles || files.reduce((sum, item) => sum + item.size, 0) + bytes.byteLength > this.maxTotalBytes) {
        throw new MediaValidationError('media/total-limit', '媒体总数量或总体积超限')
      }
      const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
      writeFileSync(temporary, bytes, { flag: 'wx' })
      renameSync(temporary, filePath)
      writeFileSync(metadataPath, JSON.stringify(stored, null, 2), { encoding: 'utf8', flag: 'wx' })
    } else {
      this.get(id)
    }
    return stored
  }

  get(id: string): { readonly metadata: StoredMedia; readonly bytes: Uint8Array } {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new MediaValidationError('media/invalid-id', 'media id 无效')
    const metadata = JSON.parse(readFileSync(join(this.root, `${id}.json`), 'utf8')) as StoredMedia
    const bytes = readFileSync(join(this.root, `${id}.bin`))
    const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    if (metadata.id !== id || metadata.sha256 !== actual || metadata.size !== bytes.byteLength || bytes.byteLength > this.maxFileBytes || detectImage(bytes) !== metadata.mediaType) {
      throw new MediaValidationError('media/digest-mismatch', '媒体文件与摘要不符')
    }
    return { metadata, bytes }
  }

  list(): readonly StoredMedia[] {
    return readdirSync(this.root)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(this.root, name), 'utf8')) as StoredMedia)
      .sort((left, right) => left.id.localeCompare(right.id))
  }
}
