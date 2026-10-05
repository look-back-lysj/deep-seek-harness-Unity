import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AtomicProfileLocks, NodePersistenceFiles } from '../../packages/market-core/src/adapters/dsh/persistence-adapter.ts'
import type { ManagementRecord } from '../../packages/market-core/src/core/execution-state.ts'
import { MAINTENANCE_INTENT_PATH, MaintenanceIntentStore } from '../../packages/market-core/src/core/maintenance-intent-store.ts'
import { MarketRuntime } from '../../packages/market-core/src/host/market-runtime.ts'
import { context, embedded, freshDirectory, identity, removeDirectory } from '../core-api/helpers.ts'

type Action = 'enable' | 'disable' | 'remove'
const packageName = 'management-fixture'
const permissions = [{ packageName: 'management-build', decision: 'approved' }]

async function scenario(action: Action, run: (fixture: {
  runtime: MarketRuntime
  restart: () => MarketRuntime
  invoke: (runtime?: MarketRuntime) => ReturnType<MarketRuntime['pluginSetEnabled']>
  writes: Action[]
  record: () => ManagementRecord
}) => Promise<void>, application = 'applied'): Promise<void> {
  const directory = freshDirectory()
  const dataDirectory = join(directory, 'market')
  const writes: Action[] = []
  let installed = true
  let enabled = action === 'disable'
  const manager = {
    listBundles: async () => installed ? [{ name: packageName, version: '1.0.0', installed, enabled, removable: true, rows: [], overrides: [] }] : [],
    listPlugins: async () => [],
    setBundleEnabled: async (name: string, next: boolean) => {
      expect(name).toBe(packageName)
      writes.push(next ? 'enable' : 'disable')
      enabled = next
      return { application, changed: true, stage: 'enable', target: name, approvedBuilds: ['management-build'] }
    },
    removeBundle: async (name: string) => {
      expect(name).toBe(packageName)
      writes.push('remove')
      installed = false
      return { application, changed: true, stage: 'remove', target: name, approvedBuilds: ['management-build'] }
    },
  }
  const runtimes: MarketRuntime[] = []
  const restart = (): MarketRuntime => {
    const runtime = new MarketRuntime(context(directory, manager), identity, dataDirectory, { embeddedCatalog: embedded, catalogSources: [] })
    runtimes.push(runtime)
    return runtime
  }
  const runtime = restart()
  const invoke = (current = runtime) => action === 'remove'
    ? current.pluginRemove({ packageName, expectedVersion: '1.0.0', confirmed: true, idempotencyKey: 'management-once' })
    : current.pluginSetEnabled({ packageName, expectedVersion: '1.0.0', enabled: action === 'enable', idempotencyKey: 'management-once' })
  const record = (): ManagementRecord => {
    const root = join(dataDirectory, 'state', 'management')
    const names = readdirSync(root).filter(name => name.endsWith('.json'))
    expect(names).toHaveLength(1)
    return JSON.parse(readFileSync(join(root, names[0]!), 'utf8')) as ManagementRecord
  }
  try {
    await runtime.taskList()
    if (action === 'remove') {
      await new MaintenanceIntentStore(new NodePersistenceFiles(join(dataDirectory, 'state')), new AtomicProfileLocks(dataDirectory)).setExplicit(packageName, true)
    }
    await run({ runtime, restart, invoke, writes, record })
  } finally {
    vi.restoreAllMocks()
    await Promise.all(runtimes.map(current => current.taskList()))
    removeDirectory(directory)
  }
}

