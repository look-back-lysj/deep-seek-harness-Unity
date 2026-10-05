import type { PluginActionRecoveryRequest, TaskStartRecoveryRequest } from '../contracts/types.ts'
import { MarketCoreError } from '../core/errors.ts'

export { decodeManagementRecord } from '../core/management-record.ts'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/u.test(value)
}

export function assertTaskRecoveryRequest(request: TaskStartRecoveryRequest, callerId: string): void {
  if (!text(callerId) || !object(request) || Object.keys(request).some(key => !['planId', 'planDigest', 'idempotencyKey'].includes(key))
    || !text(request.planId) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(request.planId)
    || !text(request.planDigest) || !text(request.idempotencyKey)) {
    throw new MarketCoreError('operation-recovery/invalid-request', '恢复查询必须携带原计划身份、摘要、幂等键和可信连接身份')
  }
}

export function assertManagementRecoveryRequest(request: PluginActionRecoveryRequest): void {
  if (!object(request) || Object.keys(request).some(key => !['packageName', 'expectedVersion', 'action', 'idempotencyKey'].includes(key))
    || !text(request.packageName) || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(request.packageName)
    || request.expectedVersion !== undefined && (typeof request.expectedVersion !== 'string' || request.expectedVersion.length > 200 || /[\u0000-\u001f]/u.test(request.expectedVersion))
    || !['enable', 'disable', 'remove'].includes(request.action) || !text(request.idempotencyKey)) {
    throw new MarketCoreError('operation-recovery/invalid-request', '恢复查询必须携带原管理对象、版本、动作与幂等键')
  }
}
