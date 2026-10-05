import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { canonicalJson, sha256Hex } from '../../packages/market-core/src/core/canonical.ts'
import type { CoordinatedManagementRequest, ManagementRecord } from '../../packages/market-core/src/core/execution-state.ts'
import type { HostInstallOutcome, PlanBundle } from '../../packages/market-core/src/core/ports.ts'
import type { PluginActionRecoveryRequest } from '../../packages/market-core/src/contracts/types.ts'
import { decodeManagementRecord } from '../../packages/market-core/src/host/operation-recovery.ts'
import { identity } from '../core-api/helpers.ts'
import { releaseFixture, settledTask } from '../core/release-context-fixture.ts'

function managementPath(directory: string, key: string): string {
  const root = join(directory, 'market', 'state', 'management')
  mkdirSync(root, { recursive: true })
  return join(root, createHash('sha256').update(identity.environmentId + ':' + key).digest('hex') + '.json')
}

function management(request: PluginActionRecoveryRequest, stage: ManagementRecord['stage'], receipt?: HostInstallOutcome): ManagementRecord {
  const saved: CoordinatedManagementRequest = { environmentId: identity.environmentId, ...request, expectedVersion: request.expectedVersion ?? '' }
  return { schemaVersion: 1, request: saved, fingerprint: createHash('sha256').update(canonicalJson(saved)).digest('hex'), stage,
    ...(receipt === undefined ? {} : stage === 'settled' ? { outcome: receipt, receipt } : { receipt }) }
}

function saveRecord(directory: string, record: ManagementRecord): void {
  writeFileSync(managementPath(directory, record.request.idempotencyKey), JSON.stringify(record))
}

