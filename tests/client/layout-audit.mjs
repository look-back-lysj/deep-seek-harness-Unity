/** 布局/交互瑕疵审计：合成沙盒 + 无头 Edge + CDP 量测，只读产品代码。
 * 用法: node tests/client/layout-audit.mjs   输出 JSON 到 stdout（退出码恒为 0）
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'

const outDir = 'D:/eac-market-verify/layout-audit'
mkdirSync(outDir, { recursive: true })
const bundle = join(outDir, 'audit-fixture.js')
await build({ entryPoints: ['tests/client/browser-fixture.tsx'], bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', outfile: bundle, alias: { react: resolve('packages/market/node_modules/react'), 'react-dom': resolve('packages/market/node_modules/react-dom') }, define: { 'process.env.NODE_ENV': '"development"' } })

const server = createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(bundle)) }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>layout audit</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>') }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const profile = join(outDir, `edge-${Date.now()}`)
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const findings = []
let ws, send, evaluate
const add = (scene, severity, check, detail) => findings.push({ scene, severity, check, detail })
try {
  for (let i = 0; i < 150 && !existsSync(join(profile, 'DevToolsActivePort')); i++) await pause(100)
  const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
  ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((done, reject) => { ws.addEventListener('open', done, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let serial = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => { const data = JSON.parse(event.data); const entry = pending.get(data.id); if (entry) { clearTimeout(entry.timer); pending.delete(data.id); data.error ? entry.reject(new Error(data.error.message)) : entry.resolve(data.result) } })
  send = (method, params = {}) => new Promise((res, rej) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); rej(new Error('timeout ' + method)) }, 15000); pending.set(id, { resolve: res, reject: rej, timer }); ws.send(JSON.stringify({ id, method, params })) })
  evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value }
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` })
} catch (error) {
  console.error('bootstrap failed', error); process.exit(1)
}
await pause(700)

const clickText = async (text) => { await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}); if(b) b.click(); })()`); await pause(250) }
const render = async (name) => { await evaluate(`fixture.render(${JSON.stringify(name)})`); await pause(400) }
const themeDark = async (on) => { await evaluate(`document.documentElement.style.cssText=${JSON.stringify(on ? '--dsw-alias-bg-base:#141414;--dsw-alias-bg-layer-1:#232323;--dsw-alias-bg-layer-2:#303030;--dsw-alias-label-primary:#eeeeee;--dsw-alias-label-secondary:#b8b8b8;--dsw-alias-border-l1:#4a4a4a;--dsw-alias-border-l3:#666666;--dsw-alias-link:#8aafff;--dsw-alias-state-business-primary:#386ad9;' : '')}`) }

/* 各场景通用量测脚本：溢出/裁切/行内对齐/按钮尺寸/旋转越界/角标碰撞/机架尾空/导航贴合 */
const scan = (scene) => `(() => {
  const out = { overflow: [], clipped: [], rows: [], buttons: [], rotated: [], sticker: [], rack: [], nav: [], seam: [] }
  const doc = document.querySelector('.eac-market')
  if (!doc) return JSON.stringify(out)
  // 1) 横向溢出
  for (const el of document.querySelectorAll('.eac-market *')) {
    const st = getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden') continue
    if (el.classList.contains('eac-market__sr-only')) continue
    if (el.scrollWidth > el.clientWidth + 1 && st.overflowX !== 'auto' && st.overflowX !== 'scroll' && el.clientWidth > 0) {
      out.overflow.push({ cls: el.className.toString().slice(0, 60), sw: el.scrollWidth, cw: el.clientWidth, text: (el.textContent || '').trim().slice(0, 30) })
    }
    if (el.scrollHeight > el.clientHeight + 2 && (st.overflowY === 'hidden') && el.clientHeight > 0 && !/skeleton|progress|poster-art/.test(el.className.toString())) {
      out.clipped.push({ cls: el.className.toString().slice(0, 60), sh: el.scrollHeight, ch: el.clientHeight, text: (el.textContent || '').trim().slice(0, 30) })
    }
  }
  // 2) 同行对齐（顶部/高度不齐）
  const rowSelectors = ['.eac-market__topbar', '.eac-market__button-row', '.eac-market__plugin-bottom', '.eac-market__page-head', '.eac-market__section-head', '.eac-market__source-row', '.eac-market__setting']
  for (const sel of rowSelectors) {
    for (const row of document.querySelectorAll(sel)) {
      const kids = [...row.children].filter(k => { const r = k.getBoundingClientRect(); const s = getComputedStyle(k); return r.width > 0 && r.height > 0 && s.display !== 'none' })
      if (kids.length < 2) continue
      if (sel === '.eac-market__page-head') continue // 设计意图: 标题块与动作区底对齐
      const center = (k) => { const r = k.getBoundingClientRect(); return r.top + r.height / 2 }
      const baseline = center(kids[0])
      const lineKids = kids.filter(k => Math.abs(center(k) - baseline) <= Math.max(kids[0].getBoundingClientRect().height / 2 + 4, 24))
      if (lineKids.length < 2) continue
      const centers = lineKids.map(center)
      const spread = Math.max(...centers) - Math.min(...centers)
      if (spread > 4) out.rows.push({ sel, spread: Math.round(spread * 10) / 10, kids: lineKids.map(k => (k.className || k.tagName).toString().slice(0, 30)) })
    }
  }
  const header = document.querySelector('.eac-market__topbar')?.getBoundingClientRect()
  if (header) {
    const tabBottoms = [...document.querySelectorAll('.eac-market__nav button')].map(b => Math.round(b.getBoundingClientRect().bottom))
    out.nav.push({ tabBottoms, headerBottom: Math.round(header.bottom), diff: tabBottoms.map(b => Math.round((header.bottom - 2) - b)) })
  }
  // 3) 按钮尺寸与阴影越界
  const scroller = document.querySelector('.eac-market__scroll')
  const scRect = scroller ? scroller.getBoundingClientRect() : document.body.getBoundingClientRect()
  for (const b of document.querySelectorAll('button')) {
    const r = b.getBoundingClientRect(); const st = getComputedStyle(b)
    if (r.width === 0 || st.display === 'none') continue
    if (r.height < 28 && !b.closest('.eac-market__poster-controls') && !b.closest('.eac-market__menu')) out.buttons.push({ issue: 'short', h: Math.round(r.height), text: (b.textContent||'').trim().slice(0,14) })
    if (r.right + 4 > scRect.right + 1 || r.left - 4 < scRect.left - 1) out.buttons.push({ issue: 'shadow-outside', left: Math.round(r.left), right: Math.round(r.right), text: (b.textContent||'').trim().slice(0,14) })
  }
  // 4) 旋转元素是否越出父容器
  for (const el of document.querySelectorAll('.eac-market *')) {
    const st = getComputedStyle(el)
    if (st.transform && st.transform !== 'none' && /matrix\\(/.test(st.transform)) {
      const m = st.transform.match(/matrix\\(([^)]+)\\)/)
      if (m) { const parts = m[1].split(',').map(Number); const a = parts[0], b = parts[1]
        if (Math.abs(b) > 0.004) { // 旋转
          const r = el.getBoundingClientRect(); const pr = (el.parentElement || document.body).getBoundingClientRect()
          if (r.left < pr.left - 1 || r.right > pr.right + 1) out.rotated.push({ cls: el.className.toString().slice(0,50), overLeft: Math.round(pr.left - r.left), overRight: Math.round(r.right - pr.right), angle: Math.round(Math.atan2(b,a)*180/Math.PI*10)/10 })
        }
      }
    }
  }
  // 5) 贴纸角标与上一元素碰撞 / 越界
  for (const el of document.querySelectorAll('[data-sticker]')) {
    const r = el.getBoundingClientRect()
    const top = r.top - 9
    const prev = el.previousElementSibling
    if (prev) { const pr = prev.getBoundingClientRect(); if (pr.bottom > top - 2) out.sticker.push({ collideWith: (prev.className||prev.tagName).toString().slice(0,40), overlapPx: Math.round(pr.bottom - top) }) }
    const sec = el.closest('section, div'); if (sec) { const sr = sec.getBoundingClientRect(); if (r.right > sr.right) out.sticker.push({ overflowRight: Math.round(r.right - sr.right) }) }
  }
  // 6) 机架行尾部空白（空网格轨道）
  for (const card of document.querySelectorAll('.eac-market__grid > .eac-market__card')) {
    const kids = [...card.children].filter(c => getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().height > 0)
    if (!kids.length) continue
    const cr = card.getBoundingClientRect()
    const contentBottom = Math.max(...kids.map(c => c.getBoundingClientRect().bottom))
    const tail = Math.round(cr.bottom - contentBottom)
    if (tail > 24) out.rack.push({ tail, card: (card.querySelector('h3')?.textContent || '').slice(0, 20) })
  }
  // 7) 详情双栏空置
  const detail = document.querySelector('.eac-market__detail')
  if (detail) { const kids = [...detail.children].map(k => { const r = k.getBoundingClientRect(); return { cls: k.className.toString().slice(0,40), h: Math.round(r.height), w: Math.round(r.width) } }); out.seam.push({ detail: kids }) }
  return JSON.stringify(out)
})()`

