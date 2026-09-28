import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const react = await import(new URL('../../packages/market/node_modules/react/index.js', import.meta.url).href) as unknown as {
    createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
  }
  const createElement = react.createElement
  const simple = (tag: string) => ({ children, className, ...rest }: Record<string, unknown>) =>
    createElement(tag, { ...rest, className }, children)
  return {
    Button: simple('button'),
    Input: simple('input'),
    Pill: simple('button'),
    Tag: simple('span'),
    MarkdownText: ({ text }: { text: string }) => createElement('pre', null, text),
    Modal: ({ open, title, children }: { open: boolean; title: string; children: unknown }) =>
      open ? createElement('div', { role: 'dialog', 'aria-label': title }, children) : null,
  }
})
import {
  DetailView,
  DiscoverView,
  MarketFrame,
} from '../../packages/market/src/client/MarketPage.tsx'
import { InventoryCard, PluginCard, TaskDrawer } from '../../packages/market/src/client/components.tsx'
import { MARKET_CSS } from '../../packages/market/src/client/marketStyles.ts'
import { catalogFixture, inventoryFixture, pluginFixtures, readOnlyRemote, taskFixture } from './fixtures.ts'

type AnyProps = Record<string, unknown> | null
interface TinyReact {
  createElement(type: unknown, props?: AnyProps, ...children: unknown[]): unknown
}
interface TinyServer {
  renderToStaticMarkup(element: unknown): string
}

const react = await import(new URL('../../packages/market/node_modules/react/index.js', import.meta.url).href) as unknown as TinyReact
const server = await import(new URL('../../packages/market/node_modules/react-dom/server.node.js', import.meta.url).href) as unknown as TinyServer
const createElement = react.createElement
const renderToStaticMarkup = server.renderToStaticMarkup
const here = dirname(fileURLToPath(import.meta.url))

function frame(content: unknown): string {
  return renderToStaticMarkup(createElement(
    MarketFrame as never,
    { view: 'discover', activeCount: 3, onNavigate: () => {}, onTasks: () => {}, onMore: () => {}, moreMenu: false, onSecondary: () => {} },
    content,
  ))
}

