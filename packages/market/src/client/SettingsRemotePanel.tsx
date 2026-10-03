import { useCallback, useEffect, useState } from 'react'
import type {
  CapabilityName,
  CatalogRefreshView,
  CatalogSourceView,
  CoreMaintenanceSnapshot,
  UpdateCheckItem,
  UpdateCheckResult,
  UpdatePolicySnapshot,
  UpdatePolicy,
} from '@dsh-eac/market-core/contracts'
import { Status } from './components.tsx'
import { Button } from './ui.tsx'
import type { MarketRemote } from './model.ts'
import { boundedRequest } from './data-controller.ts'

type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'idle' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly value: T }

export interface SettingsRemotePanelProps {
  readonly remote: MarketRemote
  readonly capabilities?: readonly CapabilityName[]
  readonly environmentId?: string
  readonly refreshBusy: boolean
  readonly onRefreshSource: (sourceId: string) => Promise<CatalogRefreshView | undefined>
}

function sourceKindLabel(source: CatalogSourceView): string {
  return source.kind === 'agent-forge' ? 'Agent Forge' : '市场目录'
}
function sourceModeLabel(source: CatalogSourceView): string {
  if (source.mode === 'https') return '网络来源'
  if (source.mode === 'local-file') return '宿主已授权的本地来源'
  return '离线包来源'
}
function sourceStatusLabel(status: CatalogSourceView['status']): string {
  if (status === 'ready') return '可用'
  if (status === 'stale') return '使用缓存'
  if (status === 'unavailable') return '暂不可用'
  return '尚未检查'
}
function sourcePolicyLabel(policy: CatalogSourceView['refreshPolicy']): string {
  if (policy === 'on-open') return '来源设定：打开市场时检查'
  if (policy === 'periodic') return '来源设定：按周期检查'
  return '来源设定：手动检查'
}
function sourceStatusTone(status: CatalogSourceView['status']): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'ready') return 'success'
  if (status === 'stale') return 'warning'
  if (status === 'unavailable') return 'danger'
  return 'neutral'
}
function updateStatusLabel(status: UpdateCheckItem['status']): string {
  if (status === 'update-available') return '发现新版本'
  if (status === 'up-to-date') return '与当前目录一致'
  if (status === 'not-in-catalog') return '当前目录未收录'
  if (status === 'incompatible') return '版本不兼容'
  return '无法确认'
}
function updateStatusTone(status: UpdateCheckItem['status']): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'update-available') return 'warning'
  if (status === 'up-to-date') return 'success'
  if (status === 'incompatible') return 'danger'
  return 'neutral'
}
function localTime(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : '时间未提供'
}
function SourceRow(props: {
  readonly source: CatalogSourceView
  readonly index: number
  readonly refreshing: boolean
  readonly refreshBusy: boolean
  readonly refreshAvailable: boolean
  readonly onRefresh: (sourceId: string) => void
}): React.JSX.Element {
  const { source, index, refreshing, refreshBusy, refreshAvailable, onRefresh } = props
  const canRefresh = refreshAvailable && source.enabled && source.mode !== 'offline-pack'
  return (
    <article className="eac-market__source-row">
      <div className="eac-market__source-copy">
        <div className="eac-market__source-title">
          <strong>{sourceKindLabel(source)}来源{index > 0 ? ` · ${index + 1}` : ''}</strong>
          <Status tone={sourceStatusTone(source.status)}>{sourceStatusLabel(source.status)}</Status>
          {!source.enabled && <Status tone="neutral">已停用</Status>}
        </div>
        <p>{sourceModeLabel(source)} · {sourcePolicyLabel(source.refreshPolicy)}。来源地址和本机路径由宿主保管，这里不会显示或修改。</p>
        {source.mode === 'offline-pack' && <small>离线内容需要通过独立导入流程更新。</small>}
        {source.status === 'stale' && <small>当前使用最近一次有效缓存，最新目录可能尚未同步。确认网络或宿主配置后，可手动刷新。</small>}
        {source.status === 'unavailable' && <small className="eac-market__integration-note--warning">宿主暂时无法取得该来源；已保留现有目录。</small>}
      </div>
      {canRefresh && <Button variant="outline" size="sm" disabled={refreshBusy || refreshing} aria-busy={refreshing} onClick={() => onRefresh(source.id)}>{refreshing ? '正在刷新…' : '刷新此来源'}</Button>}
    </article>
  )
}

