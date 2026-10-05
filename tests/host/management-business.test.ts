import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AtomicProfileLocks, NodePersistenceFiles } from '../../packages/market-core/src/adapters/dsh/persistence-adapter.ts'
import type { PluginActionRecoveryRequest } from '../../packages/market-core/src/contracts/types.ts'
import type { ManagementRecord } from '../../packages/market-core/src/core/execution-state.ts'
import type { HostInstallOutcome } from '../../packages/market-core/src/core/ports.ts'
import { MAINTENANCE_INTENT_PATH, MaintenanceIntentStore } from '../../packages/market-core/src/core/maintenance-intent-store.ts'
import { decodeManagementRecord } from '../../packages/market-core/src/core/management-record.ts'
import { MarketRuntime } from '../../packages/market-core/src/host/market-runtime.ts'
import { context, embedded, freshDirectory, identity, removeDirectory } from '../core-api/helpers.ts'

type Action = 'enable' | 'disable' | 'remove'
const packageName = 'management-business-fixture'
const permissions = [{ packageName: 'business-build', decision: 'approved' as const }]

async function scenario(action: Action, run: (fixture: {
  runtime: MarketRuntime
  restart: () => MarketRuntime
  request: PluginActionRecoveryRequest
  invoke: (runtime?: MarketRuntime) => ReturnType<MarketRuntime['pluginSetEnabled']>
  writes: Action[]
  record: () => ManagementRecord
  replaceRecord: (record: ManagementRecord) => void
  setEnabled: (enabled: boolean) => void
  setInstalled: (installed: boolean) => void
}) => Promise<void>, application = 'applied', outcome?: HostInstallOutcome): Promise<void> {
  const directory = freshDirectory()
  const dataDirectory = join(directory, 'market')
  const writes: Action[] = []
  let installed = true
  let enabled = action === 'disable'
  const manager = {
    listBundles: async () => installed ? [{ name: packageName, version: '1.0.0', installed, enabled, removable: true, rows: [], overrides: [] }] : [],
    listPlugins: async () => [],
    setBundleEnabled: async (_name: string, next: boolean) => {
      writes.push(next ? 'enable' : 'disable')
      if (outcome === undefined || 'changed' in outcome && outcome.changed) enabled = next
      return outcome ?? { application, changed: true, stage: 'enable', target: packageName, approvedBuilds: ['business-build'] }
    },
    removeBundle: async () => {
      writes.push('remove')
      if (outcome === undefined || 'changed' in outcome && outcome.changed) installed = false
      return outcome ?? { application, changed: true, stage: 'remove', target: packageName, approvedBuilds: ['business-build'] }
    },
  }
  const runtimes: MarketRuntime[] = []
  const restart = (): MarketRuntime => {
    const runtime = new MarketRuntime(context(directory, manager), identity, dataDirectory, { embeddedCatalog: embedded, catalogSources: [] })
    runtimes.push(runtime)
    return runtime
  }
  const runtime = restart()
  const request = { packageName, expectedVersion: '1.0.0', action, idempotencyKey: 'business-original' }
  const invoke = (current = runtime) => action === 'remove'
    ? current.pluginRemove({ ...request, confirmed: true })
    : current.pluginSetEnabled({ ...request, enabled: action === 'enable' })
  const recordPath = () => {
    const root = join(dataDirectory, 'state', 'management')
    const names = readdirSync(root).filter(name => name.endsWith('.json'))
    expect(names).toHaveLength(1)
    return join(root, names[0]!)
  }
  const record = (): ManagementRecord => JSON.parse(readFileSync(recordPath(), 'utf8')) as ManagementRecord
  try {
    await runtime.taskList()
    if (action === 'remove') await new MaintenanceIntentStore(new NodePersistenceFiles(join(dataDirectory, 'state')), new AtomicProfileLocks(dataDirectory)).setExplicit(packageName, true)
    await run({ runtime, restart, request, invoke, writes, record, replaceRecord: value => writeFileSync(recordPath(), JSON.stringify(value)), setEnabled: value => { enabled = value }, setInstalled: value => { installed = value } })
  } finally {
    vi.restoreAllMocks()
    await Promise.all(runtimes.map(current => current.taskList()))
    removeDirectory(directory)
  }
}

