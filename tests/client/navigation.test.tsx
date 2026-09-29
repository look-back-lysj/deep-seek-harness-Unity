import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
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

const { applyBrowseChange, detailTab, DiscoverView, MarketFrame, restoreDetailReturnFocus, runAfterNextFrame } =
  await import('../../packages/market/src/client/MarketPage.tsx')
const { catalogFixture, inventoryFixture } = await import('./fixtures.ts')
const react = await import(new URL('../../packages/market/node_modules/react/index.js', import.meta.url).href) as unknown as {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
}
const server = await import(new URL('../../packages/market/node_modules/react-dom/server.node.js', import.meta.url).href) as unknown as {
  renderToStaticMarkup(element: unknown): string
}
const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/market/src/client/MarketPage.tsx'), 'utf8')
const createElement = react.createElement
const renderToStaticMarkup = server.renderToStaticMarkup

function frameHtml(view: string, activeTab?: string, moreMenu = false): string {
  return renderToStaticMarkup(createElement(
    MarketFrame as never,
    {
      view,
      activeCount: 0,
      onNavigate: () => {},
      onTasks: () => {},
      onMore: () => {},
      moreMenu,
      onSecondary: () => {},
      ...(activeTab === undefined ? {} : { activeTab }),
    },
    '测试内容',
  ))
}

describe('EAC 市场交互与导航回归', () => {
  it('排序、验证/安装筛选和已有搜索/分类/清除变化都统一重置到第一页', () => {
    const change = vi.fn()
    const reset = vi.fn()
    applyBrowseChange(change, reset)
    expect(change).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledWith()
    expect(source).toContain('id="eac-sort"')
    expect(source).toContain('id="eac-verification"')
    expect(source).toContain('id="eac-installation"')
    for (const marker of ['eac-sort', 'eac-verification', 'eac-installation', 'eac-category']) {
      const start = source.indexOf(`id="${marker}"`)
      const control = source.slice(start, start + 320)
      expect(control).toContain('applyBrowseChange')
    }
    expect(source).toContain('onChange={(query) => applyBrowseChange')
    expect(source).toContain('onClick={() => applyBrowseChange(() => setFilters(EMPTY_FILTERS)')
  })

  it('主导航切换使用下一帧把滚动容器滚回顶部', () => {
    const callbacks: Array<() => void> = []
    vi.stubGlobal('window', { requestAnimationFrame(callback: () => void) { callbacks.push(callback) } })
    runAfterNextFrame(() => {})
    expect(callbacks).toHaveLength(1)
    callbacks[0]!()
    vi.unstubAllGlobals()
    expect(source).toContain('runAfterNextFrame(() => scrollRef.current?.scrollTo({ top: 0 }))')
  })

  it('次级页面不把发现标成 aria-current，activeTab 可保持详情来源高亮', () => {
    for (const view of ['help', 'settings', 'author', 'extension']) {
      const nav = frameHtml(view).match(/<nav class="eac-market__nav"[\s\S]*?<\/nav>/)?.[0] ?? ''
      expect(nav).not.toContain('aria-current="page"')
    }
    expect(frameHtml('detail', 'discover')).toMatch(/aria-current="page"[^>]*>发现</)
    expect(frameHtml('detail', 'all')).toMatch(/aria-current="page"[^>]*>全部插件</)
    expect(detailTab('discover')).toBe('discover')
    expect(detailTab('all')).toBe('all')
    expect(detailTab('skins')).toBe('all')
    expect(source).toContain("const activeTab = view === 'detail' ? detailTab(previousView) : undefined")
    expect(source).toContain("const from = view === 'skins' ? 'skins' : pageTab(view) ?? 'discover'")
  })

  it('返回列表优先恢复原触发节点，原节点卸载时落到滚动容器', () => {
    const trigger = { isConnected: true, focus: vi.fn() }
    const scroll = { focus: vi.fn() }
    restoreDetailReturnFocus(trigger as never, scroll as never, 'discover', { querySelector: () => null } as never)
    expect(trigger.focus).toHaveBeenCalledTimes(1)

    const removed = { isConnected: false, focus: vi.fn() }
    restoreDetailReturnFocus(removed as never, scroll as never, 'all', { querySelector: () => null } as never)
    expect(removed.focus).not.toHaveBeenCalled()
    expect(scroll.focus).toHaveBeenCalledTimes(1)
    expect(source).toContain('runAfterNextFrame(() => {')
    expect(source).toContain('restoreDetailReturnFocus(returnFocus, scrollRef.current, previousView)')
  })

  it('已安装卡片有管理入口，全部插件调用点也传入管理路径', () => {
    const onManage = vi.fn()
    const html = renderToStaticMarkup(createElement(DiscoverView as never, {
      catalog: catalogFixture,
      inventory: inventoryFixture.items,
      onOpen: () => {},
      onInstall: () => {},
      onPack: () => {},
      onBrowse: () => {},
      onHelp: () => {},
      onManage,
    }))
    expect(html).toContain('>管理</button>')
    expect(html).toContain('aria-label="管理插件：')
    const allBlock = source.slice(source.indexOf("{view === 'all'"), source.indexOf("{view === 'mine'"))
    expect(allBlock).toContain('onManage={() => navigate(\'mine\')}')
    expect(source).toContain('onManage={() => navigate(\'mine\')}')
  })

  it('我的插件页提供一个页面级官方插件页入口，库存卡片不再重复传入口', () => {
    const mineBlock = source.slice(source.indexOf("{view === 'mine'"), source.indexOf("{skinVisited &&"))
    expect(mineBlock).toContain('打开官方插件页')
    expect(mineBlock).not.toContain('onOpenOfficialPlugins={onOpenOfficialPlugins}')
  })

  it('loading/error 的更多菜单真实传递状态且任务按钮保留', () => {
    const loadingBlock = source.slice(source.indexOf("if (state.status === 'loading')"), source.indexOf("if (state.status === 'error')"))
    const errorBlock = source.slice(source.indexOf("if (state.status === 'error')"), source.indexOf('const functionalPlugins'))
    expect(loadingBlock).toContain('moreMenu={moreMenu}')
    expect(errorBlock).toContain('moreMenu={moreMenu}')
    expect(loadingBlock).toContain('activeTab={activeTab}')
    expect(errorBlock).toContain('activeTab={activeTab}')
    expect(loadingBlock).toContain('onTasks={() => setTaskDrawer(true)}')
    expect(errorBlock).toContain('onTasks={() => setTaskDrawer(true)}')
    const closed = frameHtml('help')
    const open = frameHtml('help', undefined, true)
    expect(closed).toContain('aria-expanded="false"')
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('role="menu"')
    expect(open).toContain('>任务</button>')
  })
})
