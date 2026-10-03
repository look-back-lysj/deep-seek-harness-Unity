import { describe, expect, it, vi } from 'vitest'
import type { IncompatibleBundleEvidence } from '../../packages/market-core/src/adapters/dsh/incompatible-evidence.ts'
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


// Captured code shape from the installed official Desktop 0.2.0-rc.1:
// plugin-manager managementError(ManagementFailure('incompatible-version', ...)).
function incompatibleBundle(overrides: Record<string, unknown> = {}) {
  return {
    name: '@test/old-skin', enabled: true, installed: true, optional: false, removable: true,
    error: { code: 'incompatible-version', incompatible: [{
      name: '@test/old-skin', version: '1.1.0', runtimeVersion: '0.2.0-rc.1',
      peers: { '@deepseek-ai/dsh': '0.1.7-rc.2' },
    }] },
    rows: [], overrides: [], ...overrides,
  }
}

function installedEvidence(overrides: Partial<IncompatibleBundleEvidence> = {}): IncompatibleBundleEvidence {
  return {
    packageName: '@test/old-skin', version: '1.1.0', dependencyRef: 'file:D:/isolated/cache/old-skin.tgz',
    peers: { '@deepseek-ai/dsh': '0.1.7-rc.2' }, fingerprint: 'same-host-local-metadata', sharedImpact: 'none', ...overrides,
  }
}

function diagnosticAdapter(bundles: unknown[], reader = vi.fn(async () => installedEvidence()), plugins: unknown[] = []) {
  const manager = { listBundles: vi.fn(async () => bundles), listPlugins: vi.fn(async () => plugins) }
  return { manager, reader, adapter: new DshManagerAdapter(context(manager), 'env-test', [], {
    hostVersion: '0.2.0-rc.1', readIncompatibleEvidence: reader,
  }) }
}

async function expectInventoryBlocked(adapter: DshManagerAdapter) {
  const inventory = await adapter.inventory()
  expect(inventory.unknownItems.length).toBeGreaterThan(0)
  return inventory
}

