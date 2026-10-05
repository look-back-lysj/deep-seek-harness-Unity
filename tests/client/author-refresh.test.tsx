import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const edge = process.env.EAC_TEST_EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browserFixture = `
import { AuthorWorkspace } from '/packages/market/src/client/AuthorWorkspace.tsx'
import { MarketPage } from '/packages/market/src/client/MarketPage.tsx'
import { helloFixture, catalogFixture, inventoryFixture } from '/tests/client/fixtures.ts'
const root = ReactDOM.createRoot(document.getElementById('root'))
let serial = 0
const draft = (id, revision = '1') => ({ id, revision, title: id, summary: '已保存简介', markdown: '已保存正文', mediaIds: [], updatedAt: '2026-10-03T12:00:00.000Z' })
window.fixture = {
  draft,
  reset(mode = 'author', visible = true, available = true, strict = false) {
    ReactDOM.flushSync(() => root.render(null))
    this.lists = []; this.gets = []; this.saves = []; this.snapshots = []; this.dirty = []; this.errors = []
    this.visible = visible; this.mode = mode; this.strict = strict; this.key = ++serial
    this.remote = {
      hello: async () => helloFixture, catalog: async () => catalogFixture,
      inventory: async () => inventoryFixture, listTasks: async () => [],
      ...(available ? { listDrafts: () => new Promise((resolve, reject) => this.lists.push({ resolve, reject })) } : {}),
      getDraft: id => new Promise((resolve, reject) => this.gets.push({ id, resolve, reject })),
      saveDraft: input => new Promise((resolve, reject) => this.saves.push({ input, resolve, reject })),
      transferBegin: async () => ({ transferId: 'import', receivedBytes: 0, complete: false }),
      transferChunk: async request => ({ transferId: 'import', receivedBytes: atob(request.data).length, complete: true, resultId: '导入草稿' }),
    }
    this.render()
  },
  render() {
    const author = React.createElement(AuthorWorkspace, { key: this.key, remote: this.remote, visible: this.visible,
      onDraftSnapshot: value => this.snapshots.push(value), onDirtyChange: value => this.dirty.push(value) })
    const content = this.mode === 'market' ? React.createElement(MarketPage, { key: this.key, remote: this.remote }) : React.createElement('div', { hidden: !this.visible }, author)
    ReactDOM.flushSync(() => root.render(this.strict ? React.createElement(React.StrictMode, null, content) : content))
  },
  show(visible) { this.visible = visible; this.render() },
  complete(index, drafts) { this.lists[index].resolve(drafts) },
  fail(index) { this.lists[index].reject(new Error('fixture-private-path: C:/private/profile')) },
  click(text, scope = '#root') {
    const button = [...document.querySelector(scope).querySelectorAll('button')].find(item => !item.closest('[hidden]') && item.textContent.trim() === text)
    if (!button || button.disabled) throw new Error('button missing or disabled: ' + text)
    button.click()
  },
  edit(id, value) {
    const input = document.getElementById(id)
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  },
  importZip() {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['PK-fixture'], 'fixture.zip', { type: 'application/zip' }))
    const input = document.getElementById('author-zip')
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  },
  state() {
    const section = document.querySelector('[aria-label="作者草稿工作区"]')
    const aside = section?.querySelector('aside')
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event)
    return {
      lists: this.lists.length, gets: this.gets.map(item => item.id), saves: this.saves.map(item => item.input),
      snapshot: this.snapshots.at(-1) ?? null, dirty: this.dirty.at(-1), beforeUnload: event.defaultPrevented,
      titles: [...(aside?.querySelectorAll('li button') ?? [])].map(item => item.firstChild.textContent),
      loading: !!aside?.textContent.includes('正在读取已保存草稿'), empty: !!aside?.textContent.includes('还没有保存的草稿'),
      alert: aside?.querySelector('[role="alert"]')?.textContent ?? null,
      unavailable: !!aside?.textContent.includes('当前宿主不能读取草稿列表'),
      title: document.getElementById('draft-title')?.value, summary: document.getElementById('draft-summary')?.value,
      markdown: document.getElementById('draft-markdown')?.value, text: section?.textContent ?? '', errors: this.errors,
    }
  },
}
window.addEventListener('error', event => fixture.errors.push(event.message))
window.addEventListener('unhandledrejection', event => fixture.errors.push(String(event.reason)))
fixture.reset()
`

