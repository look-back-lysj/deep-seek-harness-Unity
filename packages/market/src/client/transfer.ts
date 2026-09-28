import type { TransferBeginRequest, TransferChunkRequest, TransferResult } from '../types.ts'
import type { MarketRemote } from './model.ts'

export const DEFAULT_CHUNK_BYTES = 64 * 1024

export interface FileBlock {
  readonly sequence: number
  readonly data: string
  readonly byteLength: number
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const window = 0x8000
  for (let offset = 0; offset < bytes.length; offset += window) {
    const slice = bytes.subarray(offset, Math.min(offset + window, bytes.length))
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

export function blocksFromBytes(
  bytes: Uint8Array,
  chunkBytes = DEFAULT_CHUNK_BYTES,
): readonly FileBlock[] {
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) throw new Error('分块大小必须是正整数')
  const blocks: FileBlock[] = []
  for (let offset = 0, sequence = 0; offset < bytes.length; offset += chunkBytes, sequence += 1) {
    const data = bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.length))
    blocks.push({ sequence, data: encodeBase64(data), byteLength: data.byteLength })
  }
  return blocks
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export interface UploadOptions {
  readonly purpose: TransferBeginRequest['purpose']
  readonly targetId?: string
  readonly filename: string
  readonly mediaType: string
  readonly chunkBytes?: number
  readonly onProgress?: (receivedBytes: number, totalBytes: number) => void
}

export async function uploadBytes(
  remote: MarketRemote,
  bytes: Uint8Array,
  options: UploadOptions,
): Promise<TransferResult> {
  if (remote.transferBegin === undefined || remote.transferChunk === undefined) {
    throw new Error('当前 DSH 运行时未提供文件分块传输能力')
  }
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES
  const blocks = blocksFromBytes(bytes, chunkBytes)
  const request: TransferBeginRequest = {
    purpose: options.purpose,
    ...(options.targetId === undefined ? {} : { targetId: options.targetId }),
    filename: options.filename,
    size: bytes.byteLength,
    mediaType: options.mediaType,
    sha256: `sha256:${await sha256Hex(bytes)}`,
  }
  let result = await remote.transferBegin(request)
  for (const block of blocks) {
    const chunk: TransferChunkRequest = {
      transferId: result.transferId,
      sequence: block.sequence,
      data: block.data,
    }
    result = await remote.transferChunk(chunk)
    options.onProgress?.(result.receivedBytes, bytes.byteLength)
  }
  if (!result.complete || result.receivedBytes !== bytes.byteLength) {
    throw new Error(`文件传输未完成：已接收 ${result.receivedBytes} / ${bytes.byteLength} 字节`)
  }
  return result
}

export async function uploadFile(
  remote: MarketRemote,
  file: File,
  purpose: UploadOptions['purpose'],
  onProgress?: UploadOptions['onProgress'],
): Promise<TransferResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return uploadBytes(remote, bytes, {
    purpose,
    filename: file.name,
    mediaType: file.type || 'application/octet-stream',
    ...(onProgress === undefined ? {} : { onProgress }),
  })
}
