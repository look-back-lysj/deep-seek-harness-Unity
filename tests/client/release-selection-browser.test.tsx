import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { pluginFixtures } from './fixtures.ts'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const edge = process.env.EAC_TEST_EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browserFixture = `
import { InstallPlanDialog } from '/packages/market/src/client/InstallPlanDialog.tsx'
import { helloFixture, catalogFixture, inventoryFixture, pluginFixtures, taskFixture } from '/tests/client/fixtures.ts'
const root = ReactDOM.createRoot(document.getElementById('root'))
const nativeSetTimeout = window.setTimeout.bind(window)
window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(callback, window.fixture?.fastWrites && delay === 20000 ? 10 : window.fixture?.fastReads && delay === 12000 ? 10 : delay, ...args)
let serial = 0
window.fixture = {
  reset(mode = 'single', strict = false) {
    ReactDOM.flushSync(() => root.render(null))
    this.serial = ++serial; this.strict = strict; this.open = true
    this.lists = []; this.plans = []; this.starts = []; this.recovers = []; this.started = []; this.closed = []; this.hellos = []; this.errors = []
    this.fastWrites = false; this.fastReads = false; this.deferHello = false; this.inventory = inventoryFixture.items
    this.hello = { ...helloFixture, capabilities: [...helloFixture.capabilities, 'host-release-options', 'host-release-context', 'operation-recovery'] }
    this.target = { plugin: pluginFixtures.verified, plugins: [pluginFixtures.verified] }
    if (mode === 'pack') this.target = { pack: catalogFixture.packs[0], plugins: [pluginFixtures.verified] }
    if (mode === 'collection') this.target = { collection: { id: 'collection', name: '锁定组合', version: '1', collectionDigest: 'digest:collection', components: [{ pluginId: pluginFixtures.verified.id, version: pluginFixtures.verified.version, artifactDigest: pluginFixtures.verified.artifactDigest, required: true, enabled: false }], execution: { edges: [] } }, plugins: [pluginFixtures.verified] }
    this.remote = {
      hello: () => this.deferHello ? new Promise((resolve, reject) => this.hellos.push({ resolve, reject })) : Promise.resolve(this.hello),
      catalog: async () => catalogFixture, inventory: async () => inventoryFixture,
      releaseOptions: request => new Promise((resolve, reject) => this.lists.push({ request, resolve, reject })),
      createPlan: request => new Promise((resolve, reject) => this.plans.push({ request, resolve, reject })),
      startTask: request => new Promise((resolve, reject) => this.starts.push({ request, resolve, reject })),
      taskStartRecover: request => new Promise((resolve, reject) => this.recovers.push({ request, resolve, reject })),
    }
    this.render()
  },
  render() {
    const session = this.serial
    const dialog = React.createElement(InstallPlanDialog, { target: this.target, inventory: this.inventory, remote: this.remote, open: this.open,
      onClose: () => this.closed.push(session), onStarted: (task, reveal) => this.started.push({ session, taskId: task.taskId, reveal }) })
    ReactDOM.flushSync(() => root.render(this.strict ? React.createElement(React.StrictMode, null, dialog) : dialog))
  },
  option(version, patch = {}) {
    const plugin = this.target.plugins[0]
    return { identity: { pluginId: plugin.id, packageName: plugin.packageName, version, artifactDigest: 'artifact:' + version, metadataDigest: 'metadata:' + version, releaseId: 'release:' + version },
      compatibility: { status: 'compatible', declaredRanges: [] }, publication: 'active', artifact: { status: 'available', installability: 'bundle-installable' }, verification: 'verified', selectable: true,
      blockers: [], relation: 'upgrade', confirmationRequirements: ['ordinary-plan'], sources: [{ sourceId: 'forge', revision: 'source-1' }], ...patch }
  },
  page(releases, patch = {}) {
    return { packageName: this.target.plugins[0].packageName, includePrerelease: false,
      context: { environmentId: this.hello.environmentId, hostRevision: 'host-1', catalogRevision: 'catalog-1', inventoryRevision: 'inventory-1', checkedAt: '2026-10-04T00:00:00Z', catalogStale: false },
      hostCore: { agentId: 'dsh', agentName: 'DeepSeek Harness', version: '0.1.0', status: 'known', hostRevision: 'host-1', source: 'official' },
      installed: { status: 'known', version: '1.2.0' }, coverage: { historyCoverage: 'complete', obtainedRecords: releases.length, evaluatedRecords: releases.length, totalKnownRecords: releases.length, reasons: [] },
      latestPublished: releases[0]?.identity ?? null, latestCompatible: releases.find(option => option.compatibility.status === 'compatible')?.identity ?? null,
      latestPublishedCandidates: [], latestCompatibleCandidates: [], publishedAmbiguous: false, compatibleAmbiguous: false, releases, issues: [], pagination: { cursor: null, hasMore: false }, ...patch }
  },
  plan(index, action = 'upgrade') {
    const request = this.plans[index].request
    return { status: 'ready', plan: { planId: 'plan-' + index, planDigest: 'digest-' + index, schemaVersion: '1', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), environmentId: this.hello.environmentId, hostFingerprint: 'host-1', catalogRevision: 'catalog-1',
      ...(request.collectionId ? { collectionId: request.collectionId, collectionVersion: request.collectionVersion, collectionDigest: this.target.collection.collectionDigest } : {}),
      items: request.selections.map(selection => ({ pluginId: selection.pluginId, packageName: selection.packageName, targetVersion: selection.targetVersion, targetDigest: selection.targetDigest, releaseContext: selection.releaseContext, currentVersion: '1.2.0', currentEnabled: true, requestedEnabled: selection.enabledIntent, verification: 'verified', requiresRestart: false, blockers: [], action })) } }
  },
  completePlan(index, action = 'upgrade') { this.plans[index].resolve(this.plan(index, action)) },
  task() {
    const request = this.starts.at(-1)?.request ?? { planId: 'plan-0', planDigest: 'digest-0' }
    return taskFixture({ taskId: 'original-task', planId: request.planId, planDigest: request.planDigest, environmentId: this.hello.environmentId })
  },
  click(text) {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
    if (!button || button.disabled) throw new Error('button missing or disabled: ' + text)
    button.click()
  },
  choose(version) {
    const select = document.querySelector('select[aria-label="目标版本"]')
    const option = [...select.options].find(item => item.value && JSON.parse(item.value)[2] === version)
    if (!option || option.disabled || select.disabled) throw new Error('version unavailable: ' + version)
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  },
  switchPackage() {
    this.target = { plugin: pluginFixtures.unverified, plugins: [pluginFixtures.unverified] }; this.serial = ++serial; this.render()
  },
  state() {
    const select = document.querySelector('select[aria-label="目标版本"]')
    return { text: document.body.textContent, selected: select?.value ? JSON.parse(select.value)[2] : null,
      versions: [...(select?.options ?? [])].filter(option => option.value).map(option => ({ version: JSON.parse(option.value)[2], disabled: option.disabled, text: option.textContent })),
      buttons: [...document.querySelectorAll('button')].map(button => ({ text: button.textContent.trim(), disabled: button.disabled })),
      lists: this.lists.map(entry => entry.request), plans: this.plans.map(entry => entry.request), starts: this.starts.map(entry => entry.request), recovers: this.recovers.map(entry => entry.request),
      started: this.started, closed: this.closed, errors: this.errors }
  },
}
window.addEventListener('error', event => fixture.errors.push(event.message))
window.addEventListener('unhandledrejection', event => fixture.errors.push(String(event.reason)))
fixture.reset()
`

