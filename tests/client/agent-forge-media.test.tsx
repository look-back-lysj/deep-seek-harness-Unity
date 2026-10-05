import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CatalogMediaIcon, PluginCard, ScreenshotGallery } from '../../packages/market/src/client/components.tsx'
import { safeMediaSource } from '../../packages/market/src/client/media.tsx'
import { PendingListings } from '../../packages/market/src/client/PendingListings.tsx'
import type { CatalogListing, CatalogMedia } from '../../packages/market/src/types.ts'
import { pluginFixtures } from './fixtures.ts'

const react = await import(new URL('../../packages/market/node_modules/react/index.js', import.meta.url).href)
const renderer = await import(new URL('../../packages/market/node_modules/react-dom/server.node.js', import.meta.url).href)
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const edge = process.env.EAC_TEST_EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const icon: CatalogMedia = { id: 'forge-icon', alt: '测试图标声明', sourceUrl: 'https://media.example.test/icon.png' }
const preview: CatalogMedia = { id: 'forge-preview', alt: '测试预览声明', sourceUrl: 'https://media.example.test/preview.png', theme: 'dark' }
const invalidSources = [
  'javascript:alert(1)', 'data:image/png;base64,AA==', 'file:///C:/private/image.png',
  'http://media.example.test/image.png', '//media.example.test/image.png', 'blob:https://media.example.test/id',
  'https://user:password@media.example.test/image.png', 'https://user@media.example.test/image.png',
  'https://:password@media.example.test/image.png', 'https://media.example.test:bad/image.png',
  'https://', 'not a URL', ' https://media.example.test/image.png',
  'https://media.example.test/\nimage.png', 'https://media.example.test\\image.png', 'https://media.example.test/' + 'a'.repeat(4096),
]
const listing: CatalogListing = {
  id: 'registration-only', name: '登记测试', packageName: '@fixture/registration-only', summary: '只有登记资料',
  reason: '缺少制品', sourceUrl: 'https://example.test/source', media: { icon, previews: [preview] },
}

