import { describe, expect, it, vi } from 'vitest'
import { InstallTaskManager } from '../../packages/market-core/src/core/task-manager.ts'
import { FakeArtifactPort, FakeHost, InMemoryLocks, InMemoryTaskStore, inventoryItem, makeBundle, waitForTask } from './helpers.ts'

function scenario() {
  const host = new FakeHost()
  const artifacts = new FakeArtifactPort()
  const store = new InMemoryTaskStore()
  const validateWrite = vi.fn(async (_bundle: unknown, _pluginId: string) => {})
  const manager = new InstallTaskManager({ host, artifacts, store, locks: new InMemoryLocks(), validateWrite,
    validateStart: async bundle => { for (const step of bundle.steps) await validateWrite(bundle, step.pluginId) },
    now: () => new Date('2026-09-27T00:00:01Z') })
  return { host, artifacts, store, manager, validateWrite }
}

describe('开始任务的发行检查与幂等恢复', () => {
  it('新任务发行检查失败时零任务、零制品获取、零写入', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'new-target', version: '1.0.0' }] })
    const fixture = scenario()
    fixture.validateWrite.mockRejectedValue(new Error('发行已冲突'))
    await expect(fixture.manager.start(bundle, { planId: bundle.plan.planId, planDigest: bundle.plan.planDigest, idempotencyKey: 'new-target', confirmed: true }, await fixture.host.readState())).rejects.toThrow('发行已冲突')
    expect(fixture.store.records.size).toBe(0)
    expect(fixture.artifacts.acquired).toEqual([])
    expect(fixture.host.calls).toEqual([])
  })

  it('已完成原任务不因目录后来失效而被重复开始请求拒绝', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'original-target', version: '1.0.0' }] })
    const fixture = scenario()
    const request = { planId: bundle.plan.planId, planDigest: bundle.plan.planDigest, idempotencyKey: 'original-target', confirmed: true as const }
    const started = await fixture.manager.start(bundle, request, await fixture.host.readState())
    await waitForTask(fixture.manager, started.task.taskId, task => task.status === 'completed')
    const writes = fixture.host.calls.length
    fixture.validateWrite.mockClear().mockRejectedValue(new Error('发行已冲突'))
    const recovered = await fixture.manager.start(bundle, request, await fixture.host.readState())
    expect(recovered.created).toBe(false)
    expect(recovered.task.taskId).toBe(started.task.taskId)
    expect(fixture.validateWrite).not.toHaveBeenCalled()
    expect(fixture.host.calls).toHaveLength(writes)
  })

  it('混合计划只验证实际写入项，keep 不需要当前发行重新可下载', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'kept-target', version: '1.0.0', currentVersion: '1.0.0' }, { packageName: 'new-target', version: '1.0.0' }] })
    const fixture = scenario()
    fixture.host.items.set('kept-target', inventoryItem('kept-target', '1.0.0'))
    fixture.validateWrite.mockImplementation(async (_bundle, pluginId) => { if (pluginId === 'p0') throw new Error('keep 发行不再可下载') })
    expect(bundle.plan.items[0]?.action).toBe('keep')
    const started = await fixture.manager.start(bundle, { planId: bundle.plan.planId, planDigest: bundle.plan.planDigest, idempotencyKey: 'mixed-targets', confirmed: true }, await fixture.host.readState())
    await waitForTask(fixture.manager, started.task.taskId, task => task.status === 'completed')
    expect(fixture.validateWrite.mock.calls.every(([, pluginId]) => pluginId === 'p1')).toBe(true)
    expect(fixture.host.calls.map(call => call.packageName)).toEqual(['new-target'])
  })
})
