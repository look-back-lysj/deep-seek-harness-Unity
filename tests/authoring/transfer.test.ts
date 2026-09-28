import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TransferManager } from '../../packages/market/src/authoring/index.ts'

function request(size: number, data: Uint8Array) {
  return {
    purpose: 'author-import' as const,
    filename: 'presentation.eac-market-presentation.zip',
    size,
    mediaType: 'application/zip',
    sha256: `sha256:${createHash('sha256').update(data).digest('hex')}`,
  }
}

async function withTemp<T>(action: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'eac-transfer-'))
  try {
    return await action(root)
  } finally {
    expect(root.startsWith(tmpdir())).toBe(true)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('TransferChunkRequest.data base64 严格分块', () => {
  it('并发末块或导入回执未知时不执行第二次，重建 manager 也保持阻断', async () => {
    const root = mkdtempSync(join(tmpdir(), 'transfer-finalizer-'))
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    let writes = 0
    const manager = new TransferManager(root, { finisher: async () => { writes++; await gate; throw new Error('合成导入结果丢失') } })
    const bytes = Buffer.from('x')
    const transfer = manager.begin(request(1, bytes), { ownerId: 'owner-1' })
    const chunk = { transferId: transfer.transferId, sequence: 0, data: bytes.toString('base64') }
    const first = manager.writeChunk('owner-1', chunk)
    await expect(manager.writeChunk('owner-1', chunk)).rejects.toMatchObject({ code: 'transfer/finish-unconfirmed' })
    release()
    await expect(first).rejects.toThrow(/结果丢失/)
    const reopened = new TransferManager(root, { finisher: async () => { writes++; return 'should-not-run' } })
    await expect(reopened.writeChunk('owner-1', chunk)).rejects.toMatchObject({ code: 'transfer/finish-unconfirmed' })
    expect(writes).toBe(1)
  })
  it('连续块、幂等重复块、乱序拒绝和 finish 摘要核验', async () => {
    await withTemp(async (root) => {
      const manager = new TransferManager(root, {
        blockBytes: 2,
        maxBytes: 8,
        finisher: async () => 'draft-imported',
      })
      const bytes = Buffer.from([1, 2, 3])
      const started = manager.begin(request(3, bytes), { ownerId: 'owner-1', targetId: 'draft-1' })
      const first = { transferId: started.transferId, sequence: 0, data: Buffer.from([1, 2]).toString('base64') }
      await expect(manager.writeChunk('owner-1', first)).resolves.toMatchObject({ receivedBytes: 2, complete: false })
      await expect(manager.writeChunk('owner-1', first)).resolves.toMatchObject({ receivedBytes: 2 })
      await expect(manager.writeChunk('owner-1', { ...first, data: Buffer.from([9, 9]).toString('base64') })).rejects.toMatchObject({ code: 'transfer/idempotency' })
      await expect(manager.writeChunk('owner-1', {
        transferId: started.transferId,
        sequence: 2,
        data: Buffer.from([3]).toString('base64'),
      })).rejects.toMatchObject({ code: 'transfer/sequence' })
      await expect(manager.writeChunk('owner-1', {
        transferId: started.transferId,
        sequence: 1,
        data: Buffer.from([3]).toString('base64'),
      })).resolves.toMatchObject({ complete: true, resultId: 'draft-imported' })
    })
  })

  it('拒绝非规范 base64 和最终摘要不符', async () => {
    await withTemp(async (root) => {
      const manager = new TransferManager(root, { blockBytes: 8, maxBytes: 8 })
      const bytes = Buffer.from([1])
      const started = manager.begin(request(1, bytes), { ownerId: 'owner-1' })
      await expect(manager.writeChunk('owner-1', {
        transferId: started.transferId,
        sequence: 0,
        data: 'A',
      })).rejects.toMatchObject({ code: 'transfer/base64' })
      await expect(manager.writeChunk('owner-1', {
        transferId: started.transferId,
        sequence: 0,
        data: Buffer.from([2]).toString('base64'),
      })).rejects.toMatchObject({ code: 'transfer/digest-mismatch' })
    })
  })
})
