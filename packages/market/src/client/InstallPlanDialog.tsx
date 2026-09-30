import { useEffect, useRef, useState } from 'react'
import type { CatalogCollectionView, CatalogPack, CatalogPlugin, InventoryItem, PlanCreateRequest, PlanResult, TaskState } from '../types.ts'
import { boundedRequest, RequestTimeout } from './data-controller.ts'
import { createIdempotencyKey, isInstalled, planTargetSignature, verificationLabel, type MarketRemote } from './model.ts'
import { Button, Modal } from './ui.tsx'
import { blockerExplanation, reviewInstallPlan } from './plan-review.ts'

export interface PlanTarget {
  readonly plugin?: CatalogPlugin
  readonly pack?: CatalogPack
  readonly collection?: CatalogCollectionView
  readonly plugins: readonly CatalogPlugin[]
}
export function planSelectionFor(plugin: CatalogPlugin, inventory: readonly InventoryItem[], tryUnverified: boolean) {
  const installed = isInstalled(inventory, plugin)
  return {
    pluginId: plugin.id, packageName: plugin.packageName, targetVersion: plugin.version,
    targetDigest: plugin.artifactDigest ?? 'digest-unavailable',
    enabledIntent: installed?.bundleEnabled ?? plugin.enabledPolicy === 'default-on', tryUnverified,
  }
}
export function planRequestFor(target: PlanTarget, inventory: readonly InventoryItem[], consent: boolean): PlanCreateRequest {
  if (target.pack && target.collection) throw new Error('套餐和市场组合不能混用同一份预检。')
  const collection = target.collection
  if (collection !== undefined) {
    return { collectionId: collection.id, collectionVersion: collection.version, attemptUnknown: consent,
      selections: collection.components.flatMap((component) => {
        const plugin = target.plugins.find((item) => item.id === component.pluginId && item.version === component.version && item.artifactDigest === component.artifactDigest)
        if (!plugin) return [] // Host rejects missing required components; never substitute a newer release.
        return [{ ...planSelectionFor(plugin, inventory, consent), enabledIntent: isInstalled(inventory, plugin)?.bundleEnabled ?? component.enabled }]
      }),
    }
  }
  return { ...(target.pack === undefined ? {} : { packId: target.pack.id, packVersion: target.pack.version }),
    selections: target.plugins.map((plugin) => planSelectionFor(plugin, inventory, consent)), attemptUnknown: consent,
  }
}
interface Props {
  readonly target: PlanTarget | undefined
  readonly inventory: readonly InventoryItem[]
  readonly remote: MarketRemote
  readonly open: boolean
  readonly onClose: () => void
  readonly onStarted: (task: TaskState, reveal?: boolean) => void
}

export function nextPreflightRetry(value: number): number {
  return value + 1
}

/** The retry action is explicit even when checkbox changes already trigger preflight. */
export function UnsafePlanReview({ consentRequired, onRetry }: {
  readonly consentRequired: boolean
  readonly onRetry: () => void
}): React.JSX.Element {
  return <section className="eac-market__notice eac-market__notice--warning" role="alert" aria-label="不安全的预检项目">
    <strong>暂不能确认安装</strong>
    <p>{consentRequired
      ? '勾选上方选项后会自动重新预检；也可以点击下方“重新预检”立即重试。'
      : '预检仍包含未获同意或不安全的项目。请重新预检；硬性不兼容和校验失败不能绕过。'}</p>
    <Button variant="outline" onClick={onRetry}>重新预检</Button>
  </section>
}

/** A distinct mounted session owns each target. A's late success can reconcile A's
 * inventory, but cannot close B's dialog or move its focus to the task drawer. */
