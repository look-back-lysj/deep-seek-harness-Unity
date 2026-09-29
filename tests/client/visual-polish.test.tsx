import { describe, expect, it, vi } from 'vitest'
import {
  InventoryCard,
  PluginCard,
  ScreenshotFailure,
  VerificationStatus,
} from '../../packages/market/src/client/components.tsx'
import { MARKET_CSS } from '../../packages/market/src/client/marketStyles.ts'
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
