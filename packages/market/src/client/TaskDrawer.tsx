import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiAnalysisResult, AiApplyResult, AiConfirmRequest, TaskEvent, TaskEventPage, TaskItemResult, TaskItemStatus, TaskState } from '../types.ts'
import { boundedRequest, RequestTimeout } from './data-controller.ts'
import { TaskRequestGuard, type TaskRequestTicket } from './task-request-guard.ts'
import { createIdempotencyKey, isTaskSettled, taskItemStatusLabel, taskNextStep, taskStatusLabel, taskTone, type MarketRemote } from './model.ts'
import { Button, Modal } from './ui.tsx'
import { EmptyState } from './components.tsx'
import { ActionFeedback } from './action-feedback.tsx'
import { completedActionFeedback, failedActionFeedback, idleActionFeedback, needsRecheckActionFeedback, partialActionFeedback, runningActionFeedback, taskActionFeedback, type ActionFeedbackState } from './action-state.ts'

interface Props {
  readonly open: boolean
  readonly tasks: readonly TaskState[]
  readonly onClose: () => void
  readonly remote: MarketRemote
  readonly onChanged: (task: TaskState) => void
  readonly onRefresh?: () => void
  readonly onOpenOfficialPlugins?: (() => void) | undefined
}
const actionNames = { install: '安装', update: '更新', 'retry-source': '使用已登记来源重试', enable: '启用', disable: '停用', remove: '卸载', downgrade: '降级' } as const
const applyNames: Record<AiApplyResult['status'], string> = { queued: '任务已排队，正在读取执行状态', applied: '操作已执行，请核对实际状态', 'restart-required': '需要重启 DSH', failed: '操作失败', unknown: '结果未知，请先核对', blocked: '操作已阻止', 'requires-confirmation': '等待再次确认影响' }
type SemanticTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral'

function semanticToneClass(tone: SemanticTone): string {
  return tone === 'neutral' ? '' : ` eac-market__status--${tone}`
}

function taskItemTone(value: TaskItemStatus): SemanticTone {
  if (['installed', 'enabled', 'disabled'].includes(value)) return 'success'
  if (value === 'failed') return 'danger'
  if (['restart-required', 'blocked-by-dependency', 'blocked-on-restart'].includes(value)) return 'warning'
  if (value === 'unknown' || value === 'cancelled') return 'neutral'
  return 'info'
}

function isCompletedItem(item: TaskItemResult): boolean {
  return ['installed', 'enabled', 'disabled'].includes(item.status)
}

function isVerifiedInstallSuccess(item: TaskItemResult): boolean {
  return ['installed', 'enabled', 'disabled', 'restart-required'].includes(item.status)
    && ['applied', 'restart-required'].includes(item.installOutcome)
}

function hasFailureEvidence(item: TaskItemResult): boolean {
  if (isVerifiedInstallSuccess(item)) return false
  return ['failed', 'blocked-by-dependency', 'blocked-on-restart', 'unknown'].includes(item.status) || item.installOutcome === 'failed'
    || item.error !== undefined || item.errorCode !== undefined || item.packageResultCode !== undefined || item.diagnostic !== undefined
}

function failureHeadline(item: TaskItemResult): string {
  if (item.errorCode?.toLowerCase() === 'incompatible-version'
    || item.error?.toLowerCase().includes('incompatible-version')) return '插件与当前 DeepSeek Harness 版本不兼容'
  if (item.status === 'unknown' || item.installOutcome === 'unknown') return '安装结果尚未核实'
  if (item.status === 'blocked-by-dependency') return '前置组件尚未满足'
  return '安装未完成'
}

