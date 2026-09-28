import type { TransferBeginRequest, TransferChunkRequest, TransferResult } from '../types.ts'
import type { MarketRemote } from './model.ts'
import { boundedRequest } from './data-controller.ts'

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
  readonly expectedRevision?: string
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
    ...(options.expectedRevision === undefined ? {} : { expectedRevision: options.expectedRevision }),
    filename: options.filename,
    size: bytes.byteLength,
    mediaType: options.mediaType,
    sha256: `sha256:${await sha256Hex(bytes)}`,
  }
  let result = await boundedRequest(remote.transferBegin(request), '开始文件传输')
  const transferId = result.transferId
  let sent = 0
  for (const block of blocks) {
    const chunk: TransferChunkRequest = {
      transferId: result.transferId,
      sequence: block.sequence,
      data: block.data,
    }
    result = await boundedRequest(remote.transferChunk(chunk), '文件分块传输')
    sent += block.byteLength
    if (result.transferId !== transferId || result.receivedBytes !== sent || (result.complete && sent !== bytes.byteLength)) throw new Error('文件传输回包与当前分块不一致，请重新读取草稿核对。')
    options.onProgress?.(result.receivedBytes, bytes.byteLength)
  }
  if (!result.complete || result.receivedBytes !== bytes.byteLength) {
    throw new Error(`文件传输未完成：已接收 ${result.receivedBytes} / ${bytes.byteLength} 字节`)
  }
  // The finished media/draft is persisted separately. Release its inbound transfer
  // so multiple image uploads do not exhaust the Host's bounded transfer slots.
  if (remote.transferDispose) await boundedRequest(remote.transferDispose({ transferId }), '清理已完成上传')
  return result
}

export function decodeBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0))
}

/** Read the Host's real outbound bytes. Identity, sequence and size are checked on
 * every block; a partial response can never become a downloadable ZIP. */
export async function readTransfer(remote: MarketRemote, transfer: TransferResult, maxBytes = 32 * 1024 * 1024): Promise<Uint8Array> {
  if (!remote.transferRead) throw new Error('当前宿主没有资料包读取能力。')
  if (!transfer.complete || !Number.isSafeInteger(transfer.receivedBytes) || transfer.receivedBytes <= 0 || transfer.receivedBytes > maxBytes) throw new Error('资料包未准备完成或体积超限。')
  const bytes = new Uint8Array(transfer.receivedBytes)
  let offset = 0
  try {
    for (let sequence = 0; sequence < 4096; sequence += 1) {
      const block = await boundedRequest(remote.transferRead({ transferId: transfer.transferId, sequence }), '读取资料包')
      if (block.transferId !== transfer.transferId || block.sequence !== sequence) throw new Error('资料包分块身份不一致。')
      const data = decodeBase64(block.data)
      if (data.length === 0 || data.length > 256 * 1024 || offset + data.length > bytes.length) throw new Error('资料包分块大小不正确。')
      bytes.set(data, offset); offset += data.length
      if (block.last) {
        if (offset !== bytes.length) throw new Error('资料包不完整，请重新导出。')
        return bytes
      }
    }
    throw new Error('资料包分块数量超限。')
  } finally {
    // Cleanup failure is not download success. The caller gets a real error and may
    // retry cleanup; do not silently accumulate transfer files on the Host.
    if (remote.transferDispose) await boundedRequest(remote.transferDispose({ transferId: transfer.transferId }), '清理临时传输')
  }
}

export function saveBytes(bytes: Uint8Array, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  // Keep the object alive until the browser consumes the click.
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
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
