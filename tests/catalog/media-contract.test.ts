import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateMarketIndex } from '../../packages/market-core/src/catalog/validate.ts'
import { buildCatalogDiscovery } from '../../packages/market-core/src/catalog/discovery.ts'

const icon = { id: 'media-icon', alt: '作者声明的图标', sourceUrl: 'https://images.example.test/icon.png' }
const previews = [
  { id: 'preview-dark', alt: '深色预览', sourceUrl: 'https://images.example.test/dark.png', theme: 'dark' },
  { id: 'preview-light', alt: '浅色预览', sourceUrl: 'https://images.example.test/light.png', theme: 'light' },
]

function documentWithMedia(media: unknown) {
  const document = JSON.parse(readFileSync(new URL('./fixtures/valid-market-index.json', import.meta.url), 'utf8'))
  document.plugins[0].media = media
  document.plugins[0].screenshots = previews
  document.presentations[0].media = previews
  document.listings = [{ id: 'media.research-only', name: '媒体登记项', packageName: 'research-only',
    summary: '合成媒体合同夹具', reason: '未绑定发行制品', sourceUrl: 'https://example.test/repository', media }]
  return document
}

describe('目录媒体公共投影合同', () => {
  it('插件、登记项与presentation保留图标、预览顺序和声明主题', () => {
    const media = { icon, previews }
    const snapshot = validateMarketIndex(documentWithMedia(media)).snapshot
    expect(snapshot.plugins[0]?.media).toEqual(media)
    expect(snapshot.listings?.[0]?.media).toEqual(media)
    expect(snapshot.plugins[0]?.screenshots).toEqual(previews)
    expect(snapshot.presentations[0]?.media).toEqual(previews)
    const serialized = JSON.parse(JSON.stringify(snapshot))
    expect(serialized.listings[0].media.previews.map((preview: { theme: string }) => preview.theme)).toEqual(['dark', 'light'])
    expect(snapshot.plugins.some(plugin => plugin.packageName === 'research-only')).toBe(false)
    expect(snapshot.listings?.[0]).not.toHaveProperty('installability')
  })

  it('无media旧目录不补造字段', () => {
    const document = documentWithMedia({ icon })
    delete document.plugins[0].media
    delete document.listings[0].media
    const snapshot = validateMarketIndex(document).snapshot
    expect(snapshot.plugins[0]).not.toHaveProperty('media')
    expect(snapshot.listings?.[0]).not.toHaveProperty('media')
  })

  it('发现缩略图使用首张声明预览，不把图标冒充预览', () => {
    const snapshot = validateMarketIndex(documentWithMedia({ icon, previews })).snapshot
    const plugin = snapshot.plugins[0]!
    const recommendations = [{ pluginId: plugin.id, version: plugin.version, placement: 'featured' as const, order: 1, reason: '合成展示测试' }]
    const discovery = buildCatalogDiscovery({ plugins: [plugin], presentations: snapshot.presentations, recommendations })
    expect(discovery.featured[0]?.poster).toEqual(previews[0])
    const iconOnly = { ...plugin, media: { icon }, screenshots: [] }
    expect(buildCatalogDiscovery({ plugins: [iconOnly], presentations: [], recommendations }).featured[0]).not.toHaveProperty('poster')
  })

  it('Unicode alt限制按字符且不重写上游文字', () => {
    const media = { icon: { ...icon, alt: '😀'.repeat(500) } }
    expect(validateMarketIndex(documentWithMedia(media)).snapshot.plugins[0]?.media).toEqual(media)
    expect(() => validateMarketIndex(documentWithMedia({ icon: { ...icon, alt: '😀'.repeat(501) } }))).toThrow()
  })

  it('Unicode URL限制按字符，完整预览不因UTF8字节计数丢失', () => {
    const media = { previews: [{ ...previews[0], sourceUrl: `https://example.test/${'界'.repeat(4_000)}` }] }
    const document = documentWithMedia(media)
    document.plugins[0].screenshots = media.previews
    document.presentations[0].media = media.previews
    const snapshot = validateMarketIndex(document).snapshot
    expect(snapshot.plugins[0]?.media).toEqual(media)
    expect(snapshot.plugins[0]?.screenshots).toEqual(media.previews)
    expect(snapshot.presentations[0]?.media).toEqual(media.previews)
  })

  it.each([
    {}, { icon, videos: [] }, { previews: [] }, { previews: Array.from({ length: 13 }, (_, index) => ({ ...previews[0], id: `preview-${index}` })) },
    { previews: [previews[0], previews[0]] }, { icon: { ...icon, alt: '   ' } },
    { icon: { ...icon, sourceUrl: 'javascript:alert(1)' } }, { icon: { ...icon, sourceUrl: 'data:image/png;base64,AAAA' } },
    { icon: { ...icon, sourceUrl: 'file:///C:/private.png' } }, { icon: { ...icon, sourceUrl: 'http://example.test/image.png' } },
    { icon: { ...icon, sourceUrl: 'https://user:password@example.test/image.png' } },
    { icon: { ...icon, sourceUrl: 'https://example.test/image name.png' } },
    { previews: [{ ...previews[0], theme: 'verified' }] },
  ])('拒绝不合法媒体对象 %#', media => {
    expect(() => validateMarketIndex(documentWithMedia(media))).toThrow()
  })
})
