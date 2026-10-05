import { describe, expect, it, vi } from 'vitest'
import {
  InventoryCard,
  PluginCard,
  ScreenshotFailure,
  VerificationStatus,
} from '../../packages/market/src/client/components.tsx'
import { MARKET_CSS } from '../../packages/market/src/client/marketStyles.ts'
import { readFileSync } from 'node:fs'
import { completedActionFeedback, taskActionFeedback } from '../../packages/market/src/client/action-state.ts'
import { inventoryFixture, pluginFixtures } from './fixtures.ts'
import type { CatalogMedia, InventoryItem } from '../../packages/market/src/types.ts'

const capturedButtonProps = vi.hoisted(() => [] as Array<Record<string, unknown>>)

vi.mock('../../packages/market/src/client/ui.tsx', async () => {
  const react = await import(new URL('../../packages/market/node_modules/react/index.js', import.meta.url).href) as unknown as {
    createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
  }
  const simple = (tag: string) => ({ children, className, ...rest }: Record<string, unknown>) =>
    react.createElement(tag, { ...rest, className }, children)
  return {
    Button: ({ variant, size, className, children, ...rest }: Record<string, unknown>) => {
      capturedButtonProps.push({ variant, size, className, children, ...rest })
      return react.createElement('button', { ...rest, className }, children)
    },
    Input: simple('input'),
    Modal: simple('div'),
  }
})
const react = await import(new URL('../../packages/market/node_modules/react/index.js', import.meta.url).href) as unknown as {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
}
const server = await import(new URL('../../packages/market/node_modules/react-dom/server.node.js', import.meta.url).href) as unknown as {
  renderToStaticMarkup(element: unknown): string
}
const createElement = react.createElement
const renderToStaticMarkup = server.renderToStaticMarkup

function findButtonTag(html: string, label: string): string | undefined {
  return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map((match) => match[0])
    .find((tag) => tag.replace(/<[^>]+>/g, '').trim() === label)
}

function buttonTag(html: string, label: string): string {
  const match = findButtonTag(html, label)
  expect(match, `缺少按钮：${label}`).toBeDefined()
  return match as string
}
const plugin = pluginFixtures.verified
const installedItem: InventoryItem = {
  ...inventoryFixture.items[0]!,
  packageName: plugin.packageName,
  version: plugin.version,
  installed: true,
  bundleEnabled: true,
  removable: true,
  readOnlyReason: undefined,
  restartRequired: false,
  rows: [{ id: 'managed-row', name: plugin.packageName, state: 'enabled' }],
}

