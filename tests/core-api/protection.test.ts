import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DshManagerAdapter } from '../../packages/market-core/src/adapters/dsh/manager.ts'
import { AtomicProfileLocks, NodePersistenceFiles } from '../../packages/market-core/src/adapters/dsh/persistence-adapter.ts'
import { PROTECTED_MARKET_PACKAGES } from '../../packages/market-core/src/core/identity.ts'
import { createPlanBundle } from '../../packages/market-core/src/core/planner.ts'
import { canonicalJson, sha256Hex } from '../../packages/market-core/src/core/canonical.ts'
import { InstallTaskManager } from '../../packages/market-core/src/core/task-manager.ts'
import { AiAssistant } from '../../packages/market-core/src/host/ai-assist.ts'
import type { InstallPlan } from '../../packages/market-core/src/contracts/types.ts'
import type { PlanBundle } from '../../packages/market-core/src/core/ports.ts'
import { FakeArtifactPort, FakeHost, InMemoryTaskStore, inventoryItem, makeBundle, waitForTask } from '../core/helpers.ts'
import { context, freshDirectory, removeDirectory } from './helpers.ts'

async function digestPlan(plan: InstallPlan): Promise<string> {
  return sha256Hex(canonicalJson({ ...plan, planDigest: '' }))
}

async function digestBundle(bundle: Omit<PlanBundle, 'bundleDigest'>): Promise<string> {
  return sha256Hex(canonicalJson({ ...bundle, bundleDigest: '' }))
}

describe('市场桌面包与核心包的共同保护', () => {
  it('身份表不可变且同时包含两个包', () => {
    expect(Object.isFrozen(PROTECTED_MARKET_PACKAGES)).toBe(true)
    expect(PROTECTED_MARKET_PACKAGES).toEqual(['@dsh-eac/market', '@dsh-eac/market-core'])
  })

  it.each(['@dsh-eac/market', '@dsh-eac/market-core'])('单插件与套餐预检均阻止 %s', async packageName => {
    const packed = await makeBundle({ plugins: [{ packageName, version: '2.0.0', currentVersion: '1.0.0' }] })
    expect(packed.plan.items[0]?.blockers).toContain('management:protected-target')
    expect(packed.steps).toEqual([])
    const single = await createPlanBundle({
      catalogRevision: 'synthetic', environmentId: 'env-test', hostFingerprint: 'synthetic', now: new Date(),
      inventory: [inventoryItem(packageName, '1.0.0')], marketManagedPackageNames: [packageName],
      plugins: [{ pluginId: 'synthetic', packageName, version: '2.0.0', artifactDigest: 'synthetic-digest', verification: 'verified', requiresRestart: false, installable: true }],
      selections: [{ pluginId: 'synthetic', packageName, targetVersion: '2.0.0', targetDigest: 'synthetic-digest', enabledIntent: true, tryUnverified: false }],
    })
    expect(single.bundle?.plan.items[0]?.action).toBe('blocked')
    expect(single.bundle?.plan.items[0]?.blockers).toContain('management:protected-target')
    expect(single.bundle?.steps).toEqual([])
  })

  it('manager 标记两个包应由官方管理，并保留真实安装、启用和版本事实', async () => {
    const directory = freshDirectory()
    try {
      const names = ['@dsh-eac/market', '@dsh-eac/market-core', 'test-ordinary']
      const manager = {
        listBundles: async () => names.map(name => ({ name, version: '0.1.0', installed: true, enabled: true, removable: true, rows: [], overrides: [] })),
        listPlugins: async () => [],
      }
      const adapter = new DshManagerAdapter(context(directory, manager))
      expect(adapter.capabilities()).toContain('browse')
      const inventory = await adapter.inventory()
      expect(inventory.unknownItems).toEqual([])
      for (const name of names.slice(0, 2)) expect(inventory.items.find(item => item.packageName === name)).toMatchObject({
        readOnlyReason: 'management-required', version: '0.1.0', installed: true, bundleEnabled: true, removable: true,
      })
      expect(inventory.items.find(item => item.packageName === 'test-ordinary')?.readOnlyReason).toBeUndefined()
    } finally { removeDirectory(directory) }
  })

  it.each(['@dsh-eac/market', '@dsh-eac/market-core'])('任务器在真实锁下拒绝启停/移除 %s，旧计划也不能绕过保护', async packageName => {
    const directory = freshDirectory()
    try {
      const host = new FakeHost([inventoryItem(packageName, '1.0.0')])
      const artifacts = new FakeArtifactPort()
      const manager = new InstallTaskManager({
        host, artifacts, store: new InMemoryTaskStore(),
        locks: new AtomicProfileLocks(directory), coordinationFiles: new NodePersistenceFiles(join(directory, 'state')),
      })
      const write = vi.fn()
      for (const action of ['enable', 'disable', 'remove'] as const) {
        await expect(manager.manage({ environmentId: 'env-test', packageName, expectedVersion: '1.0.0', action, idempotencyKey: `test-${action}` }, write))
          .rejects.toMatchObject({ code: 'management/protected-target' })
      }
      expect(write).not.toHaveBeenCalled()
      // 合成拆分前已确认且摘要有效的计划，用来验证恢复执行路径的保护。
      const legacy = structuredClone(await makeBundle({ plugins: [{ packageName: 'test-before-split', version: '2.0.0', currentVersion: '1.0.0' }], now: new Date() }))
      const plan = { ...legacy.plan, items: legacy.plan.items.map(item => ({ ...item, packageName })) }
      const legacyBundle = { ...legacy, plan: { ...plan, planDigest: await digestPlan(plan) },
        steps: legacy.steps.map(step => ({ ...step, packageName })), expected: legacy.expected.map(item => ({ ...item, packageName })) }
      const bundle = { ...legacyBundle, bundleDigest: await digestBundle(legacyBundle) }
      const started = await manager.start(bundle, { planId: bundle.plan.planId, planDigest: bundle.plan.planDigest, confirmed: true, idempotencyKey: 'test-legacy' }, await host.readState())
      const stopped = await waitForTask(manager, started.task.taskId, task => task.status === 'needs-attention')
      expect(stopped.events.some(event => event.message.includes('官方管理入口'))).toBe(true)
      expect(artifacts.acquired).toEqual([])
      expect(host.calls).toEqual([])
    } finally { removeDirectory(directory) }
  })

  it.each(['@dsh-eac/market', '@dsh-eac/market-core'])('AI 不能为 %s 生成可执行建议', async packageName => {
    const llm = { async *stream() {
      yield { type: 'text-delta', text: JSON.stringify({ summary: '合成测试', facts: ['fact-1'], actions: [{ kind: 'disable', packageName, reason: 'synthetic' }] }) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } }
    const result = await new AiAssistant(llm, { currentSelection: () => ({ provider: 'test', model: 'test' }) }).analyze({ packageName }, {
      schemaVersion: '1', generatedAt: new Date().toISOString(), marketVersion: 'test', environmentId: 'test', summaries: [], redacted: true,
      diagnostics: [{ id: 'fact-1', category: 'inventory', message: 'Synthetic test only', source: 'test', redacted: true }],
    })
    expect(result.status).toBe('failed')
    expect(result.proposal).toBeUndefined()
  })
})
