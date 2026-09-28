import { useEffect, useRef, useState } from 'react'
import type { AiAnalysisResult, AiApplyResult, AiConfirmRequest, TaskState } from '../types.ts'
import { boundedRequest } from './data-controller.ts'
import { createIdempotencyKey, isTaskSettled, taskItemStatusLabel, taskNextStep, taskStatusLabel, type MarketRemote } from './model.ts'
import { Button, Modal } from './ui.tsx'

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

export function TaskDrawer({ open, tasks, ...props }: Props): React.JSX.Element | null {
  if (!open) return null
  return <Modal open onClose={props.onClose} title="安装任务" closeLabel="关闭任务面板" className="eac-market__task-dialog">
    <div className="eac-market__task-list">
      {tasks.length === 0 && <p>暂无安装任务。安装后可在这里查看结果。</p>}
      {props.onRefresh && <Button variant="outline" onClick={props.onRefresh}>重新读取任务和插件状态</Button>}
      {[...tasks].reverse().map((task) => <TaskCard key={`${task.environmentId}:${task.taskId}`} task={task} {...props} />)}
    </div>
  </Modal>
}

/** AI state is local to one task, never shared across cards. Generation checks also
 * reject late analysis for a task whose evidence has since changed. */
function TaskCard({ task, remote, onChanged, onRefresh, onOpenOfficialPlugins }: Omit<Props, 'open' | 'tasks'> & { task: TaskState }): React.JSX.Element {
  const [analysis, setAnalysis] = useState<AiAnalysisResult>()
  const [applied, setApplied] = useState<AiApplyResult>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const generation = useRef(0)
  const busyRef = useRef(false)
  const confirmationKeys = useRef({ first: '', second: '' })
  useEffect(() => {
    generation.current += 1; setAnalysis(undefined); setApplied(undefined); setBusy(''); setError(''); busyRef.current = false
    return () => { generation.current += 1 }
  }, [task.taskId, task.environmentId, task.updatedAt, remote])

  async function run(label: string, operation: () => Promise<void>): Promise<void> {
    if (busyRef.current) return
    busyRef.current = true; setBusy(label); setError('')
    const ticket = generation.current
    try { await operation() } catch (reason) {
      if (ticket === generation.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (ticket === generation.current) { busyRef.current = false; setBusy('') } }
  }
  async function askAi(): Promise<void> {
    if (remote.aiAnalyze === undefined) return
    const ticket = generation.current
    setAnalysis(undefined); setApplied(undefined)
    confirmationKeys.current = { first: createIdempotencyKey('market-ai'), second: createIdempotencyKey('market-ai-risk') }
    const result = await boundedRequest(remote.aiAnalyze({ taskId: task.taskId }), 'AI 分析', 45_000)
    if (ticket !== generation.current) return
    if (result.proposal && (result.proposal.environmentId !== task.environmentId || result.proposal.taskId !== task.taskId)) {
      throw new Error('AI 方案不属于本任务，已拒绝显示和执行。')
    }
    setAnalysis(result)
  }
  async function applyAi(second: boolean): Promise<void> {
    const proposal = analysis?.proposal
    if (proposal === undefined || remote.aiConfirm === undefined || proposal.actions.length !== 1) return
    const challenge = applied?.challenge
    if (!Number.isFinite(Date.parse(proposal.expiresAt)) || Date.parse(proposal.expiresAt) <= Date.now()) throw new Error('AI 方案已过期，请重新分析。')
    if (second && (!challenge || !Number.isFinite(Date.parse(challenge.expiresAt)) || Date.parse(challenge.expiresAt) <= Date.now())) throw new Error('影响确认已过期，请重新分析。')
    const ticket = generation.current
    const request: AiConfirmRequest = {
      proposalId: proposal.id, impactDigest: proposal.impactDigest, confirmed: true,
      idempotencyKey: second ? confirmationKeys.current.second : confirmationKeys.current.first,
      ...(second && challenge ? { challengeId: challenge.id, challengeDigest: challenge.digest, riskConfirmed: true as const } : {}),
    }
    const result = await boundedRequest(remote.aiConfirm(request), 'AI 方案确认', 20_000)
    if (ticket !== generation.current) { onRefresh?.(); return }
    setApplied(result)
    if (result.taskId && remote.getTask) onChanged(await boundedRequest(remote.getTask({ taskId: result.taskId }), '执行任务读取'))
    if (result.status !== 'requires-confirmation') onRefresh?.()
  }
  async function cancel(): Promise<void> {
    if (!remote.cancelTask) return
    onChanged(await boundedRequest(remote.cancelTask({ taskId: task.taskId, idempotencyKey: createIdempotencyKey('market-cancel') }), '取消请求'))
  }
  async function approve(): Promise<void> {
    if (!remote.approveTask || !task.approval) return
    onChanged(await boundedRequest(remote.approveTask({ taskId: task.taskId, attemptId: task.approval.attemptId, challengeId: task.approval.id, pendingBuildsDigest: task.approval.digest, approvedBuilds: task.approval.packages, idempotencyKey: createIdempotencyKey('market-approve') }), '脚本授权'))
  }
  async function resume(): Promise<void> {
    if (!remote.resumeTask || !task.resume) return
    onChanged(await boundedRequest(remote.resumeTask({ taskId: task.taskId, challengeId: task.resume.id, resumeDigest: task.resume.digest, idempotencyKey: createIdempotencyKey('market-resume') }), '重启状态检查'))
  }
  const proposal = analysis?.proposal
  const challenge = applied?.status === 'requires-confirmation' ? applied.challenge : undefined
  const done = task.items.filter((item) => ['installed', 'enabled', 'disabled'].includes(item.status)).length
  return <article className="eac-market__task" aria-label={`任务 ${task.taskId}`}>
    <div className="eac-market__task-head"><h3>{task.items[0]?.packageName ?? '安装任务'}</h3><strong>{busy === '取消' ? '正在请求取消' : taskStatusLabel(task.status)}</strong></div>
    <p>{taskNextStep(task)}</p><p>已完成 {done} / {task.items.length} 项</p>
    <ul className="eac-market__task-items">{task.items.map((item) => <li key={item.pluginId}>{item.packageName}：{taskItemStatusLabel(item.status)}</li>)}</ul>
    <div className="eac-market__button-row">
      {(!isTaskSettled(task) || task.status === 'awaiting-approval' || task.status === 'awaiting-resume') && remote.cancelTask && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run('取消', cancel)}>取消任务</Button>}
      {['failed', 'partial', 'needs-attention', 'unknown', 'interrupted'].includes(task.status) && remote.aiAnalyze && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run('AI 分析', askAi)}>AI 分析本任务</Button>}
      {onOpenOfficialPlugins && <Button size="sm" variant="outline" onClick={onOpenOfficialPlugins}>打开官方插件页</Button>}
    </div>
    {task.approval && task.status === 'awaiting-approval' && <section className="eac-market__notice"><strong>待运行的安装脚本</strong><ul>{task.approval.packages.map((name) => <li key={name}>{name}</li>)}</ul><Button disabled={!!busy || !remote.approveTask} onClick={() => void run('授权', approve)}>同意运行清单内脚本并继续</Button></section>}
    {task.resume && task.status === 'awaiting-resume' && <Button variant="primary" disabled={!!busy || !remote.resumeTask} onClick={() => void run('核对重启', resume)}>已重启，重新核对</Button>}
    {busy && <p role="status">{busy}中…</p>}
    {error && <p role="alert">{error}</p>}
    {analysis && analysis.status !== 'ready' && <p role="status">AI 暂未给出可执行方案：{analysis.reason ?? '缺少可核实的诊断事实。'}</p>}
    {proposal && <section className="eac-market__notice" aria-label="本任务 AI 方案"><strong>{proposal.summary}</strong>
      <ul>{proposal.facts.map((fact, index) => <li key={index}>{fact}</li>)}</ul>
      {proposal.actions.map((action, index) => <p key={index}>{actionNames[action.kind]} {action.packageName}{action.targetVersion ? ` → ${action.targetVersion}` : ''}：{action.reason}</p>)}
      {proposal.plan && <div aria-label="AI方案实际版本调整"><strong>实际安装计划</strong><ul>{proposal.plan.items.map((item) => <li key={item.pluginId}>{item.packageName}：{item.currentVersion ?? '未安装'} → {item.targetVersion}；{item.requestedEnabled ? '配置启用' : '保持停用'}{item.requiresRestart ? '；需要重启' : ''}{item.blockers.length ? `；阻止原因：${item.blockers.join('、')}` : ''}</li>)}</ul></div>}
      {proposal.impact && <p>{proposal.impact.summary}</p>}
      {!applied && <Button variant="primary" disabled={!!busy || !remote.aiConfirm || proposal.actions.length !== 1} onClick={() => void run('确认方案', () => applyAi(false))}>确认执行 AI 方案</Button>}
    </section>}
    {challenge && <section className="eac-market__notice eac-market__notice--warning" aria-label="再次确认影响">
      <h4>再次确认影响</h4><p>{challenge.impact.summary}</p>
      {(challenge.impact.currentVersion || challenge.impact.targetVersion) && <p>版本：{challenge.impact.currentVersion ?? '未知'} → {challenge.impact.targetVersion ?? '移除'}</p>}
      <p>受影响的插件：{challenge.impact.affectedPackages.join('、') || '后台未列出'}</p>
      <p>{challenge.impact.dataBehavior}</p>
      {challenge.impact.unknowns.length > 0 && <ul>{challenge.impact.unknowns.map((item, index) => <li key={index}>尚不能确认：{item}</li>)}</ul>}
      <div className="eac-market__button-row"><Button variant="outline" disabled={!!busy} onClick={() => { setApplied(undefined); setAnalysis(undefined) }}>取消此方案</Button><Button variant="primary" disabled={!!busy} onClick={() => void run('确认影响', () => applyAi(true))}>已了解影响，再次确认执行</Button></div>
    </section>}
    {applied && <p role="status">{applyNames[applied.status]}{applied.error ? `：${applied.error}` : ''}</p>}
    <details><summary>查看任务记录</summary><p>任务编号：{task.taskId} · 后台下一步：{task.nextAction}</p><ul>{task.events.slice(-12).map((event) => <li key={`${event.sequence}-${event.at}`}>{event.message}</li>)}</ul></details>
  </article>
}
