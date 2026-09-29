/**
 * Client→Host 的有界分块文件通道。
 *
 * 按主控修订，TransferChunkRequest.data 是 base64 字符串而不是 Uint8Array：
 * 生成器只支持 unary 结果中的二进制。Host 解码后仍严格执行64KiB块、总大小、
 * 连续序列、幂等重复块和最终 SHA-256；finish 成功前不得导入或保存。
 */
import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import type { TransferBeginRequest, TransferChunkRequest, TransferResult } from '../contracts/types.ts'

export interface TransferContext {
  readonly ownerId: string
  readonly targetId?: string
}

export interface TransferLimits {
  readonly blockBytes?: number
  readonly maxBytes?: number
  readonly maxTransfers?: number
}

export interface TransferReadResult {
  readonly transferId: string
  readonly sequence: number
  readonly data: string
  readonly last: boolean
}

export type TransferFinisher = (transfer: { readonly transferId: string; readonly path: string; readonly request: TransferBeginRequest }) => Promise<string | undefined>

interface TransferRecord extends TransferBeginRequest {
  readonly transferId: string
  readonly ownerId: string
  readonly targetId?: string
  readonly direction: 'inbound' | 'outbound'
  readonly receivedBytes: number
  readonly complete: boolean
  readonly resultId?: string
  /** 在调用有副作用的导入回调前落盘。重启后不能重放结果未知的导入。 */
  readonly finishing?: boolean
}

export class TransferError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'TransferError'
    this.code = code
  }
}

const DEFAULTS: Required<TransferLimits> = {
  blockBytes: 64 * 1024,
  maxBytes: 50 * 1024 * 1024,
  maxTransfers: 32,
}

function canonicalBase64(value: string): Buffer {
  if (value.length === 0) return Buffer.alloc(0)
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new TransferError('transfer/base64', 'data 必须是规范 base64 字符串')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new TransferError('transfer/base64', 'data 不是规范 base64 字符串')
  return bytes
}

