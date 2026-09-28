/**
 * Durable proposal/confirmation journal. A lost response after dispatch is
 * uncertain, never permission to call the installer a second time. The lock
 * protects one proposal; actual writes still use the shared task coordinator.
 */
import { createHash } from 'node:crypto'
import type { AiApplyResult, AiProposal, AiRiskChallenge } from '../contracts/types.ts'
import type { ProfileLockPort } from '../core/ports.ts'
import { canonicalJson } from '../core/canonical.ts'
import { decodeJson, encodeJson, safeStoreId, type PersistenceFilePort } from '../persistence/files.ts'
import { proposalDigest } from './ai-assist.ts'

export interface SavedAiProposal {
  readonly schemaVersion: 1
  readonly callerId: string
  readonly proposal: AiProposal
  readonly inventoryDigest: string
  readonly deliveryDigest: string
  readonly stage: 'proposed' | 'challenge' | 'dispatched' | 'settled'
  readonly challenge?: AiRiskChallenge | undefined
  readonly executionKey?: string | undefined
  readonly result?: AiApplyResult | undefined
}

const MAX_RECORD_BYTES = 1_048_576
const HASH = /^[a-f0-9]{64}$/
const STAGES = ['proposed', 'challenge', 'dispatched', 'settled'] as const
const ACTIONS = new Set(['install', 'update', 'retry-source', 'enable', 'disable', 'remove', 'downgrade'])
function hash(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex') }
function invalid(): never { throw new Error('AI 确认记录无法校验，已保留现场并暂停执行；请重新分析') }
function timestamp(value: unknown): number { return typeof value === 'string' ? Date.parse(value) : NaN }

function validate(record: SavedAiProposal, id: string, environmentId: string): void {
  const proposal = record?.proposal
  if (record?.schemaVersion !== 1 || proposal?.id !== id || proposal.environmentId !== environmentId
    || typeof record.callerId !== 'string' || !record.callerId.trim() || record.callerId.length > 512
    || !HASH.test(record.inventoryDigest) || !HASH.test(record.deliveryDigest) || !STAGES.includes(record.stage)) invalid()
  const created = timestamp(proposal.createdAt)
  const expires = timestamp(proposal.expiresAt)
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires <= created || expires - created > 901_000
    || !HASH.test(proposal.diagnosticDigest ?? '') || !HASH.test(proposal.impactDigest)
    || proposal.impactDigest !== proposalDigest(proposal) || !Array.isArray(proposal.actions) || proposal.actions.length !== 1) invalid()
  const action = proposal.actions[0]!
  const risky = action.kind === 'remove' || action.kind === 'downgrade'
  if (!ACTIONS.has(action.kind) || typeof action.packageName !== 'string' || action.packageName.length > 214
    || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(action.packageName)
    || action.requiresSecondConfirmation !== risky || !proposal.impact) invalid()
  if (proposal.plan) {
    const item = proposal.plan.items[0]
    if (proposal.plan.environmentId !== environmentId || proposal.plan.items.length !== 1 || !item
      || item.packageName !== action.packageName || item.targetVersion !== action.targetVersion
      || item.action === 'downgrade' && action.kind !== 'downgrade') invalid()
  }
  if (record.stage === 'proposed' && (record.challenge || record.executionKey || record.result)) invalid()
  if (record.stage === 'challenge' && (!risky || !record.challenge || record.executionKey || record.result)) invalid()
  if (risky && record.stage !== 'proposed' && !record.challenge) invalid()
  if (record.challenge) {
    const challenge = record.challenge
    safeStoreId(challenge.id)
    if (!risky || !Number.isFinite(timestamp(challenge.expiresAt)) || timestamp(challenge.expiresAt) > expires
      || timestamp(challenge.expiresAt) <= created || canonicalJson(challenge.impact) !== canonicalJson(proposal.impact)
      || challenge.digest !== hash({ proposalId: proposal.id, impact: proposal.impact })) invalid()
  }
  if (record.stage === 'dispatched' || record.stage === 'settled') {
    if (record.executionKey !== `ai-${proposal.id}`) invalid()
  }
  if (record.stage !== 'settled' && record.result !== undefined) invalid()
  if (record.stage === 'settled' && (!record.result || typeof record.result.changed !== 'boolean'
    || !['applied', 'restart-required', 'failed', 'unknown', 'blocked', 'queued'].includes(record.result.status))) invalid()
}

export class AiProposalStore {
  constructor(private readonly files: PersistenceFilePort, private readonly locks: ProfileLockPort, private readonly environmentId: string) {}