interface BrowserState {
  text: string
  selected: string | null
  versions: Array<{ version: string; disabled: boolean; text: string }>
  buttons: Array<{ text: string; disabled: boolean }>
  lists: Array<{ packageName: string; cursor?: string }>
  plans: Array<{ selections: Array<{ targetVersion: string; targetDigest: string; releaseContext?: { context: { catalogRevision: string }; sources: unknown[] } }> }>
  starts: Array<{ planId: string; planDigest: string; idempotencyKey: string; confirmed: boolean }>
  recovers: Array<{ planId: string; planDigest: string; idempotencyKey: string }>
  started: Array<{ session: number; taskId: string; reveal: boolean }>
  closed: number[]
  errors: string[]
}
interface CdpResult { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text: string } }
let server: Server | undefined
let browser: ChildProcess | undefined
let socket: WebSocket | undefined
let nextId = 0
const pending = new Map<number, { resolve: (value: CdpResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
const pause = (duration: number) => new Promise<void>(done => setTimeout(done, duration))
function send(method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
  return new Promise((resolveRequest, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 5_000)
    pending.set(id, { resolve: resolveRequest, reject, timer }); socket!.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate<Value = unknown>(expression: string): Promise<Value> {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result?.value as Value
}
async function settle(expression: string): Promise<void> {
  await evaluate(expression); await evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')
}
async function until(expression: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate<boolean>(expression)) return; await pause(20) }
  throw new Error(`DOM timeout: ${expression}; ${JSON.stringify(await evaluate('({ location: location.href, ready: document.readyState, fixture: !!window.fixture, scripts: [...document.scripts].map(script => { const url = new URL(script.src, location.href); return url.origin + url.pathname }), body: document.body.innerText })'))}`)
}
async function state(): Promise<BrowserState> { return evaluate<BrowserState>('fixture.state()') }
async function click(text: string): Promise<void> { await settle(`fixture.click(${JSON.stringify(text)})`) }
async function list(expression = '[fixture.option("2.0.0"), fixture.option("1.0.0", { relation: "downgrade" })]', patch = '{}', index = 0): Promise<void> {
  await settle(`fixture.lists[${index}].resolve(fixture.page(${expression}, ${patch}))`)
}
async function ready(index = 0, action = 'upgrade'): Promise<void> {
  await until(`fixture.plans.length > ${index}`); await settle(`fixture.completePlan(${index}, ${JSON.stringify(action)})`)
}
async function choose(version: string): Promise<void> { await settle(`fixture.choose(${JSON.stringify(version)})`) }
function confirmDisabled(value: BrowserState): boolean { return value.buttons.find(button => button.text === '确认安装')?.disabled ?? true }

beforeAll(async () => {
  if (!existsSync(edge)) throw new Error('需要现有 Edge；不安装依赖。')
  const profile = mkdtempSync(join(tmpdir(), 'eac-release-selection-'))
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
        const transformed = await transform(readFileSync(filename, 'utf8'), { loader: filename.endsWith('tsx') ? 'tsx' : filename.endsWith('.ts') ? 'ts' : 'js', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', format: 'esm' })
        response.end(transformed.code.replace(/(["'])react\1/g, '"/react.js"').replace(/(["'])@dsh-eac\/market-core\/compatibility\1/g, '"/packages/market-core/src/contracts/compatibility.ts"').replace(/(["'])@dsh-eac\/market-core\/semver\1/g, '"/packages/market-core/lib/semver.js"'))
      }
    } catch (error) { response.statusCode = 500; response.end(String(error)) }
  })
  await new Promise<void>(done => server!.listen(0, '127.0.0.1', done))
  browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let launchError: Error | undefined
  browser.on('error', error => { launchError = error })
  for (let attempt = 0; attempt < 150 && !existsSync(join(profile, 'DevToolsActivePort')); attempt++) {
    if (launchError) throw launchError
    if (browser.exitCode !== null && browser.exitCode !== 0) throw new Error(`Edge 启动失败：${browser.exitCode}`)
    await pause(100)
  }
  const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0])
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
  socket = new WebSocket(tabs.find(tab => tab.type === 'page')!.webSocketDebuggerUrl)
  await new Promise<void>((done, reject) => { socket!.addEventListener('open', () => done(), { once: true }); socket!.addEventListener('error', () => reject(new Error('Edge CDP 连接失败')), { once: true }) })
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)) as { id: number; error?: { message: string }; result: CdpResult }
    const entry = pending.get(message.id); if (!entry) return
    clearTimeout(entry.timer); pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result)
  })
  await send('Page.enable')
  await send('Network.enable')
  await send('Network.setBlockedURLs', { urls: ['http://me.kis.v2.scr.kaspersky-labs.com/*'] })
  await send('Page.navigate', { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` })
  await until('!!window.fixture && fixture.lists.length === 1')
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

describe('安装版本选择与提交恢复（真实 React / 隔离 Edge）', () => {
  it('列表返回前不预检；默认最高适配升级并完整绑定上下文', async () => {
    expect((await state()).plans).toHaveLength(0); expect(confirmDisabled(await state())).toBe(true)
    await list('[fixture.option("3.0.0", { selectable: false, compatibility: { status: "incompatible", reason: "core-too-old", declaredRanges: [">=0.2"] } }), fixture.option("2.0.0")]')
    await ready()
    expect(await state()).toMatchObject({ selected: '2.0.0', plans: [{ selections: [{ targetVersion: '2.0.0', targetDigest: 'artifact:2.0.0', releaseContext: { context: { catalogRevision: 'catalog-1' }, sources: [{ sourceId: 'forge', revision: 'source-1' }] } }] }] })
    expect((await state()).text).toContain('DeepSeek Harness核心版本过旧'); expect(confirmDisabled(await state())).toBe(false)
  })
  it.each(['same', 'downgrade', 'unknown'])('无升级时不默认选择 %s', async relation => {
    await list(`[fixture.option("1.0.0", { relation: ${JSON.stringify(relation)} })]`)
    expect(await state()).toMatchObject({ selected: null, plans: [] }); expect((await state()).text).toContain('不会自动降级或选同版')
  })
  it('首次安装按后端可选适配事实选择，不需虚构升级关系', async () => {
    await list('[fixture.option("2.0.0", { relation: "unknown" })]', '{ installed: { status: "absent", version: null } }'); await ready(0, 'add')
    expect((await state()).selected).toBe('2.0.0'); expect(confirmDisabled(await state())).toBe(false)
  })
  it('手选降级必须两次确认；首次点击不提交', async () => {
    await list(); await ready(); await choose('1.0.0'); await ready(1, 'downgrade')
    await click('查看降级影响'); expect((await state()).starts).toHaveLength(0)
    expect((await state()).text).toContain('第 2 步：再次确认降级影响')
    await click('已了解影响，确认降级'); expect((await state()).starts).toHaveLength(1)
    await settle('fixture.starts[0].resolve(fixture.task())'); expect((await state()).started).toMatchObject([{ taskId: 'original-task', reveal: true }])
  })
  it('换版本立即使旧预检失效，迟到的旧 ready 不可确认', async () => {
    await list(); await until('fixture.plans.length === 1'); await choose('1.0.0')
    expect(confirmDisabled(await state())).toBe(true)
    await settle('fixture.completePlan(0)'); expect(confirmDisabled(await state())).toBe(true)
    await ready(1, 'downgrade'); expect((await state()).text).toContain('将降级')
  })
  it('父页重建等价 target 与库存对象不清列表、不打断列表和预检', async () => {
    await settle('fixture.target = { ...fixture.target, plugin: { ...fixture.target.plugin }, plugins: fixture.target.plugins.map(plugin => ({ ...plugin })) }; fixture.inventory = fixture.inventory.map(item => ({ ...item, rows: [...item.rows] })); fixture.render()')
    expect((await state()).lists).toHaveLength(1)
    await list(); await until('fixture.plans.length === 1')
    await settle('fixture.target = { ...fixture.target, plugins: fixture.target.plugins.map(plugin => ({ ...plugin })) }; fixture.render()')
    expect((await state()).lists).toHaveLength(1); expect((await state()).plans).toHaveLength(1)
    await ready(); await choose('1.0.0'); await ready(1, 'downgrade')
    await settle('fixture.target = { ...fixture.target }; fixture.inventory = fixture.inventory.map(item => ({ ...item })); fixture.render()')
    expect((await state()).selected).toBe('1.0.0'); expect((await state()).plans).toHaveLength(2)
  })
  it('无关库存变化不打断，目标库存事实变化才刷新并失效旧预检', async () => {
    await list(); await ready()
    await settle('fixture.inventory = [...fixture.inventory, { ...fixture.inventory[0], packageName: "@example/unrelated", version: "9.0.0" }]; fixture.render()')
    expect((await state()).lists).toHaveLength(1); expect(confirmDisabled(await state())).toBe(false)
    await settle('fixture.inventory = fixture.inventory.map(item => item.packageName === fixture.target.plugins[0].packageName ? { ...item, version: "1.5.0" } : item); fixture.render()')
    expect((await state()).lists).toHaveLength(2); expect(confirmDisabled(await state())).toBe(true)
    await list(undefined, '{ installed: { status: "known", version: "1.5.0" }, context: { ...fixture.page([]).context, inventoryRevision: "inventory-2" } }', 1); await ready(1)
    expect((await state()).plans[1]?.selections[0]?.releaseContext).toMatchObject({ context: { inventoryRevision: 'inventory-2' } })
  })
  it('第一页 20 条均无适配时自动只读翻页选择第 21 条，不等待用户加载', async () => {
    await list('Array.from({ length: 20 }, (_, index) => fixture.option("blocked-" + index, { selectable: false, compatibility: { status: "incompatible", reason: "core-too-new", declaredRanges: [] } }))', '{ pagination: { cursor: "page2", hasMore: true } }')
    await until('fixture.lists.length === 2'); expect((await state()).plans).toHaveLength(0)
    expect((await state()).lists[1]?.cursor).toBe('page2')
    await list('[fixture.option("2.0.0")]', '{}', 1); await ready()
    expect((await state()).selected).toBe('2.0.0'); expect((await state()).versions).toHaveLength(21)
    expect((await state()).starts).toHaveLength(0)
  })
  it('自动只读分页到末尾仍无升级才说明无默认，不降级或选同版', async () => {
    await list('[fixture.option("1.2.0", { relation: "same" })]', '{ pagination: { cursor: "page2", hasMore: true } }')
    await until('fixture.lists.length === 2'); await list('[fixture.option("1.0.0", { relation: "downgrade" })]', '{}', 1)
    expect(await state()).toMatchObject({ selected: null, plans: [] })
    expect((await state()).text).toContain('没有可自动选择的适配更新')
  })
  it('自动只读分页上限有明确历史未完整说明，不声称不存在更新', async () => {
    await list('[]', '{ pagination: { cursor: "page-1", hasMore: true } }')
    for (let index = 1; index <= 20; index++) {
      await until(`fixture.lists.length > ${index}`)
      await evaluate(`fixture.lists[${index}].resolve(fixture.page([], { pagination: { cursor: "page-${index + 1}", hasMore: true } }))`)
    }
    await until('document.body.textContent.includes("20 页上限")')
    expect((await state()).lists).toHaveLength(21); expect((await state()).plans).toHaveLength(0)
    expect((await state()).text).toContain('版本历史仍未读取完整'); expect((await state()).text).not.toContain('没有可自动选择的适配更新')
    await click('加载更多版本'); await list('[fixture.option("2.0.0")]', '{}', 21); await ready()
    expect((await state()).selected).toBe('2.0.0')
  })
  it('分页保留有效手选，并将后端来源转交新预检', async () => {
    await list(undefined, '{ pagination: { cursor: "page2", hasMore: true } }'); await ready()
    await choose('1.0.0'); await ready(1, 'downgrade'); await click('加载更多版本')
    expect((await state()).lists[1]?.cursor).toBe('page2'); expect(confirmDisabled(await state())).toBe(true)
    await list('[fixture.option("0.5.0", { relation: "downgrade" })]', '{}', 1); await ready(2, 'downgrade')
    expect((await state()).selected).toBe('1.0.0'); expect((await state()).versions.map(option => option.version)).toEqual(['2.0.0', '1.0.0', '0.5.0'])
  })
  it('刷新会跨页查找原手选，不偷偷换成首屏升级', async () => {
    await list('[fixture.option("2.0.0")]', '{ pagination: { cursor: "page2", hasMore: true } }'); await ready()
    await click('加载更多版本'); await list('[fixture.option("1.0.0", { relation: "downgrade" })]', '{}', 1); await ready(1)
    await choose('1.0.0'); await ready(2, 'downgrade'); await click('刷新版本列表')
    await list('[fixture.option("2.0.0")]', '{ pagination: { cursor: "fresh-page2", hasMore: true } }', 2)
    expect((await state()).plans).toHaveLength(3); expect((await state()).lists[3]?.cursor).toBe('fresh-page2')
    await list('[fixture.option("1.0.0", { relation: "downgrade" })]', '{}', 3); await ready(3, 'downgrade')
    expect((await state()).selected).toBe('1.0.0')
  })
  it('手选身份失效后明确提示，不能仅按同版本保留不同摘要', async () => {
    await list(); await ready(); await choose('1.0.0'); await ready(1, 'downgrade'); await click('刷新版本列表')
    await list('[fixture.option("2.0.0"), fixture.option("1.0.0", { identity: { ...fixture.option("1.0.0").identity, artifactDigest: "changed" }, relation: "downgrade", selectable: false })]', '{}', 1); await ready(2)
    expect((await state()).selected).toBe('2.0.0'); expect((await state()).text).toContain('原手选版本已不可用')
  })
  it.each(['catalogRevision', 'inventoryRevision', 'hostRevision', 'environmentId'])('分页 %s 变化不混用列表或原预检', async field => {
    await list(undefined, '{ pagination: { cursor: "page2", hasMore: true } }'); await ready(); await click('加载更多版本')
    await list('[fixture.option("0.5.0")]', `{ context: { ...fixture.page([]).context, ${field}: "changed" } }`, 1)
    expect(await state()).toMatchObject({ selected: null, plans: [{ selections: [{ targetVersion: '2.0.0' }] }] })
    expect((await state()).text).toContain('旧预检已失效'); expect(confirmDisabled(await state())).toBe(true)
  })
  it('列表 stale 不预检，不以目录缓存作为 fallback', async () => {
    await list(undefined, '{ context: { ...fixture.page([]).context, catalogStale: true } }')
    expect(await state()).toMatchObject({ selected: null, plans: [] }); expect((await state()).text).toContain('目录列表已过时')
  })
  it('核心 unknown 即使条目声称 compatible 也不默认选择；手选仍交后端预检', async () => {
    await list('[fixture.option("2.0.0")]', '{ hostCore: { ...fixture.page([]).hostCore, status: "unknown", version: null } }')
    expect(await state()).toMatchObject({ selected: null, plans: [] }); expect((await state()).text).toContain('核心版本未知')
    expect((await state()).text).not.toContain('核心版本过旧')
    await choose('2.0.0'); await ready(); expect(confirmDisabled(await state())).toBe(false)
  })
  it('最新包记录不在当前页时说明未读取，加载后才展示版本与要求范围', async () => {
    await list('[fixture.option("2.0.0")]', '{ latestPublished: fixture.option("3.0.0").identity, pagination: { cursor: "page2", hasMore: true } }'); await ready()
    expect((await state()).text).toContain('最新包 3.0.0 的记录尚未在已读取页面中')
    expect((await state()).text).not.toContain('核心版本过旧'); await click('加载更多版本')
    await list('[fixture.option("3.0.0", { selectable: false, compatibility: { status: "incompatible", reason: "core-too-old", declaredRanges: [">=0.2.0"] } })]', '{}', 1); await ready(1)
    expect((await state()).text).toContain('DeepSeek Harness核心版本过旧：当前核心 0.1.0；最新包 3.0.0；要求范围 >=0.2.0')
  })
  it.each(['missing', 'identity', 'sources', 'context', 'target'])('后端 ready 的 %s 绑定缺失或变化时不可确认', async problem => {
    await list(); await until('fixture.plans.length === 1')
    await settle(`fixture.bad = fixture.plan(0); ${problem === 'missing' ? 'delete fixture.bad.plan.items[0].releaseContext' : problem === 'identity' ? 'fixture.bad.plan.items[0].releaseContext = { ...fixture.bad.plan.items[0].releaseContext, identity: { ...fixture.bad.plan.items[0].releaseContext.identity, metadataDigest: "changed" } }' : problem === 'sources' ? 'fixture.bad.plan.items[0].releaseContext = { ...fixture.bad.plan.items[0].releaseContext, sources: [{ sourceId: "forge", revision: "changed" }] }' : problem === 'context' ? 'fixture.bad.plan.items[0].releaseContext = { ...fixture.bad.plan.items[0].releaseContext, context: { ...fixture.bad.plan.items[0].releaseContext.context, catalogRevision: "changed" } }' : 'fixture.bad.plan.items[0].targetVersion = "changed"'}; fixture.plans[0].resolve(fixture.bad)`)
    expect(confirmDisabled(await state())).toBe(true); expect((await state()).text).toContain('预检未绑定当前版本身份和可信来源')
    expect((await state()).starts).toHaveLength(0)
  })
  it('未知、冲突、缺制品、历史不全各自说明，不误报 core-too-old', async () => {
    await list('[fixture.option("3.0.0", { selectable: false, compatibility: { status: "conflict", reason: "metadata-conflict", declaredRanges: [] } }), fixture.option("2.0.0", { compatibility: { status: "unknown", declaredRanges: [] } }), fixture.option("1.0.0", { selectable: false, artifact: { status: "missing", installability: "missing-artifact" } })]', '{ compatibleAmbiguous: true, coverage: { historyCoverage: "partial", obtainedRecords: 3, evaluatedRecords: 3, totalKnownRecords: null, reasons: [] } }')
    const value = await state()
    for (const message of ['冲突', '历史不完整', '核心适配未知', '缺少制品']) expect(value.text).toContain(message)
    expect(value.text).not.toContain('核心版本过旧'); expect(value.plans).toHaveLength(0)
    expect(value.versions.map(option => option.disabled)).toEqual([true, false, true])
    await choose('2.0.0'); await ready(); expect(confirmDisabled(await state())).toBe(false)
  })
  it('列表读取失败不假装无更新；显式刷新才发下一次请求', async () => {
    await settle('fixture.lists[0].reject(new Error("offline"))')
    expect((await state()).text).toContain('无法读取可信版本列表'); expect((await state()).plans).toHaveLength(0)
    await click('刷新版本列表'); expect((await state()).lists).toHaveLength(2); await list(undefined, '{}', 1); await ready()
  })
  it('预检超时后的迟到 ready 不生效，显式重新预检仍使用选定上下文', async () => {
    await settle('fixture.fastReads = true'); await list(); await until('document.body.textContent.includes("安装预检超时")')
    await settle('fixture.completePlan(0)'); expect(confirmDisabled(await state())).toBe(true)
    await settle('fixture.fastReads = false'); await click('重新预检'); await ready(1)
    expect((await state()).plans[1]?.selections[0]?.targetVersion).toBe('2.0.0'); expect(confirmDisabled(await state())).toBe(false)
  })
  it('包 A 列表迟到不能覆盖包 B', async () => {
    await settle('fixture.oldPage = fixture.page([fixture.option("9.0.0")]); fixture.switchPackage()')
    await settle('fixture.lists[0].resolve(fixture.oldPage)'); expect((await state()).plans).toHaveLength(0)
    await list('[fixture.option("2.0.0")]', '{}', 1); await ready()
    expect((await state()).selected).toBe('2.0.0'); expect((await state()).lists[1]?.packageName).toBe(pluginFixtures.unverified.packageName)
  })
  it('Remote 更换后旧列表不能进入新环境', async () => {
    await settle('fixture.remote = { ...fixture.remote }; fixture.render()')
    await list('[fixture.option("9.0.0")]', '{}', 0); expect((await state()).plans).toHaveLength(0)
    await list('[fixture.option("2.0.0")]', '{}', 1); await ready(); expect((await state()).selected).toBe('2.0.0')
  })
  it('旧 capability 缺失或 optional API 缺失时保留原安全预检', async () => {
    await settle('fixture.hello.capabilities = fixture.hello.capabilities.filter(value => value !== "host-release-context"); fixture.remote = { ...fixture.remote }; fixture.render()')
    await ready(); expect((await state()).lists).toHaveLength(1)
    expect((await state()).plans[0]?.selections[0]).not.toHaveProperty('releaseContext'); expect((await state()).text).toContain('目录锁定版本')
    await settle('fixture.reset(); delete fixture.remote.releaseOptions; fixture.remote = { ...fixture.remote }; fixture.render()')
    await ready(); expect((await state()).plans[0]?.selections[0]).not.toHaveProperty('releaseContext')
  })
  it.each(['pack', 'collection'])('%s 保持锁定版本，不调用版本列表或自动换版', async mode => {
    await settle(`fixture.reset(${JSON.stringify(mode)})`); await ready(0, 'add')
    expect((await state()).lists).toHaveLength(0); expect((await state()).selected).toBeNull()
    expect((await state()).plans[0]?.selections[0]?.targetVersion).toBe(pluginFixtures.verified.version)
    expect((await state()).text).not.toContain('目标版本')
  })
  it('默认选择意外得到 downgrade 计划仍不能执行', async () => {
    await list(); await ready(0, 'downgrade')
    expect((await state()).text).toContain('默认更新不会执行降级'); expect((await state()).starts).toHaveLength(0)
    expect((await state()).buttons.find(button => button.text === '查看降级影响')?.disabled).toBe(true)
  })
  it('提交超时只读查询原 plan/digest/key，not-found 不自动重试，found 返回原任务', async () => {
    await list(); await ready(); await settle('fixture.fastWrites = true'); await click('确认安装')
    await until('document.body.textContent.includes("提交安装超时")')
    expect(confirmDisabled(await state())).toBe(true); await click('只读查询原提交结果')
    const before = await state(); const start = before.starts[0]!
    expect(before.recovers[0]).toEqual({ planId: start.planId, planDigest: start.planDigest, idempotencyKey: start.idempotencyKey })
    await settle('fixture.recovers[0].resolve({ status: "not-found" })')
    expect((await state()).text).toContain('不能证明没有写入'); expect((await state()).starts).toHaveLength(1)
    await click('只读查询原提交结果'); await settle('fixture.recovers[1].resolve({ status: "found", task: fixture.task() })')
    expect(await state()).toMatchObject({ started: [{ taskId: 'original-task', reveal: true }], starts: [start] })
    expect((await state()).closed).toHaveLength(1)
  })
  it('恢复查询失败仍不重放，也不恢复可点击的安装确认', async () => {
    await list(); await ready(); await settle('fixture.fastWrites = true'); await click('确认安装'); await until('document.body.textContent.includes("提交安装超时")')
    await click('只读查询原提交结果'); await settle('fixture.recovers[0].reject(new Error("offline"))')
    expect((await state()).text).toContain('不会重放安装'); expect(confirmDisabled(await state())).toBe(true)
    expect((await state()).starts).toHaveLength(1)
  })
  it('超时之后原请求迟到成功不解锁或重放，仍可只读查询原提交', async () => {
    await list(); await ready(); await settle('fixture.fastWrites = true'); await click('确认安装')
    await until('document.body.textContent.includes("提交安装超时")'); await settle('fixture.starts[0].resolve(fixture.task())')
    expect((await state()).started).toHaveLength(0); expect(confirmDisabled(await state())).toBe(true)
    await click('只读查询原提交结果'); await settle('fixture.recovers[0].resolve({ status: "found", task: fixture.task() })')
    expect((await state()).starts).toHaveLength(1); expect((await state()).started).toMatchObject([{ taskId: 'original-task', reveal: true }])
  })
  it('后台耐久任务已创建但网络 reject 时保留原身份，只读找回而不新键重放', async () => {
    await list(); await ready(); await click('确认安装')
    await settle('fixture.durableTask = fixture.task(); fixture.starts[0].reject(new Error("Network connection lost after durable commit"))')
    expect((await state()).text).toContain('提交结果未知，可能已写入'); expect(confirmDisabled(await state())).toBe(true)
    expect((await state()).buttons.find(button => button.text === '刷新版本列表')?.disabled).toBe(true)
    await click('只读查询原提交结果')
    const value = await state(); const start = value.starts[0]!
    expect(value.recovers[0]).toEqual({ planId: start.planId, planDigest: start.planDigest, idempotencyKey: start.idempotencyKey })
    await settle('fixture.recovers[0].resolve({ status: "found", task: fixture.durableTask })')
    expect((await state()).starts).toHaveLength(1); expect((await state()).started).toMatchObject([{ taskId: 'original-task', reveal: true }])
  })
  it.each(['planId', 'planDigest', 'environmentId'])('恢复 found 的 %s 不匹配不能关联任务或解锁提交', async field => {
    await list(); await ready(); await click('确认安装'); await settle('fixture.starts[0].reject(new Error("offline"))')
    await click('只读查询原提交结果'); await settle(`fixture.recovers[0].resolve({ status: "found", task: { ...fixture.task(), ${field}: "other" } })`)
    expect((await state()).started).toHaveLength(0); expect((await state()).closed).toHaveLength(0)
    expect(confirmDisabled(await state())).toBe(true); expect((await state()).starts).toHaveLength(1)
    expect((await state()).text).toContain('无法确认原提交结果')
  })
  it('明确 plan/stale 领域拒绝才允许重新预检，不能靠错误消息猜未写入', async () => {
    await list(); await ready(); await click('确认安装')
    await settle('fixture.starts[0].reject(Object.assign(new Error("expired"), { code: "plan/stale" }))')
    expect((await state()).text).toContain('后台明确拒绝提交'); await click('重新预检'); await ready(1)
    expect(confirmDisabled(await state())).toBe(false)
    await click('确认安装'); await settle('fixture.starts[1].reject(new Error("plan/stale"))')
    expect(confirmDisabled(await state())).toBe(true); expect((await state()).text).toContain('提交结果未知')
    expect((await state()).starts[1]?.idempotencyKey).not.toBe((await state()).starts[0]?.idempotencyKey)
  })
  it('提交回执身份不匹配不能关闭确认窗或当作成功', async () => {
    await list(); await ready(); await click('确认安装'); await settle('fixture.starts[0].resolve({ ...fixture.task(), planDigest: "wrong" })')
    expect((await state()).started).toHaveLength(0); expect((await state()).closed).toHaveLength(0)
    expect(confirmDisabled(await state())).toBe(true); expect((await state()).text).toContain('提交结果未知')
  })
  it('缺 operation-recovery 不调用 optional 查询，超时仍保持安全 fallback', async () => {
    await settle('fixture.hello.capabilities = fixture.hello.capabilities.filter(value => value !== "operation-recovery"); fixture.remote = { ...fixture.remote }; fixture.render()')
    await list(undefined, '{}', 1); await ready(); await settle('fixture.fastWrites = true'); await click('确认安装'); await until('document.body.textContent.includes("提交安装超时")')
    expect((await state()).buttons.some(button => button.text === '只读查询原提交结果')).toBe(false)
    expect((await state()).starts).toHaveLength(1); expect(confirmDisabled(await state())).toBe(true)
  })
  it('Host 有恢复能力但 optional 方法缺失时仍不重放', async () => {
    await settle('delete fixture.remote.taskStartRecover; fixture.remote = { ...fixture.remote }; fixture.render()')
    await list(undefined, '{}', 1); await ready(); await settle('fixture.fastWrites = true'); await click('确认安装'); await until('document.body.textContent.includes("提交安装超时")')
    expect((await state()).buttons.some(button => button.text === '只读查询原提交结果')).toBe(false)
    expect((await state()).starts).toHaveLength(1); expect(confirmDisabled(await state())).toBe(true)
  })
  it('A 提交成功迟到只关联 A，不关闭 B 或夺取其任务焦点', async () => {
    await list(); await ready(); await click('确认安装'); await settle('fixture.switchPackage()')
    await list('[fixture.option("2.0.0")]', '{}', 1); await ready(1)
    await settle('fixture.starts[0].resolve(fixture.task())')
    expect((await state()).started).toMatchObject([{ taskId: 'original-task', reveal: false }]); expect((await state()).closed).toHaveLength(0)
    expect(confirmDisabled(await state())).toBe(false)
  })
  it('StrictMode 重放与卸载后的迟到列表不进入新挂载', async () => {
    await settle('fixture.oldList = fixture.lists[0]; fixture.oldPage = fixture.page([fixture.option("9.0.0")]); fixture.reset("single", true)')
    await until('fixture.lists.length === 1'); await settle('fixture.oldList.resolve(fixture.oldPage)')
    await list('[fixture.option("2.0.0")]'); await ready(); expect((await state()).selected).toBe('2.0.0')
    expect((await state()).errors).toEqual([])
  })
  it('hello 失败不能当作旧宿主降级；必须显式重读', async () => {
    await settle('fixture.deferHello = true; fixture.remote = { ...fixture.remote }; fixture.render()')
    await until('fixture.hellos.length === 1'); await settle('fixture.hellos[0].reject(new Error("offline"))')
    expect((await state()).text).toContain('无法读取可信版本列表'); expect((await state()).plans).toHaveLength(0)
    await click('刷新版本列表'); expect(await evaluate('fixture.hellos.length')).toBe(2)
  })
})