const scenes = [
  { name: 'discover-1280-light', dark: false, setup: async () => { await render('home') } },
  { name: 'directory-1280-light', dark: false, setup: async () => { await render('home'); await pause(300); await clickText('全部插件') } },
  { name: 'mine-rack-1280-light', dark: false, setup: async () => { await render('inventory-scroll'); await pause(300); await clickText('我的插件') } },
  { name: 'detail-1280-light', dark: false, setup: async () => { await render('home'); await pause(300); await evaluate(`(() => { const b=[...document.querySelectorAll('.eac-market__poster-copy button')].find(x=>x.textContent.includes('查看详情')); if(b) b.click() })()`); await pause(400) } },
  { name: 'settings-1280-light', dark: false, setup: async () => { await render('settings'); await pause(300); await clickText('更多'); await clickText('设置') } },
  { name: 'tasks-1280-light', dark: false, setup: async () => { await render('ai') } },
  { name: 'install-dialog-1280-light', dark: false, setup: async () => { await render('install'); await pause(300); await clickText('打开安装窗口'); await pause(500) } },
  { name: 'discover-480-dark', dark: true, width: 480, setup: async () => { await render('home') } },
]

for (const scene of scenes) {
  try {
    await send('Emulation.setDeviceMetricsOverride', { width: scene.width || 1280, height: 900, deviceScaleFactor: 1, mobile: false })
    await themeDark(scene.dark)
    await scene.setup()
    await pause(800)
    const data = JSON.parse(await evaluate(scan(scene.name)))
    for (const [key, list] of Object.entries(data)) {
      for (const item of list) add(scene.name, 'layout', key, item)
    }
  } catch (error) {
    add(scene.name, 'error', 'scene-failed', error.message)
  }
}

