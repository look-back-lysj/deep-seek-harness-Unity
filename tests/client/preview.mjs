/** 本地交互预览：合成数据 + 真实 Client 代码，不触碰官方 Desktop / 真实 Profile。
 * 用法: node tests/client/preview.mjs   然后浏览器会自动打开 http://127.0.0.1:4173
 * 停止: 关闭运行它的终端即可。
 */
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const outfile = join(here, 'build', 'preview-fixture.js')
mkdirSync(dirname(outfile), { recursive: true })

await build({
  entryPoints: [join(here, 'browser-fixture.tsx')],
  bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  outfile,
  alias: {
    react: resolve(root, 'packages/market/node_modules/react'),
    'react-dom': resolve(root, 'packages/market/node_modules/react-dom'),
  },
  define: { 'process.env.NODE_ENV': '"development"' },
})
console.log('[preview] fixture built:', outfile)

const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>EAC 市场 · 本地交互预览</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: #6b7280; font-family: ui-monospace, Consolas, "Microsoft YaHei", monospace; }
  #preview-bar { position: sticky; top: 0; z-index: 9999; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
    padding: 8px 10px; background: #131313; border-bottom: 2px solid #3cffd0; color: #e9e9e9; }
  #preview-bar b { color: #3cffd0; font-size: 12px; letter-spacing: 1.4px; margin-right: 4px; }
  #preview-bar button { font: 600 12px/1 ui-monospace, Consolas, monospace; letter-spacing: .06em; cursor: pointer;
    padding: 8px 12px; border-radius: 20px; border: 1px solid #555; background: #232323; color: #e9e9e9; }
  #preview-bar button:hover { background: #3cffd0; color: #000; border-color: #000; }
  #preview-bar button.on { background: #5200ff; color: #fff; border-color: #fff; }
  #preview-hint { padding: 6px 10px; background: #1d1d1d; color: #949494; font-size: 11px; letter-spacing: .04em; border-bottom: 1px solid #444; }
  #stage { display: flex; justify-content: center; min-height: calc(100dvh - 64px); }
  #root { width: 100%; max-width: 100%; height: calc(100dvh - 62px); display: flex; flex-direction: column; overflow: hidden;
    background: #f7f8fa; box-shadow: 0 0 0 1px #131313; }
  body.narrow #root { max-width: 480px; }
  body.dark { background: #131313; }
  body.dark #root { background: #141414; }
</style>
</head>
<body>
<div id="preview-bar">
  <b>EAC PREVIEW</b>
  <button data-scene="discover">发现页</button>
  <button data-scene="directory">全部插件·行情表</button>
  <button data-scene="mine">我的插件·机架</button>
  <button data-scene="detail">插件详情</button>
  <button data-scene="settings">设置</button>
  <button data-scene="author">作者工具</button>
  <button data-scene="install">安装方案弹窗</button>
  <button data-scene="tasks">任务抽屉</button>
  <button data-scene="celebrate">成功彩纸</button>
  <button data-scene="dark" id="btn-dark">暗色主题</button>
  <button data-scene="narrow" id="btn-narrow">窄面板 480</button>
</div>
<div id="preview-hint">合成数据沙盒：可随意点击；“安装”等动作只走本地假后台，不会改动真实插件。控制台可用 fixture.render('场景') 切换。</div>
<div id="stage"><div id="root"></div></div>
<script src="/fixture.js"></script>
<script>
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clickText = (text) => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === text); if (b) b.click(); return !!b; };
  const lightCss = '';
  const darkCss = '--dsw-alias-bg-base:#141414;--dsw-alias-bg-layer-1:#232323;--dsw-alias-bg-layer-2:#303030;--dsw-alias-label-primary:#eeeeee;--dsw-alias-label-secondary:#b8b8b8;--dsw-alias-label-tertiary:#aaaaaa;--dsw-alias-border-l1:#4a4a4a;--dsw-alias-border-l3:#666666;--dsw-alias-link:#8aafff;--dsw-alias-state-business-primary:#386ad9;';
  const scenes = {
    discover: async () => { fixture.render('home'); await sleep(150); clickText('发现'); },
    directory: async () => { fixture.render('home'); await sleep(150); clickText('全部插件'); },
    mine: async () => { fixture.render('inventory-scroll'); await sleep(150); clickText('我的插件'); },
    detail: async () => { fixture.render('home'); await sleep(200); const b = [...document.querySelectorAll('.eac-market__poster-copy button')].find(x => x.textContent.includes('查看详情')); if (b) b.click(); },
    settings: async () => { fixture.render('settings'); await sleep(150); clickText('更多'); await sleep(120); clickText('设置'); },
    author: async () => { fixture.render('author'); },
    install: async () => { fixture.render('install'); await sleep(150); clickText('打开安装窗口'); },
    tasks: async () => { fixture.render('ai'); },
    celebrate: async () => { fixture.render('feedback-completed'); },
    dark: async () => { const on = !document.body.classList.contains('dark'); document.body.classList.toggle('dark', on); document.documentElement.style.cssText = on ? darkCss : lightCss; document.getElementById('btn-dark').classList.toggle('on', on); },
    narrow: async () => { const on = !document.body.classList.contains('narrow'); document.body.classList.toggle('narrow', on); document.getElementById('btn-narrow').classList.toggle('on', on); },
  };
  document.getElementById('preview-bar').addEventListener('click', (event) => {
    const scene = event.target && event.target.dataset ? event.target.dataset.scene : undefined;
    if (scene && scenes[scene]) void scenes[scene]();
  });
</script>
</body>
</html>`

let port = 4173
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
    res.end(readFileSync(outfile))
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(page)
  }
})
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    port += 1
    server.listen(port, '127.0.0.1', ready)
  } else {
    console.error('[preview] server error:', error.message)
    process.exit(1)
  }
})
function ready() {
  const url = `http://127.0.0.1:${port}`
  console.log(`[preview] 打开浏览器: ${url}`)
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
}
server.listen(port, '127.0.0.1', ready)
console.log('[preview] 保持此进程运行即可预览；关闭终端或 Ctrl+C 停止。')