describe.each<Action>(['enable', 'disable', 'remove'])('management outcome: %s', action => {
  it('保留官方已变更事实和权限；维护写盘失败后同键及重建 Runtime 均不重放', async () => {
    await scenario(action, async ({ runtime, restart, invoke, writes, record }) => {
      const original = NodePersistenceFiles.prototype.writeAtomic
      const failure = vi.spyOn(NodePersistenceFiles.prototype, 'writeAtomic').mockImplementation(async function (this: NodePersistenceFiles, path, data) {
        if (path === MAINTENANCE_INTENT_PATH) throw new Error('injected maintenance save failure token=private-value')
        await original.call(this, path, data)
      })
      const first = await invoke()
      expect(first).toMatchObject({ status: 'unknown', changed: true, permissionChanges: permissions, errorCode: 'management/maintenance-save-failed' })
      expect(first.diagnostic).toContain('injected maintenance save failure')
      expect(first.diagnostic).not.toContain('private-value')
      expect(record()).toMatchObject({ stage: 'settled', outcome: { kind: 'applied', changed: true }, receipt: { kind: 'applied', changed: true } })
      expect(await invoke()).toMatchObject({ status: 'unknown', changed: true, permissionChanges: permissions })
      const recreated = restart()
      expect(await invoke(recreated)).toMatchObject({ status: 'unknown', changed: true, permissionChanges: permissions })
      expect(writes).toEqual([action])
      failure.mockRestore()
      expect(await invoke(recreated)).toMatchObject({ status: 'applied', changed: true, permissionChanges: permissions })
      const maintenance = await recreated.maintenanceStatus()
      if (action === 'remove') expect(maintenance.packages.filter(item => item.explicitState === 'explicit').map(item => item.packageName)).not.toContain(packageName)
      else expect(maintenance.packages.find(item => item.packageName === packageName)?.explicitState).toBe('explicit')
      expect(writes).toEqual([action])
      expect(await runtime.taskList()).toEqual([])
    })
  })

  it('官方写后 readState 抛错保留回执；连续故障与 Runtime 重建不重放，恢复后只核对', async () => {
    await scenario(action, async ({ runtime, restart, invoke, writes, record }) => {
      const inject = (current: MarketRuntime) => {
        const original = current.host.readState.bind(current.host)
        return vi.spyOn(current.host, 'readState').mockImplementation(async () => {
          if (writes.length > 0) throw new Error('injected post-write inventory outage')
          return original()
        })
      }
      const failure = inject(runtime)
      const first = await invoke()
      expect(first).toMatchObject({ status: 'unknown', changed: true, permissionChanges: permissions, errorCode: 'management/outcome-unverified' })
      expect(first.diagnostic).toContain('injected post-write inventory outage')
      expect(record()).toMatchObject({ stage: 'unknown', receipt: { kind: 'applied', changed: true } })
      expect(await invoke()).toMatchObject({ status: 'unknown', changed: true, permissionChanges: permissions })
      const recreated = restart()
      inject(recreated)
      expect(await invoke(recreated)).toMatchObject({ status: 'unknown', changed: true, permissionChanges: permissions })
      expect(writes).toEqual([action])
      failure.mockRestore()
      expect(await invoke()).toMatchObject({ status: 'applied', changed: true, permissionChanges: permissions })
      expect(record().stage).toBe('settled')
      expect(writes).toEqual([action])
    })
  })

  it('回执写盘失败也不能丢失刚收到的官方 changed:true；无回执旧记录禁止重放', async () => {
    await scenario(action, async ({ invoke, writes, record }) => {
      const original = NodePersistenceFiles.prototype.writeAtomic
      const failure = vi.spyOn(NodePersistenceFiles.prototype, 'writeAtomic').mockImplementation(async function (this: NodePersistenceFiles, path, data) {
        if (path.startsWith('management/') && writes.length > 0) throw new Error('injected receipt save failure')
        await original.call(this, path, data)
      })
      expect(await invoke()).toMatchObject({ status: 'unknown', changed: true, permissionChanges: permissions })
      expect(record()).toMatchObject({ stage: 'dispatched' })
      expect(record().receipt).toBeUndefined()
      failure.mockRestore()
      expect(await invoke()).toMatchObject({ status: 'unknown', changed: false })
      expect(writes).toEqual([action])
    })
  })

  it('写后库存可读但未证明目标状态时仍保留官方变更事实', async () => {
    await scenario(action, async ({ runtime, invoke, writes }) => {
      const original = runtime.host.readState.bind(runtime.host)
      vi.spyOn(runtime.host, 'readState').mockImplementation(async () => {
        const state = await original()
        return writes.length === 0 ? state : { ...state, inventory: { ...state.inventory, unknownItems: [`bundle-version:${packageName}`] } }
      })
      const result = await invoke()
      expect(result).toMatchObject({ status: 'unknown', changed: true, permissionChanges: permissions })
      expect(result.diagnostic).toContain('changed=true')
      expect(await invoke()).toMatchObject({ status: 'unknown', changed: true, permissionChanges: permissions })
      expect(writes).toEqual([action])
    })
  })

  it('写前 readState 故障仍为真正的零变更失败', async () => {
    await scenario(action, async ({ runtime, invoke, writes }) => {
      vi.spyOn(runtime.host, 'readState').mockRejectedValue(new Error('injected pre-write inventory outage'))
      expect(await invoke()).toMatchObject({ status: 'failed', changed: false, error: 'injected pre-write inventory outage', permissionChanges: [] })
      expect(writes).toEqual([])
    })
  })
})

