import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientHandshakeRequest, ClientHandshakeResult, TaskApprovalRequest } from '@dsh-eac/market-core/contracts'
import { remoteFacade } from '../../packages/market/src/client/activation.ts'
import { ADAPTER_PROTOCOL_VERSION, ADAPTER_VERSION } from '../../packages/market/src/version.ts'
import { helloFixture } from './fixtures.ts'

const handshake: ClientHandshakeResult = {
  accepted: true, protocolVersion: ADAPTER_PROTOCOL_VERSION, coreVersion: '0.1.0', coreApiVersion: '1.0.0',
}
const request: ClientHandshakeRequest = { protocolVersion: ADAPTER_PROTOCOL_VERSION, adapterVersion: ADAPTER_VERSION }
type Raw = Record<string, unknown>
type CallableFacade = Record<string, (...args: unknown[]) => Promise<unknown>>
function facade(raw: Raw): CallableFacade { return remoteFacade(raw) as unknown as CallableFacade }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function connection(overrides: Raw = {}) {
  return {
    hello: vi.fn(async () => ({ ok: true, value: helloFixture })),
    clientConnect: vi.fn(async (value: ClientHandshakeRequest) => {
      expect(value).toEqual(request)
      return { ok: true, value: handshake }
    }),
    ...overrides,
  }
}
afterEach(() => { vi.useRealTimers() })

// 后台名称和页面别名均经过真实代理；预览、导出、分析会产生状态，
// 不能误归入列表、详情或媒体读取。
const writes = [
  ['planCreate', 'createPlan'], ['taskStart', 'startTask'], ['taskApproveBuilds', 'approveTask'],
  ['taskResume', 'resumeTask'], ['taskCancel', 'cancelTask'], ['pluginSetEnabled', 'setPluginEnabled'],
  ['pluginRemove', 'removePlugin'], ['catalogRefresh', 'refreshCatalog'],
  ['authorDraftSave', 'saveDraft'], ['authorDraftDelete', 'authorDraftDelete'],
  ['authorReadmeImport', 'importReadme'], ['authorReadmePreview', 'previewReadme'],
  ['authorReadmeApplyPreview', 'applyReadmePreview'], ['authorTransferBegin', 'transferBegin'],
  ['authorTransferChunk', 'transferChunk'], ['authorTransferDispose', 'transferDispose'],
  ['authorExportDraft', 'exportDraft'], ['aiAnalyze', 'aiAnalyze'], ['aiConfirm', 'aiConfirm'],
] as const