describe('client state rendering', () => {
  it('市场主框架只有三个主导航并使用官方主题作用域', () => {
    const discover = createElement(DiscoverView as never, {
      catalog: catalogFixture,
      inventory: inventoryFixture.items,
      onOpen: () => {},
      onInstall: () => {},
      onPack: () => {},
      onBrowse: () => {},
      onHelp: () => {},
    })
    const html = frame(discover)
    expect(html).toContain('发现')
    expect(html).toContain('全部插件')
    expect(html).toContain('我的插件')
    expect(html).toContain('class="eac-market"')
    expect(html).toContain('精选功能，轻松装进 DSH')
    expect(html).not.toContain('Star')
    expect(html).not.toContain('GitHub 登录')
  })

  it('详情页明确显示硬性不兼容和不可安装原因', () => {
    const detail = createElement(DetailView as never, {
      plugin: pluginFixtures.blocked,
      presentation: undefined,
      inventory: [],
      onBack: () => {},
      onInstall: () => {},
    })
    const html = frame(detail)
    expect(html).toContain('已知不兼容')
    expect(html).toContain('待作者提供可安装包')
    expect(html).toContain('不能用“仍然尝试安装”绕过')
  })

  it('任务抽屉覆盖部分完成、待授权、等待重启、取消中和 unknown 文案', () => {
    const tasks = [
      taskFixture({ taskId: 'partial', status: 'partial' }),
      taskFixture({ taskId: 'approval', status: 'awaiting-approval' }),
      taskFixture({ taskId: 'resume', status: 'awaiting-resume' }),
      taskFixture({ taskId: 'unknown', status: 'unknown' }),
    ]
    const html = renderToStaticMarkup(createElement(TaskDrawer as never, {
      open: true,
      tasks,
      onClose: () => {},
      remote: readOnlyRemote(),
      onChanged: () => {},
    }))
    expect(html).toContain('部分完成')
    expect(html).toContain('待脚本授权')
    expect(html).toContain('等待重启')
    expect(html).toContain('状态未知')
    expect(html).toContain('依赖项暂停')
  })

  it('我的插件展示加载错误、只读原因和需要重启', () => {
    const cards = inventoryFixture.items.map((item) => createElement(InventoryCard as never, {
      key: item.packageName,
      item,
      catalogPlugin: undefined,
      onToggle: () => {},
      onRemove: () => {},
    }))
    const html = renderToStaticMarkup(createElement('div', null, ...cards))
    expect(html).toContain('加载失败')
    expect(html).toContain('由官方插件管理器管理')
    expect(html).toContain('需要重启')
    expect(html).toContain('当前项目不可卸载')
  })

  it('窄面板预览可生成，且所有截图都来自真实组件', () => {
    const discover = frame(createElement(DiscoverView as never, {
      catalog: catalogFixture,
      inventory: inventoryFixture.items,
      onOpen: () => {},
      onInstall: () => {},
      onPack: () => {},
      onBrowse: () => {},
      onHelp: () => {},
    }))
    const cards = renderToStaticMarkup(createElement('div', { className: 'eac-market__grid' }, ...catalogFixture.plugins.map((plugin) => createElement(PluginCard as never, {
      key: plugin.id,
      plugin,
      inventory: inventoryFixture.items,
      onOpen: () => {},
      onInstall: () => {},
    }))))
    const tasks = renderToStaticMarkup(createElement(TaskDrawer as never, {
      open: true,
      tasks: [taskFixture()],
      onClose: () => {},
      remote: readOnlyRemote(),
      onChanged: () => {},
    }))
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>EAC Market UI states</title><style>${MARKET_CSS}
body{margin:0;background:#d9dde3;font-family:system-ui,sans-serif}.preview-label{padding:12px 20px;color:#30343b;font-weight:700}.preview{box-sizing:border-box;margin:16px;padding:8px;background:#fff;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.12)}.wide{width:1200px}.medium{width:960px}.narrow{width:480px}
</style></head><body>
<div class="preview-label">1440×900 / 发现</div><div class="preview wide">${discover}</div>
<div class="preview-label">1280×720 / 插件状态</div><div class="preview medium"><div class="eac-market"><div class="eac-market__main">${cards}</div></div></div>
<div class="preview-label">960×640 / 任务状态</div><div class="preview medium" style="position:relative;height:640px">${tasks}</div>
<div class="preview-label">480px / 窄面板</div><div class="preview narrow">${discover}</div>
</body></html>`
    if (process.env.WRITE_PREVIEW === '1') {
      mkdirSync(join(here, 'screenshots'), { recursive: true })
      writeFileSync(join(here, 'screenshots', 'states.html'), html, 'utf8')
      const previewPage = (title: string, body: string): string => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>${MARKET_CSS}
body{margin:0;background:#d9dde3;font-family:system-ui,sans-serif}.preview-label{padding:12px 20px;color:#30343b;font-weight:700}.preview{box-sizing:border-box;margin:16px;padding:8px;background:#fff;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.12)}.wide{width:1200px}.medium{width:960px}.narrow{width:480px}
</style></head><body>${body}</body></html>`
      writeFileSync(join(here, 'screenshots', 'discover-1440.html'), previewPage('发现 1440', `<div class="preview-label">1440×900 / 发现</div><div class="preview wide">${discover}</div>`), 'utf8')
      writeFileSync(join(here, 'screenshots', 'plugins-1280.html'), previewPage('插件状态 1280', `<div class="preview-label">1280×720 / 插件状态</div><div class="preview medium"><div class="eac-market"><div class="eac-market__main">${cards}</div></div></div>`), 'utf8')
      writeFileSync(join(here, 'screenshots', 'tasks-960.html'), previewPage('任务状态 960', `<div class="preview-label">960×640 / 任务状态</div><div class="preview medium" style="position:relative;height:640px">${tasks}</div>`), 'utf8')
      writeFileSync(join(here, 'screenshots', 'narrow-480.html'), previewPage('窄面板 480', `<div class="preview-label">480px / 窄面板</div><div class="preview narrow">${discover}</div>`), 'utf8')
    }
    expect(html).toContain('480px / 窄面板')
  })
})
