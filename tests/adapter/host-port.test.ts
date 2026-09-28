import { describe, expect, it, vi } from 'vitest'
import { OfficialHostPort } from '../../packages/market/src/adapters/dsh/host-port.ts'
import { pendingBuildsDigest } from '../../packages/market/src/core/canonical.ts'
import type { ArtifactAcquisition } from '../../packages/market/src/core/ports.ts'

const artifact: ArtifactAcquisition = {
  pluginId: 'plugin',
  packageName: '@test/plugin',
  version: '1.0.0',
  artifactDigest: 'sha256:0',
  localRef: 'D:/isolated/cache/plugin.tgz',
  size: 1,
}

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
    const port = new OfficialHostPort(context({ installBundle }))
    const result = await port.install({ requestId: 'request-1', artifact, enabled: true })
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
    const port = new OfficialHostPort(context({ installBundle }))
    const result = await port.install({ requestId: 'request-2', artifact, enabled: true })
    expect(result.kind).toBe('unknown')
    if (result.kind !== 'unknown') throw new Error('unreachable')
    expect(result.error).toContain('overridden')
  })

  it('reports only capabilities the official manager actually exposes', () => {
    const port = new OfficialHostPort(context({}))
    const capabilities = port.capabilities()
    expect(capabilities).toContain('browse')
    expect(capabilities).not.toContain('install')
    expect(capabilities).not.toContain('remove')
  })
})
