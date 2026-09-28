import { describe, expect, it, vi } from 'vitest'
import { createManagedExtensionRuntime } from '../../packages/market/src/client/extensions/managed.ts'
import { createContributionContext } from '../../packages/market/src/client/extensions/context.ts'
import { EXTENSION_SLOTS, type ExtensionContext, type ExtensionDraftChange, type ExtensionInstallReviewRequest } from '../../packages/market/src/client/extensions/contract.ts'
import { contributionSignal } from '../../packages/market/src/client/extensions/registry.ts'
import { TestOwner, context, definition, makeHost } from './fixtures.ts'

describe('受管异常、超时和资源清理', () => {
  it('同步、Promise及accept异常均转为本贡献失败，不产生未处理拒绝', async () => {
    const onIssue = vi.fn(); const runtime = createManagedExtensionRuntime({ onIssue })
    expect(await runtime.run(() => { throw new Error('secret') })).toEqual({ status: 'error' })
    expect(await runtime.run(async () => { throw new Error('secret') })).toEqual({ status: 'error' })
    expect(await runtime.run(() => 1, async () => { throw new Error('secret') })).toEqual({ status: 'error' })
    runtime.guard(async () => { throw new Error('late') })(); await new Promise((done) => setTimeout(done, 0))
    expect(onIssue).toHaveBeenCalledTimes(4)
    expect(JSON.stringify(onIssue.mock.calls)).not.toContain('secret'); runtime.dispose()
  })
  it('超时取消信号，迟到结果不调用accept；迟到拒绝也已被接住', async () => {
    vi.useFakeTimers()
    try {
      const runtime = createManagedExtensionRuntime(); const accept = vi.fn()
      let release!: (value: string) => void; let signal!: AbortSignal
      const task = runtime.run((s) => { signal = s; return new Promise<string>((resolve) => { release = resolve }) }, accept, 50)
      await vi.advanceTimersByTimeAsync(51)
      expect(await task).toEqual({ status: 'timeout' }); expect(signal.aborted).toBe(true)
      release('late'); await Promise.resolve(); expect(accept).not.toHaveBeenCalled()
      runtime.dispose(); expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('父实例取消立刻清定时器、请求、订阅与effect，并记录失败清理', async () => {
    const parent = new AbortController(); const onIssue = vi.fn(); const cleanup = vi.fn()
    const runtime = createManagedExtensionRuntime({ signals: [parent.signal], onIssue }); const accept = vi.fn()
    runtime.effect(() => cleanup)
    runtime.effect(() => () => { throw new Error('cleanup failure') })
    let release!: (v: number) => void
    const task = runtime.run(() => new Promise<number>((resolve) => { release = resolve }), accept)
    parent.abort(); runtime.dispose()
    expect(await task).toEqual({ status: 'aborted' }); expect(cleanup).toHaveBeenCalledTimes(1)
    expect(onIssue).toHaveBeenCalledWith('extension/cleanup-error')
    release(1); await Promise.resolve(); expect(accept).not.toHaveBeenCalled()
  })
  it('React放弃render零监听，StrictMode同步清理/重挂仍可使用，最终卸载清理', async () => {
    const parent = new AbortController(); const add = vi.spyOn(parent.signal, 'addEventListener'); const remove = vi.spyOn(parent.signal, 'removeEventListener')
    const runtime = createManagedExtensionRuntime({ signals: [parent.signal], deferSignals: true })
    expect(add).not.toHaveBeenCalled()
    const first = runtime.retain(); first(); const second = runtime.retain()
    await Promise.resolve(); expect(await runtime.run(() => 42)).toEqual({ status: 'ok', value: 42 })
    second(); await Promise.resolve(); expect(runtime.signal.aborted).toBe(true)
    expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1)
  })
})

describe('只读上下文与受控请求', () => {
  function setup() {
    const host = makeHost(); const owner = new TestOwner(); host.service.register(owner, definition())
    const entry = host.getSnapshot().find((e) => e.contribution.slot === EXTENSION_SLOTS.author)!
    let source = context()
    const runtime = createManagedExtensionRuntime({ signals: [contributionSignal(entry)!] })
    const projected = createContributionContext(host, entry, () => source, runtime)
    return { host, owner, entry, runtime, projected, source, update(next: ExtensionContext) { source = next } }
  }
  it('不能泄漏宽对象里的raw ctx/Remote或修改宿主快照', () => {
    const s = setup()
    const raw = { ...s.source, remote: { startTask: vi.fn() }, ctx: { key: 'private' }, plugin: { ...s.source.plugin!, internalPath: 'private' } }
    const projected = createContributionContext(s.host, s.entry, () => raw, s.runtime)
    expect(Object.keys(projected)).not.toContain('ctx'); expect(Object.keys(projected)).not.toContain('remote')
    expect(Object.keys(projected.plugin!)).not.toContain('internalPath')
    expect(Object.isFrozen(projected)).toBe(true); expect(Object.isFrozen(projected.draft)).toBe(true)
    expect(() => { (projected.draft as { title: string }).title = 'tampered' }).toThrow()
    expect(s.source.draft!.title).toBe('合成草稿'); s.owner.dispose()
  })
  it('本扩展局部pageId翻译为命名空间key，跨扩展/核心导航请求零调用', () => {
    const s = setup(); s.projected.openOwnPage('page')
    expect(s.source.openOwnPage).toHaveBeenCalledWith('test.extension:page')
    s.projected.openOwnPage('other:page'); s.projected.openOwnPage('discover')
    expect(s.source.openOwnPage).toHaveBeenCalledTimes(1); s.owner.dispose()
  })
  it('安装只转交完整身份的预检；confirmed/startTask与任意URL全部拒绝', () => {
    const s = setup(); const request = { pluginId: 'fixture', version: '1.0.0', artifactDigest: 'a'.repeat(64) }
    s.projected.requestInstallReview(request)
    expect(s.source.requestInstallReview).toHaveBeenCalledWith(request)
    s.projected.requestInstallReview({ ...request, confirmed: true } as ExtensionInstallReviewRequest)
    s.projected.requestInstallReview({ ...request, artifactDigest: 'https://untrusted.invalid/a.tgz' })
    expect(s.source.requestInstallReview).toHaveBeenCalledTimes(1); s.owner.dispose()
  })
  it('草稿差异绑定当前草稿与revision，迟到旧稿不能覆盖新稿', () => {
    const s = setup(); const change = { draftId: 'test-draft', expectedRevision: 'r1', markdown: '建议正文' }
    s.projected.previewDraftChange(change); expect(s.source.previewDraftChange).toHaveBeenCalledWith(change)
    s.projected.previewDraftChange({ ...change, confirmed: true } as ExtensionDraftChange)
    s.update({ ...s.source, draft: { ...s.source.draft!, revision: 'r2' } })
    s.projected.previewDraftChange(change); expect(s.source.previewDraftChange).toHaveBeenCalledTimes(1); s.owner.dispose()
  })
  it('能力撤销/登记销毁后保留的回调不可调用核心', async () => {
    const s = setup(); s.update({ ...s.source, capabilities: [] }); s.projected.openDetail('fixture')
    expect(s.source.openDetail).not.toHaveBeenCalled()
    s.owner.dispose(); s.projected.openOwnPage('page')
    expect(s.source.openOwnPage).not.toHaveBeenCalled()
    expect(s.projected.signal.aborted).toBe(true); await Promise.resolve()
  })
})