  private path(id: string): string { return `ai-proposals/${safeStoreId(id)}.json` }
  private cancellationPath(id: string): string { return `ai-proposals/${safeStoreId(id)}.cancelled.json` }

  private async isCancelled(id: string): Promise<boolean> {
    const path = this.cancellationPath(id)
    const size = await this.files.size(path)
    if (size !== undefined && size > 4096) invalid()
    const bytes = await this.files.read(path)
    if (bytes === undefined) return false
    if (bytes.byteLength > 4096) invalid()
    const raw = decodeJson(bytes)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid()
    const { markerDigest, ...marker } = raw as Record<string, unknown>
    if (marker.schemaVersion !== 1 || marker.proposalId !== id || marker.environmentId !== this.environmentId
      || !Number.isFinite(timestamp(marker.cancelledAt)) || typeof marker.recordDigest !== 'string' || !HASH.test(marker.recordDigest)
      || markerDigest !== hash(marker)) invalid()
    return true
  }

  async get(id: string): Promise<SavedAiProposal | undefined> {
    if (await this.isCancelled(id)) return undefined
    const size = await this.files.size(this.path(id))
    if (size !== undefined && size > MAX_RECORD_BYTES) invalid()
    const bytes = await this.files.read(this.path(id))
    if (bytes === undefined) return undefined
    if (bytes.byteLength > MAX_RECORD_BYTES) invalid()
    const value = decodeJson(bytes) as SavedAiProposal & { recordDigest?: string }
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
    const { recordDigest, ...record } = value
    // A checksum detects incomplete/corrupt journals, not a hostile profile
    // owner. Pre-integrity records fail closed and are retained for diagnosis.
    if (recordDigest !== hash(record)) invalid()
    validate(record, id, this.environmentId)
    return record
  }

  async put(record: SavedAiProposal): Promise<void> {
    if (await this.isCancelled(record.proposal.id)) invalid()
    validate(record, record.proposal.id, this.environmentId)
    const prior = await this.get(record.proposal.id)
    if (prior) {
      const immutable = (value: SavedAiProposal) => ({ callerId: value.callerId, proposal: value.proposal,
        inventoryDigest: value.inventoryDigest, deliveryDigest: value.deliveryDigest })
      if (hash(immutable(prior)) !== hash(immutable(record)) || STAGES.indexOf(record.stage) < STAGES.indexOf(prior.stage)
        || prior.stage === record.stage && hash(prior) !== hash(record)
        || prior.stage === 'settled' && hash(prior) !== hash(record)
        || record.stage === 'settled' && prior.stage !== 'dispatched' && prior.stage !== 'settled'
        || prior.challenge && canonicalJson(prior.challenge) !== canonicalJson(record.challenge)) invalid()
    } else if (record.stage !== 'proposed') invalid()
    // State inspection may have waited after Runtime's first expiry check.
    // Recheck at the durable dispatch boundary, before any official mutation.
    if (record.stage === 'dispatched' && prior?.stage !== 'dispatched'
      && (Date.parse(record.proposal.expiresAt) <= Date.now()
        || record.challenge && Date.parse(record.challenge.expiresAt) <= Date.now())) invalid()
    const bytes = encodeJson({ ...record, recordDigest: hash(record) })
    if (bytes.byteLength > MAX_RECORD_BYTES) invalid()
    // Existing-record transitions run under exclusive(), including dispatch
    // intent before side effects. A failed completion write leaves dispatched.
    await this.files.writeAtomic(this.path(record.proposal.id), bytes)
  }

  /** Cancel a late analysis result without deleting its audit record. */
  async invalidateAnalysis(id: string): Promise<void> {
    await this.exclusive(id, async () => {
      if (await this.isCancelled(id)) return
      const record = await this.get(id)
      if (!record) invalid()
      // Cancellation of analysis is not cancellation of an official operation.
      // Never hide a dispatched/settled record, especially an unknown result.
      if (record.stage === 'dispatched' || record.stage === 'settled') throw new Error('提案已发起执行，不能以取消分析作废；请核对原任务')
      const marker = { schemaVersion: 1, proposalId: id, environmentId: this.environmentId,
        cancelledAt: new Date().toISOString(), recordDigest: hash(record) }
      await this.files.writeAtomic(this.cancellationPath(id), encodeJson({ ...marker, markerDigest: hash(marker) }))
    })
  }

  async exclusive<T>(id: string, action: () => Promise<T>): Promise<T> {
    const handle = await this.locks.acquire(`ai-proposal:${this.environmentId}:${safeStoreId(id)}`, 'ai-confirmation')
    try { return await action() } finally { await handle.release() }
  }
}
