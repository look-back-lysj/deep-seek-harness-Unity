import { describe, expect, it, vi } from 'vitest'
import { blocksFromBytes, encodeBase64, uploadBytes } from '../../packages/market/src/client/transfer.ts'
import type { MarketRemote } from '../../packages/market/src/client/model.ts'

describe('TransferChunkRequest base64 file blocks', () => {
  it('按文件块编码为 JSON-safe base64 文本', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
    const blocks = blocksFromBytes(bytes, 4)
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toEqual({ sequence: 0, data: 'AAEC+g==', byteLength: 4 })
    expect(blocks[2]?.data).toBe(encodeBase64(bytes.subarray(8)))
  })

  it('分块传输校验序号、总量、摘要和完成状态', async () => {
    const chunks: string[] = []
    const begin = vi.fn(async (_request: { sha256: string }) => ({ transferId: 'transfer-1', complete: false, receivedBytes: 0 }))
    const chunk = vi.fn(async (request: { sequence: number; data: string }) => {
      chunks.push(request.data)
      return { transferId: 'transfer-1', complete: request.sequence === 1, receivedBytes: (request.sequence + 1) * 3 }
    })
    const remote = { transferBegin: begin, transferChunk: chunk } as unknown as MarketRemote
    const progress: number[] = []
    const result = await uploadBytes(remote, new Uint8Array([1, 2, 3, 4, 5, 6]), {
      purpose: 'author-import',
      filename: 'README.md',
      mediaType: 'text/markdown',
      chunkBytes: 3,
      onProgress: (received) => progress.push(received),
    })
    expect(chunks.every((value) => typeof value === 'string')).toBe(true)
    expect(chunk.mock.calls.map(([request]) => request.sequence)).toEqual([0, 1])
    expect(begin).toHaveBeenCalledOnce()
    expect(begin.mock.calls[0]?.[0]?.sha256).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(progress).toEqual([3, 6])
    expect(result.complete).toBe(true)
    expect(result.receivedBytes).toBe(6)
  })

  it('默认块大小与 Host 的 64 KiB 上限一致', () => {
    const blocks = blocksFromBytes(new Uint8Array(64 * 1024 + 1))
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.byteLength).toBe(64 * 1024)
  })
})