const browserFixture = [
  "import { PluginCard, ScreenshotGallery } from '/packages/market/src/client/components.tsx'",
  "import { PendingListings } from '/packages/market/src/client/PendingListings.tsx'",
  "import { MARKET_CSS } from '/packages/market/src/client/marketStyles.ts'",
  "import { MEDIA_CSS } from '/packages/market/src/client/mediaStyles.ts'",
  "import { pluginFixtures } from '/tests/client/fixtures.ts'",
  "const style = document.createElement('style'); style.textContent = MARKET_CSS + MEDIA_CSS; document.head.prepend(style)",
  "const root = ReactDOM.createRoot(document.getElementById('root'))",
  'window.fixture = {',
  '  reset() {',
  '    ReactDOM.flushSync(() => root.render(null))',
  '    this.serial = (this.serial ?? 0) + 1',
  "    this.icon = { id: 'icon', alt: '测试图标声明', sourceUrl: 'https://media.example.test/icon.png?fixture=' + this.serial }",
  "    this.previews = []; this.listingMedia = undefined; this.installs = 0; this.verification = 'verified'; this.strict = true; this.canInstall = true",
  '    this.render()',
  '  },',
  '  render(patch = {}) {',
  '    Object.assign(this, patch)',
  "    const plugin = { ...pluginFixtures.verified, name: 'alpha', verification: this.verification, ...(this.icon ? { media: { icon: this.icon, previews: this.previews } } : {}) }",
  "    const listing = { id: 'listing', name: '登记测试', packageName: '@fixture/listing', summary: '测试登记', reason: '缺少制品', sourceUrl: 'https://example.test/source', media: this.listingMedia ?? { icon: this.icon, previews: this.previews } }",
  '    const content = React.createElement(React.Fragment, null,',
  '      React.createElement(PluginCard, { plugin, inventory: [], canInstall: this.canInstall, onOpen() {}, onInstall: () => this.installs++ }),',
  '      React.createElement(ScreenshotGallery, { screenshots: this.previews }),',
  "      React.createElement('div', { id: 'listing' }, React.createElement(PendingListings, { listings: [listing], query: '' })))",
  '    ReactDOM.flushSync(() => root.render(this.strict ? React.createElement(React.StrictMode, null, content) : content))',
  "    document.querySelectorAll('img').forEach(image => { image.loading = 'eager' })",
  '  },',
  "  preview(sourceUrl = 'https://media.example.test/preview.png?fixture=' + this.serial, theme = 'dark') { return { id: 'preview', alt: '测试预览声明', sourceUrl, theme } },",
  "  click(label) { const button = [...document.querySelectorAll('button')].find(button => button.textContent === label || button.getAttribute('aria-label') === label); if (!button) throw new Error('找不到按钮：' + label); button.click() },",
  '  state() { return {',
  "    iconText: document.querySelector('.eac-market__plugin-card .eac-market__media-icon').textContent,",
  "    icon: [...document.querySelectorAll('.eac-market__plugin-card .eac-market__media-icon img')].map(image => ({ source: image.src, hidden: image.hidden, width: image.naturalWidth, visible: getComputedStyle(image).display !== 'none' })),",
  "    previews: [...document.querySelectorAll('.eac-market__gallery img')].map(image => ({ source: image.src, width: image.naturalWidth })),",
  "    themes: [...document.querySelectorAll('.eac-market__media-theme')].map(element => element.textContent),",
  "    failures: [...document.querySelectorAll('.eac-market__gallery-fallback')].map(element => element.textContent),",
  "    dialogs: document.querySelectorAll('[role=dialog]').length, installs: this.installs,",
  "    listingButtons: document.querySelectorAll('#listing button').length,",
  "    buttons: [...document.querySelectorAll('.eac-market__plugin-card button')].map(button => ({ text: button.textContent, disabled: button.disabled })),",
  '  } },',
  '}',
  'fixture.reset()',
].join('\n')

