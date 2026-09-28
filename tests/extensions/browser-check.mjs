/** Local headless browser only; artifacts and disposable profile stay on D:. */
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
const output = 'D:/eac-market-verify/implementation-20260928/E-extension'
const dependencies = resolve('packages/market/node_modules')
await mkdir(output, { recursive: true })
await build({ entryPoints: ['tests/extensions/browser-fixture.tsx'], bundle: true, outfile: join(output, 'browser-fixture.js'), format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, alias: {
  react: join(dependencies, 'react'), 'react-dom': join(dependencies, 'react-dom'),
  '@deepseek-ai/cordis': join(dependencies, '@deepseek-ai/cordis/lib/index.js'),
  '@deepseek-ai/dsh-client-ui-slots': join(dependencies, '@deepseek-ai/dsh-client-ui-slots/lib/index.js'),
} })
const script = await readFile(join(output, 'browser-fixture.js'))
const rendererBundle = await readFile(join(dependencies, '@deepseek-ai/dsh-client-ui-renderer/lib/client.js'))
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(script) }
  else if (req.url === '/renderer.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(rendererBundle) }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>合成扩展回归</title><body><div id="root"></div><script>window.__ModuleLoader__={load(reg){window.officialRenderer=reg}}</script><script src="/renderer.js"></script><script src="/fixture.js"></script></body></html>') }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const profile = join(output, `headless-profile-${Date.now()}`)
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
let ws; let send; let results = []
try {
  for (let i = 0; i < 150 && !existsSync(join(profile, 'DevToolsActivePort')); i++) await pause(100)
  const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
  ws = new WebSocket(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl)
  await new Promise((done, reject) => { ws.addEventListener('open', done, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let serial = 0; const pending = new Map()
  ws.addEventListener('message', (event) => { const data = JSON.parse(event.data); const task = pending.get(data.id); if (task) { clearTimeout(task.timer); pending.delete(data.id); data.error ? task.reject(new Error(data.error.message)) : task.resolve(data.result) } })
  send = (method, params = {}) => new Promise((resolveRequest, reject) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30_000); pending.set(id, { resolve: resolveRequest, reject, timer }); ws.send(JSON.stringify({ id, method, params })) })
  const evaluate = async (expression) => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value }
  await send('Page.enable')
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` })
  for (let i = 0; i < 150 && !await evaluate('typeof window.runExtensionChecks === "function"'); i++) await pause(30)
  await evaluate('window.unhandledExtensionErrors=[]; window.addEventListener("unhandledrejection", event => window.unhandledExtensionErrors.push(String(event.reason)))')
  results = await evaluate('window.runExtensionChecks()')
  const unhandled = await evaluate('window.unhandledExtensionErrors')
  results.push({ name: '浏览器无未处理Promise拒绝', status: unhandled.length ? 'failed' : 'passed', ...(unhandled.length ? { errors: unhandled } : {}) })
} catch (error) { results.push({ name: 'browser harness', status: 'failed', error: String(error) }) }
finally {
  if (send) await send('Browser.close').catch(() => {})
  ws?.close(); server.close(); browser.kill()
  await writeFile(join(output, 'browser-results.json'), JSON.stringify({ evidence: 'synthetic React + installed official 0.1.7-rc.2 renderer bundle in isolated headless Edge; not Desktop installation', results }, null, 2))
  console.log(JSON.stringify(results, null, 2))
  process.exitCode = results.some((r) => r.status === 'failed') ? 1 : 0
}
