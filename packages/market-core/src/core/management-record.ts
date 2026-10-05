import { createHash } from 'node:crypto'
import type { PluginActionResult } from '../contracts/types.ts'
import { canonicalJson } from './canonical.ts'
import type { ManagementCompletion, ManagementRecord } from './execution-state.ts'
import type { HostInstallOutcome } from './ports.ts'
import { MarketCoreError } from './errors.ts'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/u.test(value)
}

function permissionsValid(value: unknown): boolean {
  return Array.isArray(value) && value.every(permission => object(permission)
    && text(permission.packageName) && ['approved', 'revoked', 'already-approved'].includes(permission.decision as string))
}

function outcomeValid(value: unknown): value is HostInstallOutcome {
  if (!object(value) || !permissionsValid(value.permissionChanges)) return false
  if (value.errorCode !== undefined && typeof value.errorCode !== 'string' || value.diagnostic !== undefined && typeof value.diagnostic !== 'string') return false
  if (value.kind === 'unknown') return typeof value.error === 'string'
  if (value.kind === 'awaiting-approval') return text(value.attemptId) && Array.isArray(value.pendingBuilds)
    && value.pendingBuilds.every(build => text(build)) && text(value.pendingBuildsDigest)
  if (value.kind === 'applied') return typeof value.changed === 'boolean' && typeof value.restartRequired === 'boolean'
  if (value.kind === 'failed') return typeof value.changed === 'boolean' && typeof value.error === 'string'
  return value.kind === 'cancelled' && typeof value.changed === 'boolean'
}

export function managementResultFromOutcome(outcome: HostInstallOutcome): PluginActionResult {
  if (outcome.kind === 'applied') return { status: outcome.restartRequired ? 'restart-required' : 'applied', changed: outcome.changed, permissionChanges: outcome.permissionChanges }
  if (outcome.kind === 'failed') return { status: 'failed', changed: outcome.changed, error: outcome.error, errorCode: outcome.errorCode, diagnostic: outcome.diagnostic, permissionChanges: outcome.permissionChanges }
  if (outcome.kind === 'unknown') return { status: 'unknown', changed: false, error: outcome.error, errorCode: outcome.errorCode, diagnostic: outcome.diagnostic, permissionChanges: outcome.permissionChanges }
  return { status: 'unknown', changed: 'changed' in outcome ? outcome.changed : false,
    error: outcome.kind === 'awaiting-approval' ? 'awaiting build approval' : 'cancelled', permissionChanges: outcome.permissionChanges }
}

function completionDigest(record: ManagementRecord, result: PluginActionResult, maintenance: ManagementCompletion['maintenance']): string {
  return createHash('sha256').update(canonicalJson({ fingerprint: record.fingerprint, outcome: record.outcome, receipt: record.receipt, result, maintenance })).digest('hex')
}

export function completeManagementRecord(record: ManagementRecord, maintenance: ManagementCompletion['maintenance']): ManagementRecord {
  if (record.stage !== 'settled' || record.outcome === undefined) throw new MarketCoreError('management/unsettled', '原官方管理结果尚未核实，不能保存完整业务凭证')
  const result = managementResultFromOutcome(record.outcome)
  const completion = { result, maintenance, digest: completionDigest(record, result, maintenance) }
  return decodeManagementRecord(new TextEncoder().encode(JSON.stringify({ ...record, completion })))
}

export function decodeManagementRecord(bytes: Uint8Array): ManagementRecord {
  let value: unknown
  try { value = JSON.parse(new TextDecoder().decode(bytes)) }
  catch { throw new MarketCoreError('management/corrupt', '管理记录无法读取，不能证明原操作未写入') }
  if (!object(value) || value.schemaVersion !== 1 || !object(value.request)
    || Object.keys(value.request).some(key => !['environmentId', 'packageName', 'expectedVersion', 'idempotencyKey', 'action'].includes(key))
    || !text(value.request.environmentId) || !text(value.request.packageName)
    || typeof value.request.expectedVersion !== 'string' || value.request.expectedVersion.length > 200 || /[\u0000-\u001f]/u.test(value.request.expectedVersion)
    || !text(value.request.idempotencyKey) || !['enable', 'disable', 'remove'].includes(value.request.action as string)
    || !['dispatched', 'settled', 'unknown'].includes(value.stage as string)
    || value.fingerprint !== createHash('sha256').update(canonicalJson(value.request)).digest('hex')
    || value.outcome !== undefined && !outcomeValid(value.outcome) || value.receipt !== undefined && !outcomeValid(value.receipt)
    || value.stage === 'settled' && value.outcome === undefined) {
    throw new MarketCoreError('management/corrupt', '管理记录身份或回执损坏，不能证明原操作未写入')
  }
  const record = value as unknown as ManagementRecord
  if (value.completion !== undefined) {
    const completion = value.completion
    const outcome = record.outcome
    if (!object(completion) || Object.keys(completion).some(key => !['result', 'maintenance', 'digest'].includes(key))
      || record.stage !== 'settled' || outcome === undefined || outcome.kind === 'unknown' || outcome.kind === 'awaiting-approval'
      || outcome.kind === 'failed' && outcome.unknownSharedImpact === true
      || record.receipt !== undefined && canonicalJson(record.receipt) !== canonicalJson(outcome)
      || !object(completion.maintenance) || !object(completion.result)
      || !permissionsValid(completion.result.permissionChanges)
      || canonicalJson(completion.result) !== canonicalJson(managementResultFromOutcome(outcome))) {
      throw new MarketCoreError('management/corrupt', '管理业务凭证与原官方回执不一致')
    }
    const maintenance = completion.maintenance
    if (outcome.kind === 'applied'
      ? maintenance.status !== 'saved' || Object.keys(maintenance).some(key => !['status', 'revision'].includes(key)) || !Number.isSafeInteger(maintenance.revision) || (maintenance.revision as number) < 0
      : maintenance.status !== 'not-required' || Object.keys(maintenance).some(key => key !== 'status')) {
      throw new MarketCoreError('management/corrupt', '管理业务凭证缺少可信维护提交事实')
    }
    if (completion.digest !== completionDigest(record, completion.result as unknown as PluginActionResult, maintenance as unknown as ManagementCompletion['maintenance'])) {
      throw new MarketCoreError('management/corrupt', '管理业务凭证摘要损坏，不能确认原操作完成')
    }
  }
  return record
}