it('维护保存失败保留官方 restart-required 事实而不是降为普通失败', async () => {
  await scenario('enable', async ({ invoke }) => {
    const original = NodePersistenceFiles.prototype.writeAtomic
    vi.spyOn(NodePersistenceFiles.prototype, 'writeAtomic').mockImplementation(async function (this: NodePersistenceFiles, path, data) {
      if (path === MAINTENANCE_INTENT_PATH) throw new Error('injected restart maintenance failure')
      await original.call(this, path, data)
    })
    const result = await invoke()
    expect(result).toMatchObject({ status: 'unknown', changed: true, permissionChanges: permissions })
    expect(result.diagnostic).toContain('restart-required')
  }, 'restart-required')
})

it('相同幂等键但不同内容不能借用原动作回执', async () => {
  await scenario('enable', async ({ runtime, invoke, writes, record }) => {
    expect(await invoke()).toMatchObject({ status: 'applied', changed: true })
    const original = record()
    expect(await runtime.pluginSetEnabled({ packageName, expectedVersion: '1.0.0', enabled: false, idempotencyKey: 'management-once' }))
      .toMatchObject({ status: 'failed', changed: false, error: expect.stringContaining('幂等键'), permissionChanges: [] })
    expect(writes).toEqual(['enable'])
    expect(record()).toEqual(original)
  })
})

it.each(['packageName', 'expectedVersion', 'remove'] as const)('同键不同%s连续拒绝并保留原回执，不另写入', async field => {
  await scenario('enable', async ({ runtime, invoke, writes, record }) => {
    expect(await invoke()).toMatchObject({ status: 'applied', changed: true })
    const original = record()
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = field === 'remove'
        ? await runtime.pluginRemove({ packageName, expectedVersion: '1.0.0', confirmed: true, idempotencyKey: 'management-once' })
        : await runtime.pluginSetEnabled({ packageName: field === 'packageName' ? 'another-management-fixture' : packageName,
          expectedVersion: field === 'expectedVersion' ? '2.0.0' : '1.0.0', enabled: true, idempotencyKey: 'management-once' })
      expect(result).toMatchObject({ status: 'failed', changed: false, error: expect.stringContaining('幂等键'), permissionChanges: [] })
      expect(record()).toEqual(original)
    }
    expect(writes).toEqual(['enable'])
    expect(await invoke()).toMatchObject({ status: 'applied', changed: true, permissionChanges: permissions })
    expect(writes).toEqual(['enable'])
  })
})

it('旧动作结果unknown不等于冲突的新请求已dispatch，冲突请求仍零变更失败', async () => {
  await scenario('enable', async ({ runtime, invoke, writes, record }) => {
    const originalRead = runtime.host.readState.bind(runtime.host)
    const outage = vi.spyOn(runtime.host, 'readState').mockImplementation(async () => {
      if (writes.length > 0) throw new Error('injected post-write inventory outage')
      return originalRead()
    })
    expect(await invoke()).toMatchObject({ status: 'unknown', changed: true, permissionChanges: permissions })
    const original = record()
    expect(original.stage).toBe('unknown')
    expect(await runtime.pluginSetEnabled({ packageName, expectedVersion: '1.0.0', enabled: false, idempotencyKey: 'management-once' }))
      .toMatchObject({ status: 'failed', changed: false, error: expect.stringContaining('幂等键'), permissionChanges: [] })
    expect(record()).toEqual(original)
    expect(writes).toEqual(['enable'])
    outage.mockRestore()
  })
})

it('恢复读取腐败仍为unknown，不因区分幂等冲突而伪装零写入失败', async () => {
  await scenario('enable', async ({ runtime, invoke, writes }) => {
    expect(await invoke()).toMatchObject({ status: 'applied', changed: true })
    const originalRead = NodePersistenceFiles.prototype.read
    vi.spyOn(NodePersistenceFiles.prototype, 'read').mockImplementation(async function (this: NodePersistenceFiles, path) {
      return path.startsWith('management/') ? new TextEncoder().encode('{corrupt') : originalRead.call(this, path)
    })
    expect(await runtime.pluginSetEnabled({ packageName, expectedVersion: '1.0.0', enabled: false, idempotencyKey: 'management-once' }))
      .toMatchObject({ status: 'unknown', changed: false, errorCode: 'management/outcome-unverified', permissionChanges: [] })
    expect(writes).toEqual(['enable'])
  })
})