describe('真实客户端 facade：每次副作用之前协商当前连接', () => {
  it('hello和握手依次完成前零写入，协商使用原始source且不发送自造peerID', async () => {
    const hello = deferred<unknown>()
    const connect = deferred<unknown>()
    const order: string[] = []
    const raw = {
      hello: vi.fn(function (this: unknown) { expect(this).toBe(raw); order.push('hello'); return hello.promise }),
      clientConnect: vi.fn(function (this: unknown, value: unknown) { expect(this).toBe(raw); expect(value).toEqual(request); order.push('clientConnect'); return connect.promise }),
      planCreate: vi.fn(function (this: unknown, value: unknown) { expect(this).toBe(raw); order.push('planCreate'); return { ok: true, value } }),
    }
    const args = { packId: 'test-pack', attemptUnknown: false }
    const pending = facade(raw).createPlan!(args)
    expect(order).toEqual(['hello'])
    expect(raw.planCreate).not.toHaveBeenCalled()
    hello.resolve({ ok: true, value: helloFixture })
    await vi.waitFor(() => expect(order).toEqual(['hello', 'clientConnect']))
    expect(raw.planCreate).not.toHaveBeenCalled()
    connect.resolve({ ok: true, value: handshake })
    await expect(pending).resolves.toBe(args)
    expect(order).toEqual(['hello', 'clientConnect', 'planCreate'])
    expect(raw.planCreate).toHaveBeenCalledExactlyOnceWith(args)
  })

  it.each(writes)('%s 及其UI别名均在协商成功后写入，拒绝时零写入', async (wire, alias) => {
    for (const name of new Set([wire, alias])) {
      const order: string[] = []
      let accepted = true
      const write = vi.fn(async (args: unknown) => { order.push(wire); return { ok: true, value: args } })
      const raw = {
        hello: vi.fn(async () => { order.push('hello'); return { ok: true, value: helloFixture } }),
        clientConnect: vi.fn(async (value: unknown) => { order.push('clientConnect'); expect(value).toEqual(request); return { ok: true, value: { ...handshake, accepted, reason: '测试连接未登记' } } }),
        [wire]: write,
      }
      const remote = facade(raw)
      const args = { test: '原始审批、revision、任务字段原样透传' }
      await expect(remote[name]!(args)).resolves.toBe(args)
      expect(order).toEqual(['hello', 'clientConnect', wire])
      expect(write).toHaveBeenCalledExactlyOnceWith(args)
      accepted = false
      write.mockClear(); order.length = 0
      await expect(remote[name]!(args)).rejects.toThrow(/测试连接未登记.*刷新/)
      expect(order).toEqual(['hello', 'clientConnect'])
      expect(write).not.toHaveBeenCalled()
    }
  })

  it.each(['1.9.9', '3.0.0', '2.0.0-rc.1', '2.0.0+build.1', '02.0.0', '2.0', ' 2.0.0', '', 'invalid', '9007199254740993.0.0', null, undefined, 2, {}, []])('hello协议%j拒绝握手且零写入', async (protocolVersion) => {
    const write = vi.fn()
    const raw = connection({ hello: async () => ({ ...helloFixture, protocolVersion }), planCreate: write })
    await expect(facade(raw).createPlan!({})).rejects.toThrow(/协议不兼容.*刷新/)
    expect(raw.clientConnect).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it.each([['2.0.0', '1.0.0'], ['2.0.7', '1.0.9'], ['2.3.0', '1.2.0']])('同主版本新增接口仍兼容：协议%s，核心API%s', async (protocolVersion, coreApiVersion) => {
    const write = vi.fn(async () => 'test-plan')
    const raw = connection({
      hello: async () => ({ ...helloFixture, protocolVersion, coreApiVersion }),
      clientConnect: async () => ({ ...handshake, protocolVersion, coreApiVersion }),
      planCreate: write,
    })
    await expect(facade(raw).createPlan!({})).resolves.toBe('test-plan')
    expect(write).toHaveBeenCalledOnce()
  })

  it.each(['1.9.9', '3.0.0', '2.0.0-rc.1', '02.0.0', 'invalid', null, undefined])('accepted不能放行握手中的非法/不兼容协议%j', async (protocolVersion) => {
    const write = vi.fn()
    const raw = connection({ clientConnect: async () => ({ ...handshake, protocolVersion }), planCreate: write })
    await expect(facade(raw).createPlan!({})).rejects.toThrow(/协议.*刷新/)
    expect(write).not.toHaveBeenCalled()
  })

  it.each(['0.9.0', '2.0.0', '1.0.0-rc.1', '01.0.0', 'invalid', null, undefined])('accepted不能放行握手中的非法/不兼容核心API%j', async (coreApiVersion) => {
    const write = vi.fn()
    const raw = connection({ clientConnect: async () => ({ ...handshake, coreApiVersion }), planCreate: write })
    await expect(facade(raw).createPlan!({})).rejects.toThrow(/核心接口.*刷新/)
    expect(write).not.toHaveBeenCalled()
  })

  it.each([null, undefined, {}, true, { ...handshake, accepted: 'true' }, { ...handshake, accepted: 1 }, { ...handshake, coreVersion: '' }, { ...handshake, coreVersion: undefined }])('握手缺少真实结构%j时零写入', async (value) => {
    const write = vi.fn()
    const raw = connection({ clientConnect: async () => ({ ok: true, value }), planCreate: write })
    await expect(facade(raw).createPlan!({})).rejects.toThrow('刷新')
    expect(write).not.toHaveBeenCalled()
  })

  it.each(['hello', 'clientConnect'])('缺少%s时拒绝写入，已有读接口仍然可用', async (missing) => {
    const write = vi.fn()
    const catalog = vi.fn(async () => ({ ok: true, value: 'test-catalog' }))
    const raw = connection({ [missing]: undefined, planCreate: write, catalog })
    const remote = facade(raw)
    await expect(remote.createPlan!({})).rejects.toThrow(/缺少协议协商.*刷新/)
    expect(write).not.toHaveBeenCalled()
    await expect(remote.catalog!()).resolves.toBe('test-catalog')
    expect(catalog).toHaveBeenCalledOnce()
  })

  it.each(['hello', 'clientConnect'])('%s失败保留后台错误字段，零写入', async (method) => {
    const write = vi.fn()
    const error = { code: 'test/connection-rejected', message: '测试连接失效', retryable: false, nextAction: 'refresh', details: { test: true } }
    const raw = connection({ [method]: async () => ({ ok: false, error }), planCreate: write })
    await expect(facade(raw).createPlan!({})).rejects.toMatchObject({ ...error, message: expect.stringMatching(/测试连接失效.*刷新/) })
    expect(write).not.toHaveBeenCalled()
  })

  it.each(['hello', 'clientConnect'])('%s抛出异常时零写入', async (method) => {
    const write = vi.fn()
    const raw = connection({ [method]: () => { throw new Error('测试断线') }, planCreate: write })
    await expect(facade(raw).createPlan!({})).rejects.toThrow(/测试断线.*刷新/)
    expect(write).not.toHaveBeenCalled()
  })

  it('握手不重写审批凭证，真实写接口的失败仍原样返回且不自动重试', async () => {
    const approval: TaskApprovalRequest = {
      taskId: 'test-task', attemptId: 'test-attempt', challengeId: 'test-challenge',
      pendingBuildsDigest: 'sha256:test-builds', approvedBuilds: ['test-build'], idempotencyKey: 'test-approval-once',
    }
    const error = { code: 'test/approval-stale', message: '测试审批已过期', retryable: false, nextAction: 'refresh', details: { challengeId: approval.challengeId } }
    const write = vi.fn(async () => ({ ok: false, error }))
    const raw = connection({ taskApproveBuilds: write })
    await expect(remoteFacade(raw).approveTask!(approval)).rejects.toMatchObject(error)
    expect(write).toHaveBeenCalledExactlyOnceWith(approval)
    expect(raw.clientConnect).toHaveBeenCalledOnce()
  })

  it('hello公布不兼容核心API时，不使用后续accepted掩盖不兼容', async () => {
    const write = vi.fn()
    const raw = connection({ hello: async () => ({ ...helloFixture, coreApiVersion: '2.0.0' }), planCreate: write })
    await expect(facade(raw).createPlan!({})).rejects.toThrow(/核心接口不兼容.*刷新/)
    expect(raw.clientConnect).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it.each(['hello', 'clientConnect'])('%s超时后即使回包成功也不能继续写入', async (method) => {
    vi.useFakeTimers()
    const late = deferred<unknown>()
    const write = vi.fn()
    const raw = connection({ [method]: vi.fn(() => late.promise), planCreate: write })
    const pending = expect(facade(raw).createPlan!({})).rejects.toThrow(/协商超时.*刷新/)
    await vi.advanceTimersByTimeAsync(8_000)
    await pending
    late.resolve({ ok: true, value: method === 'hello' ? helloFixture : handshake })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(write).not.toHaveBeenCalled()
    if (method === 'hello') expect(raw.clientConnect).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('hello与握手共用等待上限，先前的慢读取不能延长写入资格', async () => {
    vi.useFakeTimers()
    const hello = deferred<unknown>()
    const connect = deferred<unknown>()
    const write = vi.fn()
    const raw = connection({ hello: () => hello.promise, clientConnect: () => connect.promise, planCreate: write })
    const pending = expect(facade(raw).createPlan!({})).rejects.toThrow('协商超时')
    await vi.advanceTimersByTimeAsync(7_000)
    hello.resolve(helloFixture)
    await vi.advanceTimersByTimeAsync(1_000)
    await pending
    connect.resolve(handshake)
    await vi.advanceTimersByTimeAsync(1)
    expect(write).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('断线重连后同一facade重新hello和握手；拒绝后重试也不复用旧许可', async () => {
    const order: string[] = []
    let generation = 1
    let accepted = true
    let negotiated = 0
    const raw = {
      hello: async () => { order.push(`hello:${generation}`); return helloFixture },
      clientConnect: async (value: unknown) => {
        expect(value).toEqual(request)
        order.push(`connect:${generation}`)
        if (accepted) negotiated = generation
        return { ...handshake, accepted }
      },
      taskCancel: vi.fn(async (value: unknown) => {
        expect(negotiated).toBe(generation)
        order.push(`write:${generation}`)
        return value
      }),
    }
    const remote = facade(raw)
    await remote.cancelTask!({ taskId: 'test-one' })
    generation = 2; accepted = false
    await expect(remote.cancelTask!({ taskId: 'test-two' })).rejects.toThrow('刷新')
    expect(raw.taskCancel).toHaveBeenCalledTimes(1)
    accepted = true
    await remote.cancelTask!({ taskId: 'test-three' })
    expect(order).toEqual(['hello:1', 'connect:1', 'write:1', 'hello:2', 'connect:2', 'hello:2', 'connect:2', 'write:2'])
    expect(raw.taskCancel).toHaveBeenLastCalledWith({ taskId: 'test-three' })
  })

  it('已成功握手后后台协议变化，下一次写入被hello阻止', async () => {
    let protocolVersion = '2.0.0'
    const write = vi.fn(async () => 'test-plan')
    const raw = connection({ hello: async () => ({ ...helloFixture, protocolVersion }), planCreate: write })
    const remote = facade(raw)
    await remote.createPlan!({})
    protocolVersion = '3.0.0'
    await expect(remote.createPlan!({})).rejects.toThrow('刷新')
    expect(write).toHaveBeenCalledTimes(1)
    expect(raw.clientConnect).toHaveBeenCalledTimes(1)
  })
})

describe('真实客户端 facade：读取不会误触写入防护', () => {
  const reads = [
    ['catalog', 'catalog'], ['inventory', 'inventory'], ['taskList', 'listTasks'],
    ['taskGet', 'getTask'], ['taskEvents', 'taskEvents'], ['authorDraftList', 'listDrafts'],
    ['authorDraftGet', 'getDraft'], ['authorMediaRead', 'readMedia'],
    ['authorTransferRead', 'transferRead'], ['diagnosticsExport', 'exportDiagnostic'],
  ] as const
  it.each(reads)('%s及其UI别名在旧后台仍可直接读取', async (wire, alias) => {
    for (const name of new Set([wire, alias])) {
      const read = vi.fn(async () => ({ ok: true, value: 'test-read' }))
      const raw = connection({ hello: vi.fn(async () => ({ ...helloFixture, protocolVersion: '1.0.0' })), [wire]: read })
      await expect(facade(raw)[name]!({ test: 'read' })).resolves.toBe('test-read')
      expect(raw.hello).not.toHaveBeenCalled()
      expect(raw.clientConnect).not.toHaveBeenCalled()
      expect(read).toHaveBeenCalledExactlyOnceWith({ test: 'read' })
    }
  })

  it('hello和clientConnect本身直接转发，不递归协商', async () => {
    const raw = connection()
    const remote = facade(raw)
    await expect(remote.hello!()).resolves.toEqual(helloFixture)
    expect(raw.hello).toHaveBeenCalledTimes(1)
    expect(raw.clientConnect).not.toHaveBeenCalled()
    await expect(remote.clientConnect!(request)).resolves.toEqual(handshake)
    expect(raw.clientConnect).toHaveBeenCalledExactlyOnceWith(request)
    expect(raw.hello).toHaveBeenCalledTimes(1)
  })
})
