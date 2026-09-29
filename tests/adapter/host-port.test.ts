import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshManagerAdapter } from '../../packages/market/src/adapters/dsh/manager.ts'
import { OfficialHostPort, mapOfficialChange, redactDiagnostic } from '../../packages/market/src/adapters/dsh/host-port.ts'
import { AtomicProfileLocks, NodePersistenceFiles } from '../../packages/market/src/adapters/dsh/persistence-adapter.ts'
import { pendingBuildsDigest } from '../../packages/market/src/core/canonical.ts'
import type { HostInstallRequest } from '../../packages/market/src/core/ports.ts'

function context(manager: unknown) {
  return {
    profileContext: { dir: 'D:/isolated/profile', name: 'desktop' },
    get: (key: string) => key === 'pluginManager' ? manager : undefined,
  } as never
}

function installRequest(): HostInstallRequest {
  return {
    requestId: 'request-test',
    enabled: true,
    artifact: {
      pluginId: 'p0',
      packageName: '@test/plugin',
      version: '1.0.0',
      artifactDigest: 'a'.repeat(64),
      localRef: 'D:/cache/test.tgz',
      size: 1,
    },
  }
}

describe('official HostPort mapping', () => {
  it('uses the same SHA-256 approval challenge as the task runner', async () => {
    const installBundle = vi.fn(async () => ({
      changed: false,
      application: 'failed',
      stage: 'install',
      target: '@test/plugin',
      pendingBuilds: ['zod', 'esbuild'],
    }))
    const result = await mapOfficialChange(await installBundle() as never)
    expect(result.kind).toBe('awaiting-approval')
    if (result.kind !== 'awaiting-approval') throw new Error('unreachable')
    expect(result.pendingBuilds).toEqual(['esbuild', 'zod'])
    expect(result.pendingBuildsDigest).toBe(await pendingBuildsDigest(['esbuild', 'zod']))
  })

  it('maps the 0.1.7 result shape and an additive 0.2.0 shape without dropping fields', async () => {
    const base = {
      changed: true,
      application: 'applied',
      stage: 'install',
      target: '@test/plugin',
      bundle: '@test/plugin',
      packageResult: { exitCode: 0, output: 'done', truncated: false, logPath: 'D:/logs/install.log' },
    }
    expect(await mapOfficialChange(base)).toMatchObject({ kind: 'applied', changed: true, restartRequired: false })
    expect(await mapOfficialChange({ ...base, schemaVersion: 2, hostStyle: '0.2.0' })).toMatchObject({
      kind: 'applied',
      packageResultCode: 'exit-0',
    })
  })

  it('keeps a changed future result shape unknown instead of guessing success', async () => {
    const result = await mapOfficialChange({
      schemaVersion: 2,
      outcome: { status: 'applied', changed: true },
      operation: 'install',
      package: '@test/plugin',
    })
    expect(result.kind).toBe('unknown')
    if (result.kind !== 'unknown') throw new Error('unreachable')
    expect(result.errorCode).toBe('protocol/shape')
    expect(result.diagnostic).toContain('schemaVersion')
    expect(result.diagnostic).toContain('outcome')
  })

  it('does not turn overridden into success', async () => {
    const installBundle = vi.fn(async () => ({
      changed: true,
      application: 'overridden',
      stage: 'install',
      target: '@test/plugin',
    }))
    const result = await mapOfficialChange(await installBundle() as never)
    expect(result.kind).toBe('unknown')
    if (result.kind !== 'unknown') throw new Error('unreachable')
    expect(result.error).toContain('overridden')
  })

  it('does not invent script permission changes from requested approvals', async () => {
    const outcome = await mapOfficialChange({ application: 'failed', changed: false, stage: 'install', target: 'test', error: { code: 'stale-approval' } }, ['requested-only'])
    expect(outcome.permissionChanges).toEqual([])
  })

  it('does not map an unknown error code to success', async () => {
    const outcome = await mapOfficialChange({
      changed: true,
      application: 'applied',
      stage: 'install',
      target: '@test/plugin',
      error: { code: 'future-error-code', diagnostic: 'official said no' },
    })
    expect(outcome).toMatchObject({
      kind: 'failed',
      errorCode: 'future-error-code',
      unknownSharedImpact: true,
    })
  })

  it('reports only capabilities the official manager actually exposes', () => {
    const port = new OfficialHostPort(context({}))
    const capabilities = port.capabilities()
    expect(capabilities).not.toContain('browse')
    expect(capabilities).not.toContain('install')
    expect(capabilities).not.toContain('remove')
  })

  it('returns real unknown outcomes when official methods are missing', async () => {
    const port = new OfficialHostPort(context({}))
    expect(await port.install(installRequest())).toMatchObject({ kind: 'unknown', errorCode: 'adapter/capability-unavailable' })
    expect(await port.setEnabled('@test/plugin', true)).toMatchObject({ kind: 'unknown' })
    expect(await port.remove('@test/plugin')).toMatchObject({ kind: 'unknown', errorCode: 'adapter/capability-unavailable' })
    const inventory = await new DshManagerAdapter(context({})).inventory('env-test')
    expect(inventory.items).toEqual([])
    expect(inventory.unknownItems).toEqual(expect.arrayContaining([
      'listBundles:unavailable',
      'listPlugins:unavailable',
    ]))
    expect((await new DshManagerAdapter(context(undefined)).inventory('env-test')).unknownItems).toContain('pluginManager:unavailable')
  })

  it('calls removeBundle with exactly one argument', async () => {
    const removeBundle = vi.fn(async (...args: unknown[]) => {
      expect(args).toHaveLength(1)
      return { changed: true, application: 'applied', stage: 'remove', target: '@test/plugin' }
    })
    const port = new OfficialHostPort(context({
      listBundles: async () => [],
      listPlugins: async () => [],
      removeBundle,
    }))
    const result = await port.remove('@test/plugin')
    expect(removeBundle).toHaveBeenCalledWith('@test/plugin')
    expect(removeBundle.mock.calls[0]).toHaveLength(1)
    expect(result).toMatchObject({ application: 'applied' })
  })

  it('preserves bounded failure diagnostics while redacting secrets and paths', async () => {
    const outcome = await mapOfficialChange({
      changed: false,
      application: 'failed',
      stage: 'install',
      target: '@test/plugin',
      error: {
        code: 'future-error-code',
        diagnostic: 'request failed at D:/users/me/profile password=hunter2',
      },
      packageResult: {
        exitCode: 1,
        output: 'Bearer abc.def.ghi token=another-secret',
        truncated: false,
        logPath: 'D:/logs/install.log',
        kind: 'network',
      },
      failedAt: 'registry',
    })
    expect(outcome.kind).toBe('failed')
    if (outcome.kind !== 'failed') throw new Error('unreachable')
    expect(outcome.errorCode).toBe('future-error-code')
    expect(outcome.diagnostic).toContain('request failed')
    expect(outcome.diagnostic).toContain('log:')
    expect(outcome.diagnostic).toContain('failedAt:registry')
    expect(outcome.diagnostic).not.toContain('hunter2')
    expect(outcome.diagnostic).not.toContain('another-secret')
    expect(outcome.diagnostic).not.toContain('D:/users')
    expect(redactDiagnostic('https://user:pass@example.test/x')).not.toContain('pass')
  })
})

describe('lazy official atomic-write capability', () => {
  it('fails loud without a safe non-atomic fallback when the official module is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adapter-atomic-'))
    const loader = vi.fn(async () => { throw new Error('synthetic missing module') })
    const files = new NodePersistenceFiles(join(root, 'state'), loader)
    await expect(files.writeAtomic('state.json', new TextEncoder().encode('{}'))).rejects.toMatchObject({
      code: 'persistence/atomic-write-unavailable',
    })
    expect(await files.read('state.json')).toBeUndefined()

    const locks = new AtomicProfileLocks(root, 100, loader)
    await expect(locks.acquire('profile', 'test')).rejects.toMatchObject({
      code: 'persistence/atomic-write-unavailable',
    })
  })

  it('rejects a partial atomic-write signature instead of weakening lock semantics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'adapter-atomic-partial-'))
    const files = new NodePersistenceFiles(join(root, 'state'), async () => ({
      writeFileAtomic: vi.fn(async () => undefined),
    }))
    await expect(files.writeAtomic('state.json', new TextEncoder().encode('{}'))).rejects.toMatchObject({
      code: 'persistence/atomic-write-unavailable',
    })
    expect(await files.read('state.json')).toBeUndefined()
  })
})
