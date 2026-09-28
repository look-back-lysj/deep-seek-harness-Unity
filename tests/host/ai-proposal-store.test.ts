import { describe, expect, it, vi } from 'vitest'
import { AiAssistant } from '../../packages/market/src/host/ai-assist.ts'
import { AiProposalStore, type SavedAiProposal } from '../../packages/market/src/host/ai-proposal-store.ts'
import { decodeJson, encodeJson } from '../../packages/market/src/persistence/files.ts'
import { InMemoryFiles, TestLocks } from '../persistence/helpers.ts'
import type { AiProposal } from '../../packages/market/src/contracts/types.ts'

function fixture() {
  const files = new InMemoryFiles()
  const store = new AiProposalStore(files, new TestLocks(), 'test')
  const assistant = new AiAssistant(undefined, undefined)
  const unsigned: AiProposal = {
    id: 'test-proposal', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900_000).toISOString(),
    summary: '测试启用', facts: ['fact-1'], actions: [{ kind: 'enable', packageName: 'fixture', reason: 'test', requiresSecondConfirmation: false }],
    impactDigest: '', environmentId: 'test', diagnosticDigest: 'd'.repeat(64),
    impact: { summary: 'test', currentVersion: '1.0.0', affectedPackages: ['fixture'], dataBehavior: 'test', unknowns: [] },
  }
  const proposal = { ...unsigned, impactDigest: assistant.impactDigest(unsigned) }
  const record: SavedAiProposal = { schemaVersion: 1, callerId: 'peer-one', proposal, inventoryDigest: 'a'.repeat(64), deliveryDigest: 'b'.repeat(64), stage: 'proposed' }
  return { files, store, assistant, record, path: 'ai-proposals/test-proposal.json' }
}