describe('视觉与组件回归', () => {
  it('PluginCard 在已安装且提供 onManage 时显示可操作的“管理”', () => {
    const onManage = vi.fn()
    capturedButtonProps.length = 0
    const html = renderToStaticMarkup(createElement(PluginCard as never, {
      plugin,
      inventory: [installedItem],
      onOpen: () => {},
      onInstall: () => {},
      onManage,
    }))
    const manage = capturedButtonProps.find((props) => String(props.children ?? '') === '管理')
    expect(manage).toBeDefined()
    expect(manage?.disabled).not.toBe(true)
    expect(buttonTag(html, '管理')).not.toContain('disabled')
    expect(findButtonTag(html, '已安装')).toBeUndefined()
    const onClick = manage?.onClick as () => void
    onClick()
    expect(onManage).toHaveBeenCalledTimes(1)
  })

  it('PluginCard 未提供 onManage 时保留 disabled“已安装”和可见理由', () => {
    capturedButtonProps.length = 0
    const html = renderToStaticMarkup(createElement(PluginCard as never, {
      plugin,
      inventory: [installedItem],
      onOpen: () => {},
      onInstall: () => {},
    }))
    const installedButton = capturedButtonProps.find((props) => String(props.children ?? '') === '已安装')
    expect(installedButton?.disabled).toBe(true)
    expect(installedButton?.['aria-describedby']).toBeTruthy()
    expect(buttonTag(html, '已安装')).toContain('disabled')
    expect(html).toContain('已安装，请到“我的插件”管理')
  })

  it('InventoryCard 可关闭重复目录缺失说明，系统组件默认不重复分组说明', () => {
    const userItem = inventoryFixture.items[0]!
    const defaultHtml = renderToStaticMarkup(createElement(InventoryCard as never, {
      item: userItem,
      catalogPlugin: undefined,
      onToggle: () => {},
      onRemove: () => {},
    }))
    const hiddenHtml = renderToStaticMarkup(createElement(InventoryCard as never, {
      item: userItem,
      catalogPlugin: undefined,
      showCatalogNotice: false,
      onToggle: () => {},
      onRemove: () => {},
    }))
    const systemHtml = renderToStaticMarkup(createElement(InventoryCard as never, {
      item: { ...userItem, packageName: '@system/internal', source: 'installation', readOnlyReason: 'management-required', rows: [{ id: 'system-error', name: '@system/internal', state: 'load-error' }] },
      catalogPlugin: undefined,
      onToggle: () => {},
      onRemove: () => {},
    }))
    expect(defaultHtml).toContain('此插件不在当前市场目录中')
    expect(hiddenHtml).not.toContain('此插件不在当前市场目录中')
    expect(systemHtml).not.toContain('此插件不在当前市场目录中')
    expect(systemHtml).toContain('由官方插件管理器管理')
    expect(systemHtml).toContain('加载失败')
  })

  it('截图失败占位包含图标、标题、说明、来源与重试语义', () => {
    const media: CatalogMedia = {
      id: 'failed-shot',
      alt: '测试插件真实界面',
      sourceUrl: 'https://example.invalid/source.png',
      width: 800,
      height: 450,
    }
    const onRetry = vi.fn()
    capturedButtonProps.length = 0
    const html = renderToStaticMarkup(createElement(ScreenshotFailure as never, { media, onRetry }))
    expect(html).toContain('<svg')
    expect(html).toContain('截图加载失败')
    expect(html).toContain('测试插件真实界面')
    expect(html).toContain('不会用占位图替代真实截图')
    expect(html).toContain('https://example.invalid/source.png')
    const retryButton = capturedButtonProps.find((props) => String(props.children ?? '') === '重试加载')
    expect(retryButton?.disabled).not.toBe(true)
    expect(String(retryButton?.['aria-label'] ?? '')).toContain('重试加载截图')
    const retry = buttonTag(html, '重试加载')
    expect(retry).toContain('aria-label=')
    expect(retry).not.toContain('disabled')
    const onClick = retryButton?.onClick as () => void
    onClick()
    expect(onRetry).toHaveBeenCalledWith(media)
  })

  it('状态标签始终带文字状态，不依赖颜色表达', () => {
    const html = renderToStaticMarkup(createElement('div', null,
      createElement(VerificationStatus as never, { value: 'hard-incompatible' }),
      createElement(InventoryCard as never, {
        item: {
          ...inventoryFixture.items[0]!,
          packageName: '@test/unknown-state',
          rows: [{ id: 'unknown-row', name: '@test/unknown-state', state: 'unknown' }],
        },
        catalogPlugin: undefined,
        onToggle: () => {},
        onRemove: () => {},
      }),
    ))
    expect(html).toContain('已知不兼容')
    expect(html).toContain('运行状态未知')
    expect(html).toContain('需要重启')
  })

  it('编辑型视觉合同保留主题 fallback、首推舞台和窄面板降级', () => {
    expect(MARKET_CSS).toContain('--eac-content-max: 1160px')
    expect(MARKET_CSS).toContain('.eac-market__poster-stage')
    expect(MARKET_CSS).toContain('.eac-market__brand-mark')
    expect(MARKET_CSS).toContain('@media (forced-colors: active)')
    expect(MARKET_CSS).toContain('@media (prefers-reduced-motion: reduce)')
    expect(MARKET_CSS).toContain('@media (max-width: 719px)')
    expect(MARKET_CSS).not.toContain('@media (prefers-color-scheme: dark)')
  })

  it('窄面板关键结构约束长名称且使用容器查询单列', () => {
    const html = renderToStaticMarkup(createElement(PluginCard as never, {
      plugin: { ...plugin, name: '很长的中文与 English 混排名称'.repeat(5), packageName: '@example/' + 'long-package-name-'.repeat(8) },
      inventory: [],
      onOpen: () => {},
      onInstall: () => {},
    }))
    expect(html).toContain('title="很长的中文与 English 混排名称')
    expect(MARKET_CSS).toContain('@container eac-market (max-width: 719px)')
    expect(MARKET_CSS).toMatch(/@container eac-market \(max-width: 719px\)[\s\S]*\.eac-market__grid[^}]*grid-template-columns: 1fr/)
    expect(MARKET_CSS).toContain('.eac-market__plugin-title { min-width: 0; overflow-wrap: anywhere; }')
    expect(MARKET_CSS).toContain('overflow-wrap: anywhere')
  })

  it('触感层提供硬边立体、成功盖章与彩纸降级', () => {
    expect(MARKET_CSS).toContain('--eac-extrude-mint')
    expect(MARKET_CSS).toContain('@keyframes eac-stamp')
    expect(MARKET_CSS).toContain('@keyframes eac-confetti-fall')
    expect(MARKET_CSS).toContain('@keyframes eac-index-flip')
    expect(MARKET_CSS).toContain('.eac-market__confetti i')
    expect(MARKET_CSS).toMatch(/\.eac-button:active:not\(:disabled\)[^{]*\{[^}]*transform: none/)
    expect(MARKET_CSS).not.toMatch(/\.eac-button:hover:not\(:disabled\)[^{]*\{[^}]*translate/)
    expect(MARKET_CSS).toContain("grid-template-areas: 'head' 'side' 'body'")
    expect(MARKET_CSS).toMatch(/\.eac-market__directory-grid \.eac-market__plugin-card \{[^}]*display: flex/)
    expect(MARKET_CSS).toContain('animation-play-state: paused !important')
    expect(MARKET_CSS).not.toContain('@media (prefers-color-scheme: dark)')
  })

  it('StoryStream 重造保留频道刊头条、章节流与行情表结构', () => {
    expect(MARKET_CSS).toContain('.eac-market__stream')
    expect(MARKET_CSS).toContain('.eac-market__chapter-index')
    expect(MARKET_CSS).toContain('counter-reset: eac-ticker')
    expect(MARKET_CSS).toContain('.eac-market__edition')
    expect(MARKET_CSS).toContain('.eac-market__section-title')
    expect(MARKET_CSS).toContain('.eac-market__nav button:nth-child(1)::before')
    expect(MARKET_CSS).toContain('--eac-mint: #3cffd0')
    expect(MARKET_CSS).toContain('--eac-uv: #5200ff')
  })

  it('Round-4：抽屉锚定、筛选呼吸与图标底片合同', () => {
    expect(MARKET_CSS).toMatch(/\.eac-modal-overlay \{\n  position: absolute/)
    expect(MARKET_CSS).toMatch(/\.eac-market \{\n  position: relative/)
    expect(MARKET_CSS).toContain('.eac-market__plugin-icon {\n  box-shadow: 4px 4px 0 var(--eac-uv)')
    expect(MARKET_CSS).toContain('.eac-market__discover-page .eac-market__filters { gap: 10px; margin-bottom: 18px; }')
    expect(MARKET_CSS).toContain('.eac-modal--drawer .eac-market__task-list > .eac-market__empty')
  })

  it('Round-3：三定案与评审修复合同', () => {
    const clientDir = new URL('../../packages/market/src/client/', import.meta.url)
    const sources = ['MarketPage.tsx', 'AuthorWorkspace.tsx', 'TaskDrawer.tsx', 'InstallPlanDialog.tsx', 'components.tsx']
      .map((file) => readFileSync(new URL(file, clientDir), 'utf8'))
    const labels = sources.flatMap((src) => [...src.matchAll(/closeLabel="([^"]+)"/g)].map((m) => m[1]))
    expect(labels.length).toBeGreaterThan(3)
    for (const label of labels) expect(label).toContain('关闭')
    expect(completedActionFeedback('x', 'y').milestone).toBeUndefined()
    expect(completedActionFeedback('x', 'y', 'z', true).milestone).toBe(true)
    expect(taskActionFeedback({ status: 'completed' } as never, '任务').milestone).toBe(true)
    expect(MARKET_CSS).toContain('.eac-modal-overlay--drawer')
    expect(MARKET_CSS).toContain('.eac-modal--drawer')
    expect(MARKET_CSS).toContain('eac-card-plant')
    expect(MARKET_CSS).toContain('.eac-market__chapter-head')
    expect(MARKET_CSS).toContain('.eac-market__facts-strip')
    expect(MARKET_CSS).toContain('@media (max-width: 719px), (pointer: coarse)')
    expect(MARKET_CSS).toContain('.eac-market__brand-mark:hover')
    expect(MARKET_CSS).toMatch(/\.eac-market__topbar--editorial \{\n  background: #131313/)
    const marketPage = readFileSync(new URL('MarketPage.tsx', clientDir), 'utf8')
    expect(marketPage).toContain('nextChapter()')
    expect(marketPage).not.toContain('aria-hidden="true">01</span><h2 id="skin-recommendations-title"')
    expect(marketPage).toContain('{hasImage && <h3>')
    expect(marketPage).not.toContain('第 {index + 1} 步')
    expect(marketPage).toContain('更多用途')
    expect(marketPage).toContain('changePage(page + 1)')
  })

  it('不可操作按钮保留真实 disabled 理由并关联 aria-describedby', () => {
    const blockedHtml = renderToStaticMarkup(createElement(PluginCard as never, {
      plugin: pluginFixtures.blocked,
      inventory: [],
      onOpen: () => {},
      onInstall: () => {},
    }))
    expect(blockedHtml).toContain('暂不可安装')
    expect(blockedHtml).toContain('待作者提供可安装包')
    expect(blockedHtml).toContain('aria-describedby=')

    const tree = createElement(InventoryCard as never, {
      item: {
        ...inventoryFixture.items[0]!,
        packageName: '@test/read-only',
        readOnlyReason: 'management-required',
        removable: false,
      },
      catalogPlugin: undefined,
      onToggle: () => {},
      onRemove: () => {},
    })
    const html = renderToStaticMarkup(tree)
    expect(html).toContain('由官方插件管理器管理')
    expect(html).toContain('当前项目不可卸载')
    expect(html).toContain('aria-describedby=')
  })
})