/** Recovery copy stays deterministic; raw Host fields remain visible in a folded report. */
function failureSuggestion(item: TaskItemResult, task: TaskState): string {
  if (item.status === 'blocked-by-dependency') return '先处理前置组件；前置状态满足后，重新生成安装计划再继续。'
  if (item.installOutcome === 'unknown' || item.status === 'unknown') return '先到官方插件页核对实际状态，不要重复安装；确认失败后再发起新的重试。'
  if (item.errorCode?.toLowerCase() === 'incompatible-version' || item.error?.toLowerCase().includes('incompatible-version'))
    return '请安装适配当前 DeepSeek Harness 版本的插件版本；继续使用当前版本前，需要明确接受兼容风险并申请精确版本豁免。'
  if (item.status === 'blocked-on-restart' || item.status === 'restart-required') return '保存当前工作并重启 DSH，再回到任务面板核对剩余项目。'
  if (item.errorCode?.toLowerCase().includes('digest') === true || item.packageResultCode?.toLowerCase().includes('integrity') === true) return '不要使用校验失败的文件；核对已登记来源和摘要后重新预检。'
  return task.nextAction || '查看错误代码与诊断片段；保留现场并从官方插件页核对后，再决定是否重新预检。'
}

function TaskFailureSummary({ task }: { readonly task: TaskState }): React.JSX.Element | null {
  if (task.status === 'completed' && task.items.length > 0 && task.items.every(isVerifiedInstallSuccess)) return null
  const failedItems = task.items.filter(hasFailureEvidence)
  const errorEvents = task.events.filter((event) => event.level === 'error' || event.phase === 'failed')
  if (failedItems.length === 0 && errorEvents.length === 0 && !['failed', 'partial', 'needs-attention', 'interrupted', 'unknown'].includes(task.status)) return null
  return <section className="eac-market__notice eac-market__notice--danger" aria-label="安装问题">
    <strong>安装问题</strong>
    {failedItems.length === 0 && errorEvents.length === 0 && <p><strong>下一步：</strong>{task.nextAction || '先核对官方插件状态，不要重复安装。'}</p>}
    {failedItems.map((item) => <div key={item.pluginId}>
      <h4>{item.packageName}：{failureHeadline(item)}</h4>
      <p><strong>下一步：</strong>{failureSuggestion(item, task)}</p>
      <details>
        <summary>查看详细报告</summary>
        <dl>
          <dt>逐项状态</dt><dd>{taskItemStatusLabel(item.status)}</dd>
          <dt>安装结果</dt><dd>{item.installOutcome}</dd>
          <dt>是否产生变更</dt><dd>{item.changed ? '是，保留已完成变更' : '否'}</dd>
          {item.error !== undefined && <><dt>错误信息</dt><dd>{item.error}</dd></>}
          {item.errorCode !== undefined && <><dt>错误代码</dt><dd><code>{item.errorCode}</code></dd></>}
          {item.packageResultCode !== undefined && <><dt>包结果代码</dt><dd><code>{item.packageResultCode}</code></dd></>}
          {item.diagnostic !== undefined && <><dt>诊断片段</dt><dd>{item.diagnostic}</dd></>}
          {item.permissionChanges.length > 0 && <><dt>脚本许可变化</dt><dd>{item.permissionChanges.map((change) => `${change.packageName}：${change.decision}`).join('；')}</dd></>}
        </dl>
        {errorEvents.length > 0 && <ul className="eac-market__event-list">{errorEvents.slice(-6).map((event) => <li key={`${event.sequence}-${event.at}`} data-level={event.level}>{event.message}</li>)}</ul>}
      </details>
    </div>)}
  </section>
}

export function TaskDrawer({ open, tasks, ...props }: Props): React.JSX.Element | null {
  if (!open) return null
  return <Modal open onClose={props.onClose} title="安装任务" closeLabel="关闭任务面板" className="eac-market__task-dialog" variant="drawer">
    <div className="eac-market__task-list">
      {tasks.length === 0
        ? <EmptyState title="暂无安装任务" description="安装后可在这里查看结果。" action={props.onRefresh && <Button variant="outline" onClick={props.onRefresh}>重新读取任务和插件状态</Button>} />
        : <>
          {props.onRefresh && <Button variant="outline" onClick={props.onRefresh}>重新读取任务和插件状态</Button>}
          {[...tasks].reverse().map((task) => <TaskCard key={`${task.environmentId}:${task.taskId}`} task={task} {...props} />)}
        </>}
    </div>
  </Modal>
}

