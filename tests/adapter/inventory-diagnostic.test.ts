import { describe, expect, it, vi } from 'vitest'
import { DshManagerAdapter } from '../../packages/market-core/src/adapters/dsh/manager.ts'
import { mapOfficialChange, redactDiagnostic } from '../../packages/market-core/src/adapters/dsh/host-port.ts'

function context(manager: unknown) {
  return {
    profileContext: { dir: 'D:/isolated/profile', name: 'desktop' },
    get: (key: string) => key === 'pluginManager' ? manager : undefined,
  } as never
}

describe('AUD-F10/F11/F21 adapter evidence', () => {
  it('AUD-F11 joins bundle members by official entryId and keeps independent rows', async () => {
    const adapter = new DshManagerAdapter(context({
      listBundles: async () => [{
        name: 'bundle-a',
        version: '1.0.0',
        enabled: true,
        installed: true,
        optional: false,
        removable: true,
        rows: [{ rowId: 'row-a', moduleName: 'pkg-a', entryId: 'entry-a' }],
        overrides: [],
      }],
      listPlugins: async () => [
        { entryId: 'entry-a', moduleName: 'pkg-a', enabled: true, fiberPhase: 'active', patchId: 'patch-a' },
        { entryId: 'entry-b', moduleName: 'pkg-b', enabled: false, fiberPhase: 'active', readOnlyReason: 'unaddressable' },
      ],
    }))
    const inventory = await adapter.inventory('env-test')
    const bundle = inventory.items.find((item) => item.packageName === 'bundle-a')
    expect(bundle?.rows[0]).toMatchObject({ rowId: 'row-a', moduleName: 'pkg-a', entryId: 'entry-a', fiberPhase: 'active', state: 'enabled' })
    expect(inventory.items.find((item) => item.packageName === 'pkg-b')).toMatchObject({
      pluginId: 'entry-b',
      bundleEnabled: false,
      rows: [{ entryId: 'entry-b', fiberPhase: 'active', state: 'disabled' }],
    })
  })

  it('AUD-F11 keeps load errors and unknown membership explicit', async () => {
    const adapter = new DshManagerAdapter(context({
      listBundles: async () => [{
        name: 'bundle-b',
        enabled: true,
        installed: true,
        optional: false,
        removable: true,
        rows: [
          { rowId: 'row-broken', moduleName: 'pkg-broken', entryId: 'entry-broken' },
          { rowId: 'row-missing', moduleName: 'pkg-missing' },
        ],
        overrides: [],
      }],
      listPlugins: async () => [{
        entryId: 'entry-broken',
        moduleName: 'pkg-broken',
        enabled: true,
        fiberPhase: 'failed',
        meta: { error: 'loader exploded' },
        patchId: 'patch-broken',
      }],
    }))
    const inventory = await adapter.inventory('env-test')
    const rows = inventory.items[0]?.rows ?? []
    expect(rows[0]).toMatchObject({ state: 'load-error', error: 'loader exploded' })
    expect(rows[1]).toMatchObject({ state: 'unknown', fiberPhase: null })
  })

  it('AUD-F21 distinguishes proven market cache from unproven local identity', async () => {
    const bundle = {
      listBundles: async () => [{
        name: 'pkg-local',
        version: '1.0.0',
        enabled: true,
        installed: true,
        optional: false,
        removable: true,
        rows: [],
        overrides: [],
      }],
      listPlugins: async () => [],
    }
    const unproven = await new DshManagerAdapter(context(bundle)).inventory('env-test')
    expect(unproven.items[0]).toMatchObject({ source: 'unknown', localIdentity: 'unknown' })
    const market = await new DshManagerAdapter(context(bundle), 'env-test', [
      { packageName: 'pkg-local', version: '1.0.0', kind: 'market-cache-file', receiptId: 'test-receipt', digest: 'test-digest', dependencyRef: 'file:cache.tgz', cacheRef: 'cache.tgz' },
    ]).inventory('env-test')
    expect(market.items[0]).toMatchObject({ source: 'market-cache-file', localIdentity: 'file' })
    const local = await new DshManagerAdapter(context(bundle), 'env-test', [
      { packageName: 'pkg-local', version: '1.0.0', kind: 'fork' },
    ]).inventory('env-test')
    expect(local.items[0]).toMatchObject({ source: 'unknown', localIdentity: 'fork' })
  })

  it('AUD-F10 preserves bounded redacted diagnostics and error codes', async () => {
    const installBundle = vi.fn(async () => ({
      changed: false,
      application: 'failed',
      stage: 'install',
      target: '@test/plugin',
      error: {
        code: 'operation-error',
        diagnostic: 'password=secret-value at D:/users/me/profile',
      },
      packageResult: {
        exitCode: 1,
        output: 'Bearer abc.def.ghi and token=another-secret',
        truncated: false,
        logPath: 'D:/logs/install.log',
        kind: 'network',
      },
    }))
    const result = await mapOfficialChange(await installBundle() as never)
    expect(result.kind).toBe('failed')
    if (result.kind !== 'failed') throw new Error('unreachable')
    expect(result.errorCode).toBe('operation-error')
    expect(result.diagnostic).toContain('log:')
    expect(result.diagnostic).not.toContain('secret-value')
    expect(result.diagnostic).not.toContain('another-secret')
    expect(result.diagnostic).not.toContain('D:/users')
    expect(redactDiagnostic('https://user:pass@example.test/x')).not.toContain('pass')
  })
})