describe('official 0.2.0-rc.1 incompatible bundle identity', () => {
  it('recognizes the exact refusal only after corroboration and keeps the package read-only, never cache-owned', async () => {
    const { adapter, reader, manager } = diagnosticAdapter([incompatibleBundle()])
    const inventory = await adapter.inventory()
    expect(inventory.unknownItems).toEqual([])
    expect(inventory.items).toEqual([expect.objectContaining({
      packageName: '@test/old-skin', version: '1.1.0', installed: true, bundleEnabled: true,
      readOnlyReason: 'unknown', removable: false, source: 'unknown', localIdentity: 'unknown', rows: [],
    })])
    expect(inventory.items[0]).not.toHaveProperty('artifactDigest')
    expect(reader).toHaveBeenCalledTimes(2)
    expect(manager.listBundles).toHaveBeenCalledTimes(2)
    expect(manager.listPlugins).toHaveBeenCalledTimes(2)
  })

  it('does not recover from the official payload alone or for an unverified Host version', async () => {
    const manager = { listBundles: async () => [incompatibleBundle()], listPlugins: async () => [] }
    await expectInventoryBlocked(new DshManagerAdapter(context(manager)))
    const reader = vi.fn(async () => installedEvidence())
    await expectInventoryBlocked(new DshManagerAdapter(context(manager), 'env-test', [], { hostVersion: '0.2.0-rc.2', readIncompatibleEvidence: reader }))
    expect(reader).not.toHaveBeenCalled()
  })

  it.each([
    ['unknown error with a version', { version: '1.1.0', error: { code: 'future-error' } }],
    ['operation error', { error: { code: 'operation-error', diagnostic: 'unreadable manifest' } }],
    ['future shared impact field', { unknownSharedImpact: true }],
    ['nonempty overrides', { overrides: ['shared-row'] }],
    ['nonempty rows', { rows: [{ rowId: 'shared', moduleName: 'other' }] }],
    ['invalid rows', { rows: {} }],
    ['version contradiction', { version: '2.0.0' }],
    ['wrong package identity', { name: '@test/other-skin' }],
    ['malformed installed', { installed: 'true' }],
    ['malformed removable', { removable: 'true' }],
    ['malformed optional', { optional: 'false' }],
  ])('keeps %s blocking', async (_name, change) => {
    await expectInventoryBlocked(diagnosticAdapter([incompatibleBundle(change)]).adapter)
  })

  it.each([
    ['wrong version', { version: '2.0.0' }],
    ['wrong package', { packageName: '@test/other-skin' }],
    ['missing source', { dependencyRef: '' }],
    ['unknown shared impact', { sharedImpact: 'unknown' as const }],
    ['conflicting peers', { peers: { '@deepseek-ai/dsh': '*' } }],
    ['missing fingerprint', { fingerprint: '' }],
  ])('keeps %s in local evidence blocking', async (_name, change) => {
    await expectInventoryBlocked(diagnosticAdapter([incompatibleBundle()], vi.fn(async () => installedEvidence(change))).adapter)
  })

  it.each([
    { code: 'incompatible-version', incompatible: [] },
    { code: 'incompatible-version', incompatible: [{ name: '@test/old-skin', version: '1.1.0', runtimeVersion: '0.1.7-rc.2', peers: { '@deepseek-ai/dsh': '0.1.7-rc.2' } }] },
    { code: 'incompatible-version', incompatible: [{ name: '@test/old-skin', version: '1.1.0', runtimeVersion: '0.2.0-rc.1', peers: [] }] },
    { code: 'incompatible-version', incompatible: [{ name: '@test/old-skin', version: 'not-a-version', runtimeVersion: '0.2.0-rc.1', peers: { '@deepseek-ai/dsh': '0.1.7-rc.2' } }] },
  ])('rejects malformed or contradictory official incompatible details (%j)', async error => {
    await expectInventoryBlocked(diagnosticAdapter([incompatibleBundle({ error })]).adapter)
  })

  it('retains duplicate bundle identity and failed reads as unknown', async () => {
    await expectInventoryBlocked(diagnosticAdapter([incompatibleBundle(), incompatibleBundle()]).adapter)
    await expectInventoryBlocked(diagnosticAdapter([incompatibleBundle()], vi.fn(async () => { throw new Error('identity unreadable') })).adapter)
  })

  it('does not accept changing local evidence or a failing second read', async () => {
    const changed = vi.fn().mockResolvedValueOnce(installedEvidence()).mockResolvedValueOnce(installedEvidence({ fingerprint: 'changed' }))
    await expectInventoryBlocked(diagnosticAdapter([incompatibleBundle()], changed).adapter)
    const failed = vi.fn().mockResolvedValueOnce(installedEvidence()).mockRejectedValueOnce(new Error('disappeared'))
    await expectInventoryBlocked(diagnosticAdapter([incompatibleBundle()], failed).adapter)
  })

  it('does not accept changing official inventories or a failing second listing', async () => {
    const f = diagnosticAdapter([incompatibleBundle()])
    f.manager.listBundles.mockResolvedValueOnce([incompatibleBundle()]).mockResolvedValueOnce([incompatibleBundle({ enabled: false })])
    await expectInventoryBlocked(f.adapter)
    const g = diagnosticAdapter([incompatibleBundle()])
    g.manager.listPlugins.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('list outage'))
    await expectInventoryBlocked(g.adapter)
    const h = diagnosticAdapter([incompatibleBundle()])
    h.manager.listPlugins.mockResolvedValueOnce([]).mockResolvedValueOnce([{ entryId: 'new-entry' }])
    await expectInventoryBlocked(h.adapter)
  })

  it.each(['active', 'failed', 'loading', 'unloading', 'pending', 'unknown'])('does not recover while a rejected bundle has a live %s entry', async fiberPhase => {
    const plugins = [{ entryId: 'old-entry', moduleName: '@test/old-skin', enabled: true, fiberPhase }]
    await expectInventoryBlocked(diagnosticAdapter([incompatibleBundle()], vi.fn(async () => installedEvidence()), plugins).adapter)
  })

  it('does not recover around an unrelated transitioning entry', async () => {
    const plugins = [{ entryId: 'entry-other', moduleName: '@test/other', enabled: true, fiberPhase: 'loading' }]
    await expectInventoryBlocked(diagnosticAdapter([incompatibleBundle()], vi.fn(async () => installedEvidence()), plugins).adapter)
  })

  it('does not hide API errors even if a readable rejected bundle exists', async () => {
    const f = diagnosticAdapter([incompatibleBundle()])
    f.manager.listPlugins.mockRejectedValue(new Error('actual API read failed'))
    const inventory = await expectInventoryBlocked(f.adapter)
    expect(inventory.unknownItems.some(value => value.startsWith('listPlugins:'))).toBe(true)
  })

  it('leaves normal bundles, existing cache ownership and protected market packages unchanged', async () => {
    const normal = { name: '@test/normal', version: '1.0.0', installed: true, enabled: true, removable: true, rows: [], overrides: [] }
    const market = { ...normal, name: '@dsh-eac/market' }
    const core = { ...normal, name: '@dsh-eac/market-core' }
    const manager = { listBundles: async () => [normal, market, core], listPlugins: async () => [] }
    const evidence = [{ packageName: normal.name, version: normal.version, kind: 'market-cache-file' as const,
      receiptId: 'receipt', digest: 'digest', dependencyRef: 'file:cache.tgz', cacheRef: 'cache.tgz' }]
    const before = await new DshManagerAdapter(context(manager), 'env-test', evidence).inventory()
    const after = await new DshManagerAdapter(context(manager), 'env-test', evidence, {
      hostVersion: '0.2.0-rc.1', readIncompatibleEvidence: vi.fn(async () => installedEvidence()),
    }).inventory()
    expect(after).toEqual(before)
    expect(after.items[0]?.source).toBe('market-cache-file')
    expect(after.items.filter(item => item.packageName.startsWith('@dsh-eac/')).every(item => item.readOnlyReason === 'management-required')).toBe(true)
  })
})


describe('incompatible identity does not grant market ownership', () => {
  it('keeps a corroborated rejected bundle read-only even when an old receipt proves its cache artifact', async () => {
    const manager = { listBundles: async () => [incompatibleBundle()], listPlugins: async () => [] }
    const receipt = { packageName: '@test/old-skin', version: '1.1.0', kind: 'market-cache-file' as const,
      receiptId: 'prior-real-receipt', digest: 'a'.repeat(64), dependencyRef: 'file:cache.tgz', cacheRef: 'cache.tgz' }
    const adapter = new DshManagerAdapter(context(manager), 'env-test', [receipt], {
      hostVersion: '0.2.0-rc.1', readIncompatibleEvidence: async () => installedEvidence(),
    })
    const inventory = await adapter.inventory()
    expect(inventory.unknownItems).toEqual([])
    expect(inventory.items[0]).toMatchObject({ version: '1.1.0', source: 'unknown', readOnlyReason: 'unknown', removable: false })
    expect(inventory.items[0]).not.toHaveProperty('artifactDigest')
  })
})