describe('durable AI proposal integrity', () => {
  it('binds identity and expiry into the confirmed digest', () => {
    const { record, assistant } = fixture()
    expect(assistant.impactDigest({ ...record.proposal, id: 'another-proposal' })).not.toBe(record.proposal.impactDigest)
    expect(assistant.impactDigest({ ...record.proposal, expiresAt: '2099-01-01T00:00:00Z' })).not.toBe(record.proposal.impactDigest)
  })

  it.each(['callerId', 'stage', 'inventoryDigest', 'deliveryDigest', 'expiresAt'])('rejects a changed durable %s without overwriting the evidence', async field => {
    const { files, store, record, path } = fixture()
    await store.put(record)
    const saved = decodeJson(files.files.get(path)!) as any
    if (field === 'expiresAt') saved.proposal.expiresAt = '2099-01-01T00:00:00Z'
    else saved[field] = field === 'stage' ? 'dispatched' : 'c'.repeat(64)
    const corrupt = encodeJson(saved)
    files.files.set(path, corrupt)
    await expect(store.get(record.proposal.id)).rejects.toThrow()
    expect(files.files.get(path)).toEqual(corrupt)
  })

  it('never allows an unknown dispatch to be reset to proposed', async () => {
    const { store, record } = fixture()
    await store.put(record)
    await store.put({ ...record, stage: 'dispatched', executionKey: 'ai-test-proposal' })
    await expect(store.put(record)).rejects.toThrow()
    expect((await store.get(record.proposal.id))?.stage).toBe('dispatched')
  })

  it('rejects a settled record without a result instead of making it executable again', async () => {
    const { store, record } = fixture()
    await store.put(record)
    await store.put({ ...record, stage: 'dispatched', executionKey: 'ai-test-proposal' })
    await expect(store.put({ ...record, stage: 'settled', executionKey: 'ai-test-proposal' })).rejects.toThrow()
    expect((await store.get(record.proposal.id))?.stage).toBe('dispatched')
  })

  it('retains dispatch intent when the completion write fails, including after reopening', async () => {
    const { files, store, record } = fixture()
    await store.put(record)
    await store.put({ ...record, stage: 'dispatched', executionKey: 'ai-test-proposal' })
    files.failNextAtomic = true
    await expect(store.put({ ...record, stage: 'settled', executionKey: 'ai-test-proposal', result: { status: 'applied', changed: true } })).rejects.toThrow()
    expect((await new AiProposalStore(files, new TestLocks(), 'test').get(record.proposal.id))?.stage).toBe('dispatched')
  })

  it('refuses a disguised downgrade plan even when the proposal hash is internally consistent', async () => {
    const { store, assistant, record } = fixture()
    const candidate: AiProposal = { ...record.proposal,
      actions: [{ kind: 'retry-source', packageName: 'fixture', targetVersion: '1.0.0', sourceId: 'synthetic-source', reason: 'test', requiresSecondConfirmation: false }],
      plan: { planId: 'test-plan', schemaVersion: '1', createdAt: record.proposal.createdAt, expiresAt: record.proposal.expiresAt,
        environmentId: 'test', hostFingerprint: 'test', catalogRevision: 'test', planDigest: 'f'.repeat(64), items: [{
          pluginId: 'fixture', packageName: 'fixture', action: 'downgrade', currentVersion: '2.0.0', currentEnabled: true,
          targetVersion: '1.0.0', targetDigest: `sha256:${'a'.repeat(64)}`, requestedEnabled: true, verification: 'verified', requiresRestart: false, blockers: [],
        }] },
    }
    await expect(store.put({ ...record, proposal: { ...candidate, impactDigest: assistant.impactDigest(candidate) } })).rejects.toThrow()
    expect(await store.get(record.proposal.id)).toBeUndefined()
  })

  it('rechecks expiration at dispatch after earlier state inspection was delayed', async () => {
    const { store, record } = fixture()
    await store.put(record)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(record.proposal.expiresAt) + 1)
    try {
      await expect(store.put({ ...record, stage: 'dispatched', executionKey: 'ai-test-proposal' })).rejects.toThrow()
      expect((await store.get(record.proposal.id))?.stage).toBe('proposed')
    } finally { clock.mockRestore() }
  })

  it('invalidates a late analysis durably without deleting or changing the original audit record', async () => {
    const { files, store, record, path } = fixture()
    await store.put(record)
    const original = files.files.get(path)
    await store.invalidateAnalysis(record.proposal.id)
    await store.invalidateAnalysis(record.proposal.id)
    expect(files.files.get(path)).toEqual(original)
    expect(await store.get(record.proposal.id)).toBeUndefined()
    const reopened = new AiProposalStore(files, new TestLocks(), 'test')
    expect(await reopened.get(record.proposal.id)).toBeUndefined()
    await expect(reopened.put(record)).rejects.toThrow()
    expect(files.files.get(path)).toEqual(original)
  })

  it('fails closed when a cancellation tombstone is corrupt', async () => {
    const { files, store, record } = fixture()
    await store.put(record)
    await store.invalidateAnalysis(record.proposal.id)
    files.files.set('ai-proposals/test-proposal.cancelled.json', encodeJson({ schemaVersion: 1, proposalId: record.proposal.id }))
    await expect(store.get(record.proposal.id)).rejects.toThrow()
    await expect(store.put(record)).rejects.toThrow()
    await expect(store.invalidateAnalysis(record.proposal.id)).rejects.toThrow()
  })

  it('does not hide a dispatched unknown execution under an analysis cancellation tombstone', async () => {
    const { files, store, record } = fixture()
    await store.put(record)
    await store.put({ ...record, stage: 'dispatched', executionKey: 'ai-test-proposal' })
    await expect(store.invalidateAnalysis(record.proposal.id)).rejects.toThrow('已发起执行')
    expect(files.files.has('ai-proposals/test-proposal.cancelled.json')).toBe(false)
    expect((await store.get(record.proposal.id))?.stage).toBe('dispatched')
  })
})
