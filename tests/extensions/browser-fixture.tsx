/** Synthetic browser regression: real React/Cordis/official slot renderer, no Desktop. */
import { StrictMode, useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import * as ReactDom from 'react-dom'
import * as ReactDomClient from 'react-dom/client'
import * as JSXRuntime from 'react/jsx-runtime'
import * as Cordis from '@deepseek-ai/cordis'
import * as Slots from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { EXTENSION_SLOTS, type ExtensionContext, type ExtensionDefinition, type ExtensionRegistration, type ExtensionSlot } from '../../packages/market/src/client/extensions/contract.ts'
import { createMarketExtensionHost } from '../../packages/market/src/client/extensions/registry.ts'
import { ExtensionSurface, useExtensionRuntime } from '../../packages/market/src/client/extensions/surface.tsx'
import { attachDshService, EXTENSION_CHILDREN, createDshExtensionRenderer } from '../../packages/market/src/client/extensions/dsh.tsx'
import { definition as example } from '../../examples/market-extension/src/client.tsx'
import { registerBuiltinExample } from '../../examples/market-extension/builtin.ts'

const root = createRoot(document.getElementById('root')!)
const tick = () => new Promise<void>((done) => setTimeout(done, 20))
const assert = (ok: unknown, message: string): void => { if (!ok) throw new Error(message) }
const capability = ['browse', 'open-own-page', 'request-install-review', 'preview-draft-change'] as const
const cleanups = new Set<() => void>()
const owner = { effect(callback: () => (() => void)) { const cleanup = callback(); cleanups.add(cleanup); return () => { cleanups.delete(cleanup); cleanup() } } }
const results: { name: string; status: string; error?: string }[] = []
let currentPage = 'eac.example.independent:guide'
let opens = 0; let reviews = 0; let previews = 0; let activeEffects = 0; let accepted = 0
let resolveLate: ((value: number) => void) | undefined
const lifetime = new AbortController()
const context: ExtensionContext = {
  marketVersion: '0.1.0-mvp.1', dshVersion: '0.1.7-rc.2', environmentId: 'synthetic-only', capabilities: capability, signal: lifetime.signal,
  plugin: { id: 'fixture', name: '测试插件', packageName: 'fixture', version: '1.0.0', artifactDigest: 'a'.repeat(64) },
  draft: { id: 'fixture-draft', revision: 'r1', title: '测试', summary: '简介', markdown: '正文' },
  openDetail() {}, openOwnPage(id) { currentPage = id; opens++ }, requestInstallReview() { reviews++ }, previewDraftChange() { previews++ },
}
const issues: string[] = []
const host = createMarketExtensionHost({ marketVersion: context.marketVersion, dshVersion: context.dshVersion, capabilities: capability, onIssue: (i) => issues.push(i.code) })
function instrumented({ context: projected }: { context: Readonly<ExtensionContext> }): ReactNode {
  const runtime = useExtensionRuntime()
  useEffect(() => runtime.effect(() => { activeEffects++; return () => { activeEffects-- } }), [runtime])
  return <div data-safe="true">
    <p>正常扩展内容</p>
    <button id="async-fail" onClick={runtime.guard(async () => { throw new Error('synthetic async failure') })}>受管异步失败</button>
    <button id="event-fail" onClick={runtime.guard(() => { throw new Error('synthetic event failure') })}>受管同步失败</button>
    <button id="late" onClick={() => { void runtime.run(() => new Promise<number>((resolve) => { resolveLate = resolve }), () => { accepted++ }) }}>启动迟到任务</button>
    <span data-context-safe={Object.isFrozen(projected) && !('ctx' in projected) && !('remote' in projected) ? 'true' : 'false'} />
  </div>
}
const instrumentDefinition = (): ExtensionDefinition => ({ ...example, id: 'test.instrument', contributions: [{ id: 'home', slot: EXTENSION_SLOTS.home, title: '异常测试', component: instrumented }] })
function frame(render: (slot: ExtensionSlot) => ReactNode): ReactNode {
  return <main><nav aria-label="市场主导航"><button>发现</button><button>全部插件</button><button>我的插件</button></nav><p data-core="true">核心状态与安装确认区（测试）</p>
    <div data-surface="home">{render(EXTENSION_SLOTS.home)}</div><div role="menu" data-surface="more">{render(EXTENSION_SLOTS.more)}</div><div data-surface="page">{render(EXTENSION_SLOTS.page)}</div><div data-surface="detail">{render(EXTENSION_SLOTS.detail)}</div><div data-surface="author">{render(EXTENSION_SLOTS.author)}</div></main>
}
const draw = (): void => flushSync(() => root.render(<StrictMode>{frame((slot) => <ExtensionSurface host={host} slot={slot} context={context} pageId={currentPage} />)}</StrictMode>))
async function test(name: string, body: () => unknown | Promise<unknown>): Promise<void> {
  try { await body(); results.push({ name, status: 'passed' }) } catch (error) { results.push({ name, status: 'failed', error: String(error) }) }
}
function dispose(reg: ExtensionRegistration): void { if (reg.status === 'registered') reg.dispose() }

async function run(): Promise<typeof results> {
  let independent = host.service.register(owner, example)
  const builtin = registerBuiltinExample(host, owner)
  await test('双适配五位置真实React渲染；固定导航和核心内容完整', async () => {
    draw(); await tick()
    assert(document.querySelectorAll('[aria-label="市场主导航"] button').length === 3, 'navigation changed')
    for (const slot of ['home', 'more', 'page', 'detail', 'author']) assert(document.querySelector(`[data-surface="${slot}"]`)!.textContent!.length > 0, `empty ${slot}`)
    assert(document.querySelector('[data-core]'), 'core missing')
    assert(document.body.textContent!.includes('身份由扩展自报'), 'identity disclaimer missing')
  })
  await test('声明式菜单仅打开自己的完整key，详情和草稿按钮进入核心预览', async () => {
    const menu = document.querySelector('[data-surface="more"] button') as HTMLButtonElement
    menu.click(); await tick(); assert(opens === 1 && currentPage.endsWith(':guide'), 'menu route not namespaced')
    ;(document.querySelector('[data-surface="detail"] button') as HTMLButtonElement).click()
    ;(document.querySelector('[data-surface="author"] button') as HTMLButtonElement).click()
    assert(reviews === 1 && previews === 1, 'controlled core previews missing')
  })
  await test('单贡献渲染崩溃只替换其内容，其余槽位与核心仍显示', async () => {
    const broken = host.service.register(owner, { ...example, id: 'test.broken', contributions: [{ id: 'home', title: '渲染失败测试', slot: EXTENSION_SLOTS.home, component: () => { throw new Error('synthetic render failure') } }] })
    draw(); await tick()
    assert(document.body.textContent!.includes('此扩展暂时不可用'), 'no local fallback')
    assert(document.querySelector('[data-core]') && document.querySelector('[data-surface="detail"] button'), 'core/other extension lost')
    dispose(broken); await tick()
    const fixed = host.service.register(owner, { ...example, id: 'test.broken', contributions: [{ id: 'home', title: '恢复测试', slot: EXTENSION_SLOTS.home, component: () => '恢复成功' }] })
    draw(); await tick(); assert(document.body.textContent!.includes('恢复成功'), 'same-ID reload retained error boundary')
    dispose(fixed)
  })
  for (const id of ['async-fail', 'event-fail']) await test(`${id}由受管helper接住，局部回退且无未处理Promise`, async () => {
    const registration = host.service.register(owner, instrumentDefinition()); draw(); await tick()
    assert(document.querySelector('[data-context-safe="true"]'), 'unsafe context')
    ;(document.getElementById(id) as HTMLButtonElement).click(); await tick()
    assert(!document.querySelector('[data-safe]') && document.body.textContent!.includes('此扩展暂时不可用'), 'callback failure not contained')
    dispose(registration); await tick(); assert(activeEffects === 0, 'effect leak on failure')
  })
  await test('组件卸载取消异步接受与资源，迟到结果不更新新实例', async () => {
    const registration = host.service.register(owner, instrumentDefinition()); draw(); await tick()
    ;(document.getElementById('late') as HTMLButtonElement).click(); dispose(registration); draw(); await tick()
    resolveLate!(7); await tick(); assert(accepted === 0 && activeEffects === 0, 'late acceptance or effect leaked')
  })
  await test('React StrictMode下50次开关无监听/effect/重复DOM增长', async () => {
    for (let i = 0; i < 50; i++) {
      const registration = host.service.register(owner, instrumentDefinition()); draw(); await tick()
      assert(activeEffects === 1 && document.querySelectorAll('[data-safe]').length === 1, `mount leak ${i}: effects=${activeEffects}, DOM=${document.querySelectorAll('[data-safe]').length}`)
      dispose(registration); draw(); await tick(); assert(activeEffects === 0, `unmount leak ${i}`)
    }
  })
  await test('扩展卸载后原二级页有明确返回提示', async () => {
    currentPage = 'eac.example.independent:guide'; dispose(independent); draw(); await tick()
    assert(document.querySelector('[data-surface="page"]')!.textContent!.includes('已停用'), 'stale page missing explanation')
    independent = host.service.register(owner, example)
  })
  await test('官方SlotRenderer实际register/inject/props投影完成五位置渲染', async () => {
    flushSync(() => root.render(null)); await tick()
    const seed: Record<string, unknown> = { react: React, 'react-dom': ReactDom, 'react-dom/client': ReactDomClient, 'react/jsx-runtime': JSXRuntime, '@deepseek-ai/cordis': Cordis, '@deepseek-ai/dsh-client-ui-slots': Slots }
    const rendererRegistration = (window as unknown as { officialRenderer: { factory: (require: (name: string) => unknown) => { apply: (ctx: Context) => void } } }).officialRenderer
    const renderer = rendererRegistration.factory((name) => { if (!(name in seed)) throw new Error(`unknown official renderer import: ${name}`); return seed[name] })
    const ctx = new Context(); const slotsFiber = await ctx.plugin({ inject: [], apply: renderer.apply })
    // Official renderRoot always provides session-maybe, even for root-only pages.
    // Synthetic absence only; no real user session is supplied to this fixture.
    const absent = { key: undefined, hooks: {}, props: {} }
    const source = { getSnapshot: () => absent, subscribe: () => () => {} }
    ctx.slots.installScope('session', { current: source, bindingSource: () => source })
    const market = await ctx.plugin({ inject: ['slots'], apply: (scope) => attachDshService(scope, host) })
    currentPage = 'eac.example.independent:guide'
    const undeclare = ctx.slots.register({ name: 'root', children: EXTENSION_CHILDREN }, (props: PropsRenderSlots<ExtensionSlot>) => {
      const render = createDshExtensionRenderer(props.renderSlot)
      return frame((slot) => render({ host, slot, context, pageId: currentPage }))
    })
    flushSync(() => root.render(ctx.slots.renderSlot('root', {}))); await tick()
    for (const slot of ['home', 'more', 'page', 'detail', 'author']) assert(document.querySelector(`[data-surface="${slot}"]`)!.textContent!.length > 0, `official empty ${slot}`)
    assert(document.body.textContent!.includes('市场 0.1.0-mvp.1'), 'official context lost')
    assert(document.querySelectorAll('[aria-label="市场主导航"] button').length === 3, 'official wrapper replaced core')
    flushSync(() => root.render(null)); undeclare(); await market.dispose(); await slotsFiber.dispose()
  })
  dispose(independent); dispose(builtin); lifetime.abort(); host.dispose()
  assert(activeEffects === 0, 'final effect leak')
  document.body.dataset.finished = 'true'
  return results
}
Object.assign(window, { runExtensionChecks: run })
