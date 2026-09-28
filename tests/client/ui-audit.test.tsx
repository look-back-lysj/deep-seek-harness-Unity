import { describe, expect, it } from 'vitest'
import { DetailView, DiscoverView } from '../../packages/market/src/client/MarketPage.tsx'
import { TaskDrawer, planSelectionFor } from '../../packages/market/src/client/components.tsx'
import { MARKET_CSS } from '../../packages/market/src/client/marketStyles.ts'
import { PlanRequestGuard, browseSortPlugins, partitionInventory, planTargetSignature, pluginActionFeedback, taskStateIsNewer } from '../../packages/market/src/client/model.ts'
import { catalogFixture, inventoryFixture, pluginFixtures, readOnlyRemote, taskFixture } from './fixtures.ts'

const react = await import(new URL('../../packages/market/node_modules/react/index.js', import.meta.url).href) as unknown as {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
}
const server = await import(new URL('../../packages/market/node_modules/react-dom/server.node.js', import.meta.url).href) as unknown as {
  renderToStaticMarkup(element: unknown): string
}
const createElement = react.createElement
const renderToStaticMarkup = server.renderToStaticMarkup

describe('AUD UI regressions', () => {
  it('精选只展示匹配版本理由，私有组合使用独立卡片和入口', () => {
    const html = renderToStaticMarkup(createElement(DiscoverView as never, {
      catalog: { ...catalogFixture,
        recommendations: [
          { pluginId: pluginFixtures.verified.id, version: '0.0.1', placement: 'featured', order: 0, reason: '不应展示的旧版本理由' },
          { pluginId: pluginFixtures.unverified.id, version: pluginFixtures.unverified.version, placement: 'featured', order: 1, reason: '匹配版本的测试理由' },
        ],
        collections: [{ kind: 'market-collection', id: 'private-test', version: '2.0.0', name: '合成私有组合', summary: '不是公共Pack的测试组合', collectionDigest: 'sha256:test', components: [], execution: { coverage: 'complete', edges: [], provenance: 'test' } }],
      },
      inventory: [], onOpen: () => {}, onInstall: () => {}, onPack: () => {}, onCollection: () => {}, onBrowse: () => {}, onHelp: () => {},
    }))
    expect(html).not.toContain('不应展示的旧版本理由')
    expect(html).toContain('匹配版本的测试理由')
    expect(html).toContain('data-collection-id="private-test"')
    expect(html).toContain('查看组合变更')
    expect(html).toContain('查看套餐变更')
  })
  it('AUD-F01 关闭态任务抽屉不进入 DOM', () => {
    const html = renderToStaticMarkup(createElement(TaskDrawer as never, {
      open: false,
      tasks: [],
      onClose: () => {},
      remote: readOnlyRemote(),
      onChanged: () => {},
    }))
    expect(html).not.toContain('安装任务')
    expect(html).not.toContain('eac-market__drawer')
  })

  it('AUD-F04 未勾选时严格不下发 tryUnverified', () => {
    expect(planSelectionFor(pluginFixtures.unverified, [], false).tryUnverified).toBe(false)
    expect(planSelectionFor(pluginFixtures.unverified, [], true).tryUnverified).toBe(true)
  })

  it('AUD-F12 没有真实打开/设置能力时不渲染空按钮', () => {
    const html = renderToStaticMarkup(createElement(DetailView as never, {
      plugin: pluginFixtures.verified,
      presentation: undefined,
      inventory: inventoryFixture.items,
      canInstall: true,
      onBack: () => {},
      onInstall: () => {},
    }))
    expect(html).not.toContain('>打开插件<')
    expect(html).not.toContain('>完成设置<')
  })

  it('AUD-F03 A→B 的晚到方案不能提交到新目标', () => {
    const guard = new PlanRequestGuard()
    const targetA = planTargetSignature({ plugins: [pluginFixtures.verified] })
    const targetB = planTargetSignature({ plugins: [pluginFixtures.unverified] })
    const ticketA = guard.begin(targetA)
    guard.invalidate()
    const ticketB = guard.begin(targetB)
    expect(guard.accept(ticketA, 'late-A')).toBeUndefined()
    expect(guard.accept(ticketB, 'current-B')).toBe('current-B')
  })

  it('AUD-F09 启停结果按 applied/failed/unknown/restart-required 分开', () => {
    expect(pluginActionFeedback({ status: 'failed', changed: false, error: 'EACCES' }, true).tone).toBe('danger')
    expect(pluginActionFeedback({ status: 'unknown', changed: false }, true).message).toContain('结果未知')
    expect(pluginActionFeedback({ status: 'restart-required', changed: true }, true).message).toContain('需要重启')
    expect(pluginActionFeedback({ status: 'applied', changed: true }, true).message).toContain('启用设置已保存')
  })

  it('AUD-F13 旧响应不覆盖较新的任务状态', () => {
    const current = taskFixture({ status: 'completed', updatedAt: '2026-09-27T12:02:00.000Z' })
    const older = taskFixture({ status: 'installing', updatedAt: '2026-09-27T12:01:00.000Z' })
    expect(taskStateIsNewer(current, older)).toBe(false)
    expect(taskStateIsNewer(current, { ...current, status: 'failed' })).toBe(false)
    expect(taskStateIsNewer(current, { ...current, updatedAt: '2026-09-27T12:03:00.000Z', status: 'failed' })).toBe(true)
  })

  it('N01 系统组件按真实元数据折叠，规则排序默认不把推荐强制置顶', () => {
    const systemItem = { ...inventoryFixture.items[1]!, packageName: '@system/internal', readOnlyReason: 'management-required' as const, rows: [{ id: 'system-row', name: '@system/internal', state: 'load-error' as const }] }
    const partition = partitionInventory([...inventoryFixture.items, systemItem], catalogFixture.plugins)
    expect(partition.systemItems.map((item) => item.packageName)).toContain('@system/internal')
    expect(partition.systemNeedsAttention).toBe(true)
    const recommendedBlocked = { ...pluginFixtures.blocked, id: 'recommended-blocked', distribution: 'recommended' as const }
    const externalVerified = { ...pluginFixtures.verified, id: 'external-verified', distribution: 'external' as const }
    expect(browseSortPlugins([recommendedBlocked, externalVerified], 'rules').map((item) => item.id)).toEqual(['external-verified', 'recommended-blocked'])
    expect(browseSortPlugins([recommendedBlocked, externalVerified], 'recommended').map((item) => item.id)).toEqual(['external-verified', 'recommended-blocked'])
    expect(browseSortPlugins([recommendedBlocked, externalVerified], 'recommended', [{ pluginId: 'recommended-blocked', placement: 'featured', order: 1, reason: '合成测试推荐理由' }]).map((item) => item.id)).toEqual(['recommended-blocked', 'external-verified'])
    expect(MARKET_CSS).toContain('.eac-market__system-group')
  })

  it('把官方安装树和不可直接管理的内部条目折叠，但不凭官方包名前缀误收用户插件', () => {
    const base = inventoryFixture.items[0]!
    const official = { ...base, packageName: '@deepseek-ai/optional-official', source: 'installation' as const, installed: false, bundleEnabled: false, rows: [] }
    const internal = { ...base, packageName: 'cordis:include', readOnlyReason: 'unaddressable' as const }
    const user = { ...base, packageName: '@deepseek-ai/user-added', source: 'profile' as const, readOnlyReason: undefined }
    const warning = { ...official, packageName: 'official-problem', bundleEnabled: true, rows: [{ id: 'failed', name: 'failed', state: 'load-error' as const }] }
    const partition = partitionInventory([official, internal, user, warning], [])
    expect(partition.systemItems.map(item => item.packageName)).toEqual([official.packageName, internal.packageName, warning.packageName])
    expect(partition.userItems).toEqual([user])
    expect(partition.systemAttentionCount).toBeGreaterThan(0)
  })

  it('N01 发现页同时说明团队精选与规则排序，不冒充缺失的推荐理由', () => {
    const html = renderToStaticMarkup(createElement(DiscoverView as never, {
      catalog: { ...catalogFixture, recommendations: [{ pluginId: pluginFixtures.verified.id, placement: 'featured', order: 0, reason: '合成测试推荐理由' }] },
      inventory: inventoryFixture.items,
      onOpen: () => {},
      onInstall: () => {},
      onPack: () => {},
      onBrowse: () => {},
      onHelp: () => {},
    }))
    expect(html).toContain('团队精选')
    expect(html).toContain('规则发现')
    expect(html).toContain('推荐理由')
    expect(html).toContain('排序依据')
  })
})