describe('原安装意图只读恢复', () => {
  it('返回原任务与原key；库存/目录/核心变化后重复开始仍返回原task且零额外写入', async () => {
    await releaseFixture(async ({ runtime, selections, directory, setVersion, installed, officialWrites }) => {
      vi.spyOn(runtime.artifacts, 'acquire').mockRejectedValue(new Error('synthetic download stopped'))
      const plan = await runtime.planCreate({ selections }, 'owner')
      if (plan.status !== 'ready') throw new Error(JSON.stringify(plan))
      const request = { planId: plan.plan.planId, planDigest: plan.plan.planDigest, idempotencyKey: 'original-start' }
      const started = await runtime.taskStart({ ...request, confirmed: true }, 'owner')
      const settled = await settledTask(runtime, started.taskId)
      const acquire = vi.spyOn(runtime.artifacts, 'acquire')
      acquire.mockClear()
      const readState = vi.spyOn(runtime.host, 'readState')
      readState.mockClear()
      setVersion('2.0.0')
      installed.set('unrelated', { name: 'unrelated', version: '2.0.0', installed: true, enabled: true, removable: true, rows: [], overrides: [] })
      const source = structuredClone(runtime.catalog.sourceSnapshot())
      Object.assign(source.snapshot.plugins[0]!, { publication: 'withdrawn' })
      vi.spyOn(runtime.catalog, 'sourceSnapshot').mockReturnValue(source)
      for (let count = 0; count < 2; count++) {
        expect(await runtime.taskStartRecover(request, 'owner')).toEqual({ status: 'found', task: settled })
        expect(await runtime.taskStart({ ...request, confirmed: true }, 'owner')).toEqual(settled)
      }
      expect(acquire).not.toHaveBeenCalled()
      expect(readState).not.toHaveBeenCalled()
      expect(officialWrites).not.toHaveBeenCalled()
      expect(await runtime.taskList()).toHaveLength(1)
      expect(JSON.parse(readFileSync(join(directory, 'market', 'state', 'plans', request.planId + '.json'), 'utf8')).callerId).toBe('owner')
    })
  })

  it('安装归属/摘要/幂等键冲突不是not-found，不能跨caller获取原任务', async () => {
    await releaseFixture(async ({ runtime, selections }) => {
      vi.spyOn(runtime.artifacts, 'acquire').mockRejectedValue(new Error('synthetic download stopped'))
      const plan = await runtime.planCreate({ selections }, 'owner')
      if (plan.status !== 'ready') throw new Error(JSON.stringify(plan))
      const request = { planId: plan.plan.planId, planDigest: plan.plan.planDigest, idempotencyKey: 'original-start' }
      const started = await runtime.taskStart({ ...request, confirmed: true }, 'owner')
      await settledTask(runtime, started.taskId)
      await expect(runtime.taskStartRecover(request, 'other-caller')).rejects.toMatchObject({ code: 'operation-recovery/caller-mismatch' })
      await expect(runtime.taskStart({ ...request, confirmed: true }, 'other-caller')).rejects.toMatchObject({ code: 'operation-recovery/caller-mismatch' })
      await expect(runtime.taskStartRecover({ ...request, planDigest: 'forged' }, 'owner')).rejects.toMatchObject({ code: 'plan/confirmation-mismatch' })
      await expect(runtime.taskStartRecover({ ...request, idempotencyKey: 'different-key' }, 'owner')).rejects.toMatchObject({ code: 'task/idempotency-conflict' })
      await expect(runtime.taskStartRecover(request, '')).rejects.toMatchObject({ code: 'operation-recovery/invalid-request' })
    })
  })

  it('未持久化任务的计划与缺失计划只返回not-found，不读库存、不开始队列', async () => {
    await releaseFixture(async ({ runtime, selections, officialWrites }) => {
      const plan = await runtime.planCreate({ selections }, 'owner')
      if (plan.status !== 'ready') throw new Error(JSON.stringify(plan))
      const host = vi.spyOn(runtime.host, 'readState').mockRejectedValue(new Error('must not inspect inventory'))
      const start = vi.spyOn(runtime.tasks, 'start')
      const download = vi.spyOn(runtime.artifacts, 'acquire')
      expect(await runtime.taskStartRecover({ planId: plan.plan.planId, planDigest: plan.plan.planDigest, idempotencyKey: 'missing-start' }, 'owner')).toEqual({ status: 'not-found' })
      expect(await runtime.taskStartRecover({ planId: 'missing-plan', planDigest: 'missing-digest', idempotencyKey: 'missing-start' }, 'owner')).toEqual({ status: 'not-found' })
      expect(host).not.toHaveBeenCalled()
      expect(start).not.toHaveBeenCalled()
      expect(download).not.toHaveBeenCalled()
      expect(officialWrites).not.toHaveBeenCalled()
    })
  })

  it.each(['plan-json', 'plan-digest', 'task-commit', 'task-idempotency', 'missing-owner', 'legacy-missing-caller'] as const)('原耐久记录 %s 损坏或缺失不能降为not-found', async corruption => {
    await releaseFixture(async ({ runtime, selections, directory }) => {
      vi.spyOn(runtime.artifacts, 'acquire').mockRejectedValue(new Error('synthetic download stopped'))
      const plan = await runtime.planCreate({ selections }, 'owner')
      if (plan.status !== 'ready') throw new Error(JSON.stringify(plan))
      const request = { planId: plan.plan.planId, planDigest: plan.plan.planDigest, idempotencyKey: 'original-start' }
      const started = await runtime.taskStart({ ...request, confirmed: true }, 'owner')
      await settledTask(runtime, started.taskId)
      const root = join(directory, 'market', 'state')
      const planPath = join(root, 'plans', request.planId + '.json')
      const commitPath = join(root, 'tasks', started.taskId, 'commit.json')
      const originalCommit = readFileSync(commitPath)
      if (corruption === 'plan-json') writeFileSync(planPath, '{broken')
      if (corruption === 'plan-digest') {
        const saved = JSON.parse(readFileSync(planPath, 'utf8'))
        saved.bundle.plan.items[0].releaseContext.identity.metadataDigest = 'forged'
        writeFileSync(planPath, JSON.stringify(saved))
      }
      if (corruption === 'legacy-missing-caller') {
        const saved = JSON.parse(readFileSync(planPath, 'utf8'))
        delete saved.callerId
        writeFileSync(planPath, JSON.stringify(saved))
      }
      if (corruption === 'task-commit') writeFileSync(commitPath, '{broken')
      if (corruption === 'task-idempotency') {
        const commit = JSON.parse(readFileSync(commitPath, 'utf8'))
        commit.document.record.idempotency[request.idempotencyKey] = 'cancel'
        commit.digest = await sha256Hex(canonicalJson(commit.document))
        writeFileSync(commitPath, JSON.stringify(commit))
      }
      if (corruption === 'missing-owner') {
        const files = (runtime as unknown as { files: { read: (path: string) => Promise<Uint8Array | undefined> } }).files
        const original = files.read.bind(files)
        vi.spyOn(files, 'read').mockImplementation(path => path === 'plans/' + request.planId + '.json' ? Promise.resolve(undefined) : original(path))
      }
      await expect(runtime.taskStartRecover(request, 'owner')).rejects.toBeDefined()
      if (corruption === 'task-commit') writeFileSync(commitPath, originalCommit)
    })
  })

  it('缺失summary/index可从耐久commit恢复投影但不触发官方写入', async () => {
    await releaseFixture(async ({ runtime, selections, directory, officialWrites }) => {
      vi.spyOn(runtime.artifacts, 'acquire').mockRejectedValue(new Error('synthetic download stopped'))
      const plan = await runtime.planCreate({ selections }, 'owner')
      if (plan.status !== 'ready') throw new Error(JSON.stringify(plan))
      const request = { planId: plan.plan.planId, planDigest: plan.plan.planDigest, idempotencyKey: 'original-start' }
      const started = await runtime.taskStart({ ...request, confirmed: true }, 'owner')
      const settled = await settledTask(runtime, started.taskId)
      const root = join(directory, 'market', 'state')
      writeFileSync(join(root, 'task-index.json'), JSON.stringify({ schemaVersion: 1, entries: {} }))
      writeFileSync(join(root, 'tasks', started.taskId, 'summary.json'), '{broken projection')
      expect(await runtime.taskStartRecover(request, 'owner')).toEqual({ status: 'found', task: settled })
      expect(officialWrites).not.toHaveBeenCalled()
    })
  })

  it('旧plan没有releaseValidation时仍可只读验证原计划，但不宣称冻结未知上下文', async () => {
    await releaseFixture(async ({ runtime, selections, directory }) => {
      const plan = await runtime.planCreate({ selections }, 'owner')
      if (plan.status !== 'ready') throw new Error(JSON.stringify(plan))
      const path = join(directory, 'market', 'state', 'plans', plan.plan.planId + '.json')
      const saved = JSON.parse(readFileSync(path, 'utf8')) as { bundle: PlanBundle }
      const legacy = structuredClone(saved.bundle)
      delete (legacy as { releaseValidation?: unknown }).releaseValidation
      for (const item of legacy.plan.items) delete (item as { releaseContext?: unknown }).releaseContext
      Object.assign(legacy.plan, { planDigest: await sha256Hex(canonicalJson({ ...legacy.plan, planDigest: '' })) })
      Object.assign(legacy, { bundleDigest: await sha256Hex(canonicalJson({ ...legacy, bundleDigest: '' })) })
      writeFileSync(path, JSON.stringify({ ...saved, bundle: legacy }))
      expect(await runtime.taskStartRecover({ planId: plan.plan.planId, planDigest: legacy.plan.planDigest, idempotencyKey: 'legacy-unstarted' }, 'owner')).toEqual({ status: 'not-found' })
      vi.spyOn(runtime.artifacts, 'acquire').mockRejectedValue(new Error('synthetic download stopped'))
      const started = await runtime.taskStart({ planId: legacy.plan.planId, planDigest: legacy.plan.planDigest, idempotencyKey: 'legacy-start', confirmed: true }, 'owner')
      await settledTask(runtime, started.taskId)
      expect((await runtime.taskStartRecover({ planId: legacy.plan.planId, planDigest: legacy.plan.planDigest, idempotencyKey: 'legacy-start' }, 'owner')).status).toBe('found')
    })
  })
})