describe.each<Action>(['enable', 'disable', 'remove'])('管理完整业务凭证：%s', action => {
  it.each(['applied', 'restart-required'])('持久%s、维护提交及权限；只读恢复和重复原请求不依赖当前库存', async application => {
    await scenario(action, async ({ runtime, request, invoke, writes, record, setEnabled }) => {
      const result = await invoke()
      expect(result).toMatchObject({ status: application, changed: true, permissionChanges: permissions })
      expect(record().completion).toMatchObject({ result, maintenance: { status: 'saved', revision: expect.any(Number) }, digest: expect.stringMatching(/^[a-f0-9]{64}$/) })
      setEnabled(action !== 'enable')
      const read = vi.spyOn(runtime.host, 'readState').mockRejectedValue(new Error('must not infer historical business result'))
      const save = vi.spyOn(NodePersistenceFiles.prototype, 'writeAtomic').mockRejectedValue(new Error('recovery must be read only'))
      expect(await runtime.pluginActionRecover(request)).toMatchObject({ status: 'found', stage: 'settled', receipt: result, result })
      expect(await invoke()).toEqual(result)
      expect(await runtime.pluginActionRecover(request)).toMatchObject({ status: 'found', result })
      expect(read).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
      expect(writes).toEqual([action])
    }, application)
  })

  it('Runtime重建恢复完整原业务结果，不重放官方动作', async () => {
    await scenario(action, async ({ restart, request, invoke, writes }) => {
      const result = await invoke()
      const recreated = restart()
      await recreated.taskList()
      const save = vi.spyOn(NodePersistenceFiles.prototype, 'writeAtomic').mockRejectedValue(new Error('must not save during query'))
      expect(await recreated.pluginActionRecover(request)).toMatchObject({ status: 'found', result })
      expect(await invoke(recreated)).toEqual(result)
      expect(save).not.toHaveBeenCalled()
      expect(writes).toEqual([action])
    })
  })

  it('维护写盘失败保留官方事实与旧unknown；恢复不偷偷修复，明确原请求可以补提交但不重放官方动作', async () => {
    await scenario(action, async ({ runtime, restart, request, invoke, writes, record }) => {
      const original = NodePersistenceFiles.prototype.writeAtomic
      const failure = vi.spyOn(NodePersistenceFiles.prototype, 'writeAtomic').mockImplementation(async function (path, bytes) {
        if (path === MAINTENANCE_INTENT_PATH) throw new Error('maintenance failed token=private-value')
        return original.call(this, path, bytes)
      })
      expect(await invoke()).toMatchObject({ status: 'unknown', changed: true, errorCode: 'management/maintenance-save-failed' })
      expect(record()).not.toHaveProperty('completion')
      failure.mockRestore()
      const recreated = restart()
      await recreated.taskList()
      const save = vi.spyOn(NodePersistenceFiles.prototype, 'writeAtomic')
      expect(await recreated.pluginActionRecover(request)).toMatchObject({ status: 'found', receipt: { status: 'applied', changed: true }, result: { status: 'unknown' } })
      expect(save).not.toHaveBeenCalled()
      expect(await invoke(recreated)).toMatchObject({ status: 'applied', changed: true })
      expect(record().completion?.maintenance.status).toBe('saved')
      expect(await runtime.pluginActionRecover(request)).toMatchObject({ status: 'found', result: { status: 'applied' } })
      expect(writes).toEqual([action])
    })
  })

  it('最终业务凭证写盘失败不伪报成功；重建与只读核对仍unknown', async () => {
    await scenario(action, async ({ runtime, restart, request, invoke, writes, record }) => {
      const original = NodePersistenceFiles.prototype.writeAtomic
      const failure = vi.spyOn(NodePersistenceFiles.prototype, 'writeAtomic').mockImplementation(async function (path, bytes) {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ManagementRecord>
        if (path.startsWith('management/') && parsed.completion !== undefined) throw new Error('final receipt failed token=private-value')
        return original.call(this, path, bytes)
      })
      const result = await invoke()
      expect(result).toMatchObject({ status: 'unknown', changed: true, permissionChanges: permissions, errorCode: 'management/business-result-save-failed' })
      expect(result.diagnostic).not.toContain('private-value')
      expect(record()).not.toHaveProperty('completion')
      expect(await runtime.pluginActionRecover(request)).toMatchObject({ status: 'found', result: { status: 'unknown', errorCode: 'management/business-result-unavailable' } })
      failure.mockRestore()
      const recreated = restart()
      await recreated.taskList()
      expect(await recreated.pluginActionRecover(request)).toMatchObject({ status: 'found', result: { status: 'unknown' } })
      expect(writes).toEqual([action])
    })
  })

  it('旧回执不能在已变化的目标上补写维护状态', async () => {
    await scenario(action, async ({ runtime, request, invoke, writes, record, replaceRecord, setEnabled, setInstalled }) => {
      await invoke()
      const { completion: _completion, ...legacy } = record()
      replaceRecord(legacy)
      if (action === 'remove') setInstalled(true)
      else setEnabled(action !== 'enable')
      const maintenance = vi.spyOn(MaintenanceIntentStore.prototype, 'setExplicit')
      expect(await invoke()).toMatchObject({ status: 'unknown', changed: true })
      expect(maintenance).not.toHaveBeenCalled()
      expect(await runtime.pluginActionRecover(request)).toMatchObject({ status: 'found', result: { status: 'unknown' } })
      expect(writes).toEqual([action])
    })
  })

  it.each([false, true])('已核实failed changed=%s无需维护提交，保存完整失败和权限并去敏', async changed => {
    await scenario(action, async ({ runtime, request, invoke, writes, record }) => {
      const maintenance = vi.spyOn(MaintenanceIntentStore.prototype, action === 'remove' ? 'clearPackage' : 'setExplicit')
      const result = await invoke()
      expect(result).toMatchObject({ status: 'failed', changed, permissionChanges: permissions, errorCode: 'official/business-test' })
      expect(result.error).not.toContain('private-value')
      expect(result.diagnostic).not.toContain('private-value')
      expect(record().completion?.maintenance).toEqual({ status: 'not-required' })
      expect(maintenance).not.toHaveBeenCalled()
      expect(await runtime.pluginActionRecover(request)).toMatchObject({ status: 'found', result })
      expect(await invoke()).toEqual(result)
      expect(writes).toEqual([action])
    }, 'failed', { kind: 'failed', changed, error: 'official failed token=private-value', errorCode: 'official/business-test', diagnostic: 'official detail token=private-value', permissionChanges: permissions })
  })
})

