import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { HostCoreSnapshot } from '../../packages/market-core/src/contracts/types.ts'
import { readDshHostCore } from '../../packages/market/src/host-core.ts'

describe('DSH 运行时宿主核心快照', () => {
  it.each([
    '0.0.0', '1.2.3', '0.1.7-rc.2', '2.0.0-alpha', '2.0.0-alpha.1',
    '2.0.0-alpha.beta', '2.0.0-beta.11', '2.0.0-rc.1', '2.0.0-0.3.7',
    '2.0.0-x.7.z.92', '2.0.0-x-y-z.--', '1.2.3+001',
    '1.2.3+build.sha.5114f85', '0.1.7-rc.2+build.001.sha-abc',
    '999999999999999999999.2.3-999999999999999999999+001',
  ])('严格精确版本 %s 原样保留 prerelease 与 build', version => {
    const snapshot: HostCoreSnapshot = readDshHostCore(() => version)
    expect(snapshot).toEqual({
      agentId: 'dsh', agentName: 'DSH', version, versionScheme: 'semver',
      status: 'known', source: 'dsh-runtime-getter', hostRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    })
  })

  it.each([
    '', '1', '1.2', 'v1.2.3', '=1.2.3', '^1.2.3', '~1.2.3', '>=1.2.3',
    '1.2.x', '1.2.3 || 2.0.0', '01.2.3', '1.02.3', '1.2.03',
    '1.2.3-01', '1.2.3-alpha.01', '1.2.3-', '1.2.3+', '1.2.3-alpha..1',
    '1.2.3+build..1', '1.2.3+build_1', ' 1.2.3', '1.2.3 ', '1.2.3\n',
    '1.2.3\r\n', '1.2.3\u2028', '1.2.3\u0000',
  ])('非法或非精确版本 %j 不猜测、不修剪、不回退', version => {
    expect(readDshHostCore(() => version)).toMatchObject({
      agentId: 'dsh', agentName: 'DSH', version: null, versionScheme: 'semver',
      status: 'unknown', source: 'dsh-runtime-getter', reason: '无法确认 DSH 运行时版本。',
    })
  })

  it.each([undefined, null, 123, NaN, true, {}, ['1.2.3'], new String('1.2.3'), Symbol('version'), () => '1.2.3'])('非字符串类型 %# 保持未知', value => {
    expect(readDshHostCore(() => value)).toMatchObject({ version: null, status: 'unknown', reason: '无法确认 DSH 运行时版本。' })
  })

  it('类型错误不触发对象转换或读取候选版本属性', () => {
    const value = new Proxy({}, { get() { throw new Error('private-profile/token-secret') } })
    expect(readDshHostCore(() => value)).toEqual(readDshHostCore(() => null))
  })

  it('同值刷新稳定且每次真正调用 getter，不缓存结果', () => {
    let version: unknown = '0.1.7-rc.2+build.001'
    const readVersion = vi.fn(() => version)
    const first = readDshHostCore(readVersion)
    const refreshed = readDshHostCore(readVersion)
    expect(refreshed).toEqual(first)
    expect(refreshed).not.toBe(first)
    version = '0.1.7-rc.3+build.002'
    const changed = readDshHostCore(readVersion)
    expect(changed.version).toBe(version)
    expect(changed.hostRevision).not.toBe(first.hostRevision)
    version = undefined
    const unknown = readDshHostCore(readVersion)
    expect(unknown.status).toBe('unknown')
    expect(unknown.hostRevision).not.toBe(changed.hostRevision)
    version = first.version
    expect(readDshHostCore(readVersion)).toEqual(first)
    expect(readVersion).toHaveBeenCalledTimes(5)
  })

  it('仅 build 改变也更新 revision，不按 SemVer 排序等价吞掉变化', () => {
    expect(readDshHostCore(() => '1.2.3-rc.1+build.1').hostRevision)
      .not.toBe(readDshHostCore(() => '1.2.3-rc.1+build.2').hostRevision)
  })

  it('canonical digest 包含 agent、原始 version、scheme、status 与 source', () => {
    for (const version of ['0.1.7-rc.2+build.001', null]) {
      const snapshot = readDshHostCore(() => version)
      const canonical = JSON.stringify({
        agentId: 'dsh', agentName: 'DSH', version, versionScheme: 'semver',
        status: version === null ? 'unknown' : 'known', source: 'dsh-runtime-getter',
      })
      expect(snapshot.hostRevision).toBe(`sha256:${createHash('sha256').update(canonical).digest('hex')}`)
      expect(Object.keys(snapshot).sort()).toEqual([
        'agentId', 'agentName', 'hostRevision', ...(version === null ? ['reason'] : []),
        'source', 'status', 'version', 'versionScheme',
      ].sort())
    }
  })

  it('敏感异常的 message、stack、路径和 token 不进入快照，也不读取异常属性', () => {
    const sensitive = 'C:\\Users\\private-profile\\secret.json token=private-token'
    const error = new Error(sensitive)
    error.stack = `private-stack ${sensitive}`
    const inaccessible = new Proxy({}, { get() { throw error } })
    const reference = readDshHostCore(() => undefined)
    for (const thrown of [error, sensitive, { path: sensitive, token: 'private-token' }, inaccessible]) {
      const readVersion = vi.fn(() => { throw thrown })
      const snapshot = readDshHostCore(readVersion)
      expect(snapshot).toEqual(reference)
      expect(JSON.stringify(snapshot)).not.toMatch(/private-profile|secret\.json|private-token|private-stack/)
      expect(readVersion).toHaveBeenCalledTimes(1)
    }
  })

  it('未知原因与失败内容不影响 revision，同一 getter 失败后可重新读取', () => {
    const readVersion = vi.fn<() => unknown>()
      .mockImplementationOnce(() => { throw new Error('private failure') })
      .mockReturnValueOnce({ desktopVersion: '0.2.0-rc.1', coreVersion: '0.1.6' })
      .mockReturnValueOnce('invalid')
      .mockReturnValueOnce('0.1.7-rc.2')
    const failed = readDshHostCore(readVersion)
    expect(readDshHostCore(readVersion)).toEqual(failed)
    expect(readDshHostCore(readVersion)).toEqual(failed)
    const recovered = readDshHostCore(readVersion)
    expect(recovered).toMatchObject({ version: '0.1.7-rc.2', status: 'known' })
    expect(recovered.hostRevision).not.toBe(failed.hostRevision)
    expect(readVersion).toHaveBeenCalledTimes(4)
  })
})
