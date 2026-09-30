import { describe, expect, it } from 'vitest'
import { completedActionFeedback, failedActionFeedback, needsRecheckActionFeedback, pluginActionFeedbackState, taskActionFeedback } from '../../packages/market/src/client/action-state.ts'
import { taskFixture } from './fixtures.ts'

describe('client action lifecycle feedback', () => {
  it('把官方插件管理结果映射成可执行的下一步', () => {
    expect(pluginActionFeedbackState({ status: 'unknown', error: undefined }, '启用插件', '已启用')).toMatchObject({
      status: 'unknown',
      nextStep: '先重新读取插件状态，不要立即重复提交。',
    })
    expect(pluginActionFeedbackState({ status: 'restart-required', error: undefined }, '卸载插件', '已卸载')).toMatchObject({
      status: 'needs-recheck',
      retryable: false,
    })
    expect(pluginActionFeedbackState({ status: 'completed', error: undefined }, '启用插件', '已启用')).toMatchObject({ status: 'completed' })
  })

  it('区分任务部分完成、失败和未知结果', () => {
    expect(taskActionFeedback(taskFixture({ status: 'partial' }), '安装任务').status).toBe('partial')
    expect(taskActionFeedback(taskFixture({ status: 'failed' }), '安装任务').status).toBe('failed')
    expect(taskActionFeedback(taskFixture({ status: 'unknown' }), '安装任务').status).toBe('unknown')
  })

  it('保留动作标签并允许前端显式给出完成和重新核对语义', () => {
    expect(completedActionFeedback('目录刷新', '目录已刷新。').label).toBe('目录刷新')
    expect(needsRecheckActionFeedback('切换皮肤', '结果未确认。', '重新读取状态。').status).toBe('needs-recheck')
    expect(failedActionFeedback('保存草稿', new Error('版本冲突'), '重新读取草稿后再试。').message).toBe('版本冲突')
  })
})