export function InstallPlanDialog(props: Props): React.JSX.Element | null {
  if (!props.open || props.target === undefined) return null
  return <PlanSession key={planTargetSignature(props.target)} {...props} target={props.target} />
}
function PlanSession({ target, inventory, remote, onClose, onStarted }: Props & { target: PlanTarget }): React.JSX.Element {
  const [consent, setConsent] = useState(false)
  const [result, setResult] = useState<PlanResult>()
  const [busy, setBusy] = useState<'preflight' | 'starting' | undefined>('preflight')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [riskStep, setRiskStep] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const alive = useRef(true)
  const generation = useRef(0)
  const writing = useRef(false)
  const startKey = useRef('')
  const group = target.pack !== undefined || target.collection !== undefined
  const edges = target.collection?.execution.edges ?? target.pack?.execution.edges ?? []
  const consentRequired = target.plugins.some((plugin) => ['unknown', 'unverified'].includes(plugin.verification))
    || (result?.status === 'ready' && result.plan.items.some((item) => ['unknown', 'unverified'].includes(item.verification)))
  const review = result?.status === 'ready' ? reviewInstallPlan(result.plan, group, edges, consent) : undefined
  const downgrades = review?.executable.filter((item) => item.action === 'downgrade') ?? []
  const missingComponents = target.collection?.components.filter((component) => !target.plugins.some((plugin) => plugin.id === component.pluginId && plugin.version === component.version && plugin.artifactDigest === component.artifactDigest)) ?? []
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current += 1 } }, [])
  useEffect(() => {
    const current = ++generation.current
    setResult(undefined); setRiskStep(false); setNotice(''); setBusy('preflight'); setUncertain(false)
    startKey.current = createIdempotencyKey('market-install')
    void (async () => {
      try {
        if (!group && target.plugins.length === 0) throw new Error('没有可解析的插件，无法预检。')
        if (remote.createPlan === undefined) throw new Error('当前宿主暂未提供安装预检，请到官方插件页管理。')
        const plan = await boundedRequest(remote.createPlan(planRequestFor(target, inventory, consent)), '安装预检')
        if (target.collection && plan.status === 'ready' && (plan.plan.collectionId !== target.collection.id || plan.plan.collectionVersion !== target.collection.version || plan.plan.collectionDigest !== target.collection.collectionDigest || plan.plan.packId !== undefined)) throw new Error('组合版本或内容已变化，请重新读取目录后预检。')
        if (alive.current && current === generation.current) setResult(plan)
      } catch (error) {
        if (alive.current && current === generation.current) setNotice(error instanceof Error ? error.message : String(error))
      } finally { if (alive.current && current === generation.current) setBusy(undefined) }
    })()
    return () => { generation.current += 1 }
    // Inventory changes while preflighting do not silently change user intent. Host
    // binds its own current-state evidence and validates it immediately before writing.
  }, [consent, retry, remote, target])

  async function confirm(): Promise<void> {
    if (writing.current || busy !== undefined || result?.status !== 'ready' || remote.startTask === undefined || uncertain) return
    if (!review?.canConfirm || (!group && consentRequired && !consent)) return
    if (!Number.isFinite(Date.parse(result.plan.expiresAt)) || Date.parse(result.plan.expiresAt) <= Date.now()) { setNotice('安装方案已过期，请重新预检。'); setResult(undefined); return }
    if (downgrades.length > 0 && !riskStep) { setRiskStep(true); return }
    writing.current = true
    setBusy('starting'); setNotice('')
    try {
      const task = await boundedRequest(remote.startTask({ planId: result.plan.planId, planDigest: result.plan.planDigest, idempotencyKey: startKey.current, confirmed: true }), '提交安装', 20_000)
      onStarted(task, alive.current)
      if (alive.current) onClose()
    } catch (error) {
      if (alive.current) {
        setNotice(error instanceof Error ? error.message : String(error))
        // Timeout is not cancellation. Do not offer a new submission while its result is unknown.
        if (error instanceof RequestTimeout) setUncertain(true)
      }
    } finally { writing.current = false; if (alive.current) setBusy(undefined) }
  }
  const blocked = !review?.canConfirm || (!group && consentRequired && !consent)
  const unsafeReady = result?.status === 'ready' && review !== undefined && review.unsafe.length > 0
  return <Modal open onClose={() => { if (busy !== 'starting') onClose() }} title={riskStep ? '第 2 步：再次确认降级影响' : target.collection ? `安装确认：${target.collection.name}` : target.pack ? `安装确认：${target.pack.name}` : `安装确认：${target.plugin?.name ?? '所选插件'}`} closeLabel="关闭安装确认" description={riskStep ? '只有完成这次专门影响确认后，才会提交降级安装。' : '预检不会安装插件。请核对目标版本、风险和操作层级后再确认。'}>
    <div className="eac-market__form">
      {busy === 'preflight' && <p role="status">正在核对版本、安装条件和当前状态…</p>}
      {consentRequired && <label className="eac-market__notice eac-market__notice--warning"><input type="checkbox" checked={consent} disabled={busy === 'starting'} onChange={(event) => {
        generation.current += 1; setResult(undefined); setRiskStep(false); setConsent(event.currentTarget.checked)
      }} /> 仍然尝试安装未验证内容。已知不兼容或校验失败仍会阻止安装。</label>}
      {missingComponents.length > 0 && <p role="status">以下条目缺少匹配的目录版本，未提交安装：{missingComponents.map((item) => `${item.pluginId}@${item.version}`).join('、')}。必选项缺失时，后台会阻止整份预检。</p>}
      {group && review && <section className="eac-market__notice" aria-label="组合执行范围"><strong>本次确认范围</strong><p>可执行 {review.executable.length} 项（含已安装的保持项）；跳过 {review.skipped.length} 项；依赖暂停 {review.dependencyPaused.length} 项。</p><p>只执行预检允许的项目。成功项会保留，失败或暂停会逐项显示，不代表整套成功。</p></section>}
      {unsafeReady && <UnsafePlanReview consentRequired={consentRequired} onRetry={() => setRetry(nextPreflightRetry)} />}
      {result?.status === 'ready' && <ul className="eac-market__plan-items">{result.plan.items.map((item) => <li key={item.pluginId}>
        <strong>{target.plugins.find((plugin) => plugin.id === item.pluginId)?.name ?? item.packageName}</strong>
        <p>{item.action === 'blocked' ? '跳过' : review?.dependencyPaused.includes(item) ? '依赖暂停' : item.action === 'keep' ? '保持' : item.action === 'add' ? '将安装' : item.action === 'upgrade' ? '将升级' : '将降级'}：{item.currentVersion === undefined ? '' : `${item.currentVersion} → `}{item.targetVersion} · {item.requestedEnabled ? '配置启用' : '保持停用'}</p>
        <p>{verificationLabel(item.verification)}{item.requiresRestart ? ' · 需要重启 DSH' : ''}</p>
        {item.action === 'blocked' && <p>{blockerExplanation(item)}</p>}
        {review?.dependencyPaused.includes(item) && <p>前置项已被阻止，本项将在执行时暂停，不会当作成功安装。</p>}
        {item.blockers.length > 0 && <details><summary>查看预检原因</summary>{item.blockers.join('；')}</details>}
      </li>)}</ul>}
      {riskStep && <section className="eac-market__notice eac-market__notice--warning" aria-label="降级影响"><strong>将安装较旧版本</strong>
        <p>{downgrades.map((item) => `${item.packageName}：${item.currentVersion} → ${item.targetVersion}`).join('；')}</p>
        <p>新版本产生的配置或数据可能不兼容。市场没有此插件的数据迁移保证；请先保存工作并确认作者的降级说明。</p>
        <Button variant="outline" onClick={() => setRiskStep(false)}>返回安装方案</Button>
      </section>}
      {result?.status === 'blocked' && <div role="alert" className="eac-market__notice eac-market__notice--warning">暂不能安装：{result.reason}<details><summary>查看原因</summary>{result.blockers.join('；')}</details></div>}
      {result?.status === 'stale' && <p role="alert">状态已变化，请重新预检。{result.reason}</p>}
      <section className="eac-market__notice" aria-label="确认边界">
        <strong>确认边界</strong>
        <ul>
          <li>硬性不兼容、缺少可安装制品和校验失败不会被“仍然尝试安装”绕过。</li>
          <li>降级必须在方案确认后再看专门影响卡，并点击第二次确认。</li>
          <li>提交结果未知时先到任务面板核对，不自动重放安装。</li>
        </ul>
      </section>
      {notice && <p role="alert">{notice}</p>}
      {uncertain && <p>请关闭此窗口，到任务面板核对。已经提交的任务可能仍在运行。</p>}
      <div className="eac-market__button-row">
        <Button variant="outline" onClick={onClose}>{busy === 'starting' ? '关闭窗口' : '取消'}</Button>
        {busy === undefined && !uncertain && !unsafeReady && (result?.status !== 'ready' || notice) && <Button variant="outline" onClick={() => setRetry(nextPreflightRetry)}>重新预检</Button>}
        <Button variant="primary" disabled={busy !== undefined || blocked || remote.startTask === undefined || uncertain} onClick={() => void confirm()}>{busy === 'starting' ? '正在提交…' : riskStep ? '已了解影响，确认降级' : downgrades.length > 0 ? '查看降级影响' : group ? '确认执行可用项' : '确认安装'}</Button>
      </div>
    </div>
  </Modal>
}