export function SettingsRemotePanel({ remote, capabilities, environmentId, refreshBusy, onRefreshSource }: SettingsRemotePanelProps): React.JSX.Element {
  const canUse = useCallback((capability: CapabilityName, method: keyof MarketRemote): boolean => (capabilities === undefined || capabilities.includes(capability)) && typeof remote[method] === 'function', [capabilities, remote])
  const canListSources = canUse('catalog-source-list', 'catalogSources')
  const canCheckUpdates = canUse('update-check', 'checkUpdates')
  const canReadMaintenance = canUse('core-maintenance', 'maintenanceStatus')
  const canReadPolicy = canUse('update-policy', 'updatePolicyGet')
  const canSavePolicy = canUse('update-policy', 'updatePolicySave')

  const [sources, setSources] = useState<LoadState<readonly CatalogSourceView[]>>({ status: 'loading' })
  const [maintenance, setMaintenance] = useState<LoadState<CoreMaintenanceSnapshot>>({ status: 'loading' })
  const [updates, setUpdates] = useState<LoadState<UpdateCheckResult>>({ status: 'idle' })
  const [refreshingSource, setRefreshingSource] = useState<string>()
  const [sourceFeedback, setSourceFeedback] = useState('')
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [policy, setPolicy] = useState<LoadState<UpdatePolicySnapshot>>({ status: 'loading' })
  const [policyDraft, setPolicyDraft] = useState<{ readonly enabled: boolean; readonly intervalMinutes: number }>({ enabled: true, intervalMinutes: 60 })
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [policyFeedback, setPolicyFeedback] = useState('')

  const readSources = useCallback(async () => {
    const catalogSources = remote.catalogSources
    if (!canListSources || catalogSources === undefined) { setSources({ status: 'unavailable' }); return }
    setSources({ status: 'loading' })
    try { setSources({ status: 'ready', value: await boundedRequest(catalogSources(), '来源状态读取') }) }
    catch { setSources({ status: 'failed' }) }
  }, [canListSources, remote])
  const readMaintenance = useCallback(async () => {
    const maintenanceStatus = remote.maintenanceStatus
    if (!canReadMaintenance || maintenanceStatus === undefined) { setMaintenance({ status: 'unavailable' }); return }
    setMaintenance({ status: 'loading' })
    try { setMaintenance({ status: 'ready', value: await boundedRequest(maintenanceStatus(), '运行状态读取') }) }
    catch { setMaintenance({ status: 'failed' }) }
  }, [canReadMaintenance, remote])
  useEffect(() => { void readSources(); void readMaintenance() }, [readSources, readMaintenance])

  const readPolicy = useCallback(async (preserveDraft = false): Promise<UpdatePolicySnapshot | undefined> => {
    const updatePolicyGet = remote.updatePolicyGet
    if (!canReadPolicy || updatePolicyGet === undefined) { setPolicy({ status: 'unavailable' }); return undefined }
    setPolicy({ status: 'loading' })
    try {
      const current = await boundedRequest(updatePolicyGet(), '更新策略读取')
      setPolicy({ status: 'ready', value: current })
      if (!preserveDraft) setPolicyDraft({ enabled: current.policy.automaticChecksEnabled, intervalMinutes: current.policy.intervalMinutes ?? 60 })
      return current
    } catch { setPolicy({ status: 'failed' }); return undefined }
  }, [canReadPolicy, remote])
  useEffect(() => { void readPolicy() }, [readPolicy])

  const savePolicy = useCallback(async () => {
    const updatePolicySave = remote.updatePolicySave
    if (savingPolicy || policy.status !== 'ready' || !canSavePolicy || updatePolicySave === undefined) return
    const next: UpdatePolicy = {
      ...policy.value.policy,
      automaticChecksEnabled: policyDraft.enabled,
      automaticDownloadsEnabled: false,
      automaticInstallsEnabled: false,
      intervalMinutes: policyDraft.intervalMinutes,
    }
    setSavingPolicy(true)
    setPolicyFeedback('')
    try {
      const saved = await boundedRequest(updatePolicySave({ expectedRevision: policy.value.revision, policy: next }), '更新策略保存')
      setPolicy({ status: 'ready', value: saved })
      setPolicyDraft({ enabled: saved.policy.automaticChecksEnabled, intervalMinutes: saved.policy.intervalMinutes ?? 60 })
      setPolicyFeedback('检查偏好已保存。自动下载和自动安装的保存值已关闭；这不是后台检查已执行的回执。')
    } catch {
      setPolicyFeedback('保存结果暂不确定，正在重新读取后台当前值。不会自动重放保存。')
      const current = await readPolicy(true)
      if (current) {
        const matches = current.policy.automaticChecksEnabled === next.automaticChecksEnabled
          && (current.policy.intervalMinutes ?? 60) === next.intervalMinutes
          && current.policy.automaticDownloadsEnabled === false
          && current.policy.automaticInstallsEnabled === false
        setPolicyFeedback(matches
          ? '后台当前值与本次设置一致；保存请求没有重放。'
          : '后台当前策略已重新读取；本次设置未确认生效。请核对后再次手动保存，旧值不会被自动覆盖。')
      } else setPolicyFeedback('重新读取也未完成。请先确认后台当前策略，再决定是否重试。')
    } finally { setSavingPolicy(false) }
  }, [canSavePolicy, policy, policyDraft, readPolicy, savingPolicy])

  const refresh = useCallback(async (sourceId: string) => {
    if (refreshBusy || typeof remote.refreshCatalog !== 'function') return
    setRefreshingSource(sourceId)
    setSourceFeedback('')
    try {
      const result = await onRefreshSource(sourceId)
      if (result === undefined) return
      setSourceFeedback(result.status === 'refreshed'
        ? '来源已刷新，市场目录已同步。'
        : '来源刷新失败，仍保留上次可用目录。确认宿主预先配置的来源可用后，可手动重试。')
      await readSources()
    } catch {
      setSourceFeedback('刷新结果尚未确认。请先重新读取来源状态，再决定是否重试；市场不会自动重放请求。')
      await readSources()
    } finally { setRefreshingSource(undefined) }
  }, [onRefreshSource, readSources, refreshBusy, remote.refreshCatalog])

  const runUpdateCheck = useCallback(async () => {
    const checkUpdates = remote.checkUpdates
    if (!canCheckUpdates || checkingUpdates || checkUpdates === undefined) return
    setCheckingUpdates(true)
    setUpdates({ status: 'loading' })
    try { setUpdates({ status: 'ready', value: await boundedRequest(checkUpdates({ refreshFirst: false }), '插件版本检查') }) }
    catch { setUpdates({ status: 'failed' }) }
    finally { setCheckingUpdates(false) }
  }, [canCheckUpdates, checkingUpdates, remote])

  const policyNeedsSave = policy.status === 'ready' && (policyDraft.enabled !== policy.value.policy.automaticChecksEnabled
    || policyDraft.intervalMinutes !== (policy.value.policy.intervalMinutes ?? 60)
    || policy.value.policy.automaticDownloadsEnabled || policy.value.policy.automaticInstallsEnabled)
  const updateItems = updates.status === 'ready' ? updates.value.items : []
  const updateCount = updateItems.filter(item => item.status === 'update-available').length
  const uncertainCount = updateItems.filter(item => item.status === 'unknown' || item.status === 'incompatible').length
  const visibleUpdates = updateItems.slice(0, 6)

  return (
    <>
      <section className="eac-market__setting eac-market__setting--stacked" aria-labelledby="eac-sources-heading">
        <div className="eac-market__integration-head">
          <div><h3 id="eac-sources-heading">已配置的来源</h3><p>这里只查看或刷新宿主预先配置的来源，不提供任意网址或本机路径输入。</p></div>
          {canListSources && <Button variant="ghost" size="sm" disabled={sources.status === 'loading'} onClick={() => void readSources()}>{sources.status === 'loading' ? '读取中…' : '重新读取'}</Button>}
        </div>
        {sources.status === 'loading' && <p className="eac-market__integration-note" role="status">正在读取来源状态…</p>}
        {sources.status === 'unavailable' && <p className="eac-market__integration-note" role="status">当前宿主版本未提供来源列表，市场仍可使用已加载的目录。</p>}
        {sources.status === 'failed' && <p className="eac-market__integration-note eac-market__integration-note--warning" role="status">来源状态读取失败。现有目录不会因此被清除；可以重新读取。</p>}
        {sources.status === 'ready' && sources.value.length === 0 && <p className="eac-market__integration-note" role="status">宿主当前没有登记额外来源。</p>}
        {sources.status === 'ready' && sources.value.length > 0 && (
          <div className="eac-market__source-list">
            {sources.value.map((source, index) => <SourceRow key={source.id} source={source} index={index} refreshing={refreshingSource === source.id} refreshBusy={refreshBusy} refreshAvailable={source.kind === 'agent-forge' ? canUse('agent-forge-refresh', 'refreshCatalog') : typeof remote.refreshCatalog === 'function'} onRefresh={(sourceId) => void refresh(sourceId)} />)}
          </div>
        )}
        {sourceFeedback && <p className="eac-market__integration-note" role="status" aria-live="polite">{sourceFeedback}</p>}
      </section>

      <section className="eac-market__setting eac-market__setting--stacked" aria-labelledby="eac-update-check-heading">
        <div className="eac-market__integration-head">
          <div><h3 id="eac-update-check-heading">插件版本检查</h3><p>只比较当前已接收的目录和已安装版本，不下载、不安装，也不代表目录一定是公网最新。</p></div>
          <Button variant="outline" size="sm" disabled={!canCheckUpdates || checkingUpdates} aria-busy={checkingUpdates} onClick={() => void runUpdateCheck()}>{checkingUpdates ? '正在比较…' : '检查当前目录'}</Button>
        </div>
        {!canCheckUpdates && <p className="eac-market__integration-note" role="status">当前宿主尚未提供版本检查能力。</p>}
        {canCheckUpdates && updates.status === 'idle' && <p className="eac-market__integration-note">还未进行手动比较，点击上方按钮检查当前目录。</p>}
        {updates.status === 'failed' && <p className="eac-market__integration-note eac-market__integration-note--warning" role="status">检查未能完成。没有执行插件写入；确认宿主连接后可再次检查。</p>}
        {updates.status === 'ready' && (
          <div className="eac-market__update-results" role="status" aria-live="polite">
            <p>{localTime(updates.value.checkedAt)} · {updateCount === 0 ? '未发现可确认的新版本' : `发现 ${updateCount} 个目录中有较新版本`}{uncertainCount > 0 ? ` · ${uncertainCount} 项需要进一步确认` : ''}</p>
            {updates.value.catalogStale && <p className="eac-market__integration-note eac-market__integration-note--warning">当前目录已过期或刷新状态不确定，结果仅供参考。请先刷新已配置来源。</p>}
            {updateItems.length === 0 && <p>当前没有可比较的已安装插件。</p>}
            {updateItems.length > 0 && <ul className="eac-market__update-list">
              {visibleUpdates.map(item => <li key={item.packageName}>
                <span><strong>{item.packageName}</strong><small>{item.installedVersion ?? '当前版本未知'}{item.latestVersion ? ` → ${item.latestVersion}` : ''}{item.reason ? ` · ${item.reason}` : ''}</small></span>
                <Status tone={updateStatusTone(item.status)}>{updateStatusLabel(item.status)}</Status>
              </li>)}
            </ul>}
            {updateItems.length > visibleUpdates.length && <details className="eac-market__update-more"><summary>显示其余 {updateItems.length - visibleUpdates.length} 项</summary><ul className="eac-market__update-list">
              {updateItems.slice(visibleUpdates.length).map(item => <li key={item.packageName}>
                <span><strong>{item.packageName}</strong><small>{item.installedVersion ?? '当前版本未知'}{item.latestVersion ? ` → ${item.latestVersion}` : ''}</small></span>
                <Status tone={updateStatusTone(item.status)}>{updateStatusLabel(item.status)}</Status>
              </li>)}
            </ul></details>}
            {updateItems.some(item => item.status === 'update-available') && <p className="eac-market__integration-note">发现新版本只表示目录存在候选版本。请到插件详情重新预检，并在确认后安装。</p>}
          </div>
        )}
      </section>

      <section className="eac-market__setting eac-market__setting--stacked" aria-labelledby="eac-update-policy-heading">
        <div className="eac-market__integration-head">
          <div><h3 id="eac-update-policy-heading">检查偏好</h3><p>只允许后台读取新版本信息；自动下载和自动安装保持关闭。</p></div>
          {policy.status === 'ready' && canSavePolicy && <Button variant="outline" size="sm" disabled={savingPolicy || !policyNeedsSave} aria-busy={savingPolicy} onClick={() => void savePolicy()}>{savingPolicy ? '正在保存…' : '保存偏好'}</Button>}
          {policy.status === 'failed' && canReadPolicy && <Button variant="ghost" size="sm" onClick={() => void readPolicy()}>重新读取</Button>}
        </div>
        {policy.status === 'loading' && <p className="eac-market__integration-note" role="status">正在读取已保存的检查偏好…</p>}
        {policy.status === 'unavailable' && <p className="eac-market__integration-note" role="status">当前宿主尚未提供检查策略设置；手动检查仍可单独使用。</p>}
        {policy.status === 'failed' && <p className="eac-market__integration-note eac-market__integration-note--warning" role="status">检查策略读取失败，尚未开放保存，避免覆盖未知的后台设置。</p>}
        {policy.status === 'ready' && (
          <div className="eac-market__policy-editor">
            <label className="eac-market__policy-toggle"><input type="checkbox" checked={policyDraft.enabled} disabled={savingPolicy || !canSavePolicy} onChange={(event) => { const enabled = event.currentTarget.checked; setPolicyDraft(value => ({ ...value, enabled })) }} /><span><strong>允许定时读取版本信息</strong><small>只读取，不会自动下载、安装或改变插件。</small></span></label>
            <label className="eac-market__policy-interval">检查周期
              <select value={policyDraft.intervalMinutes} disabled={savingPolicy || !canSavePolicy} onChange={(event) => { const intervalMinutes = Number(event.currentTarget.value); setPolicyDraft(value => ({ ...value, intervalMinutes })) }}>
                {[30, 60, 180, 360, 1440].includes(policyDraft.intervalMinutes) ? null : (
                  <option value={policyDraft.intervalMinutes}>每 {policyDraft.intervalMinutes} 分钟（当前）</option>
                )}
                <option value={30}>每 30 分钟</option>
                <option value={60}>每小时</option>
                <option value={180}>每 3 小时</option>
                <option value={360}>每 6 小时</option>
                <option value={1440}>每天</option>
              </select>
            </label>
            {!canSavePolicy && <p className="eac-market__integration-note">当前宿主只允许查看设置，不支持保存。</p>}
            <p className="eac-market__integration-note">支持后台调度的宿主会在 DSH 运行期间按周期检查，退出 DSH 时暂停；关闭市场面板不影响它。当前接口尚不能显示调度是否已启动、上次或下次检查时间。</p>
            <p className="eac-market__integration-note">已保存偏好：自动下载{policy.value.policy.automaticDownloadsEnabled ? '开启' : '关闭'} · 自动安装{policy.value.policy.automaticInstallsEnabled ? '开启' : '关闭'}</p>
            {(policy.value.policy.automaticDownloadsEnabled || policy.value.policy.automaticInstallsEnabled) && <p className="eac-market__integration-note eac-market__integration-note--warning">后台原偏好包含自动写入设置。本市场不会触发自动下载或安装；点击保存会把这两个选项关闭。</p>}
          </div>
        )}
        {policyFeedback && <p className="eac-market__integration-note" role="status" aria-live="polite">{policyFeedback}</p>}
      </section>

      <section className="eac-market__setting eac-market__setting--stacked" aria-labelledby="eac-maintenance-heading">
        <div className="eac-market__integration-head">
          <div><h3 id="eac-maintenance-heading">运行状态</h3><p>来自后端对当前环境的维护快照；未知状态会明确保留，不会推测为正常。</p></div>
          {canReadMaintenance && <Button variant="ghost" size="sm" disabled={maintenance.status === 'loading'} onClick={() => void readMaintenance()}>{maintenance.status === 'loading' ? '读取中…' : '重新读取'}</Button>}
        </div>
        {maintenance.status === 'loading' && <p className="eac-market__integration-note" role="status">正在读取运行状态…</p>}
        {maintenance.status === 'unavailable' && <p className="eac-market__integration-note" role="status">当前宿主版本未提供维护状态接口。</p>}
        {maintenance.status === 'failed' && <p className="eac-market__integration-note eac-market__integration-note--warning" role="status">运行状态读取失败。请确认宿主正常后重新读取。</p>}
        {maintenance.status === 'ready' && environmentId !== undefined && maintenance.value.environmentId !== environmentId && <p className="eac-market__integration-note eac-market__integration-note--warning" role="status">后台返回的状态不属于当前环境，已拒绝展示。</p>}
        {maintenance.status === 'ready' && (environmentId === undefined || maintenance.value.environmentId === environmentId) && (() => {
          const packages = maintenance.value.packages
          const active = maintenance.value.activeTaskIds.length
          const uncertain = packages.filter(item => item.installState === 'unknown' || item.enabledState === 'unknown' || item.effectiveState === 'unknown').length
          const busy = packages.filter(item => item.installState === 'installing' || item.installState === 'updating' || item.installState === 'uninstalling').length
          return <div className="eac-market__maintenance-summary" role="status">
            <span>已核对 {packages.length} 项插件状态</span>
            <span>{active > 0 ? `${active} 个任务进行中` : '没有正在运行的任务'}</span>
            <span>{busy > 0 ? `${busy} 项正在变更` : '没有插件正在变更'}</span>
            <span>{maintenance.value.pendingRestart ? '有操作等待重启' : '没有待重启操作'}</span>
            {uncertain > 0 && <Status tone="warning">{uncertain} 项状态未知</Status>}
            <small>状态读取于 {localTime(maintenance.value.generatedAt)}</small>
          </div>
        })()}
      </section>
    </>
  )
}