interface BrowserState {
  iconText: string
  icon: Array<{ source: string; hidden: boolean; width: number; visible: boolean }>
  previews: Array<{ source: string; width: number }>
  themes: string[]
  failures: string[]
  dialogs: number
  installs: number
  listingButtons: number
  buttons: Array<{ text: string; disabled: boolean }>
}
interface CdpResult { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text: string } }
let server: Server | undefined
let browser: ChildProcess | undefined
let socket: WebSocket | undefined
let nextId = 0
const pending = new Map<number, { resolve: (value: CdpResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
const runtimeErrors: unknown[] = []
const networkEvents: unknown[] = []
const pausedImages = new Map<string, string>()
const imageRequests: string[] = []
const browserErrors: string[] = []
const pause = (duration: number) => new Promise<void>(done => setTimeout(done, duration))
function send(method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
  return new Promise((resolveRequest, reject) => {
    const identifier = ++nextId
    const timer = setTimeout(() => { pending.delete(identifier); reject(new Error('CDP timeout: ' + method)) }, 5_000)
    pending.set(identifier, { resolve: resolveRequest, reject, timer })
    socket!.send(JSON.stringify({ id: identifier, method, params }))
  })
}
async function evaluate<Value = unknown>(expression: string): Promise<Value> {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result?.value as Value
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
  await evaluate('(() => { ' + expression + '; })()')
  await evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')
}
async function completeImage(filename: string, success: boolean): Promise<void> {
  let requestId: string | undefined
  for (let attempt = 0; attempt < 100; attempt++) {
    requestId = [...pausedImages.entries()].find(([, url]) => new URL(url).pathname === '/' + filename)?.[0]
    if (requestId) break
    await pause(20)
  }
  if (!requestId) throw new Error('没有被拦截的测试图片请求：' + filename)
  pausedImages.delete(requestId)
  if (success) await send('Fetch.fulfillRequest', {
    requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Cache-Control', value: 'no-store' }],
    body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  })
  else await send('Fetch.failRequest', { requestId, errorReason: 'Failed' })
}

describe('Agent Forge Client 媒体消费（真实 React DOM / 隔离 Edge，技术图片夹具）', () => {
  beforeAll(async () => {
    if (!existsSync(edge)) throw new Error('需要现有 Edge；可使用 EAC_TEST_EDGE 指定路径，不安装依赖。')
    const profile = mkdtempSync(join(tmpdir(), 'eac-forge-media-'))
    server = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url!, 'http://localhost').pathname
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        if (pathname === '/') {
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.end('<!doctype html><html lang="zh-CN"><body class="eac-market"><div id="root"></div><script src="/react-umd.js"></script><script src="/react-dom-umd.js"></script><script type="module" src="/fixture.js"></script></body></html>')
        } else if (pathname === '/react-umd.js' || pathname === '/react-dom-umd.js') {
          const packageName = pathname === '/react-umd.js' ? 'react' : 'react-dom'
          response.end(readFileSync(join(workspace, 'packages/market/node_modules', packageName, 'umd', packageName + '.development.js'), 'utf8'))
        } else if (pathname === '/react.js') {
          response.end('const React = window.React; export default React; export const { useCallback, useEffect, useId, useMemo, useRef, useState, createElement, Fragment } = React;')
        } else if (pathname === '/fixture.js') response.end(browserFixture)
        else if (pathname === '/favicon.ico') { response.statusCode = 204; response.end() }
        else {
          const filename = resolve(workspace, '.' + decodeURIComponent(pathname))
          if (!filename.startsWith(workspace + sep) || !/\.(?:ts|tsx|js)$/.test(filename)) throw new Error('测试模块路径不合法')
          const transformed = await transform(readFileSync(filename, 'utf8'), { loader: filename.endsWith('tsx') ? 'tsx' : filename.endsWith('.ts') ? 'ts' : 'js', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', format: 'esm' })
          response.end(transformed.code.replace(/(["'])react\1/g, '"/react.js"').replace(/(["'])@dsh-eac\/market-core\/compatibility\1/g, '"/packages/market-core/src/contracts/compatibility.ts"').replace(/(["'])@dsh-eac\/market-core\/semver\1/g, '"/packages/market-core/lib/semver.js"'))
        }
      } catch (error) { response.statusCode = 500; response.end(String(error)) }
    })
    await new Promise<void>(done => server!.listen(0, '127.0.0.1', done))
    browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    let launchError: Error | undefined
    browser.on('error', error => { launchError = error })
    for (let attempt = 0; attempt < 150 && !existsSync(join(profile, 'DevToolsActivePort')); attempt++) {
      if (launchError) throw launchError
      if (browser.exitCode !== null && browser.exitCode !== 0) throw new Error('测试 Edge 提前退出：' + browser.exitCode)
      await pause(100)
    }
    const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]
    const tabs = await fetch('http://127.0.0.1:' + port + '/json/list').then(response => response.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
    const page = tabs.find(tab => tab.type === 'page')
    if (!page) throw new Error('测试 Edge 没有提供页面')
    socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise<void>((done, reject) => { socket!.addEventListener('open', () => done(), { once: true }); socket!.addEventListener('error', () => reject(new Error('Edge CDP 连接失败')), { once: true }) })
    socket.addEventListener('message', event => {
      const eventMessage = JSON.parse(String(event.data)) as { method?: string; params?: { requestId?: string; request?: { url: string }; response?: { url: string; status: number }; errorText?: string; blockedReason?: string } }
      if (eventMessage.method === 'Runtime.exceptionThrown') runtimeErrors.push(eventMessage.params)
      if (eventMessage.method && ['Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFailed', 'Network.loadingFinished'].includes(eventMessage.method) && networkEvents.length < 200) {
        networkEvents.push({ method: eventMessage.method, requestId: eventMessage.params?.requestId, url: eventMessage.params?.request?.url ?? eventMessage.params?.response?.url, status: eventMessage.params?.response?.status, error: eventMessage.params?.errorText, blockedReason: eventMessage.params?.blockedReason })
      }
      const message = JSON.parse(String(event.data)) as { id?: number; error?: { message: string }; result: CdpResult; method?: string; params?: { requestId: string; request: { url: string }; exceptionDetails: { text: string } } }
      if (message.method === 'Fetch.requestPaused') {
        pausedImages.set(message.params!.requestId, message.params!.request.url)
        imageRequests.push(message.params!.request.url)
      }
      if (message.method === 'Runtime.exceptionThrown') browserErrors.push(JSON.stringify(message.params))
      if (message.id === undefined) return
      const entry = pending.get(message.id)
      if (!entry) return
      clearTimeout(entry.timer); pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result)
    })
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Network.enable')
    await send('Network.setBlockedURLs', { urls: ['http://me.kis.v2.scr.kaspersky-labs.com/*'] })
    await send('Network.setCacheDisabled', { cacheDisabled: true })
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*', resourceType: 'Image', requestStage: 'Request' }] })
    await send('Page.navigate', { url: 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/' })
    await until('!!window.fixture && !!document.querySelector(".eac-market__plugin-card")')
    console.info('Client fixture ready: ' + JSON.stringify({ fixture: 'agent-forge-media', page: await evaluate('({ ready: document.readyState, fixture: !!window.fixture })'), runtimeErrors, networkEvents: networkEvents.filter(event => { const fact = event as { url?: string; method: string }; return fact.url?.startsWith('http://me.kis.v2.scr.kaspersky-labs.com/') || fact.method === 'Network.loadingFailed' }) }))
  }, 30_000)
  afterAll(async () => {
    if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close') } catch {} }
    socket?.close()
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('测试浏览器已关闭')) }
    pending.clear()
    if (browser && browser.exitCode === null) browser.kill()
    if (server) await new Promise<void>(done => server!.close(() => done()))
  }, 15_000)
  beforeEach(async () => {
    await settle('fixture.render({ icon: undefined, previews: [] })')
    for (const requestId of pausedImages.keys()) { try { await send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }) } catch {} }
    pausedImages.clear(); imageRequests.length = 0
    await settle('fixture.reset()')
  })
  it('图标真实 load 后显示，error 后回退原文字，重复 render 不偷偷重试', async () => {
    expect((await state()).iconText).toBe('A')
    expect((await state()).icon[0]).toMatchObject({ hidden: true, width: 0, visible: false })
    await completeImage('icon.png', true)
    await until('fixture.state().icon[0]?.width === 1 && !fixture.state().icon[0].hidden')
    expect((await state()).iconText).toBe('')
    await settle('fixture.icon = { ...fixture.icon, sourceUrl: "https://media.example.test/broken.png" }; fixture.render()')
    expect((await state()).iconText).toBe('A')
    await completeImage('broken.png', false)
    await until('fixture.state().icon.length === 0')
    expect((await state()).iconText).toBe('A')
    const before = imageRequests.length
    await settle('fixture.render()')
    expect(imageRequests).toHaveLength(before)
  })
  it('同 ID 换 URL 丢弃旧成功/失败状态，旧节点迟到事件不污染新图，移除 media 仍可读', async () => {
    await completeImage('icon.png', false)
    await until('fixture.state().icon.length === 0')
    await settle('fixture.icon = { ...fixture.icon, sourceUrl: "https://media.example.test/new.png" }; fixture.render(); fixture.oldIcon = document.querySelector(".eac-market__plugin-card .eac-market__media-icon img")')
    expect((await state()).iconText).toBe('A')
    await completeImage('new.png', true)
    await until('fixture.state().icon[0]?.width === 1')
    await settle('fixture.icon = { ...fixture.icon, sourceUrl: "https://media.example.test/next.png" }; fixture.render(); fixture.oldIcon.dispatchEvent(new Event("error")); fixture.oldIcon.dispatchEvent(new Event("load"))')
    expect((await state()).iconText).toBe('A')
    expect((await state()).icon[0]).toMatchObject({ hidden: true, source: 'https://media.example.test/next.png' })
    await completeImage('next.png', true)
    await until('fixture.state().icon[0]?.width === 1 && fixture.state().iconText === ""')
    await settle('fixture.render({ icon: undefined })')
    expect((await state()).icon).toHaveLength(0)
    expect((await state()).iconText).toBe('A')
  })
  it('非法客户端地址不会生成 img 请求或放大/重试控件，凭据不泄露到 DOM', async () => {
    await settle('fixture.render({ icon: undefined })')
    for (const requestId of pausedImages.keys()) { await send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }) }
    pausedImages.clear(); imageRequests.length = 0
    await settle('fixture.render({ icon: { id: "unsafe", alt: "测试", sourceUrl: "https://user:password@media.example.test/private.png" }, previews: ' + JSON.stringify(invalidSources.map((sourceUrl, index) => ({ ...preview, id: 'unsafe-' + index, sourceUrl }))) + ' })')
    expect((await state()).iconText).toBe('A')
    expect((await state()).icon).toHaveLength(0)
    expect((await state()).previews).toHaveLength(0)
    expect(await evaluate('document.querySelectorAll(".eac-market__gallery button").length')).toBe(0)
    expect(await evaluate('document.body.textContent.includes("password")')).toBe(false)
    expect(imageRequests).toHaveLength(0)
  })
  it('预览 error 保留来源与声明主题，重试创建新节点并可真实 load', async () => {
    await settle('fixture.render({ icon: undefined, previews: [fixture.preview()] })')
    await completeImage('preview.png', false)
    await until('fixture.state().failures.length === 1')
    expect((await state()).failures[0]).toContain('https://media.example.test/preview.png')
    expect((await state()).themes).toEqual(['声明主题：dark'])
    expect((await state()).previews).toHaveLength(0)
    await settle('fixture.click("重试加载")')
    expect((await state()).failures).toHaveLength(0)
    await completeImage('preview.png', true)
    await until('fixture.state().previews[0]?.width === 1')
    expect((await state()).themes).toEqual(['声明主题：dark'])
  })
  it('同 ID 预览 URL 变化回收失败与打开的 Modal，过期图片事件不污染新预览', async () => {
    await settle('fixture.render({ icon: undefined, previews: [fixture.preview()] })')
    await completeImage('preview.png', false)
    await until('fixture.state().failures.length === 1')
    await settle('fixture.render({ previews: [fixture.preview("https://media.example.test/replaced.png", "light")] })')
    expect((await state()).failures).toHaveLength(0)
    await completeImage('replaced.png', true)
    await until('fixture.state().previews[0]?.width === 1')
    await settle('fixture.click("放大查看：测试预览声明")')
    await settle('fixture.oldPreview = document.querySelector(".eac-market__media-enlarged")')
    expect((await state()).dialogs).toBe(1)
    expect((await state()).themes).toEqual(['声明主题：light', '声明主题：light'])
    await settle('fixture.render({ previews: [fixture.preview("https://media.example.test/current.png", "system")] }); fixture.oldPreview.dispatchEvent(new Event("error"))')
    expect((await state()).dialogs).toBe(0)
    expect((await state()).failures).toHaveLength(0)
    expect((await state()).themes).toEqual(['声明主题：system'])
    await completeImage('current.png', true)
    await until('fixture.state().previews[0]?.width === 1')
    await settle('fixture.render({ previews: [] })')
    expect(await evaluate('document.querySelectorAll(".eac-market__gallery").length')).toBe(0)
  })
  it('放大图片 error 事件回收 Modal，失败与重试仍由前端控制', async () => {
    await settle('fixture.render({ icon: undefined, previews: [fixture.preview()] })')
    await completeImage('preview.png', true)
    await until('fixture.state().previews[0]?.width === 1')
    await settle('fixture.click("放大查看：测试预览声明")')
    expect((await state()).dialogs).toBe(1)
    await settle('document.querySelector(".eac-market__media-enlarged").dispatchEvent(new Event("error"))')
    await until('fixture.state().dialogs === 0 && fixture.state().failures.length === 1')
    await settle('fixture.click("重试加载")')
    await until('fixture.state().previews[0]?.width === 1')
  })
  it('展示主题按输入更新且不改变安装事实，带媒体 listing 仍无安装按钮', async () => {
    await settle('fixture.render({ canInstall: false, verification: "hard-incompatible", previews: [fixture.preview()] })')
    for (const theme of ['light', 'dark', 'system']) {
      await settle('fixture.render({ previews: [fixture.preview(undefined, ' + JSON.stringify(theme) + ')] })')
      expect((await state()).themes).toEqual(['声明主题：' + theme])
      expect((await state()).buttons.find(button => button.text === '暂不可安装')?.disabled).toBe(true)
      expect((await state()).listingButtons).toBe(0)
    }
    await settle('fixture.click("暂不可安装")')
    expect((await state()).installs).toBe(0)
  })
  it.each(['light', 'dark', 'system'])('登记组关闭不请求媒体，展开显示 %s 声明与图片但仍无安装入口', async theme => {
    await settle('fixture.render({ icon: undefined, previews: [] })')
    for (const requestId of pausedImages.keys()) await send('Fetch.failRequest', { requestId, errorReason: 'Aborted' })
    pausedImages.clear(); imageRequests.length = 0
    const iconFilename = 'listing-icon-' + theme + '.png'
    const previewFilename = 'listing-preview-' + theme + '.png'
    await settle('fixture.render({ listingMedia: { icon: { id: "listing-icon", alt: "登记图标测试声明", sourceUrl: "https://media.example.test/' + iconFilename + '?fixture=" + fixture.serial }, previews: [fixture.preview("https://media.example.test/' + previewFilename + '?fixture=" + fixture.serial, ' + JSON.stringify(theme) + ')] } })')
    expect(await evaluate('document.querySelector("#listing details").open')).toBe(false)
    expect(await evaluate('document.querySelectorAll("#listing img, #listing .eac-market__gallery").length')).toBe(0)
    expect(imageRequests).toHaveLength(0)

    await settle('document.querySelector("#listing summary").click()')
    await until('document.querySelector("#listing details").open && document.querySelectorAll("#listing img").length === 2')
    await settle('document.querySelectorAll("#listing img").forEach(image => { image.loading = "eager" })')
    await completeImage(iconFilename, true)
    await completeImage(previewFilename, true)
    await until('[...document.querySelectorAll("#listing img")].every(image => image.naturalWidth === 1)')
    expect(await evaluate('document.querySelector("#listing .eac-market__media-icon img").hidden')).toBe(false)
    expect(await evaluate('getComputedStyle(document.querySelector("#listing .eac-market__media-icon img")).display')).not.toBe('none')
    expect(await evaluate('document.querySelector("#listing .eac-market__media-theme").textContent')).toBe('声明主题：' + theme)
    expect(await evaluate('document.querySelector("#listing h2").textContent')).toBe('上游声明预览')
    const listingText = await evaluate<string>('document.querySelector("#listing").textContent')
    expect(listingText).toContain('补齐并核验前不提供安装')
    expect(listingText).toContain('缺少制品')
    expect(listingText).toContain('不代表审核结论、真实验收或核心兼容性')
    expect(listingText).not.toContain('兼容性通过')
    expect(listingText).not.toContain('已验证')
    expect(listingText).not.toContain('真实截图')
    expect(await evaluate('[...document.querySelectorAll("#listing button")].map(button => button.textContent)')).toEqual([''])
    expect(await evaluate('document.querySelector("#listing button").getAttribute("aria-label")')).toBe('放大查看：测试预览声明')
    expect((await state()).installs).toBe(0)
    expect(imageRequests.map(source => new URL(source).pathname).sort()).toEqual(['/' + iconFilename, '/' + previewFilename].sort())

    await settle('document.querySelector("#listing summary").click()')
    await until('!document.querySelector("#listing details").open && document.querySelectorAll("#listing img, #listing .eac-market__gallery").length === 0')
    const requestsAfterClose = imageRequests.length
    await settle('fixture.render()')
    expect(imageRequests).toHaveLength(requestsAfterClose)
    expect((await state()).listingButtons).toBe(0)
  })
  it('专属 CSS 保持图标尺寸、图片 contain、强制颜色与 reduced-motion 下的文字回退', async () => {
    await completeImage('icon.png', true)
    await until('fixture.state().icon[0]?.width === 1')
    expect(await evaluate('getComputedStyle(document.querySelector(".eac-market__plugin-card .eac-market__media-icon")).width')).toBe('44px')
    expect(await evaluate('getComputedStyle(document.querySelector(".eac-market__plugin-card .eac-market__media-icon img")).objectFit')).toBe('contain')
    await settle('document.querySelector(".eac-market__plugin-card").style.setProperty("--eac-media-icon-size", "64px")')
    expect(await evaluate('getComputedStyle(document.querySelector(".eac-market__plugin-card .eac-market__media-icon")).width')).toBe('64px')
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
    try {
      await settle('fixture.render({ icon: undefined })')
      expect((await state()).iconText).toBe('A')
      expect(await evaluate('getComputedStyle(document.querySelector(".eac-market__plugin-card .eac-market__media-icon")).display')).not.toBe('none')
    } finally { await send('Emulation.setEmulatedMedia', { features: [] }) }
    expect(browserErrors).toEqual([])
  })
})

