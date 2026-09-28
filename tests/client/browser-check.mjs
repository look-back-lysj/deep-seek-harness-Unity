/** Scoped React/browser verification, with its own D: profile and output only.
 * Uses installed esbuild, Edge and Node's WebSocket. Never starts official DSH.
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
const collectionsOnly = process.argv.includes('--collections-only')
const versionsOnly = process.argv.includes('--versions-only')
const scrollOnly = process.argv.includes('--scroll-only')
const skinsOnly = process.argv.includes('--skins-only')
const listingsOnly = process.argv.includes('--listings-only')
const output = listingsOnly || skinsOnly ? `D:/eac-market-verify/distribution-20260928/ui/${listingsOnly ? 'listings' : 'skins'}-${Date.now()}` : scrollOnly ? 'D:/eac-market-verify/skin-market-20260928/ui' : 'D:/eac-market-verify/implementation-20260928/C-UI' + (versionsOnly ? '/versions' : collectionsOnly ? '/collections' : '')
console.log(`Evidence: ${output}`)
mkdirSync(output, { recursive: true })
await build({ entryPoints: ['tests/client/browser-fixture.tsx'], bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', outfile: join(output, 'browser-fixture.js'), alias: { react: resolve('packages/market/node_modules/react'), 'react-dom': resolve('packages/market/node_modules/react-dom') }, define: { 'process.env.NODE_ENV': '"development"' } })
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(join(output, 'browser-fixture.js'))) }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>合成 UI 回归</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>') }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const profile = join(output, `edge-profile-${Date.now()}`)
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const results = []
let ws
let send
async function check(name, operation) { if (listingsOnly && !name.startsWith('登记：') || skinsOnly && !name.startsWith('皮肤：') && !name.startsWith('滚动：') || collectionsOnly && !name.startsWith('组合：') || versionsOnly && !name.startsWith('版本：') || scrollOnly && !name.startsWith('滚动：')) return; try { await operation(); results.push({ name, status: 'passed' }) } catch (error) { results.push({ name, status: 'failed', error: error.message }) } }
try {
  for (let i = 0; i < 150 && !existsSync(join(profile, 'DevToolsActivePort')); i++) await pause(100)
  const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
  ws = new WebSocket(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl)
  await new Promise((done, reject) => { ws.addEventListener('open', done, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let serial = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => { const data = JSON.parse(event.data); const entry = pending.get(data.id); if (entry) { clearTimeout(entry.timer); pending.delete(data.id); data.error ? entry.reject(new Error(data.error.message)) : entry.resolve(data.result) } })
  send = (method, params = {}) => new Promise((resolveRequest, reject) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15_000); pending.set(id, { resolve: resolveRequest, reject, timer }); ws.send(JSON.stringify({ id, method, params })) })
  const evaluate = async (expression) => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value }
  const expect = async (expression, message) => { if (!await evaluate(expression)) throw new Error(message) }
  const until = async (expression) => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(30) } throw new Error(`DOM timeout: ${expression}`) }
  const click = async (text, scope = 'document') => { await evaluate(`(() => { const button = [...${scope}.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!button || button.disabled) throw new Error('button missing or disabled: ' + ${JSON.stringify(text)}); button.click() })()`); await pause(50) }
  const render = async (name) => { await evaluate(`fixture.render(${JSON.stringify(name)})`); await pause(100) }
  const input = async (id, text) => { await evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', {bubbles:true})); })()`); await pause(30) }
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` })
  await until('!!window.fixture && document.body.innerText.includes("发现适合你的插件")')

  await check('版本：同ID点击旧版本详情仍展示并预检该确切版本', async () => {
    await render('versions-home'); await click('全部插件')
    await click('查看详情', "[...document.querySelectorAll('.eac-market__plugin-card')].find(el => el.querySelector('h3').textContent === '精确版本 1.0.0')")
    await expect('document.querySelector("h1").textContent === "精确版本 1.0.0"', 'detail switched to another version with the same ID')
    await click('安装'); await until('fixture.stats.plans.length === 1')
    await expect('fixture.stats.plans[0].selections[0].targetVersion === "1.0.0"', 'detail preflight selected the wrong version')
  })
  await check('版本：公共套餐按component.version预检，不取第一个同ID插件', async () => {
    await render('versions-home'); await click('查看套餐变更'); await until('fixture.stats.plans.length === 1')
    await expect('fixture.stats.plans[0].packId === "versioned-pack" && fixture.stats.plans[0].selections[0].targetVersion === "1.0.0"', 'Pack selected the wrong version')
  })
  await check('版本：我的插件与旧版详情的默认更新均选择最高已登记兼容版本', async () => {
    await render('versions-installed'); await click('我的插件'); await click('更新到 2.0.0'); await until('fixture.stats.plans.length === 1')
    await expect('fixture.stats.plans[0].selections[0].targetVersion === "2.0.0"', 'inventory chose an invalid or unregistered update')
    await click('关闭'); await click('全部插件')
    await click('查看详情', "[...document.querySelectorAll('.eac-market__plugin-card')].find(el => el.querySelector('h3').textContent === '精确版本 1.0.0')")
    await expect('document.querySelector("h1").textContent === "精确版本 1.0.0"', 'installed detail selected another version')
    await click('更新到 2.0.0'); await until('fixture.stats.plans.length === 2')
    await expect('fixture.stats.plans[1].selections[0].targetVersion === "2.0.0"', 'detail update used the detail version instead of the latest eligible one')
  })

  await check('组合：首页私有入口、自动预检和未勾试装的部分执行', async () => {
    await render('collection-home')
    const home = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(join(output, 'collection-home-1280.png'), Buffer.from(home.data, 'base64'))
    await click('查看组合变更'); await until('fixture.stats.plans.length === 1')
    await expect('fixture.stats.plans[0].collectionId === "collection-test" && fixture.stats.plans[0].collectionVersion === "2.0.0" && !("packId" in fixture.stats.plans[0]) && fixture.stats.plans[0].selections.every(item => item.tryUnverified === false && item.enabledIntent === false)', 'private collection did not preserve its request identity')
    await expect('document.body.innerText.includes("可执行 1 项") && document.body.innerText.includes("跳过 2 项") && document.body.innerText.includes("依赖暂停 1 项")', 'partial scope is not explicit')
    await click('确认执行可用项'); await expect('fixture.stats.starts.length === 1 && document.body.innerText.includes("部分完成")', 'safe subset was blocked or result falsely shown complete')
  })
  await check('组合：试装变化重新预检，硬不兼容始终跳过', async () => {
    await render('collection-consent'); await click('查看组合变更'); await until('fixture.stats.plans.length === 1')
    await evaluate("document.querySelector('input[type=checkbox]').click()"); await until('fixture.stats.plans.length === 2')
    await expect('fixture.stats.plans[1].selections.every(item => item.tryUnverified) && document.body.innerText.includes("可执行 3 项") && document.body.innerText.includes("跳过 1 项") && document.body.innerText.includes("已知不兼容，不会执行")', 'consent did not update the safe scope')
    await evaluate("document.querySelector('input[type=checkbox]').click()"); await until('fixture.stats.plans.length === 3')
    await expect('!fixture.stats.plans[2].selections.some(item => item.tryUnverified) && document.body.innerText.includes("可执行 1 项")', 'unchecking consent retained stale executable scope')
    await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 900, deviceScaleFactor: 1, mobile: false })
    await expect('document.documentElement.scrollWidth <= innerWidth + 1', 'collection preflight overflows at 480px')
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(join(output, 'collection-plan-480.png'), Buffer.from(shot.data, 'base64'))
  })
  await check('组合：公共Pack部分阻止仍允许安全项，身份不混成collection', async () => {
    await render('pack-partial'); await click('查看套餐变更'); await until('fixture.stats.plans.length === 1')
    await expect('fixture.stats.plans[0].packId === "pack-test" && !("collectionId" in fixture.stats.plans[0]) && document.body.innerText.includes("依赖暂停 1 项")', 'public Pack identity or dependency scope changed')
    await click('确认执行可用项'); await expect('fixture.stats.starts.length === 1', 'partial Pack could not start')
  })
  await check('组合：整套blocked与不安全Host计划都禁止确认', async () => {
    for (const mode of ['collection-all-blocked', 'collection-unsafe']) {
      await render(mode); await click('查看组合变更'); await until('fixture.stats.plans.length === 1')
      await expect("fixture.stats.starts.length === 0 && [...document.querySelectorAll('button')].find(el => el.textContent === '确认执行可用项').disabled", mode + ' was not blocked')
    }
  })
  await check('组合：内容摘要漂移拒绝旧确认', async () => {
    await render('collection-stale'); await click('查看组合变更'); await until('fixture.stats.plans.length === 1')
    await expect("document.body.innerText.includes('组合版本或内容已变化') && fixture.stats.starts.length === 0 && [...document.querySelectorAll('button')].find(el => el.textContent === '确认执行可用项').disabled", 'changed collection reused old confirmation')
  })

  await check('未勾选零提交、自动预检、勾选重预检及取消勾选作废', async () => {
    await render('install'); await click('打开安装窗口'); await until('fixture.stats.plans.length === 1')
    await expect("[...document.querySelectorAll('button')].find(e=>e.textContent==='确认安装').disabled", 'unchecked button must be disabled')
    await evaluate("document.querySelector('input[type=checkbox]').click()"); await until('fixture.stats.plans.length === 2')
    await expect('fixture.stats.plans[1].selections[0].tryUnverified === true', 'consent not bound to request')
    await evaluate("document.querySelector('input[type=checkbox]').click()"); await until('fixture.stats.plans.length === 3')
    await expect("fixture.stats.starts.length === 0 && [...document.querySelectorAll('button')].find(e=>e.textContent==='确认安装').disabled", 'uncheck must invalidate old consent')
    await evaluate("document.querySelector('input[type=checkbox]').click()"); await until('fixture.stats.plans.length === 4'); await click('确认安装')
    await expect('fixture.stats.starts.length === 1', 'explicit confirm must submit once')
  })
  await check('A迟到成功不能关闭B或串用B计划', async () => {
    await render('late'); await click('打开安装窗口'); await until('fixture.stats.plans.length === 1')
    await evaluate("document.querySelector('input[type=checkbox]').click()"); await until('fixture.stats.plans.length === 2'); await click('确认安装')
    await evaluate('fixture.openB()'); await until('document.body.innerText.includes("安装：合成插件 B")'); await evaluate('fixture.resolveA()'); await pause(100)
    await expect('fixture.stats.closes === 0 && fixture.stats.started[0] === "A" && document.body.innerText.includes("安装：合成插件 B")', 'late A closed B')
  })
  await check('降级第一次确认零写，第二次确认才提交', async () => {
    await render('downgrade'); await click('打开安装窗口'); await until('fixture.stats.plans.length === 1'); await click('确认安装')
    await expect('fixture.stats.starts.length === 0 && document.body.innerText.includes("再次确认降级影响")', 'downgrade wrote before impact')
    await click('已了解影响，确认降级'); await expect('fixture.stats.starts.length === 1', 'downgrade second confirmation did not submit')
  })
  await check('AI按任务展示，危险动作首确认无risk字段，第二确认带challenge', async () => {
    await render('ai'); await click('AI 分析本任务', 'document.querySelector(\'[aria-label="任务 A"]\')')
    await until('document.body.innerText.includes("只属于 A 的方案")')
    await expect('!document.querySelector(\'[aria-label="任务 B"]\').textContent.includes("只属于 A")', 'AI proposal leaked into task B')
    await click('确认执行 AI 方案'); await until('fixture.stats.ai.length === 1')
    await expect('!("riskConfirmed" in fixture.stats.ai[0]) && !("challengeId" in fixture.stats.ai[0])', 'first confirmation carried risk consent')
    await click('已了解影响，再次确认执行')
    await expect('fixture.stats.ai[1].riskConfirmed === true && fixture.stats.ai[1].challengeId === "challenge" && fixture.stats.ai[1].challengeDigest === "challenge-digest"', 'second confirmation lacks bound challenge')
  })
  await check('AI queued读取真实任务并并入列表，不显示applied', async () => {
    await render('ai-queued'); await click('AI 分析本任务', 'document.querySelector(\'[aria-label="任务 A"]\')')
    await until('document.body.innerText.includes("只属于 A 的方案")'); await click('确认执行 AI 方案')
    await expect('fixture.stats.started.includes("ai-queued-task") && document.body.innerText.includes("任务已排队") && !document.body.innerText.includes("操作已执行")', 'queued shown as applied or task not merged')
  })
  await check('作者草稿重开、README差异、冲突保留原稿与出站API调用', async () => {
    await render('author'); await click('合成草稿' + await evaluate('document.querySelector(".eac-market__draft-list small").textContent'))
    await until('document.getElementById("draft-markdown").value === "旧正文"')
    await input('repo-url', 'https://github.com/example/test'); await click('读取并预览差异')
    await until('document.body.innerText.includes("确认正文差异")')
    await expect('fixture.stats.saved.length === 0', 'README preview overwrote draft')
    await evaluate('fixture.conflict()'); await click('确认差异并保存')
    await expect('document.body.innerText.includes("revision 已变化") && document.getElementById("draft-markdown").value === "旧正文"', 'conflict lost original')
    await click('关闭'); await click('保存并导出介绍 ZIP')
    await expect('fixture.stats.exports === 1 && fixture.stats.dispose === 1', 'ZIP did not use outbound API')
  })
  await check('作者图片上传绑定草稿revision，校验预览并插入正文', async () => {
    await render('author'); await click('合成草稿' + await evaluate('document.querySelector(".eac-market__draft-list small").textContent'))
    const photo = join(output, 'test-media.png')
    writeFileSync(photo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    const doc = await send('DOM.getDocument')
    const field = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#draft-image' })
    await send('DOM.setFileInputFiles', { nodeId: field.nodeId, files: [photo] })
    await until('!!document.querySelector(".eac-market__media-list img")')
    await expect('fixture.stats.mediaUploads[0].targetId === "draft-one" && fixture.stats.mediaUploads[0].expectedRevision === "r1"', 'media upload is not bound')
    await click('插入正文'); await expect('document.getElementById("draft-markdown").value.includes("media://img-fixture")', 'media not inserted')
  })
  await check('普通卸载实际两次确认且官方导航可调用', async () => {
    await render('remove'); await click('我的插件'); await click('打开官方插件页'); await expect('fixture.stats.official > 0', 'official navigation not wired')
    await click('卸载'); await click('继续查看卸载影响'); await expect('fixture.stats.started.length === 0', 'remove first confirm wrote')
    await click('已了解影响，再次确认卸载'); await expect('fixture.stats.started.includes("remove")', 'second confirmation did not remove')
  })
  await check('目录刷新失败显示原因，不报已刷新', async () => {
    await render('home'); await click('更多'); await click('设置'); await click('刷新目录')
    await expect('document.body.innerText.includes("目录刷新失败") && document.body.innerText.includes("合成来源离线") && !document.body.innerText.includes("目录已刷新。")', 'refresh failure was lost')
  })
  await check('键盘Tab困于对话框、Escape关闭、焦点返回触发按钮', async () => {
    await render('install'); await evaluate('document.getElementById("launch").focus()'); await click('打开安装窗口')
    await until('!!document.querySelector("[role=dialog]")')
    await evaluate("(() => { const a=[...document.querySelector('[role=dialog]').querySelectorAll('button:not([disabled]),input:not([disabled])')]; a[a.length-1].focus() })()")
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await expect("document.querySelector('[role=dialog]').contains(document.activeElement)", 'Tab escaped dialog')
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await pause(50)
    await expect('!document.querySelector("[role=dialog]") && document.activeElement.id === "launch"', 'Escape focus did not return')
  })
  await check('更多菜单支持方向键和Escape焦点恢复', async () => {
    await render('home'); await click('更多')
    await expect('document.activeElement.textContent === "设置"', 'menu did not focus first item')
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
    await expect('document.activeElement.textContent === "作者工具"', 'menu ArrowDown did not navigate')
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await pause(40)
    await expect('!document.querySelector("[role=menu]") && document.activeElement.textContent === "更多"', 'menu Escape did not return focus')
  })
  const theme = async (dark) => {
    await evaluate(`document.documentElement.style.cssText=${JSON.stringify(dark ? '--dsw-alias-bg-base:#141414;--dsw-alias-bg-layer-1:#232323;--dsw-alias-bg-layer-2:#303030;--dsw-alias-label-primary:#eeeeee;--dsw-alias-label-secondary:#b8b8b8;--dsw-alias-label-tertiary:#aaaaaa;--dsw-alias-border-l1:#4a4a4a;--dsw-alias-border-l3:#666666;--dsw-alias-link:#8aafff;--dsw-alias-state-business-primary:#386ad9;' : '')}`)
  }
  if (listingsOnly) {
    await check('登记：27条默认折叠，位于主列表之后，不混入功能卡片', async () => {
      await render('skins-listings'); await click('全部插件')
      await expect('!document.querySelector(".eac-market__pending-listings")', 'research-only records leaked into default installable view')
      await click('全部记录')
      await expect('document.querySelector(".eac-market__pending-listings") && !document.querySelector(".eac-market__pending-listings").open && document.querySelectorAll(".eac-market__pending-list li").length === 27', 'registered catalog not collapsed or incomplete')
      await expect('document.querySelectorAll(".eac-market__plugin-card").length === 1 && document.querySelector(".eac-market__pending-listings").getBoundingClientRect().top > document.querySelector(".eac-market__plugin-card").getBoundingClientRect().top', 'listings displaced plugin grid')
      await evaluate('document.querySelector(".eac-market__pending-listings summary").click()')
      await expect('document.querySelectorAll(".eac-market__pending-list button").length === 0 && document.querySelectorAll(".eac-market__pending-list a").length === 27 && skinFixture.stats.plans.length === 0 && skinFixture.stats.starts.length === 0', 'registration row exposes install action')
    })
    await check('登记：名称/说明搜索，申请版本标为未核实，无结果可恢复', async () => {
      await input('eac-market-search', '语音整理')
      await expect('document.querySelectorAll(".eac-market__pending-list li").length === 1 && document.querySelector(".eac-market__pending-list").textContent.includes("合成登记功能 6")', 'description search failed')
      await input('eac-market-search', '合成登记功能 2')
      await expect('document.querySelector(".eac-market__pending-list").textContent.includes("申请版本：2.0.0（未核实）")', 'requested version presented as verified release')
      await input('eac-market-search', '找不到的记录')
      await expect('document.querySelector(".eac-market__pending-listings").textContent.includes("没有匹配的登记项目")', 'empty search unexplained')
      await input('eac-market-search', '')
      await expect('document.querySelectorAll(".eac-market__pending-list li").length === 27', 'clearing search did not restore records')
    })
    for (const [width, dark] of [[1280, false], [480, true]]) {
      await check(`登记：${width}px展开收起、窄面板无横向溢出`, async () => {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 760, deviceScaleFactor: 1, mobile: false }); await theme(dark)
        await render('skins-listings'); await click('全部插件'); await click('全部记录')
        await evaluate('document.querySelector(".eac-market__pending-listings summary").scrollIntoView({block:"center"})')
        let shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(join(output, `pending-collapsed-${width}.png`), Buffer.from(shot.data, 'base64'))
        await evaluate('document.querySelector(".eac-market__pending-listings summary").click();document.querySelector(".eac-market__pending-listings summary").scrollIntoView({block:"start"});document.querySelector(".eac-market__scroll").scrollTop -= document.querySelector(".eac-market__topbar").getBoundingClientRect().height + 12')
        await expect('document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector(".eac-market__pending-listings").open', 'expanded pending catalog overflows')
        shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(join(output, `pending-expanded-${width}.png`), Buffer.from(shot.data, 'base64'))
        await evaluate('document.querySelector(".eac-market__pending-listings summary").click()')
        await expect('!document.querySelector(".eac-market__pending-listings").open', 'cannot collapse listing')
      })
    }
  }
  if (skinsOnly) {
    const skinScope = (index) => `[...document.querySelectorAll('.eac-market__plugin-card')].find(e => e.querySelector('h3').textContent === '合成皮肤 ${index}')`
    const installedScope = (index) => `[...document.querySelectorAll('.eac-market__skin-installed')].find(e => e.querySelector('h3').textContent === '合成皮肤 ${index}')`
    const center = async (mode = 'skins-installed') => { await render(mode); await click('打开皮肤中心'); await until('document.querySelector("h1").textContent === "皮肤中心"') }
    await check('皮肤：三主导航、首页全部排除单独皮肤和重复loader卡', async () => {
      await render('skins-catalog')
      await expect('document.querySelectorAll(".eac-market__nav button").length === 3 && document.querySelectorAll("[aria-label=皮肤管理器入口]").length === 1', 'entry or nav count wrong')
      await expect('![...document.querySelectorAll(".eac-market__plugin-card h3")].some(e => e.textContent.startsWith("合成皮肤"))', 'skin recommendations leaked into discovery')
      await click('全部插件')
      await expect('document.querySelectorAll(".eac-market__plugin-card").length === 1 && document.body.innerText.includes("合成功能插件")', 'classification guessed from package prefix or loader duplicated')
      await click('我的插件'); await expect('document.body.innerText.includes("0 款已安装")', 'catalog marked installed')
    })
    await check('皮肤：catalog-only浏览搜索与缺制品/暂停保留', async () => {
      await center('skins-catalog')
      await expect('document.querySelectorAll(".eac-market__skin-center .eac-market__plugin-card").length === 13 && document.body.innerText.includes("尚未安装")', 'skin count or missing runtime guidance wrong')
      await expect('!document.body.innerText.includes("已恢复默认") && ![...document.querySelectorAll("button")].some(e => e.textContent === "恢复默认外观")', 'invented current skin or switch action')
      await input('eac-skin-search', '合成皮肤 10')
      await expect('document.querySelectorAll(".eac-market__skin-center .eac-market__plugin-card").length === 1 && document.body.innerText.includes("缺少可下载制品")', 'missing artifact skin hidden')
      await input('eac-skin-search', '合成皮肤 11')
      await expect('document.body.innerText.includes("安装已阻止") && document.body.innerText.includes("兼容修复")', 'blocked reason hidden')
      await click('查看详情', skinScope(11)); await click('返回皮肤中心')
      await expect('document.getElementById("eac-skin-search").value === "合成皮肤 11"', 'search lost on detail return')
    })
    await check('皮肤：先引导loader、核心完整计划、确认前零写', async () => {
      await center('skins-catalog'); await click('查看安装方案', skinScope(0))
      await expect('skinFixture.stats.plans.length === 0 && skinFixture.stats.starts.length === 0', 'guide performed a write')
      await click('先查看管理器安装方案'); await until('skinFixture.stats.plans.length === 1')
      await expect('skinFixture.stats.plans[0].selections.length === 1 && skinFixture.stats.plans[0].selections[0].packageName === "@dsh-eac/ui-skin-loader" && skinFixture.stats.starts.length === 0', 'loader auto installed or skin added to plan')
      await click('关闭'); await click('查看安装方案', skinScope(0)); await click('仅查看此皮肤安装方案'); await until('skinFixture.stats.plans.length === 2')
      await expect('skinFixture.stats.plans[1].selections[0].packageName === "@test/appearance-0" && skinFixture.stats.starts.length === 0', 'skin selection or confirmation gate wrong')
      await click('确认安装'); await until('skinFixture.stats.starts.length === 1')
      await expect('skinFixture.stats.switches.length === 0', 'install automatically switched skin')
    })
    await check('皮肤：已安装聚合、loader仍为功能、停用/故障/版本保留', async () => {
      await render('skins-installed'); await click('我的插件')
      await expect('document.body.innerText.includes("3 款已安装") && !document.body.innerText.includes("合成皮肤 0") && document.body.innerText.includes("合成皮肤管理器")', 'inventory aggregation lost loader or leaked skins')
      await click('打开皮肤中心'); await click('已安装皮肤（3）')
      await expect('document.querySelectorAll(".eac-market__skin-installed").length === 3 && document.body.innerText.includes("已登记，未使用") && document.body.innerText.includes("激活故障") && document.body.innerText.includes("已停用") && document.body.innerText.includes("1.0.0")', 'installed facts lost')
      await expect(`${installedScope(2)}.querySelector('.eac-market__skin-controls button').disabled`, 'disabled skin switch available')
      await click('使用此皮肤', installedScope(0)); await until('document.body.innerText.includes("加载器已确认使用此皮肤")')
      await expect('skinFixture.stats.switches[0] === "test-skin-0" && document.body.innerText.includes("合成皮肤 0 · 1.0.0 · 使用中")', 'active state not tied to current/status')
      await click('恢复默认外观'); await until('document.body.innerText.includes("已恢复默认外观")')
      await expect('skinFixture.stats.switches[1] === "default"', 'default target incorrect')
    })
    await check('皮肤：失败/回退与未确认响应不假报成功，故障重试需确认', async () => {
      await center(); await click('已安装皮肤（3）'); await evaluate('skinFixture.behavior("unconfirmed")')
      await click('使用此皮肤', installedScope(0)); await until('document.body.innerText.includes("未确认目标生效")')
      await expect('!document.body.innerText.includes("加载器已确认使用此皮肤")', 'ok response used as active evidence')
      await evaluate('skinFixture.behavior("fail")'); await click('查看重试说明', installedScope(1))
      await expect('skinFixture.stats.switches.length === 1', 'fault retry happened without confirmation')
      await click('确认重试此皮肤', installedScope(1)); await until('document.body.innerText.includes("合成激活故障")')
      await expect('document.body.innerText.includes("回退到 默认外观") && document.body.innerText.includes("合成残留提醒")', 'rollback or warning lost')
    })
    await check('皮肤：服务移除清理监听并拒绝迟到成功，重新出现可恢复', async () => {
      await center('skins-offline'); await click('已安装皮肤（3）')
      await expect('!document.body.innerText.includes("使用此皮肤") && document.body.innerText.includes("切换服务暂不可用")', 'offline exposes switch')
      await evaluate('skinFixture.availability(true)'); await until('skinFixture.stats.runtimeListeners === 1')
      await evaluate('skinFixture.behavior("late")'); await click('使用此皮肤', installedScope(0))
      await evaluate('skinFixture.availability(false)'); await until('skinFixture.stats.runtimeListeners === 0')
      await evaluate('skinFixture.settle()'); await pause(60)
      await expect('!document.body.innerText.includes("加载器已确认使用此皮肤") && !document.body.innerText.includes("使用此皮肤")', 'stale result survived service removal')
      await evaluate('skinFixture.availability(true)'); await until('skinFixture.stats.runtimeListeners === 1')
      await render('skins-catalog'); await until('skinFixture.stats.runtimeListeners === 0 && skinFixture.stats.bridgeListeners === 0')
    })
    await check('皮肤：仅服务登记/幽灵active不能冒充已安装或切换成功', async () => {
      await center('skins-ghost'); await evaluate('skinFixture.ghost()')
      await expect('document.body.innerText.includes("已安装皮肤（0）") && document.body.innerText.includes("尚未确认当前外观") && !document.body.innerText.includes("使用此皮肤")', 'registration treated as installation/activation')
    })
    await check('皮肤：同一轮移除再提供服务不会卡住busy或接纳旧结果', async () => {
      await center(); await click('已安装皮肤（3）'); await evaluate('skinFixture.behavior("late")')
      await click('使用此皮肤', installedScope(0))
      await evaluate('skinFixture.availability(false); skinFixture.availability(true)')
      await until('!document.body.innerText.includes("正在等待皮肤管理器完成切换")')
      await evaluate('skinFixture.settle()'); await pause(60)
      await expect('!document.body.innerText.includes("加载器已确认使用此皮肤") && skinFixture.stats.runtimeListeners === 1', 'batched lifetime change left stale state')
      await evaluate('skinFixture.behavior("throw")'); await click('使用此皮肤', installedScope(0)); await until('document.body.innerText.includes("合成连接中断")')
      await expect('!document.body.innerText.includes("加载器已确认使用此皮肤")', 'exception reported success')
    })
    for (const [width, dark] of [[1280, false], [480, true]]) {
      await check(`皮肤：${width}px布局/滚动/截图`, async () => {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 760, deviceScaleFactor: 1, mobile: false }); await theme(dark)
        await render('skins-catalog')
        let shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(join(output, `skin-entry-${width}.png`), Buffer.from(shot.data, 'base64'))
        await click('打开皮肤中心')
        await expect('document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector(".eac-market-host").getBoundingClientRect().bottom <= innerHeight + 1', 'skin page overflows official panel')
        shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(join(output, `skin-browse-${width}.png`), Buffer.from(shot.data, 'base64'))
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width - 60, y: 500, deltaY: 700, deltaX: 0 }); await until('document.querySelector(".eac-market__scroll").scrollTop > 100')
        await center(); await click('已安装皮肤（3）'); await evaluate('document.querySelector(".eac-market__scroll").scrollTo(0,0)')
        shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(join(output, `skin-installed-${width}.png`), Buffer.from(shot.data, 'base64'))
      })
    }
  }
  for (const [width, dark] of [[1280, false], [480, true]]) {
    await check(`滚动：官方受限面板 ${width}px 的折叠、滚轮与键盘`, async () => {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 760, deviceScaleFactor: 1, mobile: false })
      await theme(dark); await render('inventory-scroll'); await click('我的插件')
      await until('document.querySelector(".eac-market__system-group") !== null')
      await expect('!document.querySelector(".eac-market__system-group").open && !document.querySelector(".eac-market__system-group .eac-market__grid").children.length', 'official group should start closed without hidden card work')
      await expect('document.querySelector(".eac-market__system-group summary").textContent.includes("28") && document.querySelector(".eac-market__group-warning").textContent.includes("2")', 'collapsed summary loses the official count or warning')
      await evaluate('document.querySelector(".eac-market__system-group summary").click()')
      await until('document.querySelector(".eac-market__system-group .eac-market__grid").children.length === 28')
      await expect('document.querySelector(".eac-market__scroll").scrollHeight > document.querySelector(".eac-market__scroll").clientHeight && document.querySelector(".eac-market-host").getBoundingClientRect().bottom <= innerHeight + 1', 'list grows out of the official clipped panel')
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width - 60, y: 500, deltaY: 700, deltaX: 0 })
      await until('document.querySelector(".eac-market__scroll").scrollTop > 100')
      await evaluate('document.querySelector(".eac-market__scroll").focus()')
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
      await until('Math.abs(document.querySelector(".eac-market__scroll").scrollHeight - document.querySelector(".eac-market__scroll").clientHeight - document.querySelector(".eac-market__scroll").scrollTop) < 5')
      await expect('document.documentElement.scrollWidth <= innerWidth + 1', 'narrow grouped list overflows horizontally')
      await evaluate('document.querySelector(".eac-market__system-group summary").click()')
      await until('!document.querySelector(".eac-market__system-group").open')
      await evaluate('document.querySelector(".eac-market__scroll").scrollTo(0,0)')
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(join(output, `mine-collapsed-${width}.png`), Buffer.from(shot.data, 'base64'))
    })
  }
  for (const [name, width, dark] of [['home', 1280, false], ['home', 480, true], ['long', 480, false], ['empty', 480, false], ['author', 480, true], ['ai', 480, true]]) {
    await check(`布局与截图 ${name}-${width}-${dark ? 'dark' : 'light'}`, async () => {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }); await theme(dark); await render(name)
      await expect('document.documentElement.scrollWidth <= innerWidth + 1', 'viewport has horizontal overflow')
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(join(output, `${name}-${width}-${dark ? 'dark' : 'light'}.png`), Buffer.from(shot.data, 'base64'))
    })
  }
} catch (error) { results.push({ name: 'browser harness', status: 'failed', error: error.stack }) }
finally {
  if (send) await send('Browser.close').catch(() => {})
  ws?.close(); server.close(); browser.kill()
  writeFileSync(join(output, 'browser-results.json'), JSON.stringify({ evidence: 'synthetic React components in isolated headless Edge; not official Desktop', results }, null, 2))
  console.log(JSON.stringify(results, null, 2))
  process.exitCode = results.some((result) => result.status === 'failed') ? 1 : 0
}