it('维护提交和完整凭证保存都处于同一execution锁内', async () => {
  await scenario('enable', async ({ invoke, record }) => {
    const acquire = AtomicProfileLocks.prototype.acquire
    let executionHeld = 0
    const events: string[] = []
    vi.spyOn(AtomicProfileLocks.prototype, 'acquire').mockImplementation(async function (name, owner) {
      const handle = await acquire.call(this, name, owner)
      if (!name.startsWith('execution:')) return handle
      executionHeld++
      return { ...handle, release: async () => { events.push('release'); executionHeld--; await handle.release() } }
    })
    const write = NodePersistenceFiles.prototype.writeAtomic
    vi.spyOn(NodePersistenceFiles.prototype, 'writeAtomic').mockImplementation(async function (path, bytes) {
      if (path === MAINTENANCE_INTENT_PATH) { expect(executionHeld).toBe(1); events.push('maintenance') }
      if (path.startsWith('management/') && (JSON.parse(new TextDecoder().decode(bytes)) as ManagementRecord).completion !== undefined) {
        expect(executionHeld).toBe(1)
        events.push('completion')
      }
      return write.call(this, path, bytes)
    })
    await invoke()
    expect(events.indexOf('completion')).toBeGreaterThan(events.indexOf('maintenance'))
    expect(events.slice(events.indexOf('maintenance'))).toEqual(['maintenance', 'completion', 'release'])
    expect(record().completion?.maintenance.status).toBe('saved')
  })
})

it.each(['result', 'revision', 'digest', 'receipt', 'stage'] as const)('损坏完整业务凭证%s被严格拒绝，查询不写入', async field => {
  await scenario('enable', async ({ runtime, request, invoke, writes, record, replaceRecord }) => {
    await invoke()
    const saved = record()
    const bad = structuredClone(saved) as unknown as Record<string, unknown>
    const completion = bad.completion as Record<string, unknown>
    if (field === 'result') (completion.result as Record<string, unknown>).changed = false
    else if (field === 'revision') (completion.maintenance as Record<string, unknown>).revision = -1
    else if (field === 'digest') completion.digest = '0'.repeat(64)
    else if (field === 'receipt') (bad.receipt as Record<string, unknown>).changed = false
    else bad.stage = 'unknown'
    expect(() => decodeManagementRecord(new TextEncoder().encode(JSON.stringify(bad)))).toThrow()
    replaceRecord(bad as unknown as ManagementRecord)
    const save = vi.spyOn(NodePersistenceFiles.prototype, 'writeAtomic')
    await expect(runtime.pluginActionRecover(request)).rejects.toMatchObject({ code: 'management/corrupt' })
    expect(save).not.toHaveBeenCalled()
    expect(writes).toEqual(['enable'])
    replaceRecord(saved)
  })
})