describe('Agent Forge Client 媒体合同（Node / SSR）', () => {
  it.each(invalidSources.map((sourceUrl, index) => ({ sourceUrl, index })))('拒绝无效媒体地址 #$index 且不生成图片或重试入口', ({ sourceUrl }) => {
    expect(safeMediaSource(sourceUrl)).toBeUndefined()
    const html = renderer.renderToStaticMarkup(react.createElement(react.Fragment, null,
      react.createElement(CatalogMediaIcon, { name: 'alpha', media: { ...icon, sourceUrl } }),
      react.createElement(ScreenshotGallery, { screenshots: [{ ...preview, sourceUrl }] }),
    ))
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<button')
    expect(html).toContain('预览地址不可用')
    expect(html).toContain('声明主题：dark')
    expect(html).not.toContain('password')
  })
  it('允许无凭据 HTTPS 地址与查询参数，不重做宿主网络校验', () => {
    const source = 'https://cdn.example.test/image.png?v=2&theme=dark#preview'
    expect(safeMediaSource(source)).toBe(source)
    expect(safeMediaSource(undefined)).toBeUndefined()
    expect(safeMediaSource(42)).toBeUndefined()
    const html = renderer.renderToStaticMarkup(react.createElement(CatalogMediaIcon, { name: 'alpha', media: { ...icon, sourceUrl: source } }))
    expect(html).toContain('<img')
    expect(html).toContain('referrerPolicy="no-referrer"')
  })
  it('旧无 media 卡片保留原文字占位与安装动作，空画廊隐藏', () => {
    const html = renderer.renderToStaticMarkup(react.createElement(PluginCard, { plugin: { ...pluginFixtures.verified, name: 'alpha' }, inventory: [], onOpen() {}, onInstall() {} }))
    expect(html).not.toContain('<img')
    expect(html).toContain('aria-hidden="true">A</span>')
    expect(html).toContain('安装')
    expect(renderer.renderToStaticMarkup(react.createElement(ScreenshotGallery, { screenshots: [] }))).toBe('')
  })
  it('URL 按 Unicode 码点计数而非 UTF16/字节，不改写 URL，500 emoji alt 可展示', () => {
    const sourceUrl = 'https://media.example.test/' + '😀'.repeat(4000)
    const alt = '😀'.repeat(500)
    expect(sourceUrl.length).toBeGreaterThan(4096)
    expect(Buffer.byteLength(sourceUrl, 'utf8')).toBeLessThanOrEqual(16384)
    expect(safeMediaSource(sourceUrl)).toBe(sourceUrl)
    const html = renderer.renderToStaticMarkup(react.createElement(CatalogMediaIcon, { name: 'alpha', media: { ...icon, sourceUrl, alt } }))
    expect(html).toContain(sourceUrl)
    expect(html).toContain('alt="' + alt + '"')
    const prefix = 'https://media.example.test/'
    expect(safeMediaSource(prefix + '😀'.repeat(4096 - Array.from(prefix).length))).toBeDefined()
    expect(safeMediaSource(prefix + '😀'.repeat(4097 - Array.from(prefix).length))).toBeUndefined()
  })
  it('媒体和 theme 不改变已阻断的插件操作事实', () => {
    const plugin = { ...pluginFixtures.verified, verification: 'hard-incompatible' as const, media: { icon, previews: [preview] } }
    const html = renderer.renderToStaticMarkup(react.createElement(PluginCard, { plugin, inventory: [], canInstall: false, onOpen() {}, onInstall() {} }))
    expect(html).toContain('<img')
    expect(html).toMatch(/<button[^>]*disabled=""/u)
    expect(html).toContain('已知不兼容')
  })
  it('listing 带媒体仍无安装入口，不合成版本或 CatalogPlugin', () => {
    const html = renderer.renderToStaticMarkup(react.createElement(PendingListings, { listings: [listing], query: '' }))
    expect(html).toContain('缺少制品')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('安装插件')
    expect('version' in listing).toBe(false)
  })
  it('按原顺序保留 light/dark/system 声明，标题中性，不宣称审核或兼容通过', () => {
    const screenshots = (['light', 'dark', 'system'] as const).map((theme, index) => ({ ...preview, id: 'preview-' + index, alt: '测试预览-' + index, theme }))
    const html = renderer.renderToStaticMarkup(react.createElement(ScreenshotGallery, { screenshots }))
    expect(html).toContain('预览图片')
    expect(html).toContain('不代表审核结论、真实验收或核心兼容性')
    expect(html.indexOf('声明主题：light')).toBeLessThan(html.indexOf('声明主题：dark'))
    expect(html.indexOf('声明主题：dark')).toBeLessThan(html.indexOf('声明主题：system'))
    expect(html).not.toContain('真实截图')
    expect(html).not.toContain('已验证')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<script')
    expect(renderer.renderToStaticMarkup(react.createElement(ScreenshotGallery, { screenshots, title: '上游展示' }))).toContain('上游展示')
  })
  it('旧 screenshots 无主题不添加声明，错误 theme 不变成兼容标签', () => {
    const html = renderer.renderToStaticMarkup(react.createElement(ScreenshotGallery, { screenshots: pluginFixtures.verified.screenshots }))
    expect(html).toContain('<img')
    expect(html).not.toContain('声明主题：')
    const invalidTheme = { ...preview, theme: 'verified' } as unknown as CatalogMedia
    expect(renderer.renderToStaticMarkup(react.createElement(ScreenshotGallery, { screenshots: [invalidTheme] }))).not.toContain('声明主题：')
  })
  it('同一页面多画廊标题 aria-labelledby 各自唯一且指向对应标题', () => {
    const html = renderer.renderToStaticMarkup(react.createElement(react.Fragment, null,
      react.createElement(ScreenshotGallery, { screenshots: [preview] }),
      react.createElement(ScreenshotGallery, { screenshots: [preview], title: '登记预览' }),
    ))
    const headingIds = [...html.matchAll(/aria-labelledby="([^"]+)"/gu)].map(match => match[1]!)
    expect(headingIds).toHaveLength(2)
    expect(new Set(headingIds).size).toBe(2)
    for (const identifier of headingIds) expect(html).toContain('<h2 id="' + identifier + '">')
    expect(html).not.toContain('screenshots-title')
  })
})
