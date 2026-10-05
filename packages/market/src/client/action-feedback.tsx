import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './ui.tsx'
import { feedbackStatusLabel, feedbackTone, type ActionFeedbackState } from './action-state.ts'

export function ActionFeedback({ state, onRetry, onRefresh, onDismiss, children }: {
  readonly state: ActionFeedbackState
  readonly onRetry?: (() => void) | undefined
  readonly onRefresh?: (() => void) | undefined
  readonly onDismiss?: (() => void) | undefined
  readonly children?: ReactNode
}): React.JSX.Element | null {
  const rootRef = useRef<HTMLElement | null>(null)
  const status = state.status
  const milestone = state.milestone === true
  useEffect(() => {
    if (status !== 'completed' || !milestone) return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = rootRef.current
    if (!root) return
    const layer = document.createElement('span')
    layer.className = 'eac-market__confetti'
    layer.setAttribute('aria-hidden', 'true')
    for (let index = 0; index < 16; index += 1) {
      const piece = document.createElement('i')
      piece.style.left = `${6 + ((index * 53) % 86)}%`
      piece.style.animationDelay = `${(index % 5) * 45}ms`
      piece.style.animationDuration = `${780 + (index % 4) * 70}ms`
      layer.appendChild(piece)
    }
    root.appendChild(layer)
    const timer = window.setTimeout(() => layer.remove(), 1400)
    return () => { window.clearTimeout(timer); layer.remove() }
  }, [status, milestone])
  if (state.status === 'idle') return null
  const tone = feedbackTone(state.status)
  const role = ['failed', 'partial', 'unknown', 'needs-recheck'].includes(state.status) ? 'alert' : 'status'
  const retryAllowed = ['failed', 'partial', 'needs-recheck'].includes(state.status) && state.retryable !== false
  return <section ref={rootRef} className={`eac-market__action-feedback eac-market__action-feedback--${state.status}`} role={role} aria-live="polite" aria-busy={state.status === 'preparing' || state.status === 'running'}>
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
