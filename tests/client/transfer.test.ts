import { describe, expect, it, vi } from 'vitest'
import { blocksFromBytes, encodeBase64, uploadBytes, readTransfer } from '../../packages/market/src/client/transfer.ts'
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

describe('真实ZIP出站读取', () => {
  it('合并实际字节并清理传输，不用JSON冒充ZIP', async () => {
    const data = new Uint8Array([80, 75, 3, 4, 6, 7])
    const dispose = vi.fn(async () => true)
    const remote = { transferRead: async ({ transferId, sequence }: { transferId: string; sequence: number }) => ({ transferId, sequence, data: encodeBase64(data.subarray(sequence * 3, (sequence + 1) * 3)), last: sequence === 1 }), transferDispose: dispose } as unknown as MarketRemote
    expect(await readTransfer(remote, { transferId: 'export', complete: true, receivedBytes: 6 })).toEqual(data)
    expect(dispose).toHaveBeenCalledWith({ transferId: 'export' })
  })
  it('上传成功释放有界传输槽，拒绝其他上传的回包', async () => {
    const dispose = vi.fn(async () => true)
    const remote = {
      transferBegin: async () => ({ transferId: 'upload-one', complete: false, receivedBytes: 0 }),
      transferChunk: async () => ({ transferId: 'upload-one', complete: true, receivedBytes: 3, resultId: 'img-test' }),
      transferDispose: dispose,
    } as unknown as MarketRemote
    await uploadBytes(remote, new Uint8Array([1, 2, 3]), { purpose: 'draft-media', filename: 'test.png', mediaType: 'image/png' })
    expect(dispose).toHaveBeenCalledWith({ transferId: 'upload-one' })
    const wrong = { ...remote, transferChunk: async () => ({ transferId: 'other-upload', complete: true, receivedBytes: 3 }) }
    await expect(uploadBytes(wrong, new Uint8Array([1, 2, 3]), { purpose: 'draft-media', filename: 'test.png', mediaType: 'image/png' })).rejects.toThrow('当前分块不一致')
  })
  it('拒绝截断与错任务回包，失败也释放临时传输', async () => {
    const dispose = vi.fn(async () => true)
    const remote = { transferRead: async () => ({ transferId: 'wrong', sequence: 0, data: 'UEsDBA==', last: true }), transferDispose: dispose } as unknown as MarketRemote
    await expect(readTransfer(remote, { transferId: 'export', complete: true, receivedBytes: 4 })).rejects.toThrow('身份')
    expect(dispose).toHaveBeenCalledOnce()
  })
})