interface AuthorState {
  lists: number
  gets: string[]
  saves: Array<{ id?: string; expectedRevision?: string; title: string; summary: string; markdown: string }>
  snapshot: { id: string; revision: string } | null
  dirty: boolean
  beforeUnload: boolean
  titles: string[]
  loading: boolean
  empty: boolean
  alert: string | null
  unavailable: boolean
  title: string
  summary: string
  markdown: string
  text: string
  errors: string[]
}
interface CdpResult {
  result?: { value?: unknown }
  exceptionDetails?: { exception?: { description?: string }; text: string }
}
let server: Server | undefined
let browser: ChildProcess | undefined
let socket: WebSocket | undefined
let nextId = 0
const pending = new Map<number, { resolve: (value: CdpResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
const runtimeErrors: unknown[] = []
const networkEvents: unknown[] = []
const pause = (duration: number) => new Promise<void>(done => setTimeout(done, duration))

function send(method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
  return new Promise((resolveRequest, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 5_000)
    pending.set(id, { resolve: resolveRequest, reject, timer })
    socket!.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate<T = unknown>(expression: string): Promise<T> {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result?.value as T
}
async function state(): Promise<AuthorState> { return evaluate<AuthorState>('fixture.state()') }
async function until(expression: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate<boolean>(expression)) return
    await pause(20)
  }
  const page = await evaluate('({ location: location.href, ready: document.readyState, fixture: !!window.fixture, scripts: [...document.scripts].map(script => script.src), body: document.body?.innerText ?? "" })')
  throw new Error('DOM timeout: ' + expression + '; ' + JSON.stringify({ page, runtimeErrors, networkEvents, state: await evaluate('window.fixture ? fixture.state() : undefined') }))
}
async function settle(expression: string): Promise<void> {
  await evaluate(expression)
  await evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')
}
async function click(text: string, scope = '#root'): Promise<void> { await settle(`fixture.click(${JSON.stringify(text)}, ${JSON.stringify(scope)})`) }
async function edit(id: string, value: string): Promise<void> { await settle(`fixture.edit(${JSON.stringify(id)}, ${JSON.stringify(value)})`) }
async function complete(index: number, ids: string[]): Promise<void> { await settle(`fixture.complete(${index}, ${JSON.stringify(ids)}.map(id => fixture.draft(id)))`) }

beforeAll(async () => {
  if (!existsSync(edge)) throw new Error('需要现有 Edge；可使用 EAC_TEST_EDGE 指定路径，不安装依赖。')
  const profile = mkdtempSync(join(tmpdir(), 'eac-author-refresh-'))
  const reactModule = 'const React = window.React; export default React; export const { useCallback, useEffect, useId, useMemo, useRef, useState, createElement, Fragment } = React;'
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url!, 'http://localhost').pathname
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
      if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end('<!doctype html><html lang="zh-CN"><body><div id="root"></div><script src="/react-umd.js"></script><script src="/react-dom-umd.js"></script><script type="module" src="/fixture.js"></script></body></html>')
      } else if (pathname === '/react-umd.js' || pathname === '/react-dom-umd.js') {
        const packageName = pathname === '/react-umd.js' ? 'react' : 'react-dom'
        response.end(readFileSync(join(workspace, `packages/market/node_modules/${packageName}/umd/${packageName}.development.js`), 'utf8'))
      } else if (pathname === '/react.js') response.end(reactModule)
      else if (pathname === '/fixture.js') response.end(browserFixture)
      else {
        const filename = resolve(workspace, `.${decodeURIComponent(pathname)}`)
        if (!filename.startsWith(`${workspace}${sep}`) || !/\.(?:ts|tsx|js)$/.test(filename)) throw new Error('测试模块路径不合法')
        const source = readFileSync(filename, 'utf8')
        const transformed = await transform(source, { loader: filename.endsWith('tsx') ? 'tsx' : filename.endsWith('.ts') ? 'ts' : 'js', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', format: 'esm' })
        response.end(transformed.code.replace(/(["'])react\1/g, '"/react.js"')
          .replace(/(["'])@dsh-eac\/market-core\/compatibility\1/g, '"/packages/market-core/src/contracts/compatibility.ts"')
          .replace(/(["'])@dsh-eac\/market-core\/semver\1/g, '"/packages/market-core/lib/semver.js"'))
      }
    } catch (error) { response.statusCode = 500; response.end(String(error)) }
  })
  await new Promise<void>(done => server!.listen(0, '127.0.0.1', done))
  browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let launchError: Error | undefined
  browser.on('error', error => { launchError = error })
  for (let attempt = 0; attempt < 150 && !existsSync(join(profile, 'DevToolsActivePort')); attempt++) {
    if (launchError) throw launchError
    if (browser.exitCode !== null && browser.exitCode !== 0) throw new Error(`Edge 提前退出：${browser.exitCode}`)
    await pause(100)
  }
  if (!existsSync(join(profile, 'DevToolsActivePort'))) throw new Error('Edge 未提供隔离 CDP 端口')
  const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
  socket = new WebSocket(tabs.find(tab => tab.type === 'page')!.webSocketDebuggerUrl)
  await new Promise<void>((done, reject) => { socket!.addEventListener('open', () => done(), { once: true }); socket!.addEventListener('error', () => reject(new Error('Edge CDP 连接失败')), { once: true }) })
  socket.addEventListener('message', event => {
    const eventMessage = JSON.parse(String(event.data)) as { method?: string; params?: { requestId?: string; request?: { url: string }; response?: { url: string; status: number }; errorText?: string; blockedReason?: string } }
    if (eventMessage.method === 'Runtime.exceptionThrown') runtimeErrors.push(eventMessage.params)
    if (eventMessage.method && ['Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFailed', 'Network.loadingFinished'].includes(eventMessage.method) && networkEvents.length < 200) {
      networkEvents.push({ method: eventMessage.method, requestId: eventMessage.params?.requestId, url: eventMessage.params?.request?.url ?? eventMessage.params?.response?.url, status: eventMessage.params?.response?.status, error: eventMessage.params?.errorText, blockedReason: eventMessage.params?.blockedReason })
    }
    const message = JSON.parse(String(event.data)) as { id: number; error?: { message: string }; result: CdpResult }
    const entry = pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timer); pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setBlockedURLs', { urls: ['http://me.kis.v2.scr.kaspersky-labs.com/*'] })
  const address = server.address() as { port: number }
  await send('Page.navigate', { url: `http://127.0.0.1:${address.port}/` })
  await until('!!window.fixture && !!document.getElementById("draft-title")')
  console.info('Client fixture ready: ' + JSON.stringify({ fixture: 'author-refresh', page: await evaluate('({ ready: document.readyState, fixture: !!window.fixture })'), runtimeErrors, networkEvents: networkEvents.filter(event => { const fact = event as { url?: string; method: string }; return fact.url?.startsWith('http://me.kis.v2.scr.kaspersky-labs.com/') || fact.method === 'Network.loadingFailed' }) }))
}, 30_000)

afterAll(async () => {
  if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close') } catch {} }
  socket?.close()
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('测试浏览器已关闭')) }
  pending.clear()
  if (browser && browser.exitCode === null) browser.kill()
  if (server) await new Promise<void>(done => server!.close(() => done()))
}, 15_000)
beforeEach(async () => { await settle('fixture.reset()'); await until('fixture.lists.length === 1') })

describe('作者页可见刷新、草稿保留与请求竞态（真实 React / 隔离 Edge）', () => {
  it('首次未完成和失败不伪装成空列表；重新可见后重试', async () => {
    expect(await state()).toMatchObject({ loading: true, empty: false, titles: [] })
    await settle('fixture.fail(0)')
    expect(await state()).toMatchObject({ loading: false, empty: false })
    expect((await state()).alert).toContain('草稿列表读取失败')
    expect((await state()).text).not.toContain('fixture-private-path')
    await settle('fixture.show(false)'); await settle('fixture.show(true)')
    expect((await state()).lists).toBe(2)
    await complete(1, [])
    expect(await state()).toMatchObject({ empty: true, alert: null, loading: false, errors: [] })
  })
  it('首次隐藏仍读取，每次再次可见刷新，隐藏和编辑不额外读取', async () => {
    await settle('fixture.reset("author", false)')
    expect((await state()).lists).toBe(1)
    await complete(0, ['原有草稿']); await settle('fixture.show(true)'); await complete(1, ['外部新增草稿'])
    await edit('draft-title', '未保存标题'); await settle('fixture.show(false)')
    expect((await state()).lists).toBe(2)
    await settle('fixture.show(true)'); await complete(2, ['最新草稿'])
    expect(await state()).toMatchObject({ lists: 3, titles: ['最新草稿'], title: '未保存标题', dirty: true, beforeUnload: true })
  })
  it('刷新不覆盖正文、saved revision 或 dirty；切换需确认，冲突不伪造保存', async () => {
    await complete(0, ['已打开草稿']); await settle('document.querySelector("aside li button").click()')
    await settle('fixture.gets[0].resolve(fixture.draft("已打开草稿", "1"))')
    await edit('draft-title', '未保存标题'); await edit('draft-summary', '未保存简介'); await edit('draft-markdown', '未保存正文')
    await settle('fixture.show(false)'); await settle('fixture.show(true)')
    await settle('fixture.complete(1, [fixture.draft("已打开草稿", "2"), fixture.draft("另一草稿")])')
    expect(await state()).toMatchObject({ title: '未保存标题', summary: '未保存简介', markdown: '未保存正文', dirty: true, beforeUnload: true, snapshot: { id: '已打开草稿', revision: '1' } })
    await settle('document.querySelectorAll("aside li button")[1].click()')
    expect(await evaluate('!!document.querySelector("[role=dialog]")')).toBe(true)
    expect((await state()).gets).toHaveLength(1)
    await click('继续编辑', '[role=dialog]'); await click('保存草稿')
    expect((await state()).saves[0]).toMatchObject({ id: '已打开草稿', expectedRevision: '1', title: '未保存标题', markdown: '未保存正文' })
    await settle('fixture.saves[0].reject(new Error("revision-conflict: C:/private/profile"))')
    expect(await state()).toMatchObject({ dirty: true, markdown: '未保存正文', snapshot: { revision: '1' } })
    expect((await state()).text).toContain('保存失败或结果尚未确认')
    expect((await state()).text).not.toContain('C:/private/profile')
  })
  it('刷新失败保留旧列表和未保存编辑，再次进入可恢复', async () => {
    await complete(0, ['原有草稿']); await edit('draft-markdown', '不能丢失的正文')
    await settle('fixture.show(false)'); await settle('fixture.show(true)'); await settle('fixture.fail(1)')
    expect(await state()).toMatchObject({ titles: ['原有草稿'], markdown: '不能丢失的正文', dirty: true, empty: false })
    expect((await state()).alert).toContain('当前列表可能不是最新')
    await settle('fixture.show(false)'); await settle('fixture.show(true)'); await complete(2, ['外部新增草稿'])
    expect(await state()).toMatchObject({ titles: ['外部新增草稿'], markdown: '不能丢失的正文', dirty: true, alert: null })
  })
  it('列表超时保留编辑且不显示空状态；超时请求迟到不覆盖重试结果', async () => {
    await complete(0, ['原有草稿']); await edit('draft-markdown', '超时仍保留的正文')
    await settle('fixture.show(false); fixture.originalTimeout = window.setTimeout; window.setTimeout = (callback, delay, ...args) => fixture.originalTimeout(callback, delay === 12000 ? 10 : delay, ...args)')
    try {
      await settle('fixture.show(true)')
      await until('!!fixture.state().alert')
      expect(await state()).toMatchObject({ titles: ['原有草稿'], markdown: '超时仍保留的正文', dirty: true, empty: false, loading: false })
    } finally { await settle('window.setTimeout = fixture.originalTimeout') }
    await settle('fixture.show(false)'); await settle('fixture.show(true)'); await complete(2, ['重试最新草稿']); await complete(1, ['超时旧草稿'])
    expect(await state()).toMatchObject({ titles: ['重试最新草稿'], markdown: '超时仍保留的正文', dirty: true, alert: null })
  })
  it.each(['resolve', 'reject'])('旧列表 %s 迟到不覆盖新一轮结果或状态', async result => {
    await settle('fixture.show(false)'); await settle('fixture.show(true)'); await complete(1, ['最新列表'])
    if (result === 'resolve') await complete(0, ['过期列表'])
    else await settle('fixture.fail(0)')
    expect(await state()).toMatchObject({ titles: ['最新列表'], loading: false, alert: null })
  })
  it.each(['resolve', 'reject'])('保存后旧列表 %s 不删除已保存草稿或伪造失败', async result => {
    await edit('draft-title', '本地新草稿'); await click('保存草稿')
    await settle('fixture.saves[0].resolve(fixture.draft("本地新草稿", "2"))')
    if (result === 'resolve') await complete(0, [])
    else await settle('fixture.fail(0)')
    expect(await state()).toMatchObject({ titles: ['本地新草稿'], title: '本地新草稿', dirty: false, beforeUnload: false, loading: false, alert: null, empty: false, snapshot: { id: '本地新草稿', revision: '2' } })
  })
  it('导入独立 ZIP 后旧列表不删除导入草稿，dirty 正文和 revision 保留', async () => {
    await complete(0, ['当前草稿']); await settle('document.querySelector("aside li button").click()')
    await settle('fixture.gets[0].resolve(fixture.draft("当前草稿", "3"))'); await edit('draft-markdown', '未保存正文')
    await settle('fixture.show(false)'); await settle('fixture.show(true)'); await settle('fixture.importZip()')
    await until('fixture.gets.length === 2'); await settle('fixture.gets[1].resolve(fixture.draft("导入草稿"))'); await complete(1, [])
    expect(await state()).toMatchObject({ titles: ['导入草稿', '当前草稿'], title: '当前草稿', markdown: '未保存正文', dirty: true, snapshot: { id: '当前草稿', revision: '3' } })
    expect((await state()).saves).toHaveLength(0)
  })
  it('Remote 更换后旧列表和迟到 getDraft 不能进入新环境', async () => {
    await complete(0, ['旧环境草稿']); await settle('document.querySelector("aside li button").click()')
    await settle('fixture.show(false)'); await settle('fixture.show(true)')
    await settle('fixture.oldList = fixture.lists[1]; fixture.oldGet = fixture.gets[0]; fixture.remote = { ...fixture.remote }; fixture.render()')
    expect(await state()).toMatchObject({ titles: [], loading: true })
    await complete(2, ['新环境草稿']); await settle('fixture.oldList.resolve([fixture.draft("旧环境迟到草稿")]); fixture.oldGet.resolve(fixture.draft("旧环境草稿"))')
    expect(await state()).toMatchObject({ titles: ['新环境草稿'], dirty: false, snapshot: null, title: '' })
  })
  it('隐藏时 Remote 更换仍初始化新环境列表，不混用旧列表和读取状态', async () => {
    await complete(0, ['旧环境草稿']); await settle('fixture.show(false)')
    await settle('fixture.remote = { ...fixture.remote }; fixture.render()')
    expect(await state()).toMatchObject({ lists: 2, titles: [], loading: true, empty: false })
    await complete(1, ['新环境草稿'])
    expect(await state()).toMatchObject({ titles: ['新环境草稿'], loading: false })
    await settle('fixture.show(true)')
    expect((await state()).lists).toBe(3)
  })
  it('缺 listDrafts 能力显示不可用，而非空列表或失败', async () => {
    await settle('fixture.reset("author", true, false)')
    expect(await state()).toMatchObject({ lists: 0, unavailable: true, empty: false, loading: false, alert: null })
    await edit('draft-title', '仍可编辑'); expect(await state()).toMatchObject({ title: '仍可编辑', dirty: true })
  })
  it.each(['resolve', 'reject'])('StrictMode 重放和卸载后旧请求 %s 不覆盖新挂载', async result => {
    await settle('fixture.reset("author", true, true, true)'); expect((await state()).lists).toBe(2)
    await complete(1, ['严格模式新列表']); await complete(0, ['严格模式旧列表'])
    expect((await state()).titles).toEqual(['严格模式新列表'])
    await settle('fixture.show(false)'); await settle('fixture.show(true)')
    await settle('fixture.staleList = fixture.lists[2]; fixture.reset()'); await complete(0, ['新挂载列表'])
    if (result === 'resolve') await settle('fixture.staleList.resolve([fixture.draft("已卸载旧列表")])')
    else await settle('fixture.staleList.reject(new Error("已卸载迟到失败"))')
    expect(await state()).toMatchObject({ titles: ['新挂载列表'], alert: null, errors: [] })
  })
  it('MarketPage 离开确认保留编辑，真实导航返回刷新且不额外 get/save', async () => {
    await settle('fixture.reset("market")'); await until('document.body.textContent.includes("发现适合你的插件")')
    await complete(0, ['首次草稿']); await click('更多'); await click('作者工具')
    await until('fixture.lists.length === 2'); await complete(1, ['首次草稿'])
    await edit('draft-title', '会话标题'); await edit('draft-summary', '会话简介'); await edit('draft-markdown', '会话正文')
    await click('返回市场')
    expect(await evaluate('!!document.querySelector("[role=dialog]")')).toBe(true)
    await click('离开并保留编辑', '[role=dialog]')
    expect(await evaluate('document.querySelector("[aria-label=作者草稿工作区]").parentElement.hidden')).toBe(true)
    expect((await state()).lists).toBe(2)
    await click('更多'); await click('作者工具'); await until('fixture.lists.length === 3'); await complete(2, ['外部新增草稿'])
    expect(await state()).toMatchObject({ title: '会话标题', summary: '会话简介', markdown: '会话正文', titles: ['外部新增草稿'], beforeUnload: true, gets: [], saves: [], errors: [] })
    expect((await state()).text).toContain('有未保存修改')
  })
})