function safeFilename(value: string): string {
  const filename = basename(value.replace(/\\/g, '/'))
  if (!filename || filename === '.' || filename === '..' || /[\u0000-\u001f<>:"|?*]/.test(filename)) {
    throw new TransferError('transfer/filename', '文件名不安全')
  }
  return filename.slice(0, 200)
}

function assertMediaType(purpose: TransferBeginRequest['purpose'], mediaType: string): void {
  const lower = mediaType.toLowerCase().split(';')[0]?.trim() ?? ''
  const allowed = purpose === 'draft-media'
    ? ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
    : ['application/zip', 'application/x-zip-compressed']
  if (!allowed.includes(lower)) throw new TransferError('transfer/media-type', `${purpose} 不接受 ${mediaType}`)
}

function sha256File(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

export class TransferManager {
  private readonly root: string
  private readonly limits: Required<TransferLimits>
  private readonly finisher: TransferFinisher | undefined

  constructor(root: string, options: TransferLimits & { readonly finisher?: TransferFinisher } = {}) {
    this.root = resolve(root)
    this.limits = { ...DEFAULTS, ...options }
    this.finisher = options.finisher
    mkdirSync(join(this.root, 'meta'), { recursive: true })
    mkdirSync(join(this.root, 'data'), { recursive: true })
  }

  private metaPath(transferId: string): string {
    if (!/^[a-f0-9-]{36}$/.test(transferId)) throw new TransferError('transfer/id', 'transferId 无效')
    return join(this.root, 'meta', `${transferId}.json`)
  }

  private dataPath(transferId: string): string {
    return join(this.root, 'data', `${transferId}.part`)
  }

  private read(transferId: string): TransferRecord {
    return JSON.parse(readFileSync(this.metaPath(transferId), 'utf8')) as TransferRecord
  }

  private write(record: TransferRecord): void {
    const path = this.metaPath(record.transferId)
    const temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(record), { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, path)
  }

  begin(request: TransferBeginRequest, context: TransferContext): TransferResult {
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(context.ownerId)) throw new TransferError('transfer/owner', 'ownerId 无效')
    const filename = safeFilename(request.filename)
    if (request.targetId !== undefined && context.targetId !== undefined && request.targetId !== context.targetId) throw new TransferError('transfer/target', '传输目标与 Host 绑定目标不一致')
    assertMediaType(request.purpose, request.mediaType)
    if (!Number.isSafeInteger(request.size) || request.size < 0 || request.size > this.limits.maxBytes) {
      throw new TransferError('transfer/size', `文件大小必须在0..${this.limits.maxBytes}`)
    }
    const sha256 = request.sha256.toLowerCase()
    if (!/^sha256:[a-f0-9]{64}$/.test(sha256)) throw new TransferError('transfer/digest', 'sha256 必须是 sha256:<64位十六进制>')
    const active = readdirSync(join(this.root, 'meta')).filter((name) => name.endsWith('.json'))
    if (active.length >= this.limits.maxTransfers) throw new TransferError('transfer/too-many', '活动传输数量超限')
    const transferId = randomUUID()
    const record: TransferRecord = {
      ...request,
      filename,
      sha256,
      transferId,
      ownerId: context.ownerId,
      ...(context.targetId === undefined ? {} : { targetId: context.targetId }),
      direction: 'inbound',
      receivedBytes: 0,
      complete: false,
    }
    writeFileSync(this.dataPath(transferId), Buffer.alloc(0), { flag: 'wx' })
    this.write(record)
    return { transferId, complete: false, receivedBytes: 0 }
  }

  async writeChunk(ownerId: string, request: TransferChunkRequest): Promise<TransferResult> {
    const record = this.read(request.transferId)
    if (record.ownerId !== ownerId || record.direction !== 'inbound') throw new TransferError('transfer/owner', '传输归属不匹配')
    if (record.complete) return { transferId: record.transferId, complete: true, receivedBytes: record.receivedBytes, ...(record.resultId === undefined ? {} : { resultId: record.resultId }) }
    if (record.finishing) throw new TransferError('transfer/finish-unconfirmed', '该传输已开始导入，结果尚未确认；请先重开草稿核对，禁止重复导入')
    if (!Number.isSafeInteger(request.sequence) || request.sequence < 0) throw new TransferError('transfer/sequence', 'sequence 无效')
    const data = canonicalBase64(request.data)
    if (data.byteLength === 0 || data.byteLength > this.limits.blockBytes) throw new TransferError('transfer/block-size', `块大小必须在1..${this.limits.blockBytes}`)
    const expectedSequence = Math.floor(record.receivedBytes / this.limits.blockBytes)
    const path = this.dataPath(record.transferId)
    const expectedOffset = request.sequence * this.limits.blockBytes
    if (expectedOffset < record.receivedBytes) {
      const existing = Buffer.alloc(data.byteLength)
      const descriptor = openSync(path, 'r')
      try {
        readSync(descriptor, existing, 0, existing.length, expectedOffset)
      } finally {
        closeSync(descriptor)
      }
      if (!existing.equals(data)) throw new TransferError('transfer/idempotency', '重复块内容不一致')
      if (record.receivedBytes === record.size && sha256File(path) !== record.sha256) {
        throw new TransferError('transfer/digest-mismatch', '上传摘要不符')
      }
      return { transferId: record.transferId, complete: false, receivedBytes: record.receivedBytes }
    }
    if (request.sequence !== expectedSequence) throw new TransferError('transfer/sequence', `乱序块被拒绝：expected ${expectedSequence}, actual ${request.sequence}`)
    if (expectedOffset !== record.receivedBytes || record.receivedBytes + data.byteLength > record.size) {
      throw new TransferError('transfer/size', '分块超出声明总大小')
    }
    const remaining = record.size - record.receivedBytes
    if (remaining > this.limits.blockBytes && data.byteLength !== this.limits.blockBytes) {
      throw new TransferError('transfer/block-size', '非末尾块必须是完整64KiB')
    }
    const descriptor = openSync(path, 'r+')
    try {
      writeSync(descriptor, data, 0, data.byteLength, expectedOffset)
    } finally {
      closeSync(descriptor)
    }
    const receivedBytes = record.receivedBytes + data.byteLength
    if (receivedBytes === record.size) {
      const actual = sha256File(path)
      if (actual !== record.sha256) {
        this.write({ ...record, receivedBytes })
        throw new TransferError('transfer/digest-mismatch', `上传摘要不符：expected ${record.sha256}, actual ${actual}`)
      }
      this.write({ ...record, receivedBytes, finishing: true })
      const resultId = await this.finisher?.({ transferId: record.transferId, path, request: record })
      const complete: TransferRecord = { ...record, receivedBytes, finishing: false, complete: true, ...(resultId === undefined ? {} : { resultId }) }
      this.write(complete)
      return { transferId: record.transferId, complete: true, receivedBytes, ...(resultId === undefined ? {} : { resultId }) }
    }
    this.write({ ...record, receivedBytes })
    return { transferId: record.transferId, complete: false, receivedBytes }
  }

  stageOutbound(ownerId: string, request: Omit<TransferBeginRequest, 'sha256' | 'size'> & { readonly size?: number }, bytes: Uint8Array): TransferResult {
    const data = Buffer.from(bytes)
    const begin: TransferBeginRequest = {
      ...request,
      filename: safeFilename(request.filename),
      size: data.byteLength,
      sha256: `sha256:${createHash('sha256').update(data).digest('hex')}`,
    }
    const transferId = this.begin(begin, { ownerId }).transferId
    writeFileSync(this.dataPath(transferId), data)
    const record = this.read(transferId)
    this.write({ ...record, direction: 'outbound', receivedBytes: data.byteLength, complete: true })
    return { transferId, complete: true, receivedBytes: data.byteLength }
  }

  readChunk(ownerId: string, transferId: string, sequence: number): TransferReadResult {
    const record = this.read(transferId)
    if (record.ownerId !== ownerId || record.direction !== 'outbound' || !record.complete) throw new TransferError('transfer/owner', '出站传输不可读')
    const offset = sequence * this.limits.blockBytes
    if (!Number.isSafeInteger(sequence) || sequence < 0 || offset >= Math.max(1, record.size)) throw new TransferError('transfer/sequence', '读取块序号无效')
    const data = readFileSync(this.dataPath(transferId)).subarray(offset, offset + this.limits.blockBytes)
    return {
      transferId,
      sequence,
      data: data.toString('base64'),
      last: offset + data.byteLength >= record.size,
    }
  }

  dispose(ownerId: string, transferId: string): void {
    const record = this.read(transferId)
    if (record.ownerId !== ownerId) throw new TransferError('transfer/owner', '传输归属不匹配')
    rmSync(this.dataPath(transferId), { force: true })
    rmSync(this.metaPath(transferId), { force: true })
  }
}
