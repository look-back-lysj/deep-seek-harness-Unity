import { describe, expect, it, vi } from 'vitest'
import { DiscoverView } from '../../packages/market/src/client/MarketPage.tsx'
import { VerificationStatus } from '../../packages/market/src/client/components.tsx'
import { inventoryIssueLabel, isEnvironmentPreflightBlock, PreflightBlockNotice } from '../../packages/market/src/client/InstallPlanDialog.tsx'
import type { CatalogSnapshot, PlanResult } from '../../packages/market/src/types.ts'
import { catalogFixture, pluginFixtures } from './fixtures.ts'

const react = await import(new URL('../../packages/market/node_modules/react/index.js', import.meta.url).href) as unknown as {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
}
const server = await import(new URL('../../packages/market/node_modules/react-dom/server.node.js', import.meta.url).href) as unknown as {
  renderToStaticMarkup(element: unknown): string
}
function renderDiscovery(catalog: CatalogSnapshot): string {
  return server.renderToStaticMarkup(react.createElement(DiscoverView as never, {
    catalog, inventory: [], onOpen: vi.fn(), onInstall: vi.fn(), onPack: vi.fn(), onBrowse: vi.fn(), onHelp: vi.fn(),
  }))
}
const noMedia = { ...pluginFixtures.unverified, screenshots: [] }
const emptyDiscovery: CatalogSnapshot = { ...catalogFixture, recommendations: [], discovery: { featured: [], recommendedSkins: [] }, plugins: [noMedia] }

describe('官方本机试用反馈的 Client 回归', () => {
  it('真实目录没有推荐和图片时仍保留文字大海报，不伪造团队精选和高分', () => {
    const html = renderDiscovery(emptyDiscovery)
    expect(html).toContain('插件探索')
    expect(html).toContain('eac-market__poster-stage')
    expect(html).toContain('eac-market__poster--fallback')
    expect(html).toContain('不代表团队精选或评分')
    expect(html).not.toContain('id="skin-recommendations-title"')
    expect(html).not.toContain('aria-label="高分插件"')
    expect(html).not.toContain('aria-label="高分 skill"')
    expect(emptyDiscovery.discovery?.featured).toEqual([])
  })
  it('文字海报只浏览有安装包的功能，排除皮肤、管理器、缺包和硬不兼容条目', () => {
    const html = renderDiscovery({ ...emptyDiscovery, plugins: [
      noMedia,
      { ...noMedia, id: 'skin', kind: 'skin', name: '不该进入海报的皮肤' },
      { ...noMedia, id: 'loader', packageName: '@dsh-eac/ui-skin-loader', name: '不该重复的皮肤管理器' },
      { ...noMedia, id: 'missing', name: '没有制品', installability: 'missing-artifact' },
      { ...noMedia, id: 'incompatible', name: '已知不兼容', verification: 'hard-incompatible' },
    ] })
    expect(html).toContain(noMedia.name)
    expect(html).not.toContain('不该进入海报的皮肤')
    expect(html).not.toContain('不该重复的皮肤管理器')
    expect(html).not.toContain('没有制品')
    expect(html).not.toContain('已知不兼容')
  })
  it('没有任何可展示的安装包时不随意挑硬阻断插件充当推荐', () => {
    const html = renderDiscovery({ ...emptyDiscovery, plugins: [pluginFixtures.blocked] })
    expect(html).not.toContain('eac-market__poster-stage')
    expect(html).not.toContain('id="featured-title"')
  })
  it('真实精准版本精选优先，保留真实推荐理由与无图降级', () => {
    const html = renderDiscovery({ ...emptyDiscovery, discovery: { featured: [{ pluginId: noMedia.id, version: noMedia.version, title: '真实精选标题', summary: noMedia.summary, reason: '真实维护者推荐理由', source: 'curated', order: 0 }], recommendedSkins: [] } })
    expect(html).toContain('id="featured-title">团队精选')
    expect(html).toContain('真实精选标题')
    expect(html).toContain('真实维护者推荐理由')
    expect(html).toContain('eac-market__poster--fallback')
    expect(html).not.toContain('id="featured-title">插件探索')
  })
  it('精选精确版本失配不会拿其他版本冒充，仅回到诚实目录展示', () => {
    const html = renderDiscovery({ ...emptyDiscovery, discovery: { featured: [{ pluginId: noMedia.id, version: '99.0.0', title: '失配精选', summary: '', reason: '不应显示', source: 'curated', order: 0 }], recommendedSkins: [] } })
    expect(html).not.toContain('失配精选')
    expect(html).toContain('id="featured-title">插件探索')
  })
  it('浏览未验证状态使用中性提示，已知不兼容仍保留危险提示', () => {
    const unverified = server.renderToStaticMarkup(react.createElement(VerificationStatus as never, { value: 'unverified' }))
    const incompatible = server.renderToStaticMarkup(react.createElement(VerificationStatus as never, { value: 'hard-incompatible' }))
    expect(unverified).toContain('未验证')
    expect(unverified).toContain('data-tone="neutral"')
    expect(unverified).not.toContain('status--warning')
    expect(incompatible).toContain('data-tone="danger"')
  })
  it('库存阻断明确是环境待核对，不暗示勾选风险就能继续', () => {
    const blocked: PlanResult = { status: 'blocked', reason: '当前库存或安装活动无法完整核实，请稍后重新预检', blockers: ['inventory:unverified-state'] }
    expect(isEnvironmentPreflightBlock(blocked)).toBe(true)
    const html = server.renderToStaticMarkup(react.createElement(PreflightBlockNotice as never, { result: blocked, onOpenOfficialPlugins: vi.fn() }))
    expect(html).toContain('安装目标状态待核对')
    expect(html).toContain('这不是对无关插件的风险判定')
    expect(html).toContain('安装结果由官方安装器和上游插件负责')
    expect(html).toContain('查看官方插件页')
    expect(html).toContain('inventory:unverified-state')
  })
  it('环境核对只显示安全包身份，不暴露路径、URL或凭据原文', () => {
    expect(inventoryIssueLabel('bundle-version:@dsh-eac/skin-trading')).toBe('@dsh-eac/skin-trading：已安装版本尚未核实。')
    const blocked: PlanResult = { status: 'blocked', reason: '状态未核实', blockers: ['inventory:unverified-state'] }
    const html = server.renderToStaticMarkup(react.createElement(PreflightBlockNotice as never, { result: blocked, inventoryIssues: ['bundle-version:@dsh-eac/skin-trading', 'failure at C:/private/test token=fixture-secret https://user:pass@example.invalid'] }))
    expect(html).toContain('@dsh-eac/skin-trading')
    expect(html).toContain('还有宿主状态未能核实')
    expect(html).not.toContain('fixture-secret')
    expect(html).not.toContain('C:/private')
    expect(html).not.toContain('user:pass')
  })
  it('真实缺包或校验阻断保留真实理由，不误解释成环境问题', () => {
    const blocked: PlanResult = { status: 'blocked', reason: '缺少可下载制品', blockers: ['artifact:not-installable'] }
    expect(isEnvironmentPreflightBlock(blocked)).toBe(false)
    expect(isEnvironmentPreflightBlock(undefined)).toBe(false)
    const html = server.renderToStaticMarkup(react.createElement(PreflightBlockNotice as never, { result: blocked }))
    expect(html).toContain('暂不能安装')
    expect(html).toContain('缺少可下载制品')
    expect(html).not.toContain('安装目标状态待核对')
  })
})
