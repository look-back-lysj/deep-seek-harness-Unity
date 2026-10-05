import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../../tools/desktop-acceptance/trace-host.mjs'

const { dnsLookup, traceLog, traceMkdir } = vi.hoisted(() => ({
  dnsLookup: vi.fn(), traceLog: vi.fn(), traceMkdir: vi.fn(),
}))
vi.mock('node:dns/promises', () => ({ lookup: dnsLookup }))
vi.mock('node:fs', () => ({ appendFileSync: traceLog, mkdirSync: traceMkdir }))

const httpFetch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubEnv('DSH_HOME', 'D:/eac-market-verify/desktop-trace-test/harness')
  vi.stubGlobal('fetch', httpFetch)
  dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  httpFetch.mockImplementation(async () => new Response('abc'))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function facts() {
  return traceLog.mock.calls.map(([, text]) => JSON.parse(text))
}

function mount() {
  let dispose: (() => void) | undefined
  const ctx = {
    loader: { entries: () => [] },
    typert: { local: { get: () => undefined, hasSeen: () => false, subscribe: vi.fn() } },
    on: vi.fn(),
    effect: vi.fn((effect: () => () => void) => { dispose = effect() }),
  }
  apply(ctx)
  return () => dispose?.()
}

async function settled() {
  await vi.waitFor(() => {
    expect(facts().filter(fact => fact.event === 'host-network')).toHaveLength(2)
    expect(facts().filter(fact => fact.event === 'host-dns')).toHaveLength(1)
  })
}

describe('Desktop Host trace 离线交付边界', () => {
  it('导入真实 Core security 时不会挂载 Host、写文件或发起网络请求', () => {
    expect(inject).toEqual(['typert', 'loader', 'profileContext'])
    expect(typeof apply).toBe('function')
    expect(traceMkdir).not.toHaveBeenCalled()
    expect(traceLog).not.toHaveBeenCalled()
    expect(dnsLookup).not.toHaveBeenCalled()
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it.each(['', 'D:/ordinary-desktop-profile'])('在不满足现有隔离目录标记的 home %s 中拒绝挂载', home => {
    vi.stubEnv('DSH_HOME', home)
    expect(() => apply({})).toThrow('Host trace requires an isolated acceptance home')
    expect(traceMkdir).not.toHaveBeenCalled()
    expect(traceLog).not.toHaveBeenCalled()
    expect(dnsLookup).not.toHaveBeenCalled()
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it('通过真实安全门读取 mock 正文，记录字节数并释放周期采样', async () => {
    const dispose = mount()
    await settled()
    expect(facts().filter(fact => fact.event === 'host-network')).toEqual([
      expect.objectContaining({ id: 'catalog-gitee', status: 200, bytes: 3 }),
      expect.objectContaining({ id: 'catalog-github', status: 200, bytes: 3 }),
    ])
    expect(facts().find(fact => fact.event === 'host-dns').result.hosts).toHaveLength(4)
    expect(httpFetch).toHaveBeenCalledTimes(2)
    for (const [url, options] of httpFetch.mock.calls) {
      expect(url).toBeInstanceOf(URL)
      expect(url.protocol).toBe('https:')
      expect(options).toMatchObject({ method: 'GET', redirect: 'manual' })
    }
    await vi.advanceTimersByTimeAsync(2000)
    expect(facts().some(fact => fact.event === 'sample')).toBe(true)
    dispose()
    const count = traceLog.mock.calls.length
    await vi.advanceTimersByTimeAsync(4000)
    expect(traceLog).toHaveBeenCalledTimes(count)
    expect(facts().at(-1).event).toBe('trace-disposed')
  })

  it('私网 DNS 被真实 Core 拦截，不调用 HTTP，也不把失败记成字节成功', async () => {
    dnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    const dispose = mount()
    await settled()
    expect(httpFetch).not.toHaveBeenCalled()
    for (const fact of facts().filter(fact => fact.event === 'host-network')) {
      expect(fact.error).toMatchObject({ code: 'delivery/private-address' })
      expect(fact).not.toHaveProperty('bytes')
    }
    dispose()
  })

  it('私网重定向在下一跳 HTTP 前被拒绝', async () => {
    httpFetch.mockImplementation(async () => new Response(null, {
      status: 302, headers: { location: 'https://127.0.0.1/catalog.json' },
    }))
    const dispose = mount()
    await settled()
    expect(httpFetch).toHaveBeenCalledTimes(2)
    for (const fact of facts().filter(fact => fact.event === 'host-network')) {
      expect(fact.error).toMatchObject({ code: 'delivery/private-address' })
    }
    dispose()
  })

  it.each([
    { response: () => new Response('unavailable', { status: 503 }), code: 'delivery/http-failed' },
    { response: () => new Response('a', { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } }), code: 'delivery/too-large' },
    { response: () => new Response('abc', { headers: { 'content-length': '4' } }), code: 'delivery/length-mismatch' },
  ])('保留 Core 失败语义 $code，不产生虚假读取成功', async ({ response, code }) => {
    httpFetch.mockImplementation(async () => response())
    const dispose = mount()
    await settled()
    for (const fact of facts().filter(fact => fact.event === 'host-network')) {
      expect(fact.error).toMatchObject({ code })
      expect(fact).not.toHaveProperty('bytes')
    }
    dispose()
  })
})
