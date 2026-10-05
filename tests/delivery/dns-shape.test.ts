import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureDnsShape, captureLookupResult } from '../../tools/review-probes/dns-shape-20261004.mjs'
import { assertSafeRemoteUrl, safeFetch } from '../../packages/market-core/src/delivery/security.ts'

const dnsLookup = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup: dnsLookup }))

afterEach(() => vi.resetAllMocks())

describe('DNS 形状取证', () => {
  it('分别记录 Node record 和待核实的 string 数组，不混淆来源形状', () => {
    expect(captureLookupResult([{ address: '93.184.216.34', family: 4 }])).toEqual({
      shape: 'array', length: 1,
      entries: [{ shape: 'record', addressType: 'string', address: '93.184.216.34', kind: 4, family: 4 }],
    })
    expect(captureLookupResult(['93.184.216.34'])).toEqual({
      shape: 'array', length: 1,
      entries: [{ shape: 'string', addressType: 'string', address: '93.184.216.34', kind: 4 }],
    })
  })

  it('空、稀疏、invalid 和非数组答案保留异常形状，不输出任意非 IP 文本', () => {
    expect(captureLookupResult([])).toEqual({ shape: 'array', length: 0, entries: [] })
    expect(captureLookupResult(null)).toEqual({ shape: 'non-array', type: 'null' })
    expect(captureLookupResult('93.184.216.34')).toEqual({ shape: 'non-array', type: 'string' })
    expect(captureLookupResult([undefined, {}, { address: 'secret-invalid-text', family: 4 }])).toMatchObject({
      entries: [{ kind: 0 }, { kind: 0 }, { kind: 0, family: 4 }],
    })
    expect(JSON.stringify(captureLookupResult(['secret-invalid-text']))).not.toContain('secret-invalid-text')
    expect(captureLookupResult(new Array(1))).toMatchObject({ entries: [{ shape: 'invalid', kind: 0 }] })
  })

  it('只查 DNS 和显式传入的 gate，不请求 HTTP、不暴露模块路径或错误正文', async () => {
    const resolver = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const gate = vi.fn().mockRejectedValue(Object.assign(new Error('sensitive path'), { code: 'delivery/private-address' }))
    const fetcher = vi.spyOn(globalThis, 'fetch')
    try {
      const result = await captureDnsShape({
        lookup: resolver, assertSafeRemoteUrl: gate, hostnames: ['gitee.com'],
        resolve: () => 'file:///sensitive/profile/loader.mjs',
      })
      expect(resolver.mock.calls).toEqual([
        ['gitee.com', { all: true }], ['gitee.com', { all: true, order: 'verbatim' }],
      ])
      expect(gate).toHaveBeenCalledWith('https://gitee.com/')
      expect(result.hosts[0].gate).toMatchObject({ ok: false, error: { name: 'Error', code: 'delivery/private-address' } })
      expect(result.modules).toMatchObject([{ builtin: false, protocol: 'file:' }, { builtin: false, protocol: 'file:' }])
      expect(JSON.stringify(result)).not.toContain('sensitive')
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      fetcher.mockRestore()
    }
  })

  it('DNS 失败和超时可返回证据，不取消或改写宿主 resolver', async () => {
    const rejected = await captureDnsShape({
      lookup: async () => { throw Object.assign(new Error('hidden'), { code: 'ENOTFOUND' }) }, hostnames: ['gitee.com'],
    })
    expect(rejected.hosts[0].calls).toMatchObject([
      { ok: false, error: { code: 'ENOTFOUND' } }, { ok: false, error: { code: 'ENOTFOUND' } },
    ])
    expect(rejected.hosts[0].gate).toEqual({ tested: false })
    const timeout = await captureDnsShape({ lookup: () => new Promise(() => {}), hostnames: ['gitee.com'], timeoutMs: 5 })
    expect(timeout.hosts[0].calls).toMatchObject([
      { ok: false, error: { code: 'probe/timeout' } }, { ok: false, error: { code: 'probe/timeout' } },
    ])
  })
})

describe('现有 DNS 安全门基线（不等于官方 shape 已确认）', () => {
  it('默认 resolver 接受标准 Node 公网 IPv4、IPv6 及混合答案', async () => {
    for (const entries of [
      [{ address: '93.184.216.34', family: 4 }],
      [{ address: '2606:4700:4700::1111', family: 6 }],
      [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }],
    ]) {
      dnsLookup.mockResolvedValue(entries)
      await expect(assertSafeRemoteUrl('https://gitee.com/')).resolves.toHaveProperty('hostname', 'gitee.com')
    }
    expect(dnsLookup).toHaveBeenCalledWith('gitee.com', { all: true })
  })

  it('options.lookup 使用已声明的 string[] 合同，不再经过 Node record 映射', async () => {
    const resolver = vi.fn().mockResolvedValue(['93.184.216.34', '2606:4700:4700::1111'])
    await expect(assertSafeRemoteUrl('https://gitee.com/', { lookup: resolver })).resolves.toHaveProperty('hostname', 'gitee.com')
    expect(dnsLookup).not.toHaveBeenCalled()
  })

  it.each(['127.0.0.1', '10.0.0.1', '198.18.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1'])('任意混合私网答案 %s 都拒绝', async address => {
    dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }])
    await expect(assertSafeRemoteUrl('https://gitee.com/')).rejects.toMatchObject({ code: 'delivery/private-address' })
  })

  it('空或 invalid DNS 不获准', async () => {
    for (const entries of [[], [{ address: 'not-an-ip', family: 4 }], [{ address: '999.1.1.1', family: 4 }]]) {
      dnsLookup.mockResolvedValue(entries)
      await expect(assertSafeRemoteUrl('https://gitee.com/')).rejects.toMatchObject({ code: 'delivery/private-address' })
    }
  })

  it('协议、凭据、私有主机名和 literal 在 DNS 前拒绝', async () => {
    for (const [url, code] of [
      ['http://gitee.com/', 'delivery/insecure-url'],
      ['https://user:pass@gitee.com/', 'delivery/credential-url'],
      ['https://localhost/', 'delivery/private-host'],
      ['https://[::1]/', 'delivery/private-address'],
    ] as const) {
      await expect(assertSafeRemoteUrl(url)).rejects.toMatchObject({ code })
    }
    expect(dnsLookup).not.toHaveBeenCalled()
  })

  it('私网 DNS 在代理和 HTTP 调用前拒绝，不因代理信任目标', async () => {
    dnsLookup.mockResolvedValue([{ address: '198.18.0.1', family: 4 }])
    const fetcher = vi.fn()
    const dispatcher = vi.fn()
    await expect(safeFetch('https://gitee.com/', {
      proxy: { httpsProxy: 'http://127.0.0.1:8080' }, dispatcherForProxy: dispatcher, fetch: fetcher,
    })).rejects.toMatchObject({ code: 'delivery/private-address' })
    expect(dispatcher).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
