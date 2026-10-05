import { describe, expect, it } from 'vitest'
import type { EnvironmentHello, HostCoreSnapshot, ReleaseOptionsResult, UpdateCheckResult } from '../../packages/market-core/src/contracts/types.ts'
import { ADAPTER_PROTOCOL_VERSION, ADAPTER_PROVIDER_PROTOCOL_VERSION, HOST_REQUIRED_CORE_API_VERSION, REQUIRED_CORE_API_VERSION } from '../../packages/market/src/version.ts'
import { CORE_API_VERSION, supportsApiVersion } from '../../packages/market-core/src/contracts/compatibility.ts'

const remote = await import(new URL('../../packages/market/lib/typert.remote-client.js', import.meta.url).href) as {
  TYPERT_REMOTE: { descriptors: readonly { method: string; result: { create(): { safeParse(value: unknown): { success: boolean; data?: unknown } } } }[] }
}
const hostCore: HostCoreSnapshot = { agentId: 'dsh', agentName: 'DSH', version: '1.0.0', versionScheme: 'semver', status: 'known', hostRevision: `sha256:${'a'.repeat(64)}`, source: 'dsh-runtime-getter' }
const options: ReleaseOptionsResult = {
  packageName: '@test/wire', includePrerelease: false,
  context: { environmentId: 'fixture', hostRevision: hostCore.hostRevision, catalogRevision: 'r1', inventoryRevision: 'i1', checkedAt: '2026-10-03T00:00:00Z', catalogStale: false },
  hostCore, installed: { status: 'absent', version: null }, coverage: { historyCoverage: 'latest-only', obtainedRecords: 1, evaluatedRecords: 0, totalKnownRecords: null, reasons: ['research-only-records'] },
  latestPublished: null, latestCompatible: null, latestPublishedCandidates: [], latestCompatibleCandidates: [], publishedAmbiguous: false, compatibleAmbiguous: false,
  releases: [], issues: [], pagination: { cursor: null, hasMore: false },
}

function schema(method: string) {
  const descriptor = remote.TYPERT_REMOTE.descriptors.find(descriptor => descriptor.method === method)
  if (descriptor === undefined) throw new Error(`generated Remote 缺少 ${method}`)
  return descriptor.result.create()
}

describe('生成Remote与最低握手兼容矩阵', () => {
  it('Provider新增能力但旧Client握手仍可用，新Client也保留旧Host最低要求', () => {
    expect(ADAPTER_PROVIDER_PROTOCOL_VERSION).toBe('2.1.0')
    expect(ADAPTER_PROTOCOL_VERSION).toBe('2.0.0')
    expect(CORE_API_VERSION).toBe('1.1.0')
    expect(HOST_REQUIRED_CORE_API_VERSION).toBe('1.1.0')
    expect(REQUIRED_CORE_API_VERSION).toBe('1.0.0')
    expect(supportsApiVersion(ADAPTER_PROVIDER_PROTOCOL_VERSION, '2.0.0')).toBe(true)
    expect(supportsApiVersion('2.0.0', ADAPTER_PROTOCOL_VERSION)).toBe(true)
    expect(supportsApiVersion('1.0.0', REQUIRED_CORE_API_VERSION)).toBe(true)
    expect(supportsApiVersion('1.0.0', HOST_REQUIRED_CORE_API_VERSION)).toBe(false)
  })

  it('真实生成的严格schema接受known/unknown宿主、hello增量与版本列表', () => {
    expect(schema('hostCore').safeParse(hostCore).success).toBe(true)
    expect(schema('hostCore').safeParse({ ...hostCore, status: 'unknown', version: null, reason: 'host-core-version-unavailable' }).success).toBe(true)
    const hello: EnvironmentHello = { protocolVersion: '2.1.0', schemaVersion: '1', marketVersion: 'test-only', environmentId: 'fixture', profileName: 'synthetic', hostVersion: 'legacy-value', capabilities: ['host-release-options'], hostCore, coreApiVersion: '1.1.0' }
    expect(schema('hello').safeParse(hello).success).toBe(true)
    expect(schema('hello').safeParse({ ...hello, hostCore: undefined }).success).toBe(true)
    expect(schema('releaseOptions').safeParse(options).success).toBe(true)
  })

  it('生成codec按官方object规则剥离合同外字段，不传递默认选择、UI状态或私有路径', () => {
    for (const key of ['defaultReleaseId', 'modalStep', 'loading', 'polling', 'profileDir']) {
      const parsed = schema('releaseOptions').safeParse({ ...options, [key]: 'fixture' })
      expect(parsed.success).toBe(true)
      expect(parsed.data).not.toHaveProperty(key)
    }
    const parsed = schema('hostCore').safeParse({ ...hostCore, profileDir: 'C:/fixture/private' })
    expect(parsed.success).toBe(true)
    expect(parsed.data).not.toHaveProperty('profileDir')
  })

  it('checkUpdates增量事实通过真实codec，旧平面字段仍保留', () => {
    const result: UpdateCheckResult = { checkedAt: '2026-10-03T00:00:00Z', sourceRevision: 'r1', catalogStale: false, inventoryRevision: 'i1', items: [{ packageName: '@test/wire', status: 'up-to-date', installedVersion: '1.0.0', latestVersion: '1.0.0',
      releaseSummary: { hostCore, installed: { status: 'known', version: '1.0.0' }, historyCoverage: 'latest-only', latestPublished: null, latestCompatible: null, latestPublishedCompatibility: null, publishedAmbiguous: false, compatibleAmbiguous: false },
    }] }
    expect(schema('checkUpdates').safeParse(result).success).toBe(true)
  })
})
