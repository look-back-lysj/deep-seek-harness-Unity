import { describe, expect, it } from 'vitest'
import type { PluginActionRecoveryResult, ReleaseSelectionContext, TaskStartRecoveryResult } from '../../packages/market-core/src/contracts/types.ts'
import { taskFixture } from '../client/fixtures.ts'

const remote = await import(new URL('../../packages/market/lib/typert.remote-client.js', import.meta.url).href) as {
  TYPERT_REMOTE: { descriptors: readonly { method: string; result: { create(): { safeParse(value: unknown): { success: boolean; data?: unknown } } } }[] }
}

function schema(method: string) {
  const descriptor = remote.TYPERT_REMOTE.descriptors.find(entry => entry.method === method)
  if (descriptor === undefined) throw new Error(`generated Remote 缺少 ${method}`)
  return descriptor.result.create()
}

describe('原操作只读恢复与版本计划的真实生成codec', () => {
  it('安装恢复保留原task或缺失，不提供重放与界面状态', () => {
    const found: TaskStartRecoveryResult = { status: 'found', task: taskFixture() }
    const missing: TaskStartRecoveryResult = { status: 'not-found' }
    expect(schema('taskStartRecover').safeParse(found)).toMatchObject({ success: true, data: found })
    expect(schema('taskStartRecover').safeParse(missing)).toMatchObject({ success: true, data: missing })
    expect(schema('taskStartRecover').safeParse({ status: 'found' }).success).toBe(false)
    const parsed = schema('taskStartRecover').safeParse({ ...missing, retry: true, loading: true, callerId: 'untrusted' })
    expect(parsed.data).toEqual(missing)
  })

  it('管理恢复区分派发、未知和已核实回执，不凭缺失声称失败', () => {
    const receipt = { status: 'applied' as const, changed: true, permissionChanges: [] }
    const values: PluginActionRecoveryResult[] = [
      { status: 'not-found' }, { status: 'found', stage: 'dispatched' },
      { status: 'found', stage: 'unknown', result: { status: 'unknown', changed: false, permissionChanges: [] } },
      { status: 'found', stage: 'settled', result: receipt },
      { status: 'found', stage: 'settled', receipt, result: { status: 'unknown', changed: true, errorCode: 'management/business-result-unavailable', permissionChanges: [] } },
    ]
    for (const value of values) expect(schema('pluginActionRecover').safeParse(value)).toMatchObject({ success: true, data: value })
    expect(schema('pluginActionRecover').safeParse({ status: 'found', stage: 'success' }).success).toBe(false)
  })

  it('计划codec保留完整所选发行上下文而剥离交互中间态', () => {
    const releaseContext: ReleaseSelectionContext = {
      context: { environmentId: 'test-environment', hostRevision: 'h1', catalogRevision: 'c1', inventoryRevision: 'i1', checkedAt: '2026-10-04T00:00:00Z', catalogStale: false },
      identity: { pluginId: 'test-plugin', packageName: '@test/wire', version: '1.0.0', metadataDigest: 'sha256:metadata', artifactDigest: 'sha256:artifact', releaseId: 'release-one' },
      sources: [{ sourceId: 'registered-main', revision: 'source:r1' }],
    }
    const task = taskFixture()
    const plan = { ...task, schemaVersion: '1', createdAt: task.createdAt, expiresAt: task.createdAt, hostFingerprint: 'h1', catalogRevision: 'c1',
      planDigest: 'sha256:plan', items: [{ pluginId: 'test-plugin', packageName: '@test/wire', action: 'add', currentEnabled: false, targetVersion: '1.0.0', targetDigest: 'sha256:artifact', requestedEnabled: true, verification: 'verified', requiresRestart: false, blockers: [], releaseContext }] }
    const parsed = schema('planCreate').safeParse({ status: 'ready', plan, loading: true })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toMatchObject({ status: 'ready', plan: { items: [{ releaseContext }] } })
    expect(parsed.data).not.toHaveProperty('loading')
  })
})
