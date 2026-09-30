import type { ReactNode } from 'react'
import { Button } from './ui.tsx'
import { feedbackStatusLabel, feedbackTone, type ActionFeedbackState } from './action-state.ts'

export function ActionFeedback({ state, onRetry, onRefresh, onDismiss, children }: {
  readonly state: ActionFeedbackState
  readonly onRetry?: (() => void) | undefined
  readonly onRefresh?: (() => void) | undefined
  readonly onDismiss?: (() => void) | undefined
  readonly children?: ReactNode
}): React.JSX.Element | null {
  if (state.status === 'idle') return null
  const tone = feedbackTone(state.status)
  const role = ['failed', 'partial', 'unknown', 'needs-recheck'].includes(state.status) ? 'alert' : 'status'
  const retryAllowed = ['failed', 'partial', 'needs-recheck'].includes(state.status) && state.retryable !== false
  return <section className={`eac-market__action-feedback eac-market__action-feedback--${state.status}`} role={role} aria-live="polite" aria-busy={state.status === 'preparing' || state.status === 'running'}>
    <div className="eac-market__action-feedback-head">
      <span className={`eac-market__status eac-market__status--${tone}`}>{feedbackStatusLabel(state.status)}</span>
      {state.label && <strong>{state.label}</strong>}
    </div>
    <p>{state.message}</p>
    {state.nextStep && <p className="eac-market__action-feedback-next"><strong>下一步：</strong>{state.nextStep}</p>}
    {children}
    {(onRetry || onRefresh || onDismiss) && <div className="eac-market__button-row">
      {onRetry && retryAllowed && <Button size="sm" variant="outline" onClick={onRetry}>重试</Button>}
      {onRefresh && <Button size="sm" variant="outline" onClick={onRefresh}>重新核对</Button>}
      {onDismiss && <Button size="sm" variant="ghost" onClick={onDismiss}>收起提示</Button>}
    </div>}
  </section>
}
