import type { PluginActionResult, TaskState } from '../types.ts'

export type ActionLifecycleStatus =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'unknown'
  | 'needs-recheck'

export interface ActionFeedbackState {
  readonly status: ActionLifecycleStatus
  readonly label: string
  readonly message: string
  readonly nextStep?: string
  readonly retryable?: boolean
  /** 里程碑成功（安装/更新/启停/皮肤切换）才允许庆祝彩纸。 */
  readonly milestone?: boolean
}

export function idleActionFeedback(): ActionFeedbackState {
  return { status: 'idle', label: '', message: '' }
}

export function preparingActionFeedback(label: string): ActionFeedbackState {
  return { status: 'preparing', label, message: `正在准备${label}…` }
}

export function runningActionFeedback(label: string): ActionFeedbackState {
  return { status: 'running', label, message: `${label}进行中…` }
}

export function completedActionFeedback(label: string, message: string, nextStep?: string, milestone = false): ActionFeedbackState {
  return { status: 'completed', label, message, ...(nextStep === undefined ? {} : { nextStep }), ...(milestone ? { milestone: true } : {}) }
}

export function partialActionFeedback(label: string, message: string, nextStep: string): ActionFeedbackState {
  return { status: 'partial', label, message, nextStep, retryable: true }
}

export function failedActionFeedback(label: string, error: unknown, nextStep: string, retryable = true): ActionFeedbackState {
  return { status: 'failed', label, message: error instanceof Error ? error.message : String(error), nextStep, retryable }
}

export function unknownActionFeedback(label: string, message: string, nextStep: string): ActionFeedbackState {
  return { status: 'unknown', label, message, nextStep, retryable: false }
}

export function needsRecheckActionFeedback(label: string, message: string, nextStep: string, retryable = true): ActionFeedbackState {
  return { status: 'needs-recheck', label, message, nextStep, retryable }
}

export function pluginActionFeedbackState(action: Pick<PluginActionResult, 'status' | 'error'>, label: string, successMessage: string): ActionFeedbackState {
  if (action.status === 'failed') return failedActionFeedback(label, action.error ?? '官方插件管理器报告失败。', '核对官方插件页中的真实状态，确认没有正在进行的任务后再重试。')
  if (action.status === 'unknown') return unknownActionFeedback(label, '请求已经提交，但后台没有返回可确认的最终结果。', '先重新读取插件状态，不要立即重复提交。')
  if (action.status === 'restart-required') return needsRecheckActionFeedback(label, '请求已保存，但需要重启 DSH 才能确认最终状态。', '保存当前工作并重启 DSH，回来后重新读取插件状态。', false)
  return completedActionFeedback(label, successMessage, '可以继续使用插件，或打开任务面板查看官方执行记录。', true)
}

export function taskActionFeedback(task: TaskState, label: string): ActionFeedbackState {
  if (task.status === 'unknown') return unknownActionFeedback(label, '后台暂时无法确认任务最终结果。', '先重新读取任务和插件状态，不要重复安装。')
  if (['needs-attention', 'interrupted'].includes(task.status)) return needsRecheckActionFeedback(label, '任务需要继续核对，已有变更会按逐项结果保留。', task.nextAction || '打开官方插件页核对状态，再决定是否重新预检。')
  if (task.status === 'partial') return partialActionFeedback(label, '任务已部分完成，成功项已保留。', task.nextAction || '查看失败项后再决定是否重新预检。')
  if (task.status === 'failed') return failedActionFeedback(label, task.nextAction || '任务执行失败。', '查看逐项错误和官方插件状态，再重新预检。')
  if (task.status === 'cancelled') return completedActionFeedback(label, '任务已停止，已经完成的变更会保留。', '查看逐项状态，确认是否需要重新预检。')
  if (task.status === 'completed') return completedActionFeedback(label, '任务已完成，后台已经返回最终状态。', '打开“我的插件”核对启用状态。', true)
  return runningActionFeedback(label)
}

export function feedbackTone(status: ActionLifecycleStatus): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'partial' || status === 'needs-recheck') return 'warning'
  if (status === 'unknown') return 'neutral'
  if (status === 'preparing' || status === 'running') return 'info'
  return 'neutral'
}

export function feedbackStatusLabel(status: ActionLifecycleStatus): string {
  switch (status) {
    case 'preparing': return '准备中'
    case 'running': return '执行中'
    case 'completed': return '已完成'
    case 'partial': return '部分完成'
    case 'failed': return '失败'
    case 'unknown': return '结果未知'
    case 'needs-recheck': return '需要重新核对'
    default: return ''
  }
}
