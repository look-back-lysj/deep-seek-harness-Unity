import { describe, expect, it, vi } from 'vitest'
import { DshManagerAdapter } from '../../packages/market/src/adapters/dsh/manager.ts'
import { OfficialHostPort } from '../../packages/market/src/adapters/dsh/host-port.ts'

function context(manager: unknown) {
  return {
    profileContext: { dir: 'D:/isolated/profile', name: 'desktop' },
    get: (key: string) => key === 'pluginManager' ? manager : undefined,
  } as never
}

describe('AUD-F07/F09 adapter state mapping', () => {
  it('keeps pending runtime unknown without inventing a restart receipt', async () => {
    const adapter = new DshManagerAdapter(context({
      listBundles: async () => [{
        name: 'restart-bundle',
        enabled: true,
        installed: true,
        optional: false,
        removable: true,
        rows: [{ rowId: 'row', moduleName: 'member', entryId: 'entry' }],
        overrides: [],
      }],
      listPlugins: async () => [{
        entryId: 'entry',
        moduleName: 'member',
        enabled: true,
        fiberPhase: 'pending',
        patchId: 'patch',
      }],
    }))
    const inventory = await adapter.inventory('env-test')
    expect(inventory.items[0]).toMatchObject({ bundleEnabled: true, restartRequired: false })
    expect(inventory.items[0]?.rows[0]).toMatchObject({ state: 'unknown', fiberPhase: 'pending' })
  })

  it('AUD-F09 keeps failed and unknown activation results non-successful', async () => {
    const failedManager = {
      setBundleEnabled: vi.fn(async () => ({
        changed: false,
        application: 'failed',
        stage: 'enable',
        target: 'plugin',
        error: { code: 'operation-error' },
      })),
    }
    const failed = await new OfficialHostPort(context(failedManager)).setEnabled('plugin', false)
    expect(failed.kind).toBe('failed')

    const unknownManager = {
      setBundleEnabled: vi.fn(async () => ({ changed: false, stage: 'enable', target: 'plugin' })),
    }
    const unknown = await new OfficialHostPort(context(unknownManager)).setEnabled('plugin', true)
    expect(unknown.kind).toBe('unknown')
  })
})