describe('原管理意图只读恢复', () => {
  const request: PluginActionRecoveryRequest = { packageName: 'management-fixture', expectedVersion: '1.0.0', action: 'enable', idempotencyKey: 'management-original' }
  const permissions = [{ packageName: 'native-build', decision: 'approved' as const }]

  it.each(['dispatched', 'unknown'] as const)('原%s没有receipt，查询保留stage且不重放', async stage => {
    await releaseFixture(async ({ runtime, directory, officialWrites }) => {
      saveRecord(directory, management(request, stage))
      const read = vi.spyOn(runtime.host, 'readState').mockRejectedValue(new Error('must not infer outcome from inventory'))
      expect(await runtime.pluginActionRecover(request)).toEqual({ status: 'found', stage })
      expect(await runtime.pluginActionRecover(request)).toEqual({ status: 'found', stage })
      expect(read).not.toHaveBeenCalled()
      expect(officialWrites).not.toHaveBeenCalled()
    })
  })

  it.each(['enable', 'disable', 'remove'] as const)('缺失%s记录不证明未写，也不推断当前库存', async action => {
    await releaseFixture(async ({ runtime, officialWrites }) => {
      const read = vi.spyOn(runtime.host, 'readState').mockRejectedValue(new Error('must not inspect inventory'))
      expect(await runtime.pluginActionRecover({ ...request, action })).toEqual({ status: 'not-found' })
      expect(read).not.toHaveBeenCalled()
      expect(officialWrites).not.toHaveBeenCalled()
    })
  })

  it.each(['applied', 'failed', 'unknown', 'restart-required'] as const)('structured原%s回执保留changed/error/permissions但不证明维护保存完成', async kind => {
    await releaseFixture(async ({ runtime, directory, officialWrites }) => {
      const receipt: HostInstallOutcome = kind === 'failed'
        ? { kind: 'failed', changed: true, error: 'official failed', errorCode: 'official/test', permissionChanges: permissions }
        : kind === 'unknown' ? { kind: 'unknown', error: 'official unknown', permissionChanges: permissions }
          : { kind: 'applied', changed: true, restartRequired: kind === 'restart-required', permissionChanges: permissions }
      saveRecord(directory, management(request, kind === 'unknown' ? 'unknown' : 'settled', receipt))
      const recovered = await runtime.pluginActionRecover(request)
      expect(recovered).toMatchObject({ status: 'found', receipt: { status: kind, changed: kind !== 'unknown', permissionChanges: permissions }, result: { status: 'unknown', changed: kind !== 'unknown', permissionChanges: permissions, errorCode: 'management/business-result-unavailable' } })
      if (kind === 'failed' || kind === 'unknown') expect(recovered).toMatchObject({ receipt: { error: 'official ' + kind } })
      expect(await runtime.pluginActionRecover(request)).toEqual(recovered)
      expect(officialWrites).not.toHaveBeenCalled()
    })
  })

  it.each(['dispatched', 'unknown'] as const)('原%s即使已有applied receipt仍不是完整业务完成', async stage => {
    await releaseFixture(async ({ runtime, directory, officialWrites }) => {
      saveRecord(directory, management(request, stage, { kind: 'applied', changed: true, restartRequired: false, permissionChanges: permissions }))
      expect(await runtime.pluginActionRecover(request)).toMatchObject({ status: 'found', stage,
        receipt: { status: 'applied', changed: true, permissionChanges: permissions },
        result: { status: 'unknown', changed: true, permissionChanges: permissions, errorCode: 'management/business-result-unavailable' } })
      expect(officialWrites).not.toHaveBeenCalled()
    })
  })

  it.each([undefined, ''])('合法旧expectedVersion=%j可恢复原回执', async expectedVersion => {
    await releaseFixture(async ({ runtime, directory }) => {
      const original = { ...request, expectedVersion }
      saveRecord(directory, management(original, 'settled', { kind: 'applied', changed: true, restartRequired: false, permissionChanges: permissions }))
      expect(await runtime.pluginActionRecover(original)).toMatchObject({ status: 'found', stage: 'settled', receipt: { status: 'applied', changed: true }, result: { status: 'unknown' } })
    })
  })

  it.each(['packageName', 'expectedVersion', 'action'] as const)('同key不同%s必须冲突，不是not-found', async field => {
    await releaseFixture(async ({ runtime, directory }) => {
      saveRecord(directory, management(request, 'dispatched'))
      const changed = { ...request, [field]: field === 'action' ? 'disable' : 'different' } as PluginActionRecoveryRequest
      await expect(runtime.pluginActionRecover(changed)).rejects.toMatchObject({ code: 'task/idempotency-conflict' })
    })
  })

  it.each(['json', 'schema', 'fingerprint', 'identity', 'stage', 'outcome', 'settled-missing-receipt', 'version-control', 'version-long'] as const)('损坏%s不能作为not-found或成功回执', async corruption => {
    await releaseFixture(async ({ runtime, directory }) => {
      const record = management(request, 'settled', { kind: 'applied', changed: true, restartRequired: false, permissionChanges: permissions })
      const mutated = JSON.parse(JSON.stringify(record))
      if (corruption === 'schema') mutated.schemaVersion = 2
      if (corruption === 'fingerprint') mutated.fingerprint = 'forged'
      if (corruption === 'identity') mutated.request.packageName = 'forged'
      if (corruption === 'stage') mutated.stage = 'invented'
      if (corruption === 'outcome') mutated.outcome = { kind: 'applied' }
      if (corruption === 'settled-missing-receipt') delete mutated.outcome
      if (corruption === 'version-control') mutated.request.expectedVersion = '1.0.0\n'
      if (corruption === 'version-long') mutated.request.expectedVersion = 'a'.repeat(201)
      writeFileSync(managementPath(directory, request.idempotencyKey), corruption === 'json' ? '{broken' : JSON.stringify(mutated))
      await expect(runtime.pluginActionRecover(request)).rejects.toMatchObject({ code: 'management/corrupt' })
    })
  })

  it('官方failed安全脱敏仍保留原错误类别；parser拒绝无效权限', async () => {
    const record = management(request, 'settled', { kind: 'failed', changed: false, error: 'official failed token=secret-token', errorCode: 'official/failed', permissionChanges: permissions })
    await releaseFixture(async ({ runtime, directory }) => {
      saveRecord(directory, record)
      const recovered = await runtime.pluginActionRecover(request)
      expect(recovered).toMatchObject({ status: 'found', receipt: { status: 'failed', changed: false, errorCode: 'official/failed', permissionChanges: permissions } })
      expect(JSON.stringify(recovered)).not.toContain('secret-token')
    })
    const corrupted = { ...record, outcome: { ...record.outcome, permissionChanges: [{ packageName: 'build', decision: 'invalid' }] } }
    expect(() => decodeManagementRecord(Buffer.from(JSON.stringify(corrupted)))).toThrow()
  })
})
