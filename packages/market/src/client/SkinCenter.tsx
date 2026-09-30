import { useEffect, useRef, useState } from 'react'
import type { CatalogPlugin, InventoryItem } from '../types.ts'
import { Button, Input, Pill } from './ui.tsx'
import { ActionFeedback } from './action-feedback.tsx'
import { completedActionFeedback, failedActionFeedback, idleActionFeedback, needsRecheckActionFeedback, preparingActionFeedback, runningActionFeedback, type ActionFeedbackState } from './action-state.ts'
import { EmptyState, InventoryCard, PluginCard, Status, errorMessage } from './components.tsx'
import { browseSortPlugins, filterPlugins, EMPTY_FILTERS, latestCompatiblePlugin, installabilityLabel, verificationLabel } from './model.ts'
import type { CatalogSnapshot } from '../types.ts'
import { boundedRequest } from './data-controller.ts'
import { isSkinPlugin, skinCatalogForInventory, skinSwitchBlockReason } from './skin-model.ts'
import { DEFAULT_SKIN_ID, SKIN_LOADER_PACKAGE, type SkinRuntime, type SkinRuntimeInfo, type SkinServiceBridge } from './skin-service.ts'

export interface SkinCenterProps {
  readonly catalog: CatalogSnapshot
  readonly inventory: readonly InventoryItem[]
  readonly skinService?: SkinServiceBridge | undefined
  readonly onBack: () => void
  readonly onOpen: (plugin: CatalogPlugin) => void
  readonly onInstall: (plugin: CatalogPlugin) => void
  readonly onToggle: (item: InventoryItem, enabled: boolean) => void
  readonly onRemove: (item: InventoryItem) => void
  readonly onOpenOfficialPlugins?: (() => void) | undefined
  readonly managementBusy?: boolean
  readonly canInstall: boolean
}

interface RuntimeSnapshot {
  readonly generation?: number
  readonly runtime?: SkinRuntime | undefined
  readonly current?: string | undefined
  readonly skins: readonly SkinRuntimeInfo[]
  readonly error?: string | undefined
}

/** Two subscriptions: optional service lifetime and the current service's state.
 * On replacement/removal the old state and listener are discarded immediately.
 */
function useSkinRuntime(bridge: SkinServiceBridge | undefined) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>({ skins: [] })
  const lifetime = useRef(0)
  const refresh = useRef(() => {})
  useEffect(() => {
    let live = true
    let runtime: SkinRuntime | undefined
    let offState: (() => void) | undefined
    let offService: (() => void) | undefined
    const read = () => {
      if (!live) return
      try { setSnapshot(runtime ? { generation: lifetime.current, runtime, current: runtime.current(), skins: runtime.list().map((skin) => ({ ...skin })) } : { generation: lifetime.current, skins: [] }) }
      catch (error) { setSnapshot({ skins: [], error: errorMessage(error) }) }
    }
    const bind = () => {
      if (!live) return
      try {
        const next = bridge?.getRuntime()
        if (next !== runtime) {
          lifetime.current += 1
          offState?.(); offState = undefined
          runtime = next
          offState = next?.subscribe(read)
        }
        read()
      } catch (error) { lifetime.current += 1; runtime = undefined; offState?.(); offState = undefined; setSnapshot({ skins: [], error: errorMessage(error) }) }
    }
    refresh.current = bind
    try { offService = bridge?.subscribe(bind); bind() }
    catch (error) { setSnapshot({ skins: [], error: errorMessage(error) }) }
    return () => { live = false; lifetime.current += 1; refresh.current = () => {}; offState?.(); offService?.() }
  }, [bridge])
  return { snapshot, lifetime, refresh }
}

export function SkinCenterEntry({ plugins, inventory, onOpen }: {
  readonly plugins: readonly CatalogPlugin[]
  readonly inventory: readonly InventoryItem[]
  readonly onOpen: () => void
}): React.JSX.Element {
  const count = new Set(plugins.filter(isSkinPlugin).map((plugin) => plugin.packageName)).size
  const installed = inventory.filter((item) => item.installed && skinCatalogForInventory(item, plugins)).length
  return <section className="eac-market__skin-entry" aria-label="皮肤中心入口">
    <div className="eac-market__skin-entry-meta"><span className="eac-market__skin-entry-mark" aria-hidden="true">SKIN</span><div><h2>皮肤中心</h2><p>{count} 款外观已收录 · {installed} 款已安装。进入后浏览、安装和切换。</p></div></div>
    <Button variant="outline" onClick={onOpen}>进入皮肤中心</Button>
  </section>
}

