import { describe, expect, it } from 'vitest'
import { FakeHost, makeBundle, makeManager, waitForTask } from './helpers.ts'
import type { HostInstallOutcome, ArtifactAcquisition } from '../../packages/market-core/src/core/ports.ts'
import { hasUncertainWrite } from '../../packages/market-core/src/core/execution-state.ts'
import { createPlanBundle } from '../../packages/market-core/src/core/planner.ts'
import type { InstallLogEntry } from '../../packages/market-core/src/contracts/types.ts'

type LogEntry = Omit<InstallLogEntry, 'hostVersion'>

function sink(): { entries: LogEntry[]; append(entry: LogEntry): void } {
  const entries: LogEntry[] = []
  return { entries, append(entry) { entries.push(entry) } }
}

function settled(task: { status: string }): boolean {
  return ['completed', 'partial', 'failed', 'cancelled', 'needs-attention'].includes(task.status)
}

/** 写入完成的瞬间才把宿主标成"未安定"，模拟写后库存读取未安定。 */
class LateUnsettledHost extends FakeHost {
  async install(request: { artifact: ArtifactAcquisition; enabled: boolean; approvedBuilds?: readonly string[] }): Promise<HostInstallOutcome> {
    const outcome = await super.install(request)
    this.stable = false
    this.writeBarrier = true
    this.unknownItems = [...this.unknownItems, 'bundle-version:' + request.artifact.packageName]
    return outcome
  }
  settle(): void {
    this.stable = true
    this.writeBarrier = false
    this.unknownItems = []
  }
}

/** 官方调用在派发后直接抛异常的宿主。 */
class ThrowingHost extends FakeHost {
  async install(request: { artifact: ArtifactAcquisition; enabled: boolean; approvedBuilds?: readonly string[] }): Promise<HostInstallOutcome> {
    this.calls.push({ packageName: request.artifact.packageName })
    throw new Error('连接在派发后中断')
  }
}

function startRequest(planId: string, digest: string, key: string): Parameters<ReturnType<typeof makeManager>['manager']['start']>[1] {
  return { planId, planDigest: digest, idempotencyKey: key, confirmed: true }
}

describe('B2 宽松安装：核对类降级为记录器', () => {
  it('装后核对存疑仍保留官方要求的重启状态', async () => {
    const host = new LateUnsettledHost()
    const install = host.install.bind(host)
    host.install = async request => {
      const outcome = await install(request)
      return outcome.kind === 'applied' ? { ...outcome, restartRequired: true } : outcome
    }
    const bundle = await makeBundle({ plugins: [{ packageName: '@test/loose-restart', version: '1.0.0' }] })
    const { manager, taskId } = await makeManager(bundle, host)
    const task = await waitForTask(manager, taskId, value => value.status === 'awaiting-resume')

    expect(task.items[0]).toMatchObject({ status: 'restart-required', installOutcome: 'restart-required', errorCode: 'postcheck/logged' })
    expect(task.status).not.toBe('completed')
  })

  it('写后库存未安定时按已完成记录，且不为后续安装设阻', async () => {
    const log = sink()
    const host = new LateUnsettledHost()
    const bundle = await makeBundle({ plugins: [{ packageName: '@test/loose-a', version: '1.0.0' }] })
    const { manager, taskId, store } = await makeManager(bundle, host, undefined, { installLog: log })
    const task = await waitForTask(manager, taskId, settled)

    expect(task.status).toBe('completed')
    expect(task.items[0]).toMatchObject({ status: 'enabled', installOutcome: 'applied' })
    const record = store.records.get(taskId)
    expect(record && hasUncertainWrite(record)).toBe(false)
    expect(log.entries.at(-1)).toMatchObject({ action: 'install', packageName: '@test/loose-a', officialResult: { kind: 'applied' } })

    // 宿主瞬时未安定结束后，第二个任务必须能直接开始（不再被旧写入阻塞）。
    host.settle()
    const next = await makeBundle({ plugins: [{ packageName: '@test/loose-b', version: '1.0.0' }], planId: 'plan-loose-b' })
    await expect(manager.start(next, startRequest(next.plan.planId, next.plan.planDigest, 'start-plan-loose-b'), await host.readState()))
      .resolves.toMatchObject({ created: true })
  })

  it('官方调用抛异常时显示"结果未知（已提交）"，但不暂停也不阻塞后续安装', async () => {
    const log = sink()
    const host = new ThrowingHost()
    const bundle = await makeBundle({ plugins: [{ packageName: '@test/throw-a', version: '1.0.0' }] })
    const { manager, taskId, store } = await makeManager(bundle, host, undefined, { installLog: log })
    const task = await waitForTask(manager, taskId, settled)

    expect(task.status).toBe('needs-attention')
    expect(task.items[0]).toMatchObject({ status: 'unknown', installOutcome: 'unknown' })
    expect(task.events.some(event => event.message === '已提交，结果未核实，详见安装日志')).toBe(true)
    const record = store.records.get(taskId)
    expect(record && hasUncertainWrite(record)).toBe(false)
    expect(log.entries.at(-1)).toMatchObject({ packageName: '@test/throw-a', officialResult: { kind: 'unknown' } })

    const next = await makeBundle({ plugins: [{ packageName: '@test/throw-b', version: '1.0.0' }], planId: 'plan-throw-b' })
    await expect(manager.start(next, startRequest(next.plan.planId, next.plan.planDigest, 'start-plan-throw-b'), await host.readState()))
      .resolves.toMatchObject({ created: true })
  })

  it('已知不兼容只降级为计划级警告；缺制品与 hard-blocked 仍然阻断', async () => {
    const context = (installable: boolean, verification: 'hard-incompatible' | 'verified') => ({
      environmentId: 'env-test', hostFingerprint: 'host', catalogRevision: 'test', inventory: [], now: new Date(),
      plugins: [{ pluginId: 'p0', packageName: '@test/risky', version: '1.0.0', artifactDigest: 'a'.repeat(64), verification, installable, requiresRestart: false }],
      selections: [{ pluginId: 'p0', packageName: '@test/risky', targetVersion: '1.0.0', targetDigest: 'a'.repeat(64), enabledIntent: true, tryUnverified: false }],
    })
    const risky = await createPlanBundle(context(true, 'hard-incompatible'))
    expect(risky.status).toBe('ready')
    expect(risky.bundle?.plan.items[0]).toMatchObject({ action: 'add', warnings: ['verification:hard-incompatible'] })

    const blocked = await createPlanBundle(context(false, 'hard-incompatible'))
    expect(blocked.status).toBe('ready')
    expect(blocked.bundle?.plan.items[0]).toMatchObject({ action: 'blocked' })
    expect(blocked.bundle?.plan.items[0]?.blockers).toContain('artifact:not-installable')
  })
})
