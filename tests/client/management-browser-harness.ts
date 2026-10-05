import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { afterAll, beforeAll, beforeEach } from 'vitest'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const edge = process.env.EAC_TEST_EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browserFixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MarketPage } from './packages/market/src/client/MarketPage.tsx'
import { helloFixture, inventoryFixture, readOnlyRemote } from './tests/client/fixtures.ts'
const root = createRoot(document.getElementById('root'))
const nativeSetTimeout = window.setTimeout.bind(window)
const nativeClearTimeout = window.clearTimeout.bind(window)
const timers = new Map()
window.setTimeout = (handler, delay, ...args) => {
  const identifier = nativeSetTimeout(handler, delay, ...args)
  if ([12000, 20000].includes(delay)) timers.set(identifier, { handler, delay, args })
  return identifier
}
window.clearTimeout = identifier => { timers.delete(identifier); nativeClearTimeout(identifier) }
window.fixture = {
  reset(clear = true) {
    flushSync(() => root.render(null))
    for (const identifier of timers.keys()) nativeClearTimeout(identifier)
    timers.clear()
    if (clear) localStorage.clear()
    this.calls = { writes: [], removes: [], recover: [] }; this.errors = []; this.official = 0; this.inventoryReads = 0
    this.environment = helloFixture.environmentId; this.oldHost = false; this.noCapability = false; this.noWrite = false; this.readFailure = false; this.inventoryFailure = false
    this.extraItems = []; this.strict = false; this.inventoryEnabled = true
    this.remote = this.makeRemote(); this.render()
  },
  makeRemote() {
    const defer = (kind, request) => new Promise((resolve, reject) => this.calls[kind].push({ request, resolve, reject }))
    const remote = { ...readOnlyRemote(),
      hello: async () => { if (this.readFailure) throw new Error('hello disconnected'); return { ...helloFixture, environmentId: this.environment, capabilities: this.noCapability ? helloFixture.capabilities : [...helloFixture.capabilities, 'operation-recovery'] } },
      inventory: async () => { this.inventoryReads++; if (this.inventoryFailure) throw new Error('inventory failed'); return { ...inventoryFixture, environmentId: this.environment, items: [...inventoryFixture.items.map((item, index) => index === 0 ? { ...item, bundleEnabled: this.inventoryEnabled } : item), ...this.extraItems] } },
      listTasks: async () => [], setPluginEnabled: request => defer('writes', request), removePlugin: request => defer('removes', request), pluginActionRecover: request => defer('recover', request),
    }
    if (this.oldHost) delete remote.pluginActionRecover
    if (this.noWrite) delete remote.setPluginEnabled
    return remote
  },
  render() { const page = <MarketPage remote={this.remote} onOpenOfficialPlugins={() => this.official++} />; flushSync(() => root.render(this.strict ? <React.StrictMode>{page}</React.StrictMode> : page)) },
  unmount() { flushSync(() => root.render(null)) },
  reconnect() { this.remote = this.makeRemote(); this.render() },
  click(label) { const button = [...document.querySelectorAll('button')].find(element => element.textContent === label); if (!button) throw new Error('button missing: ' + label); button.click() },
  complete(kind, index, result) { this.calls[kind][index].resolve(result) },
  reject(kind, index) { this.calls[kind][index].reject(new Error('transport disconnected')) },
  expire(delay) { for (const [identifier, timer] of timers) if (timer.delay === delay) { timers.delete(identifier); nativeClearTimeout(identifier); timer.handler(...timer.args) } },
  result(status = 'applied', changed = true) { return { status, changed, permissionChanges: [] } },
  recovery(status = 'applied', changed = true) { return { status: 'found', stage: 'settled', receipt: this.result('applied'), result: this.result(status, changed) } },
  pointers() { return Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('eac-market:management:')).map(key => [key, JSON.parse(localStorage.getItem(key))])) },
  state() { return { calls: Object.fromEntries(Object.entries(this.calls).map(([kind, entries]) => [kind, entries.map(entry => entry.request)])), errors: this.errors, official: this.official, inventoryReads: this.inventoryReads, pointers: this.pointers(), text: document.body.innerText, buttons: [...document.querySelectorAll('button')].map(button => ({ label: button.textContent, disabled: button.disabled })) } },
}
window.addEventListener('error', event => fixture.errors.push(event.message))
window.addEventListener('unhandledrejection', event => fixture.errors.push(String(event.reason)))
fixture.reset(false)
`
interface ManagementBrowserState {
  calls: Record<'writes' | 'removes' | 'recover', Array<Record<string, unknown>>>
  errors: string[]
  official: number
  inventoryReads: number
  pointers: Record<string, Record<string, unknown>>
  text: string
  buttons: Array<{ label: string; disabled: boolean }>
}
interface CdpResult {
  result?: { value?: unknown }
  exceptionDetails?: { exception?: { description?: string }; text: string }
}
export function createManagementBrowserHarness() {
  let server: Server | undefined
  let browser: ChildProcess | undefined
  let socket: WebSocket | undefined
  let nextId = 0
  const pending = new Map<number, { resolve: (value: CdpResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const runtimeErrors: unknown[] = []
  const pause = (duration: number) => new Promise<void>(done => setTimeout(done, duration))
  function send(method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
    return new Promise((resolveRequest, reject) => {
      const identifier = ++nextId
      const timer = setTimeout(() => { pending.delete(identifier); reject(new Error('CDP timeout: ' + method)) }, 5_000)
      pending.set(identifier, { resolve: resolveRequest, reject, timer })
      socket!.send(JSON.stringify({ id: identifier, method, params }))
    })
  }
  async function evaluate<Result = unknown>(expression: string): Promise<Result> {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result?.value as Result
  }
  async function state(): Promise<ManagementBrowserState> { return evaluate<ManagementBrowserState>('fixture.state()') }
  async function until(expression: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate<boolean>(expression)) return
      await pause(20)
    }
    throw new Error('DOM timeout: ' + expression + '; ' + JSON.stringify(await evaluate('window.fixture ? fixture.state() : ({ location: location.href, ready: document.readyState, html: document.documentElement.outerHTML })')) + '; ' + JSON.stringify(runtimeErrors))
  }
  async function settle(expression: string): Promise<void> {
    await evaluate(expression)
    await evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')
  }
  async function click(label: string): Promise<void> { await settle('fixture.click(' + JSON.stringify(label) + ')') }
  async function disabled(label: string): Promise<boolean | undefined> { return (await state()).buttons.find(button => button.label === label)?.disabled }
  beforeAll(async () => {
    if (!existsSync(edge)) throw new Error('需要现有 Edge；可使用 EAC_TEST_EDGE 指定路径，不安装依赖。')
    const profile = mkdtempSync(join(tmpdir(), 'eac-management-'))
    const fixture = await build({
      stdin: { contents: browserFixture, loader: 'tsx', resolveDir: workspace }, bundle: true, write: false,
      format: 'iife', platform: 'browser', jsx: 'automatic',
      alias: {
        react: join(workspace, 'packages/market/node_modules/react'), 'react-dom': join(workspace, 'packages/market/node_modules/react-dom'),
        '@dsh-eac/market-core/compatibility': join(workspace, 'packages/market-core/src/contracts/compatibility.ts'),
        '@dsh-eac/market-core/semver': join(workspace, 'packages/market-core/src/core/semver.ts'),
      },
      define: { 'process.env.NODE_ENV': '"development"' },
    })
    server = createServer((request, response) => {
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'self'")
      if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fixture.outputFiles[0]!.text) }
      else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><html lang="zh-CN"><body><div id="root"></div><script src="/fixture.js"></script></body></html>') }
    })
    await new Promise<void>(done => server!.listen(0, '127.0.0.1', done))
    browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    let launchError: Error | undefined
    browser.on('error', error => { launchError = error })
    for (let attempt = 0; attempt < 150 && !existsSync(join(profile, 'DevToolsActivePort')); attempt++) {
      if (launchError) throw launchError
      if (browser.exitCode !== null && browser.exitCode !== 0) throw new Error('Edge 提前退出：' + browser.exitCode)
      await pause(100)
    }
    if (!existsSync(join(profile, 'DevToolsActivePort'))) throw new Error('Edge 未提供隔离 CDP 端口')
    const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]
    const tabs = await fetch('http://127.0.0.1:' + port + '/json/list').then(response => response.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
    const page = tabs.find(tab => tab.type === 'page')
    if (!page) throw new Error('隔离 Edge 未提供真实页面')
    socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise<void>((done, reject) => { socket!.addEventListener('open', () => done(), { once: true }); socket!.addEventListener('error', () => reject(new Error('Edge CDP 连接失败')), { once: true }) })
    socket.addEventListener('message', event => {
      const eventMessage = JSON.parse(String(event.data)) as { method?: string; params?: unknown }
      if (eventMessage.method === 'Runtime.exceptionThrown') runtimeErrors.push(eventMessage.params)
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
    const navigation = await send('Page.navigate', { url: 'http://127.0.0.1:' + address.port + '/' })
    if ('errorText' in navigation) throw new Error('隔离页面导航失败：' + JSON.stringify(navigation))
    await until('!!window.fixture && !!document.querySelector(".eac-market-host")')
  }, 30_000)
  afterAll(async () => {
    if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close') } catch {} }
    socket?.close()
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('测试浏览器已关闭')) }
    pending.clear()
    if (browser && browser.exitCode === null) browser.kill()
    if (server) await new Promise<void>(done => server!.close(() => done()))
  }, 15_000)
  beforeEach(async () => { await settle('fixture.reset()') })
  async function reload(): Promise<void> {
    await send('Page.reload')
    await until('!!window.fixture && !!document.querySelector(".eac-market-host")')
  }
  return { evaluate, state, until, settle, click, disabled, reload }
}
