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
  summarizeInventory,
  compareVersions,
  taskNextStep,
  pluginActionState,
} from '../../packages/market/src/client/model.ts'
import { catalogFixture, inventoryFixture, pluginFixtures, taskFixture } from './fixtures.ts'

describe('market UI model', () => {
  it('停用且没有运行成员并非未知；配置启用与实际运行分开', () => {
    const item = { ...inventoryFixture.items[0]!, rows: [], bundleEnabled: false, restartRequired: false }
    expect(summarizeInventory(item)).toBe('已停用')
    expect(summarizeInventory({ ...item, bundleEnabled: true })).toBe('运行状态未知')
    expect(summarizeInventory({ ...item, bundleEnabled: true, rows: [{ id: 'a', name: 'a', state: 'enabled' }] })).toContain('运行待核对')
    expect(summarizeInventory({ ...item, bundleEnabled: true, rows: [{ id: 'a', name: 'a', state: 'enabled', fiberPhase: 'active' }] })).toBe('运行中')
  })
  it('预发行版本和无效版本不会误导更新入口，未知结果优先核对', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0-rc.10', '1.0.0-rc.2')).toBe(1)
    expect(compareVersions(undefined, '1.0.0')).toBe(0)
    expect(compareVersions('invalid', '1.0.0')).toBe(0)
    expect(taskNextStep(taskFixture({ status: 'unknown', nextAction: 'restart' }))).toContain('先到官方插件页核对')
  })
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

  it('统一插件动作状态：已安装、未验证、硬阻断和可安装分别给出下一步', () => {
    expect(pluginActionState(pluginFixtures.verified, [], { canInstall: true, canManage: false })).toMatchObject({ kind: 'install', label: '查看安装方案', disabled: false })
    expect(pluginActionState(pluginFixtures.unverified, [], { canInstall: true, canManage: false })).toMatchObject({ kind: 'confirm', label: '查看安装方案', disabled: false })
    expect(pluginActionState(pluginFixtures.blocked, [], { canInstall: true, canManage: false })).toMatchObject({ kind: 'blocked', label: '暂不可安装', disabled: true })
    expect(pluginActionState(pluginFixtures.verified, inventoryFixture.items, { canInstall: true, canManage: false })).toMatchObject({ kind: 'manage', label: '已安装', disabled: true })
    expect(pluginActionState(pluginFixtures.verified, [], { canInstall: false, canManage: false })).toMatchObject({ kind: 'runtime-unavailable', label: '暂不可安装', disabled: true })
  })
  it('分类来自目录且任务活动状态可计数', () => {
    expect(categoriesOf(catalogFixture.plugins)).toEqual(['编程', '界面', '效率', '资料整理'])
    expect(activeTasks([taskFixture({ status: 'installing' }), taskFixture({ taskId: 'done', status: 'completed' })])).toHaveLength(1)
  })
})