export function SkinCenter({ catalog, inventory, skinService, onBack, onOpen, onInstall, onToggle, onRemove, onOpenOfficialPlugins, managementBusy = false, canInstall }: SkinCenterProps): React.JSX.Element {
  const [tab, setTab] = useState<'browse' | 'installed'>('browse')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [feedback, setFeedback] = useState<ActionFeedbackState>(idleActionFeedback())
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<string>()
  const lock = useRef(false)
  const lastSwitch = useRef<string | undefined>(undefined)
  const { snapshot, lifetime, refresh } = useSkinRuntime(skinService)
  const skins = catalog.plugins.filter(isSkinPlugin)
  const installed = inventory.filter((item) => item.installed && skinCatalogForInventory(item, catalog.plugins))
  const loader = inventory.find((item) => item.installed && item.packageName === SKIN_LOADER_PACKAGE)
  const loaderPlugin = latestCompatiblePlugin(catalog, SKIN_LOADER_PACKAGE) ?? catalog.plugins.find((plugin) => plugin.packageName === SKIN_LOADER_PACKAGE)
  const loaderBlocked = loaderPlugin?.installability !== 'bundle-installable' || loaderPlugin.verification === 'hard-incompatible'
  const canSwitch = !!loader && loader.bundleEnabled && !loader.restartRequired && !!snapshot.runtime
  const matches = filterPlugins(skins, inventory, { ...EMPTY_FILTERS, query })
  const shown = browseSortPlugins(matches, 'rules')
  const matchedPackages = new Set(matches.map((plugin) => plugin.packageName))
  const installedShown = installed.filter((item) => matchedPackages.has(item.packageName))
  const currentInfo = snapshot.skins.find((skin) => skin.id === snapshot.current && skin.status === 'active')
  const currentInstalled = installed.some((item) => skinCatalogForInventory(item, catalog.plugins)?.skinId === currentInfo?.id && item.version === currentInfo?.version)
  const eligibility = JSON.stringify([canSwitch, installed.map((item) => [item.packageName, item.version, item.bundleEnabled, item.restartRequired])])
  const latestEligibility = useRef(eligibility)
  latestEligibility.current = eligibility

  useEffect(() => { lock.current = false; setBusy(false); setRetry(undefined); setNotice(''); setFeedback(idleActionFeedback()) }, [snapshot.runtime, snapshot.generation, eligibility])

  async function switchSkin(id: string): Promise<void> {
    const runtime = snapshot.runtime
    if (!runtime || !canSwitch || lock.current) return
    // Recheck at the click boundary; never trust a stale rendered button.
    try {
      if (skinService?.getRuntime() !== runtime) { setFeedback(needsRecheckActionFeedback('切换皮肤', '皮肤运行时已经变化，当前按钮状态可能过期。', '重新读取皮肤状态后再试。')); refresh.current(); return }
      if (id !== DEFAULT_SKIN_ID) {
        const item = installed.find((entry) => skinCatalogForInventory(entry, catalog.plugins)?.skinId === id)
        const plugin = item && skinCatalogForInventory(item, catalog.plugins)
        const info = runtime.list().find((entry) => entry.id === id)
        if (!item || !plugin || skinSwitchBlockReason(item, plugin, info)) { setFeedback(needsRecheckActionFeedback('切换皮肤', '皮肤状态已变化，当前目标不能直接切换。', '重新读取状态，确认皮肤仍已安装且兼容。')); refresh.current(); return }
      }
    } catch (error) { setFeedback(failedActionFeedback('切换皮肤', error, '重新读取皮肤运行时后再试。')); refresh.current(); return }
    const generation = lifetime.current
    lastSwitch.current = id
    lock.current = true; setBusy(true); setFeedback(preparingActionFeedback('切换皮肤')); setRetry(undefined)
    await Promise.resolve()
    if (generation === lifetime.current && eligibility === latestEligibility.current) setFeedback(runningActionFeedback('切换皮肤'))
    try {
      const result = await boundedRequest(runtime.switchTo(id), '切换皮肤', 20_000)
      if (generation !== lifetime.current || eligibility !== latestEligibility.current || skinService?.getRuntime() !== runtime) return
      refresh.current()
      const current = runtime.current()
      const active = id === DEFAULT_SKIN_ID || runtime.list().some((skin) => skin.id === id && skin.status === 'active')
      if (!result.ok) {
        const message = `切换未完成：${result.error}。加载器回报回退到 ${result.rolledBackTo === DEFAULT_SKIN_ID ? '默认外观' : result.rolledBackTo}。${result.warning ?? ''}`
        setNotice(message)
        setFeedback(failedActionFeedback('切换皮肤', message, '确认当前外观后，再从已安装皮肤中重新尝试。'))
      } else if (current === id && active) {
        const message = `${id === DEFAULT_SKIN_ID ? '已恢复默认外观。' : '加载器已确认使用此皮肤。'}${result.warning ?? ''}`
        setNotice(message)
        setFeedback(completedActionFeedback('切换皮肤', message, '可以继续浏览市场；再次切换前会重新核对运行时状态。'))
      } else {
        const message = `切换请求已返回，但当前状态未确认目标生效，请重新读取状态。${result.warning ?? ''}`
        setNotice(message)
        setFeedback(needsRecheckActionFeedback('切换皮肤', message, '点击“重新读取状态”，确认当前外观后再继续。'))
      }
    } catch (error) {
      if (generation === lifetime.current && eligibility === latestEligibility.current) {
        const message = `切换结果未确认：${errorMessage(error)}。请重新读取状态。`
        setNotice(message)
        setFeedback(needsRecheckActionFeedback('切换皮肤', message, '重新读取皮肤状态；结果未确认前不要重复切换。', false))
        refresh.current()
      }
    } finally {
      if (generation === lifetime.current && eligibility === latestEligibility.current) { lock.current = false; setBusy(false) }
    }
  }
  return <section className="eac-market__skin-center" aria-label="皮肤中心">
    <Button variant="ghost" onClick={onBack}>返回市场</Button>
    <header className="eac-market__page-head"><div><h1>皮肤中心</h1><p>先安装，再从已安装皮肤中选择外观。安装不会自动切换皮肤。</p></div></header>
    <section className="eac-market__settings-list" aria-label="皮肤管理器状态">
      <div className="eac-market__setting">
        <div><h2>当前外观</h2>
          <p>{!canSwitch ? '尚未确认当前外观' : snapshot.current === DEFAULT_SKIN_ID ? '默认外观' : currentInfo && currentInstalled ? `${currentInfo.name} · ${currentInfo.version} · 使用中` : `加载器当前标识：${snapshot.current ?? '未知'}；安装或激活状态待核对`}</p>
          <p>{!loader ? '皮肤管理器尚未安装。先查看管理器安装方案，完成安装与启用后再切换。' : !loader.bundleEnabled ? `皮肤管理器 ${loader.version ?? '版本未知'} 已停用，请在官方插件页启用。` : loader.restartRequired ? '皮肤管理器正在等待重启。请保存工作后重启 DSH。' : !snapshot.runtime ? `皮肤管理器 ${loader.version ?? '版本未知'} 已安装，切换服务暂不可用。请检查启用状态；也可使用 DSH 设置里的皮肤管理器。` : `皮肤管理器 ${loader.version ?? '版本未知'} · 切换服务已连接`}</p>
        </div>
        <div className="eac-market__button-row">
          {!loader && loaderPlugin && <Button variant="primary" disabled={!canInstall || loaderBlocked} onClick={() => onInstall(loaderPlugin)}>查看管理器安装方案</Button>}
          {loaderPlugin && <Button variant="ghost" onClick={() => onOpen(loaderPlugin)}>管理器说明</Button>}
          {canSwitch && <Button variant="outline" disabled={busy || snapshot.current === DEFAULT_SKIN_ID} onClick={() => void switchSkin(DEFAULT_SKIN_ID)}>恢复默认外观</Button>}
          <Button variant="outline" disabled={busy} onClick={() => refresh.current()}>重新读取状态</Button>
          {onOpenOfficialPlugins && <Button variant="ghost" onClick={onOpenOfficialPlugins}>官方插件页</Button>}
        </div>
      </div>
      {!loader && !loaderPlugin && <p className="eac-market__notice">目录尚未收录皮肤管理器，请先在官方插件页安装作者提供的管理器。</p>}
      {!loader && loaderPlugin && loaderBlocked && <p className="eac-market__notice eac-market__notice--warning">管理器暂不可安装：{verificationLabel(loaderPlugin.verification)}；{installabilityLabel(loaderPlugin.installability)}。可打开管理器说明核对原因。</p>}
      {!canInstall && <p className="eac-market__notice">当前市场未提供安装服务，可浏览介绍，暂不能安装。</p>}
      {snapshot.error && <p className="eac-market__notice eac-market__notice--warning" role="status">读取皮肤状态失败：{snapshot.error}</p>}
      {notice && <p className="eac-market__notice" role="status">{notice}</p>}
      <ActionFeedback state={feedback} onRetry={() => { const id = lastSwitch.current; if (id) void switchSkin(id) }} onRefresh={() => refresh.current()} onDismiss={() => { setFeedback(idleActionFeedback()); setNotice('') }} />
      {busy && <p role="status">正在等待皮肤管理器完成切换…</p>}
    </section>
    <div className="eac-market__toolbar">
      <div className="eac-market__filters" aria-label="皮肤列表范围">
        <Pill active={tab === 'browse'} onClick={() => setTab('browse')}>浏览皮肤</Pill>
        <Pill active={tab === 'installed'} onClick={() => setTab('installed')}>已安装皮肤（{installed.length}）</Pill>
      </div>
      <label className="eac-market__skin-search">搜索皮肤<Input id="eac-skin-search" type="search" value={query} placeholder="名称、作者或包名" onChange={(event) => setQuery(event.currentTarget.value)} /></label>
    </div>
    {tab === 'browse' ? shown.length === 0 ? <EmptyState title="没有匹配的皮肤" description="试试其他名称，或清空搜索。目录中的皮肤尚不代表已经安装。" /> : <div className="eac-market__grid">
      {shown.map((plugin) => <PluginCard key={`${plugin.id}:${plugin.version}`} plugin={plugin} inventory={inventory} onOpen={onOpen} onInstall={onInstall} canInstall={canInstall} />)}
    </div> : installedShown.length === 0 ? <EmptyState title={installed.length ? '没有匹配的已安装皮肤' : '还没有安装皮肤'} description="在「浏览皮肤」查看介绍和完整安装方案。已收录的皮肤不会自动安装。" action={<Button variant="outline" onClick={() => { setTab('browse'); setQuery('') }}>浏览皮肤</Button>} /> : <div className="eac-market__grid">
      {installedShown.map((item) => {
        const plugin = skinCatalogForInventory(item, catalog.plugins)!
        const info = snapshot.skins.find((skin) => skin.id === plugin.skinId)
        const reason = skinSwitchBlockReason(item, plugin, info)
        const active = canSwitch && !reason && info?.status === 'active' && snapshot.current === info.id
        const fault = info?.status === 'fault' || info?.status === 'suspect-residue'
        return <div key={`${item.packageName}:${item.version}`} className="eac-market__skin-installed">
          <InventoryCard item={item} catalogPlugin={plugin} updatePlugin={latestCompatiblePlugin(catalog, item.packageName)} onToggle={onToggle} onRemove={onRemove} onUpdate={(_item, update) => onInstall(update)} busy={managementBusy || busy} onOpenOfficialPlugins={onOpenOfficialPlugins} />
          <div className="eac-market__skin-controls">
            <Status tone={active ? 'success' : fault ? 'warning' : 'neutral'}>{active ? '使用中' : info?.status === 'fault' ? '激活故障' : info?.status === 'suspect-residue' ? '疑似残留，需核对' : info?.status === 'discovered' ? '已登记，未使用' : '尚未确认激活'}</Status>
            <p>{reason ?? (!canSwitch ? '切换服务不可用，请先检查皮肤管理器。' : info?.settingsHint)}</p>
            {canSwitch && <Button variant="outline" disabled={busy || managementBusy || !!reason || active} onClick={() => { if (fault) setRetry(plugin.skinId); else if (plugin.skinId) void switchSkin(plugin.skinId) }}>{active ? '正在使用' : fault ? '查看重试说明' : '使用此皮肤'}</Button>}
            {retry !== undefined && retry === plugin.skinId && <div className="eac-market__notice"><p>此皮肤发生过故障或可能留下界面改动。重试会让加载器清除隔离标记并尝试一次；失败时按加载器结果提示。</p><div className="eac-market__button-row"><Button variant="outline" onClick={() => setRetry(undefined)}>取消重试</Button><Button disabled={busy || !!reason || !canSwitch} onClick={() => { if (plugin.skinId) void switchSkin(plugin.skinId) }}>确认重试此皮肤</Button></div></div>}
          </div>
        </div>
      })}
    </div>}
  </section>
}
