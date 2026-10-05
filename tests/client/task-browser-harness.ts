import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import type { TaskState } from '../../packages/market/src/types.ts'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const edge = process.env.EAC_TEST_EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browserFixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { TaskDrawer } from './packages/market/src/client/TaskDrawer.tsx'
import { readOnlyRemote, taskFixture } from './tests/client/fixtures.ts'
const root = createRoot(document.getElementById('root'))
const nativeSetTimeout = window.setTimeout.bind(window)
const nativeClearTimeout = window.clearTimeout.bind(window)
const timers = new Map()
window.setTimeout = (handler, delay, ...args) => {
  const identifier = nativeSetTimeout(handler, delay, ...args)
  if ([12000, 20000, 45000].includes(delay)) timers.set(identifier, { handler, delay, args })
  return identifier
}
window.clearTimeout = identifier => { timers.delete(identifier); nativeClearTimeout(identifier) }
window.fixture = {
  reset() {
    flushSync(() => root.render(null))
    for (const identifier of timers.keys()) nativeClearTimeout(identifier)
    timers.clear()
    this.calls = { cancel: [], approve: [], resume: [], analyze: [], confirm: [], events: [], read: [] }
    this.changed = []; this.errors = []; this.refreshes = 0; this.catalogRefreshes = 0; this.recoveries = 0
    this.task = taskFixture(); this.remote = this.makeRemote(); this.open = true; this.strict = false
    this.render()
  },
  makeRemote() {
    const defer = (kind, request) => new Promise((resolve, reject) => this.calls[kind].push({ request, resolve, reject }))
    return { ...readOnlyRemote(),
      cancelTask: request => defer('cancel', request), approveTask: request => defer('approve', request),
      resumeTask: request => defer('resume', request), aiAnalyze: request => defer('analyze', request),
      aiConfirm: request => defer('confirm', request), taskEvents: request => defer('events', request),
      getTask: request => defer('read', request),
      refreshCatalog: async () => { this.catalogRefreshes++; throw new Error('不允许隐式刷新目录') },
      taskStartRecover: async () => { this.recoveries++; throw new Error('卡片没有原安装key，不能猜恢复请求') },
      pluginActionRecover: async () => { this.recoveries++; throw new Error('卡片没有原管理key，不能猜恢复请求') },
    }
  },
  render(patch = {}) {
    this.task = { ...this.task, ...patch }
    const drawer = <TaskDrawer open={this.open} tasks={[this.task]} remote={this.remote} onClose={() => {}} onChanged={next => this.changed.push(next)} onRefresh={() => this.refreshes++} />
    flushSync(() => root.render(this.strict ? <React.StrictMode>{drawer}</React.StrictMode> : drawer))
  },
  click(label) {
    const button = [...document.querySelectorAll('button')].find(element => element.textContent === label)
    if (!button) throw new Error('找不到按钮：' + label)
    button.click()
  },
  expire(delay) {
    const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay)
    if (!entry) throw new Error('找不到真实请求计时器：' + delay)
    const [identifier, timer] = entry
    nativeClearTimeout(identifier); timers.delete(identifier); timer.handler(...timer.args)
  },
  complete(kind, index, value) { this.calls[kind][index].resolve(value) },
  reject(kind, index, message) { this.calls[kind][index].reject(new Error(message)) },
  proposal(task = this.task) {
    this.lastProposal = { status: 'ready', proposal: {
      id: 'proposal-' + task.taskId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
      impactDigest: 'impact-' + task.taskId, summary: '仅属于 ' + task.taskId + ' 的方案', facts: ['保留原任务事实'],
      actions: [{ kind: 'retry-source', packageName: '@example/alpha', sourceId: 'source-original', reason: '使用原登记来源', requiresSecondConfirmation: false }],
      environmentId: task.environmentId, taskId: task.taskId,
    } }
    return this.lastProposal
  },
  history(message = '完整历史') { return { events: [{ sequence: 8, at: '2026-10-04T00:00:00Z', phase: 'partial', level: 'info', message }], nextSequence: 9, truncated: false } },
  openHistory() { const details = document.querySelector('details[aria-label="任务记录"]'); details.open = true; details.dispatchEvent(new Event('toggle')) },
  state() { return {
    calls: Object.fromEntries(Object.entries(this.calls).map(([kind, entries]) => [kind, entries.map(entry => entry.request)])),
    changed: this.changed, refreshes: this.refreshes, catalogRefreshes: this.catalogRefreshes, recoveries: this.recoveries,
    errors: this.errors, text: document.body.innerText,
    buttons: [...document.querySelectorAll('button')].map(button => ({ label: button.textContent, disabled: button.disabled })),
  } },
}
window.addEventListener('error', event => fixture.errors.push(event.message))
window.addEventListener('unhandledrejection', event => fixture.errors.push(String(event.reason)))
fixture.reset()
`
interface BrowserState {
  calls: Record<'cancel' | 'approve' | 'resume' | 'analyze' | 'confirm' | 'events' | 'read', Array<Record<string, unknown>>> & Record<string, Array<Record<string, unknown>>>
  changed: TaskState[]
  refreshes: number
  catalogRefreshes: number
  recoveries: number
  errors: string[]
  text: string
  buttons: Array<{ label: string; disabled: boolean }>
}
interface CdpResult {
  result?: { value?: unknown }
  exceptionDetails?: { exception?: { description?: string }; text: string }
}
export function createTaskBrowserHarness() {
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
  async function state(): Promise<BrowserState> { return evaluate<BrowserState>('fixture.state()') }
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
  async function click(label: string): Promise<void> { await settle('fixture.click(' + JSON.stringify(label) + ')') }
  async function disabled(label: string): Promise<boolean | undefined> { return (await state()).buttons.find(button => button.label === label)?.disabled }
  async function readyProposal(): Promise<void> {
    await click('AI 分析本任务')
    await settle('fixture.complete("analyze", fixture.calls.analyze.length - 1, fixture.proposal())')
    await until('document.body.textContent.includes("确认执行 AI 方案")')
  }
  beforeAll(async () => {
    if (!existsSync(edge)) throw new Error('需要现有 Edge；可使用 EAC_TEST_EDGE 指定路径，不安装依赖。')
    const profile = mkdtempSync(join(tmpdir(), 'eac-task-card-'))
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
    await send('Page.navigate', { url: 'http://127.0.0.1:' + address.port + '/' })
    await until('!!window.fixture && !!document.querySelector("article.eac-market__task")')
    console.info('Client fixture ready: ' + JSON.stringify({ fixture: 'task-card', page: await evaluate('({ ready: document.readyState, fixture: !!window.fixture })'), runtimeErrors, networkEvents: networkEvents.filter(event => { const fact = event as { url?: string; method: string }; return fact.url?.startsWith('http://me.kis.v2.scr.kaspersky-labs.com/') || fact.method === 'Network.loadingFailed' }) }))
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
  return { evaluate, state, until, settle, click, disabled, readyProposal }
}
