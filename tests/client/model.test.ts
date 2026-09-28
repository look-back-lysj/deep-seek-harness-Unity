import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  activeTasks,
  categoriesOf,
  filterPlugins,
  installabilityLabel,
  readOnlyLabel,
  taskStatusLabel,
  verificationLabel,
} from '../../packages/market/src/client/model.ts'
import { catalogFixture, inventoryFixture, pluginFixtures, taskFixture } from './fixtures.ts'

describe('market UI model', () => {
  it('stops polling terminal partial and needs-attention tasks', () => {
    expect(activeTasks([
      taskFixture({ status: 'partial' }),
      taskFixture({ status: 'needs-attention' }),
      taskFixture({ status: 'installing' }),
    ]).map((task) => task.status)).toEqual(['installing'])
  })

  it('搜索覆盖名称、作者、简介、用途和英文包名', () => {
    expect(filterPlugins(catalogFixture.plugins, inventoryFixture.items, { ...EMPTY_FILTERS, query: '旧版界面' })).toHaveLength(1)
    expect(filterPlugins(catalogFixture.plugins, inventoryFixture.items, { ...EMPTY_FILTERS, query: 'research-helper' })).toHaveLength(1)
    expect(filterPlugins(catalogFixture.plugins, inventoryFixture.items, { ...EMPTY_FILTERS, query: '不存在' })).toHaveLength(0)
  })

  it('筛选明确区分验证与安装状态', () => {
    const unverified = filterPlugins(catalogFixture.plugins, inventoryFixture.items, { ...EMPTY_FILTERS, verification: 'unverified' })
    expect(unverified.map((item) => item.id)).toEqual(['plugin-beta'])
    expect(verificationLabel(pluginFixtures.blocked.verification)).toBe('已知不兼容')
    expect(installabilityLabel(pluginFixtures.blocked.installability)).toBe('待作者提供可安装包')
  })

  it('窄列表真实状态可读且不只用颜色', () => {
    expect(taskStatusLabel('partial')).toBe('部分完成')
    expect(taskStatusLabel('awaiting-approval')).toBe('待脚本授权')
    expect(taskStatusLabel('awaiting-resume')).toBe('等待重启')
    expect(taskStatusLabel('unknown')).toBe('状态未知')
    expect(readOnlyLabel(inventoryFixture.items[1]!)).toBe('由官方插件管理器管理')
  })

  it('分类来自目录且任务活动状态可计数', () => {
    expect(categoriesOf(catalogFixture.plugins)).toEqual(['编程', '界面', '效率', '资料整理'])
    expect(activeTasks([taskFixture({ status: 'installing' }), taskFixture({ taskId: 'done', status: 'completed' })])).toHaveLength(1)
  })
})
