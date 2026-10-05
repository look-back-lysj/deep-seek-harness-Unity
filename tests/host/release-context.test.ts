import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ReleaseSelectionContext } from '../../packages/market-core/src/contracts/types.ts'
import { verifyPlanBundle } from '../../packages/market-core/src/core/planner.ts'
import type { PlanBundle } from '../../packages/market-core/src/core/ports.ts'
import { releaseFixture, settledTask } from '../core/release-context-fixture.ts'

describe('发行列表上下文冻结与写入保护', () => {
  it.each([true, false])('新/旧调用方（显式上下文=%s）均冻结完整发行和真实环境事实', async explicit => {
    await releaseFixture(async ({ runtime, selections, directory }) => {
      const selection = selections[0]!
      const options = await runtime.releaseOptions({ packageName: selection.packageName })
      const releaseContext = { context: options.context, identity: options.releases[0]!.identity, sources: options.releases[0]!.sources }
      const plan = await runtime.planCreate({ selections: [{ ...selection, ...(explicit ? { releaseContext } : {}) }] }, 'owner')
      expect(plan.status, JSON.stringify(plan)).toBe('ready')
      if (plan.status !== 'ready') throw new Error(JSON.stringify(plan))
      const frozen = plan.plan.items[0]!.releaseContext!
      expect(frozen).toMatchObject({ context: { ...options.context, checkedAt: expect.any(String) }, identity: releaseContext.identity, sources: releaseContext.sources })
      expect(frozen.identity.metadataDigest).toMatch(/^sha256:[a-f0-9]{64}$/u)
      expect(frozen.identity.releaseId).toBeTruthy()
      const saved = JSON.parse(readFileSync(join(directory, 'market', 'state', 'plans', plan.plan.planId + '.json'), 'utf8')) as { bundle: PlanBundle }
      expect(await verifyPlanBundle(saved.bundle)).toBe(true)
      for (const mutate of [
        (bundle: PlanBundle) => Object.assign(bundle.plan.items[0]!.releaseContext!.identity, { metadataDigest: 'forged' }),
        (bundle: PlanBundle) => Object.assign(bundle.plan.items[0]!.releaseContext!.sources[0]!, { revision: 'forged' }),
        (bundle: PlanBundle) => Object.assign(bundle.releaseValidation!, { hostBinding: 'forged' }),
      ]) {
        const tampered = structuredClone(saved.bundle)
        mutate(tampered)
        expect(await verifyPlanBundle(tampered)).toBe(false)
      }
      expect(runtime.capabilities()).toContain('host-release-context')
    })
  })

  it.each(['environmentId', 'hostRevision', 'catalogRevision', 'inventoryRevision', 'catalogStale', 'pluginId', 'packageName', 'version', 'metadataDigest', 'artifactDigest', 'releaseId', 'sources'] as const)('拒绝伪造或过时 %s；时间戳不能代替revision', async field => {
    await releaseFixture(async ({ runtime, selections, officialWrites }) => {
      const selection = selections[0]!
      const options = await runtime.releaseOptions({ packageName: selection.packageName })
      const releaseContext: ReleaseSelectionContext = structuredClone({ context: options.context, identity: options.releases[0]!.identity, sources: options.releases[0]!.sources })
      if (field === 'sources') Object.assign(releaseContext, { sources: [{ sourceId: 'forged-source', revision: 'forged-revision' }] })
      else if (field in releaseContext.context) Object.assign(releaseContext.context, { [field]: field === 'catalogStale' ? !options.context.catalogStale : 'forged' })
      else Object.assign(releaseContext.identity, { [field]: 'forged' })
      Object.assign(releaseContext.context, { checkedAt: new Date().toISOString() })
      const download = vi.spyOn(runtime.artifacts, 'acquire')
      expect(await runtime.planCreate({ selections: [{ ...selection, releaseContext }] }, 'owner')).toMatchObject({ status: 'stale', reason: 'release-context/stale' })
      expect(download).not.toHaveBeenCalled()
      expect(officialWrites).not.toHaveBeenCalled()
      expect(await runtime.taskList()).toEqual([])
    })
  })

  it.each([null, {}, { context: null, identity: {}, sources: [] }])('畸形上下文不能进入计划：%j', async malformed => {
    await releaseFixture(async ({ runtime, selections }) => {
      expect(await runtime.planCreate({ selections: [{ ...selections[0]!, releaseContext: malformed as unknown as ReleaseSelectionContext }] }, 'owner')).toMatchObject({ status: 'blocked' })
    })
  })

  it('旧列表的库存/核心/目录事实实际改变后必须重新读取', async () => {
    await releaseFixture(async ({ runtime, selections, installed, setVersion }) => {
      const selection = selections[0]!
      const options = await runtime.releaseOptions({ packageName: selection.packageName })
      const releaseContext = { context: options.context, identity: options.releases[0]!.identity, sources: options.releases[0]!.sources }
      installed.set('unrelated', { name: 'unrelated', version: '1.0.0', installed: true, enabled: false, removable: true, rows: [], overrides: [] })
      expect(await runtime.planCreate({ selections: [{ ...selection, releaseContext }] }, 'owner')).toMatchObject({ status: 'stale' })
      installed.clear()
      setVersion('1.1.0')
      expect(await runtime.planCreate({ selections: [{ ...selection, releaseContext }] }, 'owner')).toMatchObject({ status: 'stale' })
      setVersion('1.0.0')
      const source = runtime.catalog.sourceSnapshot()
      vi.spyOn(runtime.catalog, 'sourceSnapshot').mockReturnValue({ ...source, provenance: { sourceId: 'new-source', revision: 'changed-source' } })
      expect(await runtime.planCreate({ selections: [{ ...selection, releaseContext }] }, 'owner')).toMatchObject({ status: 'stale' })
    })
  })

  it.each(['metadata', 'requirements', 'source', 'host', 'inventory', 'withdrawn', 'artifact'] as const)('计划保存后 %s 改变，开始前零下载零写入', async change => {
    await releaseFixture(async ({ runtime, selections, setVersion, installed, officialWrites }) => {
      const plan = await runtime.planCreate({ selections }, 'owner')
      if (plan.status !== 'ready') throw new Error(JSON.stringify(plan))
      const source = structuredClone(runtime.catalog.sourceSnapshot())
      if (change === 'metadata') Object.assign(source.snapshot.plugins[0]!, { metadataDigest: 'sha256:' + 'f'.repeat(64) })
      if (change === 'requirements') Object.assign(source.snapshot.plugins[0]!, { hostRequirements: { historyCoverage: 'unknown', declarations: [{ agentId: 'dsh', range: '>=2.0.0', versionScheme: 'npm', origin: 'package-engines' }] } })
      if (change === 'withdrawn') Object.assign(source.snapshot.plugins[0]!, { publication: 'withdrawn' })
      if (change === 'artifact') Object.assign(source.snapshot.plugins[0]!, { artifactDigest: 'sha256:' + 'f'.repeat(64) })
      if (change === 'source') Object.assign(source, { provenance: { sourceId: 'new-source', revision: 'new-revision' } })
      if (['metadata', 'requirements', 'withdrawn', 'artifact', 'source'].includes(change)) vi.spyOn(runtime.catalog, 'sourceSnapshot').mockReturnValue(source)
      if (change === 'host') setVersion('2.0.0')
      if (change === 'inventory') installed.set('unrelated', { name: 'unrelated', version: '1.0.0', installed: true, enabled: false, removable: true, rows: [], overrides: [] })
      const download = vi.spyOn(runtime.artifacts, 'acquire')
      await expect(runtime.taskStart({ planId: plan.plan.planId, planDigest: plan.plan.planDigest, confirmed: true, idempotencyKey: 'start-once' }, 'owner')).rejects.toBeDefined()
      expect(download).not.toHaveBeenCalled()
      expect(officialWrites).not.toHaveBeenCalled()
      expect(await runtime.taskList()).toEqual([])
    })
  })

  it.each(['requirements', 'source', 'inventory'] as const)('制品取得后 %s 改变，首次dispatch前拒绝官方写入', async change => {
    await releaseFixture(async ({ runtime, selections, installed, officialWrites }) => {
      const plan = await runtime.planCreate({ selections }, 'owner')
      if (plan.status !== 'ready') throw new Error(JSON.stringify(plan))
      vi.spyOn(runtime.artifacts, 'acquire').mockImplementation(async request => {
        if (change === 'inventory') installed.set('unrelated', { name: 'unrelated', version: '1.0.0', installed: true, enabled: false, removable: true, rows: [], overrides: [] })
        else {
          const source = structuredClone(runtime.catalog.sourceSnapshot())
          if (change === 'requirements') Object.assign(source.snapshot.plugins[0]!, { hostRequirements: undefined })
          else Object.assign(source, { provenance: { sourceId: 'changed-source', revision: 'changed-revision' } })
          vi.spyOn(runtime.catalog, 'sourceSnapshot').mockReturnValue(source)
        }
        return { pluginId: request.pluginId, packageName: request.packageName, version: request.version, artifactDigest: request.artifactDigest, localRef: 'synthetic-artifact', size: 509 }
      })
      const install = vi.spyOn(runtime.host, 'install')
      const task = await runtime.taskStart({ planId: plan.plan.planId, planDigest: plan.plan.planDigest, confirmed: true, idempotencyKey: 'start-once' }, 'owner')
      expect((await settledTask(runtime, task.taskId)).status).toBe('needs-attention')
      expect(install).not.toHaveBeenCalled()
      expect(officialWrites).not.toHaveBeenCalled()
    })
  })

  it('多个步骤首次dispatch后的真实库存变化不误挡后续步骤', async () => {
    await releaseFixture(async ({ runtime, selections, installed }) => {
      vi.spyOn(runtime.artifacts, 'acquire').mockImplementation(async request => ({ pluginId: request.pluginId, packageName: request.packageName, version: request.version, artifactDigest: request.artifactDigest, localRef: 'synthetic-artifact', size: 509 }))
      const readState = runtime.host.readState.bind(runtime.host)
      vi.spyOn(runtime.host, 'readState').mockImplementation(async () => {
        const state = await readState()
        return { ...state, inventory: { ...state.inventory, items: state.inventory.items.map(item => ({ ...item, source: 'market-cache-file' as const, localIdentity: 'file' })) } }
      })
      const install = vi.spyOn(runtime.host, 'install').mockImplementation(async request => {
        installed.set(request.artifact.packageName, { name: request.artifact.packageName, version: request.artifact.version, installed: true, enabled: request.enabled, removable: true, rows: [], overrides: [] })
        return { kind: 'applied', changed: true, restartRequired: false, permissionChanges: [] }
      })
      const plan = await runtime.planCreate({ selections }, 'owner')
      if (plan.status !== 'ready') throw new Error(JSON.stringify(plan))
      const task = await runtime.taskStart({ planId: plan.plan.planId, planDigest: plan.plan.planDigest, confirmed: true, idempotencyKey: 'multi-step' }, 'owner')
      const settled = await settledTask(runtime, task.taskId)
      expect(settled.status, JSON.stringify(settled)).toBe('completed')
      expect(install).toHaveBeenCalledTimes(2)
    }, 2)
  })

  it('核心未知不伪装已适配，保留原显式计划确认门槛', async () => {
    await releaseFixture(async ({ runtime, selections, setVersion }) => {
      setVersion(null)
      const options = await runtime.releaseOptions({ packageName: selections[0]!.packageName })
      expect(options.releases[0]!.compatibility.status).toBe('unknown')
      const plan = await runtime.planCreate({ selections }, 'owner')
      expect(plan.status).toBe('ready')
      if (plan.status !== 'ready') throw new Error(JSON.stringify(plan))
      const download = vi.spyOn(runtime.artifacts, 'acquire')
      await expect(runtime.taskStart({ planId: plan.plan.planId, planDigest: plan.plan.planDigest, confirmed: false as unknown as true, idempotencyKey: 'unknown-unconfirmed' }, 'owner')).rejects.toMatchObject({ code: 'plan/not-confirmed' })
      expect(download).not.toHaveBeenCalled()
    })
  })

  it('真实stale列表即使上下文一致仍拒绝新版选择；旧调用方策略不全局改变', async () => {
    await releaseFixture(async ({ runtime, selections, officialWrites }) => {
      const captured = structuredClone(runtime.catalog.sourceSnapshot())
      Object.assign(captured.snapshot, { stale: true })
      vi.spyOn(runtime.catalog, 'sourceSnapshot').mockReturnValue(captured)
      const options = await runtime.releaseOptions({ packageName: selections[0]!.packageName })
      expect(options.context.catalogStale).toBe(true)
      const release = options.releases[0]!
      const releaseContext = { context: options.context, identity: release.identity, sources: release.sources }
      const download = vi.spyOn(runtime.artifacts, 'acquire')
      expect(await runtime.planCreate({ selections: [{ ...selections[0]!, releaseContext }] }, 'owner')).toMatchObject({ status: 'blocked', reason: expect.stringContaining('过期目录') })
      expect(await runtime.planCreate({ selections }, 'owner')).toMatchObject({ status: 'ready' })
      expect(download).not.toHaveBeenCalled()
      expect(officialWrites).not.toHaveBeenCalled()
      expect(await runtime.taskList()).toEqual([])
    })
  })

  it('真实库存相同数量的版本/启停变化也产生不同revision，旧列表不能重用', async () => {
    await releaseFixture(async ({ runtime, selections, installed }) => {
      installed.set('unrelated', { name: 'unrelated', version: '1.0.0', installed: true, enabled: false, removable: true, rows: [], overrides: [] })
      const options = await runtime.releaseOptions({ packageName: selections[0]!.packageName })
      const releaseContext = { context: options.context, identity: options.releases[0]!.identity, sources: options.releases[0]!.sources }
      installed.get('unrelated')!.version = '2.0.0'
      installed.get('unrelated')!.enabled = true
      expect((await runtime.releaseOptions({ packageName: selections[0]!.packageName })).context.inventoryRevision).not.toBe(options.context.inventoryRevision)
      expect(await runtime.planCreate({ selections: [{ ...selections[0]!, releaseContext }] }, 'owner')).toMatchObject({ status: 'stale' })
    })
  })

  it('官方条目顺序变化保守失效；稳定排序反复读取保持相同revision', async () => {
    await releaseFixture(async ({ runtime, selections, installed }) => {
      installed.set('first', { name: 'first', version: '1.0.0', installed: true, enabled: false, removable: true, rows: [], overrides: [] })
      installed.set('second', { name: 'second', version: '1.0.0', installed: true, enabled: false, removable: true, rows: [], overrides: [] })
      const first = await runtime.releaseOptions({ packageName: selections[0]!.packageName })
      expect((await runtime.releaseOptions({ packageName: selections[0]!.packageName })).context.inventoryRevision).toBe(first.context.inventoryRevision)
      const record = installed.get('first')!
      installed.delete('first')
      installed.set('first', record)
      expect((await runtime.releaseOptions({ packageName: selections[0]!.packageName })).context.inventoryRevision).not.toBe(first.context.inventoryRevision)
      expect(await runtime.planCreate({ selections: [{ ...selections[0]!, releaseContext: { context: first.context, identity: first.releases[0]!.identity, sources: first.releases[0]!.sources } }] }, 'owner')).toMatchObject({ status: 'stale' })
    })
  })

  it('publication未知仍允许原确认fallback，不把列表selectable当作兼容硬阻断', async () => {
    await releaseFixture(async ({ runtime, selections }) => {
      const captured = structuredClone(runtime.catalog.sourceSnapshot())
      Object.assign(captured.snapshot.plugins[0]!, { publication: 'unknown' })
      vi.spyOn(runtime.catalog, 'sourceSnapshot').mockReturnValue(captured)
      const options = await runtime.releaseOptions({ packageName: selections[0]!.packageName })
      const release = options.releases[0]!
      expect(release.selectable).toBe(false)
      expect(release.blockers).toContain('release-publication-unknown')
      expect(release.compatibility.status).toBe('compatible')
      const plan = await runtime.planCreate({ selections: [{ ...selections[0]!, releaseContext: { context: options.context, identity: release.identity, sources: release.sources } }] }, 'owner')
      expect(plan.status).toBe('ready')
      if (plan.status !== 'ready') throw new Error(JSON.stringify(plan))
      const acquire = vi.spyOn(runtime.artifacts, 'acquire')
      await expect(runtime.taskStart({ planId: plan.plan.planId, planDigest: plan.plan.planDigest, confirmed: false as unknown as true, idempotencyKey: 'publication-unconfirmed' }, 'owner')).rejects.toMatchObject({ code: 'plan/not-confirmed' })
      expect(acquire).not.toHaveBeenCalled()
    })
  })
})
