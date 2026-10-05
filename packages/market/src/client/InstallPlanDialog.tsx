import { useEffect, useRef, useState } from 'react'
import type { CatalogCollectionView, CatalogPack, CatalogPlugin, InventoryItem, PlanCreateRequest, PlanResult, ReleaseOptionsResult, ReleaseSelectionContext, TaskStartRecoveryRequest, TaskState } from '../types.ts'
import { boundedRequest, RequestTimeout } from './data-controller.ts'
import { createIdempotencyKey, isInstalled, planTargetSignature, verificationLabel, type MarketRemote } from './model.ts'
import { Button, Modal } from './ui.tsx'
import { blockerExplanation, reviewInstallPlan } from './plan-review.ts'
import { appendReleasePage, chooseRelease, releaseIdentityKey, releaseListNotices, releaseOptionLabel, releaseSelectionContext, sameReleaseContext } from './release-selection.ts'

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
export function planRequestFor(target: PlanTarget, inventory: readonly InventoryItem[], consent: boolean, releaseContext?: ReleaseSelectionContext): PlanCreateRequest {
  if (target.pack && target.collection) throw new Error('套餐和市场组合不能混用同一份预检。')
  if (releaseContext !== undefined) {
    if (target.pack || target.collection || target.plugins.length !== 1 || target.plugins[0]?.packageName !== releaseContext.identity.packageName) throw new Error('版本选择只能绑定当前单包预检。')
    const plugin = target.plugins[0]!
    return { selections: [{ ...planSelectionFor(plugin, inventory, consent), pluginId: releaseContext.identity.pluginId,
      packageName: releaseContext.identity.packageName, targetVersion: releaseContext.identity.version,
      targetDigest: releaseContext.identity.artifactDigest ?? 'digest-unavailable', releaseContext }], attemptUnknown: consent }
  }
  const collection = target.collection
  if (collection !== undefined) {
    return { collectionId: collection.id, collectionVersion: collection.version, attemptUnknown: consent,
      selections: collection.components.flatMap((component) => {
        const plugin = target.plugins.find((item) => item.id === component.pluginId && item.version === component.version && item.artifactDigest === component.artifactDigest)
        if (!plugin) return [] // Host rejects missing required components; never substitute a newer release.
        return [{ ...planSelectionFor(plugin, inventory, false), enabledIntent: isInstalled(inventory, plugin)?.bundleEnabled ?? component.enabled }]
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
  readonly onOpenOfficialPlugins?: (() => void) | undefined
  readonly inventoryIssues?: readonly string[] | undefined
}

/** Only safe package identities are exposed; unknown diagnostic text may contain local paths. */
export function inventoryIssueLabel(issue: string): string {
  const version = new RegExp('^bundle-version:((?:@[a-z0-9._-]+/)?[a-z0-9._-]+)$', 'i').exec(issue)
  if (version?.[1]) return version[1] + '：已安装版本尚未核实。'
  return '还有宿主状态未能核实，请到官方插件页查看。'
}

export function isEnvironmentPreflightBlock(result: PlanResult | undefined): boolean {
  return result?.status === 'blocked' && result.blockers.includes('inventory:unverified-state')
}

/** A blocked plan is about the selected target; unrelated inventory issues are advisory. */
export function PreflightBlockNotice({ result, onOpenOfficialPlugins, inventoryIssues = [] }: {
  readonly result: Extract<PlanResult, { readonly status: 'blocked' }>
  readonly onOpenOfficialPlugins?: (() => void) | undefined
  readonly inventoryIssues?: readonly string[] | undefined
}): React.JSX.Element {
  const environmentBlocked = isEnvironmentPreflightBlock(result)
  return <section role="alert" data-sticker="BLOCK" className="eac-market__notice eac-market__notice--warning">
    <strong>{environmentBlocked ? '安装目标状态待核对' : '暂不能安装'}</strong>
    {environmentBlocked ? <>
      <p>市场暂时无法完整确认本次目标插件的安装状态。这不是对无关插件的风险判定。</p>
      <p>请确认目标插件没有正在安装或卸载，然后重新预检。安装结果由官方安装器和上游插件负责，目标包身份校验仍会执行。</p>
      {inventoryIssues.length > 0 && <ul aria-label="待核对的已安装状态">{[...new Set(inventoryIssues.map(inventoryIssueLabel))].map(label => <li key={label}>{label}</li>)}</ul>}
      {onOpenOfficialPlugins && <Button variant="outline" onClick={onOpenOfficialPlugins}>查看官方插件页</Button>}
    </> : <p>{result.reason}</p>}
    <details><summary>查看预检详情</summary><p>{result.reason}</p>{result.blockers.join('；')}</details>
  </section>
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
      : '预检仍包含实际安装问题。请重新预检；缺少制品和校验失败不能绕过。'}</p>
    <Button variant="outline" onClick={onRetry}>重新预检</Button>
  </section>
}

/** A distinct mounted session owns each target. A's late success can reconcile A's
 * inventory, but cannot close B's dialog or move its focus to the task drawer. */
export function InstallPlanDialog(props: Props): React.JSX.Element | null {
  if (!props.open || props.target === undefined) return null
  return <PlanSession key={planTargetSignature(props.target)} {...props} target={props.target} />
}

function inventoryTargetIdentity(target: PlanTarget, inventory: readonly InventoryItem[]): string {
  const packages = new Set(target.plugins.map(plugin => plugin.packageName))
  return JSON.stringify(inventory.filter(item => packages.has(item.packageName)).map(item => [item.packageName, item.version ?? null, item.artifactDigest ?? null,
    item.installed, item.bundleEnabled, item.source, item.entryId ?? null, item.moduleName ?? null, item.restartRequired, item.readOnlyReason ?? null,
    item.rows.map(row => [row.id, row.state]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))))
}

function PlanSession({ target, inventory, remote, onClose, onStarted, onOpenOfficialPlugins, inventoryIssues }: Props & { target: PlanTarget }): React.JSX.Element {
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
  const [releaseMode, setReleaseMode] = useState<'loading' | 'enabled' | 'legacy'>('loading')
  const [options, setOptions] = useState<ReleaseOptionsResult>()
  const [selectedKey, setSelectedKey] = useState<string>()
  const [releaseBusy, setReleaseBusy] = useState(false)
  const [releaseNotice, setReleaseNotice] = useState('')
  const [releaseRetry, setReleaseRetry] = useState(0)
  const [recovering, setRecovering] = useState(false)
  const selectionRef = useRef<{ key: string; manual: boolean }>()
  const releaseGeneration = useRef(0)
  const releaseScope = useRef<{ remote: MarketRemote; signature: string }>()
  const recoveryAvailable = useRef(false)
  const pendingStart = useRef<{ request: TaskStartRecoveryRequest; environmentId: string; remote: MarketRemote; canRecover: boolean; generation: number }>()
  const group = target.pack !== undefined || target.collection !== undefined
  const packageName = target.plugin?.packageName ?? target.plugins[0]?.packageName
  const targetSignature = planTargetSignature(target)
  const inventoryIdentity = inventoryTargetIdentity(target, inventory)
  const readSignature = JSON.stringify([targetSignature, inventoryIdentity, packageName ?? null])
  const selected = options?.releases.find(option => releaseIdentityKey(option.identity) === selectedKey)
  const edges = target.collection?.execution.edges ?? target.pack?.execution.edges ?? []
  // Native-like install policy: catalog verification is advisory. The final
  // install button remains the explicit confirmation; upstream compatibility is
  // evaluated by DeepSeek Harness/plugin authors.
  const consentRequired = false
  const review = result?.status === 'ready' ? reviewInstallPlan(result.plan, group, edges, consent) : undefined
  const downgrades = review?.executable.filter((item) => item.action === 'downgrade') ?? []
  const automaticDowngrade = releaseMode === 'enabled' && downgrades.length > 0 && !selectionRef.current?.manual
  const missingComponents = target.collection?.components.filter((component) => !target.plugins.some((plugin) => plugin.id === component.pluginId && plugin.version === component.version && plugin.artifactDigest === component.artifactDigest)) ?? []
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current += 1 } }, [])
  useEffect(() => {
    const current = ++releaseGeneration.current
    releaseScope.current = undefined
    generation.current += 1
    setResult(undefined); setRiskStep(false); setOptions(undefined); setSelectedKey(undefined)
    setReleaseMode('loading'); setReleaseBusy(true); setReleaseNotice('')
    recoveryAvailable.current = false
    if (pendingStart.current !== undefined) { setReleaseBusy(false); return }
    void (async () => {
      try {
        const hello = await boundedRequest(remote.hello(), '读取宿主能力')
        if (!alive.current || current !== releaseGeneration.current) return
        recoveryAvailable.current = hello.capabilities.includes('operation-recovery')
        if (group || !hello.capabilities.includes('host-release-context') || remote.releaseOptions === undefined) {
          releaseScope.current = { remote, signature: readSignature }
          setReleaseMode('legacy'); return
        }
        setReleaseMode('enabled')
        if (!packageName || target.plugins.length !== 1) throw new Error('版本选择只能用于单包。')
        let page = await boundedRequest(remote.releaseOptions({ packageName, limit: 20 }), '读取版本列表')
        if (!alive.current || current !== releaseGeneration.current) return
        if (page.packageName !== packageName || page.context.environmentId !== hello.environmentId || page.includePrerelease) throw new Error('版本列表身份不匹配。')
        const preference = selectionRef.current?.manual ? selectionRef.current.key : undefined
        const cursors = new Set<string>()
        let limited = false
        while (page.pagination.hasMore && (preference ? !page.releases.some(option => releaseIdentityKey(option.identity) === preference)
          : !chooseRelease(page) && !page.context.catalogStale && page.hostCore.status === 'known' && page.installed.status !== 'unknown')) {
          const cursor = page.pagination.cursor
          if (!cursor || cursors.has(cursor)) throw new Error('版本分页无法完成。')
          if (cursors.size >= 20) { limited = true; break }
          cursors.add(cursor)
          const next = await boundedRequest(remote.releaseOptions({ packageName, limit: 20, cursor }), preference ? '核对原手选版本' : '寻找默认适配版本')
          if (!alive.current || current !== releaseGeneration.current) return
          page = appendReleasePage(page, next)
        }
        const choice = limited && preference ? undefined : chooseRelease(page, preference)
        selectionRef.current = choice === undefined ? limited && preference ? { key: preference, manual: true } : undefined : { key: releaseIdentityKey(choice.identity), manual: preference === releaseIdentityKey(choice.identity) }
        setOptions(page); setSelectedKey(choice === undefined ? undefined : releaseIdentityKey(choice.identity))
        releaseScope.current = { remote, signature: readSignature }
        if (limited) setReleaseNotice('自动只读分页已达本轮 20 页上限，版本历史仍未读取完整；不会声称没有适配更新或原手选版本不存在，请手动继续加载。')
        else if (preference && selectionRef.current?.key !== preference) setReleaseNotice('原手选版本已不可用，旧预检已失效；请核对新的选择。')
      } catch {
        if (alive.current && current === releaseGeneration.current) setReleaseNotice('无法读取可信版本列表，请显式刷新；不会自动采用目录版本安装。')
      } finally { if (alive.current && current === releaseGeneration.current) setReleaseBusy(false) }
    })()
    return () => { releaseGeneration.current += 1 }
  }, [remote, targetSignature, inventoryIdentity, group, packageName, releaseRetry])
  useEffect(() => {
    const current = ++generation.current
    setResult(undefined); setRiskStep(false); setNotice('')
    if (pendingStart.current !== undefined || releaseScope.current?.remote !== remote || releaseScope.current.signature !== readSignature
      || releaseMode === 'loading' || releaseBusy || (releaseMode === 'enabled' && (!options || !selected || options.context.catalogStale || !selected.selectable))) { setBusy(undefined); return }
    setBusy('preflight')
    startKey.current = createIdempotencyKey('market-install')
    void (async () => {
      try {
        if (!group && target.plugins.length === 0) throw new Error('没有可解析的插件，无法预检。')
        if (remote.createPlan === undefined) throw new Error('当前宿主暂未提供安装预检，请到官方插件页管理。')
        const plan = await boundedRequest(remote.createPlan(planRequestFor(target, inventory, consent, releaseMode === 'enabled' && options && selected ? releaseSelectionContext(options, selected) : undefined)), '安装预检')
        if (releaseMode === 'enabled' && options && selected && plan.status === 'ready') {
          const item = plan.plan.items[0]
          const binding = item?.releaseContext
          const sources = (values: ReleaseSelectionContext['sources']) => JSON.stringify(values.map(value => [value.sourceId, value.revision]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))))
          if (plan.plan.items.length !== 1 || !binding || !sameReleaseContext(binding.context, options.context)
            || releaseIdentityKey(binding.identity) !== releaseIdentityKey(selected.identity) || sources(binding.sources) !== sources(selected.sources)
            || item?.pluginId !== selected.identity.pluginId || item.packageName !== selected.identity.packageName
            || item.targetVersion !== selected.identity.version || item.targetDigest !== selected.identity.artifactDigest) throw new Error('预检未绑定当前版本身份和可信来源，请刷新版本列表后重新预检。')
        }
        if (target.collection && plan.status === 'ready' && (plan.plan.collectionId !== target.collection.id || plan.plan.collectionVersion !== target.collection.version || plan.plan.collectionDigest !== target.collection.collectionDigest || plan.plan.packId !== undefined)) throw new Error('组合版本或内容已变化，请重新读取目录后预检。')
        if (alive.current && current === generation.current) setResult(plan)
      } catch (error) {
        if (alive.current && current === generation.current) setNotice(error instanceof Error ? error.message : String(error))
      } finally { if (alive.current && current === generation.current) setBusy(undefined) }
    })()
    return () => { generation.current += 1 }
  }, [consent, retry, remote, targetSignature, inventoryIdentity, releaseMode, options, selectedKey, releaseBusy])

  function invalidatePreflight(): void {
    generation.current += 1; setResult(undefined); setRiskStep(false); setNotice('')
  }

  async function loadMore(): Promise<void> {
    if (releaseBusy || uncertain || writing.current || !options?.pagination.hasMore || !options.pagination.cursor || !remote.releaseOptions || !packageName) return
    const current = releaseGeneration.current
    const previous = options
    invalidatePreflight(); setReleaseBusy(true); setReleaseNotice('')
    try {
      const page = await boundedRequest(remote.releaseOptions({ packageName, limit: 20, cursor: previous.pagination.cursor! }), '读取更多版本')
      if (!alive.current || current !== releaseGeneration.current) return
      const combined = appendReleasePage(previous, page)
      const preference = selectionRef.current?.manual ? selectionRef.current.key : undefined
      const awaitingManual = preference !== undefined && combined.pagination.hasMore && !combined.releases.some(option => releaseIdentityKey(option.identity) === preference)
      const choice = awaitingManual ? undefined : chooseRelease(combined, preference)
      selectionRef.current = choice === undefined ? awaitingManual ? { key: preference!, manual: true } : undefined : { key: releaseIdentityKey(choice.identity), manual: preference === releaseIdentityKey(choice.identity) }
      setOptions(combined); setSelectedKey(choice === undefined ? undefined : releaseIdentityKey(choice.identity))
    } catch {
      if (alive.current && current === releaseGeneration.current) {
        setOptions(undefined); setSelectedKey(undefined)
        setReleaseNotice('分页失败或列表上下文已变化，旧预检已失效。请重新读取首屏，不会混用两份列表。')
      }
    } finally { if (alive.current && current === releaseGeneration.current) setReleaseBusy(false) }
  }

  async function recoverStart(): Promise<void> {
    const pending = pendingStart.current
    if (!pending?.canRecover || !pending.remote.taskStartRecover || recovering) return
    setRecovering(true); setNotice('')
    try {
      const recovered = await boundedRequest(pending.remote.taskStartRecover(pending.request), '查询原安装提交')
      if (recovered.status === 'found') {
        if (recovered.task.planId !== pending.request.planId || recovered.task.planDigest !== pending.request.planDigest || recovered.task.environmentId !== pending.environmentId) throw new Error('原任务身份不匹配。')
        const reveal = alive.current && pending.generation === generation.current
        onStarted(recovered.task, reveal)
        if (reveal) onClose()
      } else if (alive.current) setNotice('尚未找到原提交记录；这不能证明没有写入。不会自动重试，请稍后只读查询或到任务面板核对。')
    } catch { if (alive.current) setNotice('无法确认原提交结果；不会重放安装，可稍后再次只读查询。') }
    finally { if (alive.current) setRecovering(false) }
  }

  async function confirm(): Promise<void> {
    if (writing.current || busy !== undefined || result?.status !== 'ready' || remote.startTask === undefined || uncertain
      || releaseScope.current?.remote !== remote || releaseScope.current.signature !== readSignature) return
    if (!review?.canConfirm || (!group && consentRequired && !consent) || releaseBusy || automaticDowngrade) return
    if (!Number.isFinite(Date.parse(result.plan.expiresAt)) || Date.parse(result.plan.expiresAt) <= Date.now()) { setNotice('安装方案已过期，请重新预检。'); setResult(undefined); return }
    if (downgrades.length > 0 && !riskStep) { setRiskStep(true); return }
    writing.current = true
    setBusy('starting'); setNotice('')
    const request = { planId: result.plan.planId, planDigest: result.plan.planDigest, idempotencyKey: startKey.current, confirmed: true as const }
    const current = generation.current
    pendingStart.current = { request: { planId: request.planId, planDigest: request.planDigest, idempotencyKey: request.idempotencyKey }, environmentId: result.plan.environmentId, remote, canRecover: recoveryAvailable.current, generation: current }
    try {
      const task = await boundedRequest(remote.startTask(request), '提交安装', 20_000)
      if (task.planId !== request.planId || task.planDigest !== request.planDigest || task.environmentId !== result.plan.environmentId) throw new Error('提交回执身份不匹配；请只读查询原提交。')
      const reveal = alive.current && current === generation.current
      onStarted(task, reveal)
      if (reveal) onClose()
    } catch (error) {
      const preDispatchRejection = typeof error === 'object' && error !== null && 'code' in error && error.code === 'plan/stale'
      if (alive.current) {
        setNotice(preDispatchRejection ? '计划已过期，后台明确拒绝提交；请重新预检。' : error instanceof RequestTimeout ? error.message : '提交结果未知，可能已写入；请只读查询原提交或到任务面板核对，不会重放安装。')
        setUncertain(!preDispatchRejection)
        if (preDispatchRejection) setResult(undefined)
      }
      if (preDispatchRejection) pendingStart.current = undefined
    } finally { writing.current = false; if (alive.current) setBusy(undefined) }
  }
  const blocked = !review?.canConfirm || (!group && consentRequired && !consent) || automaticDowngrade || releaseMode === 'loading' || releaseBusy
    || releaseScope.current?.remote !== remote || releaseScope.current.signature !== readSignature
  const unsafeReady = result?.status === 'ready' && review !== undefined && review.unsafe.length > 0
  const environmentBlocked = isEnvironmentPreflightBlock(result)
  return <Modal open onClose={() => { if (busy !== 'starting') onClose() }} title={riskStep ? '第 2 步：再次确认降级影响' : target.collection ? `安装确认：${target.collection.name}` : target.pack ? `安装确认：${target.pack.name}` : `安装确认：${target.plugin?.name ?? '所选插件'}`} closeLabel="关闭安装确认" description={riskStep ? '只有完成这次专门影响确认后，才会提交降级安装。' : '先核对版本、来源和安装条件；你确认后才会安装。'}>
    <div className="eac-market__form">
      {!group && <section aria-label="安装版本选择" className="eac-market__notice">
        {releaseMode === 'legacy' ? <p>当前宿主未提供可信版本选择上下文，保留目录锁定版本预检；不会自动改选版本。</p> : <>
          {releaseBusy && <p role="status">正在读取后端版本事实…</p>}
          {options && <>
            <p>核心：{options.hostCore.agentName} · {options.hostCore.version ?? '未知'}；已安装：{options.installed.status === 'absent' ? '未安装' : options.installed.version ?? '未知'}</p>
            <label>目标版本 <select aria-label="目标版本" value={selectedKey ?? ''} disabled={releaseBusy || busy === 'starting' || uncertain || options.context.catalogStale} onChange={event => {
              const key = event.currentTarget.value
              const choice = options.releases.find(option => releaseIdentityKey(option.identity) === key && option.selectable)
              if (!choice) return
              invalidatePreflight(); selectionRef.current = { key, manual: true }; setSelectedKey(key)
            }}>
              <option value="" disabled>请选择版本</option>
              {options.releases.map(option => <option key={releaseIdentityKey(option.identity)} value={releaseIdentityKey(option.identity)} disabled={!option.selectable}>{releaseOptionLabel(option)}</option>)}
            </select></label>
            {releaseListNotices(options).map(message => <p key={message} role="status">{message}</p>)}
            {selected && <p>所选版本来源：{selected.sources.length > 0 ? selected.sources.map(source => `${source.sourceId}@${source.revision}`).join('、') : '未提供来源记录，仍须由后端核对'}；制品摘要：{selected.identity.artifactDigest ?? '未知'}。</p>}
            {!selected && !options.context.catalogStale && <p role="status">{options.pagination.hasMore ? '当前已读取记录中没有默认适配候选，可继续加载版本。' : options.installed.status === 'known' ? '没有可自动选择的适配更新；不会自动降级或选同版。可手动选择可用版本。' : '没有可自动选择的适配版本，请核对列表和核心事实。'}</p>}
            {options.pagination.hasMore && <Button variant="outline" disabled={releaseBusy || busy === 'starting' || uncertain} onClick={() => void loadMore()}>加载更多版本</Button>}
          </>}
          <Button variant="outline" disabled={releaseBusy || busy === 'starting' || uncertain} onClick={() => { invalidatePreflight(); setReleaseRetry(value => value + 1) }}>刷新版本列表</Button>
        </>}
        {releaseNotice && <p role="alert">{releaseNotice}</p>}
      </section>}
      {busy === 'preflight' && <p role="status">正在核对版本、安装条件和当前状态…</p>}
      {consentRequired && !environmentBlocked && <label className="eac-market__notice eac-market__install-consent"><input type="checkbox" checked={consent} disabled={busy === 'starting'} onChange={(event) => {
        generation.current += 1; setResult(undefined); setRiskStep(false); setConsent(event.currentTarget.checked)
      }} /> 我了解此版本尚未验证兼容性，同意尝试安装。<span className="eac-market__integration-note">此确认不会绕过已知不兼容、缺包或校验失败。</span></label>}
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
      {result?.status === 'blocked' && <PreflightBlockNotice result={result} onOpenOfficialPlugins={onOpenOfficialPlugins} inventoryIssues={inventoryIssues} />}
      {result?.status === 'stale' && <p role="alert">状态已变化，请重新预检。{result.reason}</p>}
      {automaticDowngrade && <p role="alert">当前方案变成了降级；默认更新不会执行降级。请刷新版本事实并手动选择后再次确认。</p>}
      <details className="eac-market__notice" aria-label="确认边界">
        <summary>安装保护说明</summary>
        <ul>
          <li>缺少可安装制品、摘要或版本校验失败不会被绕过；上游兼容性由官方安装器和插件作者负责。</li>
          {downgrades.length > 0 && <li>降级必须在方案确认后再看专门影响卡，并点击第二次确认。</li>}
          <li>提交结果未知时先到任务面板核对，不自动重放安装。</li>
        </ul>
      </details>
      {notice && <p role="alert">{notice}</p>}
      {uncertain && <p>请关闭此窗口，到任务面板核对。已经提交的任务可能仍在运行。</p>}
      {uncertain && pendingStart.current?.canRecover && pendingStart.current.remote.taskStartRecover && <Button variant="outline" disabled={recovering} onClick={() => void recoverStart()}>{recovering ? '正在查询原提交…' : '只读查询原提交结果'}</Button>}
      <div className="eac-market__button-row">
        <Button variant="outline" onClick={onClose}>{busy === 'starting' ? '关闭窗口' : '取消'}</Button>
        {busy === undefined && !uncertain && !unsafeReady && (result?.status !== 'ready' || notice) && <Button variant="outline" onClick={() => setRetry(nextPreflightRetry)}>重新预检</Button>}
        <Button variant="primary" disabled={busy !== undefined || blocked || remote.startTask === undefined || uncertain} onClick={() => void confirm()}>{busy === 'starting' ? '正在提交…' : riskStep ? '已了解影响，确认降级' : downgrades.length > 0 ? '查看降级影响' : group ? '确认执行可用项' : '确认安装'}</Button>
      </div>
    </div>
  </Modal>
}
