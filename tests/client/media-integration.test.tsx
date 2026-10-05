import { describe, expect, it } from 'vitest'
import { DetailView } from '../../packages/market/src/client/MarketPage.tsx'
import { PendingListings } from '../../packages/market/src/client/PendingListings.tsx'
import { MEDIA_CSS } from '../../packages/market/src/client/mediaStyles.ts'
import { pluginFixtures } from './fixtures.ts'

const react = await import(new URL('../../packages/market/node_modules/react/index.js', import.meta.url).href)
const renderer = await import(new URL('../../packages/market/node_modules/react-dom/server.node.js', import.meta.url).href)
const media = { icon: { id: 'integration-icon', sourceUrl: 'https://images.example.test/icon.png', alt: '声明图标' },
  previews: [{ id: 'integration-preview', sourceUrl: 'https://images.example.test/preview.png', alt: '声明预览', theme: 'dark' as const }] }

describe('主页面media接线', () => {
  it('详情优先采用完整media预览并渲染图标，声明不冒充验收', () => {
    const plugin = { ...pluginFixtures.verified, media, screenshots: [{ id: 'legacy-preview', sourceUrl: 'https://images.example.test/legacy.png', alt: '旧预览' }] }
    const html = renderer.renderToStaticMarkup(react.createElement(DetailView, { plugin, presentation: undefined, inventory: [], onBack: () => {}, onInstall: () => {} }))
    expect(html).toContain(media.icon.sourceUrl)
    expect(html).toContain(media.previews[0]!.sourceUrl)
    expect(html).not.toContain(plugin.screenshots[0]!.sourceUrl)
    expect(html).toContain('声明主题：dark')
    expect(html).toContain('不代表审核结论、真实验收或核心兼容性')
    expect(html).not.toContain('真实截图')
  })

  it('登记media默认收起不生成图片或安装入口', () => {
    const listing = { id: 'media-pending', name: '只读登记项', packageName: 'media-pending', summary: '只有上游展示声明', reason: '缺少核验制品',
      sourceUrl: 'https://example.test/repository', requestedVersion: '1.0.0', media }
    const html = renderer.renderToStaticMarkup(react.createElement(PendingListings, { listings: [listing], query: '' }))
    expect(html).toContain('只读登记项')
    expect(html).toContain('未核实')
    expect(html).toContain('缺少核验制品')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('iframe')
  })

  it('媒体样式保持为可拼接TS字符串，不引入额外CSS发行入口', () => {
    expect(typeof MEDIA_CSS).toBe('string')
    expect(MEDIA_CSS).toContain('.eac-market__media-icon')
    expect(MEDIA_CSS).toContain('object-fit: contain')
    expect(MEDIA_CSS).toContain('forced-colors')
  })
})