/* 8) 按压重叠 + 磁吸（强制能力模式，覆盖 pointer:fine 盲区） */
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await themeDark(false)
  await render('home')
  await pause(700)
  const box = JSON.parse(await evaluate(`(() => { const b=[...document.querySelectorAll('.eac-button--primary')].find(x=>x.textContent.trim()==='搜索全部插件'); const r=b.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2}) })()`))
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await pause(200)
  const pressState = await evaluate(`(() => { const b=[...document.querySelectorAll('.eac-button--primary')].find(x=>x.textContent.trim()==='搜索全部插件'); const st=getComputedStyle(b); return JSON.stringify({t:st.transform, s:st.boxShadow}) })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  const press = JSON.parse(pressState)
  if (press.t !== 'none' && press.t !== 'matrix(1, 0, 0, 1, 0, 0)') add('press', 'interaction', 'press-displaces', press)
  if (!press.s.includes('0px 0px 0px 0px')) add('press', 'interaction', 'extrusion-not-collapsed', press)

  // 强制 pointer:fine 后重挂载按钮，扫描按钮内部轨迹
  await evaluate("window.__mmOrig = window.matchMedia; window.matchMedia = (q) => ((q.includes('pointer: fine') || q.includes('hover: hover')) ? { matches: true, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} } : window.__mmOrig.call(window, q))")
  await render('home')
  await pause(600)
  const target = JSON.parse(await evaluate(`(() => { const b=[...document.querySelectorAll('.eac-button--primary')].find(x=>x.textContent.trim()==='搜索全部插件'); const r=b.getBoundingClientRect(); return JSON.stringify({cx:r.left+r.width/2, cy:r.top+r.height/2, w:r.width, h:r.height}) })()`))
  // 先进入按钮左侧内部，再沿横向扫过（不经过几何中心，避免 pull=0 清除）
  let prev = null
  let maxJump = 0
  let engaged = 0
  let jumpAt = null
  const sweepY = target.cy - target.h * 0.2
  for (let step = 0; step <= 20; step++) {
    const x = target.cx - target.w * 0.42 + (target.w * 0.84) * (step / 20)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: sweepY })
    await pause(28)
    const t = await evaluate(`(() => { const b=[...document.querySelectorAll('.eac-button--primary')].find(x=>x.textContent.trim()==='搜索全部插件'); return b.style.transform || '' })()`)
    const nums = (t.match(/-?\d+(\.\d+)?/g) || []).map(Number)
    if (nums.length === 2) engaged += 1
    if (prev && nums.length === 2) {
      const jump = Math.hypot(nums[0] - prev[0], nums[1] - prev[1])
      if (jump > maxJump) { maxJump = jump; jumpAt = { x: Math.round(x), from: prev, to: nums } }
    }
    if (nums.length === 2) prev = nums
  }
  if (engaged === 0) add('magnet', 'interaction', 'not-engaged-forced', { hint: 'pointerenter did not fire under stubbed pointer:fine' })
  if (maxJump > 1.5) add('magnet', 'interaction', 'frame-jump', { maxJump: Math.round(maxJump * 100) / 100, jumpAt })
  // 离开按钮应清除
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.cx + 300, y: Math.max(20, target.cy - 260) })
  await pause(160)
  const cleared = await evaluate(`(() => { const b=[...document.querySelectorAll('.eac-button--primary')].find(x=>x.textContent.trim()==='搜索全部插件'); return b.style.transform || '' })()`)
  if (cleared) add('magnet', 'interaction', 'not-cleared-on-leave', { transform: cleared })
  add('magnet', 'interaction', 'sweep-sample', { maxJump: Math.round(maxJump * 100) / 100, engaged, cleared })
  await evaluate('window.matchMedia = window.__mmOrig; delete window.__mmOrig')
} catch (error) {
  add('interaction', 'error', 'interaction-failed', error.message)
}

const violations = []
for (const f of findings) {
  if (f.severity === 'error') violations.push({ scene: f.scene, check: f.check, detail: f.detail })
  if (f.check === 'rows' && f.detail && f.detail.spread > 4) violations.push({ scene: f.scene, check: 'rows', spread: f.detail.spread })
  if (f.check === 'nav' && f.detail && Array.isArray(f.detail.diff) && f.detail.diff.some((d) => Math.abs(d) > 1)) violations.push({ scene: f.scene, check: 'nav-gap', diff: f.detail.diff })
  if (f.check === 'rack' && f.detail && f.detail.tail > 24) violations.push({ scene: f.scene, check: 'rack-tail', tail: f.detail.tail })
  if (f.check === 'overflow' || f.check === 'clipped') violations.push({ scene: f.scene, check: f.check, detail: f.detail })
  if (f.check === 'frame-jump' || f.check === 'press-displaces' || f.check === 'extrusion-not-collapsed' || f.check === 'not-engaged-forced' || f.check === 'not-cleared-on-leave') violations.push({ scene: f.scene, check: f.check, detail: f.detail })
}
writeFileSync(join(outDir, 'findings.json'), JSON.stringify({ findings, violations }, null, 2))
console.log(JSON.stringify({ violations }, null, 2))
console.log(`\nFINDINGS: ${findings.length}  VIOLATIONS: ${violations.length}  ->  ${join(outDir, 'findings.json')}`)

try { ws?.close() } catch {}
server.close()
browser.kill()
process.exit(violations.length > 0 ? 1 : 0)