function TaskCard({ task, remote, onChanged, onRefresh, onOpenOfficialPlugins }: Omit<Props, 'open' | 'tasks'> & { task: TaskState }): React.JSX.Element {
  const [analysis, setAnalysis] = useState<AiAnalysisResult>()
  const [applied, setApplied] = useState<AiApplyResult>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState<ActionFeedbackState>(idleActionFeedback())
  const [eventLog, setEventLog] = useState<{ readonly events: readonly TaskEvent[]; readonly nextSequence: number; readonly hasMore: boolean; readonly truncated: boolean; readonly status: 'idle' | 'loading' | 'ready' | 'failed' }>({ events: task.events, nextSequence: -1, hasMore: true, truncated: false, status: 'idle' })
  const scope = useMemo(() => ({ action: new TaskRequestGuard(), events: new TaskRequestGuard(), recheck: new TaskRequestGuard() }), [task.taskId, task.environmentId, remote])
  const previousScope = useRef(scope)
  if (previousScope.current !== scope) {
    previousScope.current.action.invalidate(); previousScope.current.events.invalidate(); previousScope.current.recheck.invalidate()
    previousScope.current = scope
  }
  const [checking, setChecking] = useState(false)
  const confirmationKeys = useRef({ first: '', second: '' })
  useEffect(() => {
    setAnalysis(undefined); setApplied(undefined); setBusy(''); setChecking(false); setError(''); setFeedback(idleActionFeedback()); confirmationKeys.current = { first: '', second: '' }
    setEventLog({ events: task.events, nextSequence: -1, hasMore: true, truncated: false, status: 'idle' })
    return () => { scope.action.invalidate(); scope.events.invalidate(); scope.recheck.invalidate() }
  }, [scope])

  async function loadTaskEvents(more = false): Promise<void> {
    const readEvents = remote.taskEvents
    if (!readEvents || (more && !eventLog.hasMore)) return
    const ticket = scope.events.begin()
    if (!ticket) return
    const afterSequence = more ? Math.max(-1, eventLog.nextSequence - 1) : -1
    setEventLog(current => ({ ...current, status: 'loading' }))
    const request = Promise.resolve().then(() => readEvents({ taskId: task.taskId, afterSequence, limit: 100 }))
    try {
      const page: TaskEventPage = await boundedRequest(request, '读取完整任务记录')
      if (!scope.events.accepts(ticket)) return
      setEventLog(current => {
        const merged = new Map<number, TaskEvent>(current.events.map(event => [event.sequence, event]))
        for (const event of page.events) merged.set(event.sequence, event)
        for (const event of task.events) merged.set(event.sequence, event)
        return {
          events: [...merged.values()].sort((a, b) => a.sequence - b.sequence),
          // Use the returned page, not an old Host's global tail cursor.
          nextSequence: (page.events.at(-1)?.sequence ?? afterSequence) + 1,
          hasMore: page.events.length === 100 && (page.events.at(-1)?.sequence ?? afterSequence) > afterSequence,
          truncated: current.truncated || page.truncated,
          status: 'ready',
        }
      })
    } catch {
      if (scope.events.accepts(ticket)) setEventLog(current => ({ ...current, status: 'failed' }))
    } finally {
      scope.events.expire(ticket)
      const release = (): void => { if (scope.events.finish(ticket)) setEventLog(current => ({ ...current })) }
      void request.then(release, release)
    }
  }

  async function run(label: string, operation: (ticket: TaskRequestTicket) => Promise<void>, timeoutMs = 12_000): Promise<void> {
    const ticket = scope.action.begin()
    if (!ticket) return
    setBusy(label); setError(''); setFeedback(runningActionFeedback(label))
    const request = Promise.resolve().then(() => scope.action.accepts(ticket) ? operation(ticket) : undefined)
    try { await boundedRequest(request, label, timeoutMs) } catch (reason) {
      if (scope.action.accepts(ticket)) {
        const message = reason instanceof Error ? reason.message : String(reason)
        setError(message)
        setFeedback(reason instanceof RequestTimeout
          ? needsRecheckActionFeedback(label, message, '原请求仍可能执行中；只读核对任务状态，不要重复提交。', false)
          : failedActionFeedback(label, reason, '确认任务仍处于当前环境后再重试；结果未知时先重新读取，不要重复提交。'))
      }
    } finally {
      scope.action.expire(ticket)
      const release = (): void => { if (scope.action.finish(ticket)) setBusy('') }
      void request.then(release, release)
    }
  }
  async function recheck(): Promise<void> {
    if (!remote.getTask) { onRefresh?.(); return }
    const ticket = scope.recheck.begin()
    if (!ticket) return
    setChecking(true)
    const request = Promise.resolve().then(() => remote.getTask!({ taskId: task.taskId }))
    try {
      const next = await boundedRequest(request, '任务状态核对')
      if (!scope.recheck.accepts(ticket)) return
      if (next.taskId !== task.taskId || next.environmentId !== task.environmentId) throw new Error('核对结果不属于本任务或当前环境，已拒绝显示。')
      onChanged(next)
    } catch (reason) {
      if (scope.recheck.accepts(ticket)) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      scope.recheck.expire(ticket)
      const release = (): void => { if (scope.recheck.finish(ticket)) setChecking(false) }
      void request.then(release, release)
    }
  }
  async function askAi(ticket: TaskRequestTicket): Promise<void> {
    if (remote.aiAnalyze === undefined) return
    setAnalysis(undefined); setApplied(undefined)
    confirmationKeys.current = { first: createIdempotencyKey('market-ai'), second: createIdempotencyKey('market-ai-risk') }
    const result = await remote.aiAnalyze({ taskId: task.taskId })
    if (!scope.action.accepts(ticket)) return
    if (result.proposal && (result.proposal.environmentId !== task.environmentId || result.proposal.taskId !== task.taskId)) {
      throw new Error('AI 方案不属于本任务，已拒绝显示和执行。')
    }
    setAnalysis(result)
    if (result.status === 'ready' && result.proposal) setFeedback({ status: 'completed', label: 'AI 分析本任务', message: 'AI 已完成分析，方案仍需你逐项核对。', nextStep: '阅读事实、版本和影响后，再决定是否确认。' })
    else setFeedback(partialActionFeedback('AI 分析本任务', result.reason ?? 'AI 没有给出可执行方案。', '保留当前任务结果，并使用官方插件页继续核对。'))
  }
  async function applyAi(second: boolean, ticket: TaskRequestTicket): Promise<void> {
    const proposal = analysis?.proposal
    if (proposal === undefined || remote.aiConfirm === undefined || proposal.actions.length !== 1) return
    const challenge = applied?.challenge
    if (!Number.isFinite(Date.parse(proposal.expiresAt)) || Date.parse(proposal.expiresAt) <= Date.now()) throw new Error('AI 方案已过期，请重新分析。')
    if (second && (!challenge || !Number.isFinite(Date.parse(challenge.expiresAt)) || Date.parse(challenge.expiresAt) <= Date.now())) throw new Error('影响确认已过期，请重新分析。')
    const request: AiConfirmRequest = {
      proposalId: proposal.id, impactDigest: proposal.impactDigest, confirmed: true,
      idempotencyKey: second ? confirmationKeys.current.second : confirmationKeys.current.first,
      ...(second && challenge ? { challengeId: challenge.id, challengeDigest: challenge.digest, riskConfirmed: true as const } : {}),
    }
    const result = await remote.aiConfirm(request)
    if (!scope.action.accepts(ticket)) return
    setApplied(result)
    if (result.taskId && remote.getTask) {
      const next = await boundedRequest(remote.getTask({ taskId: result.taskId }), '执行任务读取')
      if (!scope.action.accepts(ticket)) return
      if (next.taskId !== result.taskId || next.environmentId !== task.environmentId) throw new Error('执行结果不属于当前任务环境，已拒绝显示。')
      onChanged(next)
    }
    if (result.status === 'requires-confirmation') setFeedback(needsRecheckActionFeedback('AI 方案确认', '后台要求再次确认影响，方案尚未执行。', '阅读影响清单后，明确确认或取消这次方案。', false))
    else if (result.status === 'queued') setFeedback({ status: 'running', label: 'AI 方案确认', message: '方案已排队，正在读取真实任务状态。', nextStep: '等待任务状态更新，不要重复提交。' })
    else if (result.status === 'restart-required') setFeedback(needsRecheckActionFeedback('AI 方案确认', '方案已执行，但 DSH 需要重启后才能确认最终状态。', '保存当前工作并重启 DSH，回来后重新读取任务和插件状态。', false))
    else if (result.status === 'applied') setFeedback(completedActionFeedback('AI 方案确认', 'AI 方案已执行，后台已返回提交结果。', '打开任务面板核对真实任务状态；不要根据 AI 文案猜测最终库存。'))
    else if (result.status === 'unknown') setFeedback(needsRecheckActionFeedback('AI 方案确认', '请求已提交，但后台没有返回可确认的最终结果。', '重新读取任务和插件状态，不要重复确认。', false))
    else setFeedback(failedActionFeedback('AI 方案确认', result.error ?? 'AI 方案未执行。', '查看任务记录和官方插件状态后，再重新分析。'))
    if (result.status !== 'requires-confirmation') onRefresh?.()
  }
  async function cancel(ticket: TaskRequestTicket): Promise<void> {
    if (!remote.cancelTask) return
    const next = await remote.cancelTask({ taskId: task.taskId, idempotencyKey: createIdempotencyKey('market-cancel') })
    if (!scope.action.accepts(ticket)) return
    if (next.taskId !== task.taskId || next.environmentId !== task.environmentId) throw new Error('取消结果不属于本任务或当前环境，已拒绝显示。')
    onChanged(next)
    setFeedback(taskActionFeedback(next, '取消任务'))
  }
  async function approve(ticket: TaskRequestTicket): Promise<void> {
    if (!remote.approveTask || !task.approval) return
    const next = await remote.approveTask({ taskId: task.taskId, attemptId: task.approval.attemptId, challengeId: task.approval.id, pendingBuildsDigest: task.approval.digest, approvedBuilds: task.approval.packages, idempotencyKey: createIdempotencyKey('market-approve') })
    if (!scope.action.accepts(ticket)) return
    if (next.taskId !== task.taskId || next.environmentId !== task.environmentId) throw new Error('授权结果不属于本任务或当前环境，已拒绝显示。')
    onChanged(next)
    setFeedback(taskActionFeedback(next, '脚本授权'))
  }
  async function resume(ticket: TaskRequestTicket): Promise<void> {
    if (!remote.resumeTask || !task.resume) return
    const next = await remote.resumeTask({ taskId: task.taskId, challengeId: task.resume.id, resumeDigest: task.resume.digest, idempotencyKey: createIdempotencyKey('market-resume') })
    if (!scope.action.accepts(ticket)) return
    if (next.taskId !== task.taskId || next.environmentId !== task.environmentId) throw new Error('重启核对结果不属于本任务或当前环境，已拒绝显示。')
    onChanged(next)
    setFeedback(taskActionFeedback(next, '重启状态检查'))
  }
  const proposal = analysis?.proposal
  const challenge = applied?.status === 'requires-confirmation' ? applied.challenge : undefined
  const done = task.items.filter(isCompletedItem).length
  const title = task.items.length > 1 ? `${task.items[0]?.packageName ?? '安装任务'} 等 ${task.items.length} 项` : task.items[0]?.packageName ?? '安装任务'
  const visibleEvents = [...new Map([...eventLog.events, ...task.events].map(event => [event.sequence, event])).values()].sort((left, right) => left.sequence - right.sequence)
  return <article className="eac-market__task" aria-label={`任务 ${task.taskId}`}>
    <div className="eac-market__task-head">
      <h3>{title}</h3>
      <strong className={`eac-market__status${semanticToneClass(taskTone(busy === '取消' ? 'cancelling' : task.status))}`}>{busy === '取消' ? '正在请求取消' : taskStatusLabel(task.status)}</strong>
    </div>
    <p><strong>下一步：</strong>{taskNextStep(task)}</p>
    {task.items.length > 0
      ? <p aria-label="任务进度"><strong>已完成 {done} / {task.items.length} 项</strong> · 按逐项状态统计，不显示未经核实的百分比。</p>
      : <p>后台未提供逐项总数，不显示百分比。</p>}
    <ul className="eac-market__task-items">{task.items.map((item) => <li key={item.pluginId}>
      <span>{item.packageName}：{taskItemStatusLabel(item.status)}</span>
      <strong className={`eac-market__status${semanticToneClass(taskItemTone(item.status))}`}>{item.changed ? '已产生变更' : '尚未变更'}</strong>
    </li>)}</ul>
    <div className="eac-market__button-row">
      {(!isTaskSettled(task) || task.status === 'awaiting-approval' || task.status === 'awaiting-resume') && remote.cancelTask && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run('取消', cancel)}>取消任务</Button>}
      {['failed', 'partial', 'needs-attention', 'unknown', 'interrupted'].includes(task.status) && remote.aiAnalyze && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run('AI 分析', askAi, 45_000)}>AI 分析本任务</Button>}
      {(remote.getTask || onRefresh) && <Button size="sm" variant="outline" disabled={checking} onClick={() => void recheck()}>重新核对本任务</Button>}
      {onOpenOfficialPlugins && <Button size="sm" variant="outline" onClick={onOpenOfficialPlugins}>打开官方插件页</Button>}
    </div>
    <ActionFeedback state={feedback} onRefresh={remote.getTask || onRefresh ? () => void recheck() : undefined} />
    {checking && <p role="status">正在只读核对任务状态…</p>}
    <TaskFailureSummary task={task} />
    {task.approval && task.status === 'awaiting-approval' && <section className="eac-market__notice"><strong>待运行的安装脚本 <span className="eac-tag eac-tag--danger">高权限操作</span></strong><ul>{task.approval.packages.map((name) => <li key={name}>{name}</li>)}</ul><Button variant="primary" disabled={!!busy || !remote.approveTask} onClick={() => void run('授权', approve)}>同意运行清单内脚本并继续</Button></section>}
    {task.resume && task.status === 'awaiting-resume' && <Button variant="primary" disabled={!!busy || !remote.resumeTask} onClick={() => void run('核对重启', resume)}>已重启，重新核对</Button>}
    {busy && <p role="status">{busy}中…</p>}
    {error && <p role="alert">{error}</p>}
    {analysis && analysis.status !== 'ready' && <p role="status">AI 暂未给出可执行方案：{analysis.reason ?? '缺少可核实的诊断事实。'}</p>}
    {proposal && <section className="eac-market__notice" aria-label="本任务 AI 方案"><strong>{proposal.summary}</strong>
      <ul>{proposal.facts.map((fact, index) => <li key={index}>{fact}</li>)}</ul>
      {proposal.actions.map((action, index) => <p key={index}>{actionNames[action.kind]} {action.packageName}{action.targetVersion ? ` → ${action.targetVersion}` : ''}：{action.reason}</p>)}
      {proposal.plan && <div aria-label="AI方案实际版本调整"><strong>实际安装计划</strong><ul>{proposal.plan.items.map((item) => <li key={item.pluginId}>{item.packageName}：{item.currentVersion ?? '未安装'} → {item.targetVersion}；{item.requestedEnabled ? '配置启用' : '保持停用'}{item.requiresRestart ? '；需要重启' : ''}{item.blockers.length ? `；阻止原因：${item.blockers.join('、')}` : ''}</li>)}</ul></div>}
      {proposal.impact && <p>{proposal.impact.summary}</p>}
      {!applied && <Button variant="primary" disabled={!!busy || !remote.aiConfirm || proposal.actions.length !== 1} onClick={() => void run('确认方案', ticket => applyAi(false, ticket), 20_000)}>确认执行 AI 方案</Button>}
    </section>}
    {challenge && <section className="eac-market__notice eac-market__notice--warning" aria-label="再次确认影响">
      <h4>再次确认影响</h4><p>{challenge.impact.summary}</p>
      {(challenge.impact.currentVersion || challenge.impact.targetVersion) && <p>版本：{challenge.impact.currentVersion ?? '未知'} → {challenge.impact.targetVersion ?? '移除'}</p>}
      <p>受影响的插件：{challenge.impact.affectedPackages.join('、') || '后台未列出'}</p>
      <p>{challenge.impact.dataBehavior}</p>
      {challenge.impact.unknowns.length > 0 && <ul>{challenge.impact.unknowns.map((item, index) => <li key={index}>尚不能确认：{item}</li>)}</ul>}
      <div className="eac-market__button-row"><Button variant="outline" disabled={!!busy} onClick={() => { setApplied(undefined); setAnalysis(undefined); confirmationKeys.current = { first: '', second: '' }; setFeedback(idleActionFeedback()) }}>取消此方案</Button><Button variant="primary" disabled={!!busy} onClick={() => void run('确认影响', ticket => applyAi(true, ticket), 20_000)}>已了解影响，再次确认执行</Button></div>
    </section>}
    {applied && <p role="status">{applyNames[applied.status]}{applied.error ? `：${applied.error}` : ''}</p>}
    <details className="eac-market__task-history" aria-label="任务记录" onToggle={(event) => { if (event.currentTarget.open && eventLog.status === 'idle') void loadTaskEvents() }}>
      <summary>查看任务记录（已载入 {visibleEvents.length} 条）</summary>
      <p>任务编号：{task.taskId} · 后台下一步：{task.nextAction}</p>
      {eventLog.status === 'loading' && <p role="status">正在读取任务记录…</p>}
      {eventLog.status === 'failed' && <p role="alert">完整记录读取失败；仍可查看当前任务摘要中的最近记录。</p>}
      {eventLog.truncated && <p role="status">后台提示部分历史记录已被清理或不完整，以下内容不代表完整时间线。</p>}
      <ul className="eac-market__event-list">{visibleEvents.map((event) => <li key={`${event.sequence}-${event.at}`} data-level={event.level}>{event.message}</li>)}</ul>
      {remote.taskEvents === undefined && <p>当前宿主不支持读取完整历史，仅显示任务摘要中的记录。</p>}
      {eventLog.status === 'failed' && remote.taskEvents !== undefined && <Button variant="ghost" disabled={!!busy || scope.events.pending} onClick={() => void loadTaskEvents(eventLog.nextSequence > 0)}>重新读取任务记录</Button>}
      {eventLog.hasMore && remote.taskEvents !== undefined && <Button variant="outline" disabled={!!busy || scope.events.pending || eventLog.status === 'loading'} onClick={() => void loadTaskEvents(true)}>{eventLog.status === 'loading' ? '正在读取…' : '加载更多记录'}</Button>}
    </details>
  </article>
}
