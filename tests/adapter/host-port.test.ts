import { describe, expect, it, vi } from 'vitest'
import { OfficialHostPort, mapOfficialChange } from '../../packages/market/src/adapters/dsh/host-port.ts'
import { pendingBuildsDigest } from '../../packages/market/src/core/canonical.ts'

function context(manager: unknown) {
  return {
    profileContext: { dir: 'D:/isolated/profile', name: 'desktop' },
    get: (key: string) => key === 'pluginManager' ? manager : undefined,
  } as never
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

  it('reports only capabilities the official manager actually exposes', () => {
    const port = new OfficialHostPort(context({}))
    const capabilities = port.capabilities()
    expect(capabilities).toContain('browse')
    expect(capabilities).not.toContain('install')
    expect(capabilities).not.toContain('remove')
  })
})
