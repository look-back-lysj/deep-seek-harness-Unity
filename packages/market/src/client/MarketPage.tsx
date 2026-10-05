import { useEffect, useId, useRef, useState } from 'react'
import { Button, MarkdownText, Modal, Pill, Tag } from './ui.tsx'
import type {
  CatalogPack,
  CatalogCollectionView,
  CatalogPlugin,
  CatalogMedia,
  CatalogDiscoveryCard,
  CatalogPresentation,
  CatalogSnapshot,
  CatalogRefreshView,
  DiagnosticExport,
  InventoryItem,
  TaskState,
} from '../types.ts'
import {
  EMPTY_FILTERS,
  activeTasks,
  browseSortPlugins,
  categoriesOf,
  hasCatalogUpdate,
  partitionInventory,
  type BrowseSortMode,
  filterPlugins,
  findPlugin,
  latestCompatiblePlugin,
  installabilityLabel,
  isInstalled,
  pluginActionState,
  packCoverageLabel,
  presentationForPlugin,
  recommendationMatches,
  verificationLabel,
  type MarketRemote,
  type MarketView,
  type BrowseNavigationContext,
  type NavigationSnapshot,
  type DiscoverNavigationSection,
  type PluginFilters,
  type PrimaryView,
} from './model.ts'
import {
  CatalogMediaIcon,
  EmptyState,
  InstallPlanDialog,
  InventoryCard,
  PluginCard,
  ScreenshotGallery,
  SearchField,
  Status,
  TaskDrawer,
  type PlanTarget,
} from './components.tsx'
import { MARKET_CSS } from './marketStyles.ts'
import { MEDIA_CSS } from './mediaStyles.ts'
import { ActionFeedback } from './action-feedback.tsx'
import {
  completedActionFeedback,
  failedActionFeedback,
  idleActionFeedback,
  needsRecheckActionFeedback,
  partialActionFeedback,
  preparingActionFeedback,
  runningActionFeedback,
  type ActionFeedbackState,
} from './action-state.ts'
import { useMarketData, boundedRequest } from './data-controller.ts'
import { ManagementPointerStore } from './management-pointer.ts'
import { ManagementRequest, emptyManagementView, type ManagementView } from './management-request.ts'
import { AuthorWorkspace } from './AuthorWorkspace.tsx'
import { SkinCenter, SkinCenterEntry } from './SkinCenter.tsx'
import { SettingsRemotePanel } from './SettingsRemotePanel.tsx'
import { PendingListings } from './PendingListings.tsx'
import { isSkinPlugin, skinCatalogForInventory } from './skin-model.ts'
import { SKIN_LOADER_PACKAGE, type SkinServiceBridge } from './skin-service.ts'
import { EXTENSION_SLOTS, type ExtensionContext, type ExtensionDraftChange, type ExtensionDraftRef, type ExtensionSlot, type MarketExtensionHost } from './extensions/contract.ts'

export type { MarketRemote } from './model.ts'

export interface MarketPageProps {
  readonly remote: MarketRemote
  readonly skinService?: SkinServiceBridge | undefined
  readonly onOpenOfficialPlugins?: (() => void) | undefined
  readonly homeSupplemental?: React.ReactNode
  readonly authorSupplemental?: React.ReactNode
  readonly detailSupplemental?: ((plugin: CatalogPlugin) => React.ReactNode) | undefined
  readonly extensions?: MarketExtensionHost | undefined
  /** E supplies its guarded renderer. No contribution is invoked directly here. */
  readonly renderExtensionSurface?: ((props: { host: MarketExtensionHost; slot: ExtensionSlot; context: Readonly<ExtensionContext>; pageId?: string | undefined }) => React.ReactNode) | undefined
}

const MARKDOWN_LABELS = {
  code: { copyLabel: '复制代码', copiedLabel: '已复制' },
  footnotes: '脚注',
}

const HELP_STEPS = [
  { title: '找功能', text: '用搜索或用途分类了解插件，详情页只展示目录中的真实资料。' },
  { title: '安装', text: '先核对版本调整，再由官方插件管理器执行。部分成功会逐项保留结果。' },
  { title: '开始使用', text: '按插件说明打开入口；需要设置或重启时，市场会明确提示。' },
]

function pageTab(view: MarketView): PrimaryView | undefined {
  if (view === 'all' || view === 'detail' || view === 'skins') return 'all'
  if (view === 'mine') return 'mine'
  if (view === 'discover') return 'discover'
  // 次级页和扩展页不是主导航页面，不能把“发现”误标为当前页。
  return undefined
}

export function detailTab(origin: PrimaryView | 'skins'): PrimaryView {
  // 皮肤中心沿用现有 all 语义；详情只继承真正打开它的主导航。
  return origin === 'skins' ? 'all' : origin
}

export function applyBrowseChange(change: () => void, resetPage: () => void): void {
  change()
  resetPage()
}

export function changePageInPlace(next: number, apply: (page: number) => void, scrollTo: () => void): void {
  apply(next)
  runAfterNextFrame(scrollTo)
}

export function runAfterNextFrame(callback: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(callback)
  else callback()
}

export function restoreDetailReturnFocus(
  trigger: HTMLElement | null | undefined,
  scrollContainer: HTMLElement | null | undefined,
  origin: PrimaryView | 'skins',
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): void {
  if (trigger?.isConnected !== false && typeof trigger?.focus === 'function') {
    trigger.focus()
    return
  }
  const selector = origin === 'discover' ? '.eac-market__discover-head h1' : '.eac-market__page-head h1'
  const title = doc?.querySelector<HTMLElement>(selector)
  if (title && typeof title.focus === 'function') {
    if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1')
    title.focus()
    return
  }
  scrollContainer?.focus()
}

export function packPlugins(pack: CatalogPack, catalogPlugins: readonly CatalogPlugin[]): readonly CatalogPlugin[] {
  return pack.components.flatMap((component) => {
    const plugin = catalogPlugins.find((item) => item.id === component.pluginId && item.version === component.version)
    return plugin === undefined ? [] : [plugin]
  })
}

function CountUp({ value }: { readonly value: number }): React.JSX.Element {
  const [shown, setShown] = useState(value)
  const started = useRef(false)
  const frame = useRef(0)
  useEffect(() => {
    if (started.current) { setShown(value); return }
    started.current = true
    const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof window === 'undefined' || reduced || typeof requestAnimationFrame !== 'function') { setShown(value); return }
    const target = value
    const begin = performance.now()
    setShown(0)
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - begin) / 500)
      const eased = 1 - Math.pow(1 - progress, 3)
      setShown(Math.round(target * eased))
      if (progress < 1) frame.current = requestAnimationFrame(tick)
      else { frame.current = 0; setShown(target) }
    }
    frame.current = requestAnimationFrame(tick)
    return () => { if (frame.current !== 0) cancelAnimationFrame(frame.current); frame.current = 0 }
  }, [value])
  return <span>{shown}</span>
}

export function MarketPage({ remote, skinService, onOpenOfficialPlugins, homeSupplemental, authorSupplemental, detailSupplemental, extensions, renderExtensionSurface }: MarketPageProps): React.JSX.Element {
  const { state, notice: syncNotice, controller } = useMarketData(remote)
  const [view, setView] = useState<MarketView>('discover')
  const [previousView, setPreviousView] = useState<PrimaryView | 'skins'>('discover')
  const [browseContext, setBrowseContext] = useState<BrowseNavigationContext>()
  const secondaryOrigin = useRef<NavigationSnapshot>()
  const detailOrigin = useRef<NavigationSnapshot>()
  const skinOriginSnapshot = useRef<NavigationSnapshot>()
  const extensionOrigin = useRef<NavigationSnapshot>()
  const [skinOrigin, setSkinOrigin] = useState<PrimaryView>('discover')
  const [skinVisited, setSkinVisited] = useState(false)
  const [skinInstallGuide, setSkinInstallGuide] = useState<CatalogPlugin>()
  const [detailSelection, setDetailSelection] = useState<{ readonly id: string; readonly version: string }>()
  const [filters, setFilters] = useState<PluginFilters>(EMPTY_FILTERS)
  const [advancedDraft, setAdvancedDraft] = useState<PluginFilters>(EMPTY_FILTERS)
  const [advanced, setAdvanced] = useState(false)
  const [availableOnly, setAvailableOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [taskDrawer, setTaskDrawer] = useState(false)
  const [moreMenu, setMoreMenu] = useState(false)
  const [planTarget, setPlanTarget] = useState<PlanTarget | undefined>(undefined)
  const [removeTarget, setRemoveTarget] = useState<InventoryItem | undefined>(undefined)
  const [actionFeedback, setActionFeedback] = useState<ActionFeedbackState>(idleActionFeedback())
  const [diagnostic, setDiagnostic] = useState<DiagnosticExport | undefined>(undefined)
  const [diagnosticBusy, setDiagnosticBusy] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [browseSort, setBrowseSort] = useState<BrowseSortMode>('rules')
  const [systemOpen, setSystemOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const scrollPositions = useRef(new Map<string, number>())
  const [removeStep, setRemoveStep] = useState(false)
  const [management, setManagement] = useState<ManagementView>(emptyManagementView)
  const managementRequest = useRef<ManagementRequest>()
  const managementBusy = management.busy
  const managementEnvironment = state.status === 'ready' ? state.hello.environmentId : undefined
  const [catalogBusy, setCatalogBusy] = useState(false)
  const catalogLock = useRef(false)
  const [extensionPage, setExtensionPage] = useState<string>()
  const [extensionDraft, setExtensionDraft] = useState<ExtensionDraftRef>()
  const [draftChange, setDraftChange] = useState<ExtensionDraftChange>()
  const [authorDirty, setAuthorDirty] = useState(false)
  const [authorLeaveIntent, setAuthorLeaveIntent] = useState<'return' | PrimaryView | 'help' | 'settings'>()
  const extensionLifetime = useRef(new AbortController())
  const detailReturnFocus = useRef<HTMLElement | null>(null)
  const navigationIntent = useRef(0)
  const [navigationPhase, setNavigationPhase] = useState<'idle' | 'entering'>('idle')
  const navigationTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    setNavigationPhase('entering')
    if (navigationTimer.current !== undefined) window.clearTimeout(navigationTimer.current)
    navigationTimer.current = window.setTimeout(() => setNavigationPhase('idle'), 240)
    return () => { if (navigationTimer.current !== undefined) window.clearTimeout(navigationTimer.current) }
  }, [view])

  useEffect(() => { const lifetime = new AbortController(); extensionLifetime.current = lifetime; return () => lifetime.abort() }, [remote])

  useEffect(() => {
    if (managementEnvironment === undefined) return
    let owner: ManagementRequest
    try {
      owner = new ManagementRequest(remote, managementEnvironment, new ManagementPointerStore(window.localStorage), (next) => {
        setManagement(next)
        if (next.result && next.result.status !== 'unknown' && !next.pointer && next.feedback.label === '卸载插件') setRemoveTarget(undefined)
      }, () => controller.refreshInventory())
    } catch {
      setManagement({ busy: true, checking: false, feedback: { status: 'unknown', label: '插件管理', message: '无法访问原操作指针存储，已停止新管理写入。', nextStep: '请到官方插件页核对，不会自动重新提交。', retryable: false } })
      return
    }
    managementRequest.current = owner
    owner.restore()
    return () => { owner.dispose(); if (managementRequest.current === owner) managementRequest.current = undefined }
  }, [remote, controller, managementEnvironment])

  useEffect(() => {
    if (state.status !== 'ready') return
    const plugin = findPlugin(state.catalog, detailSelection?.id, detailSelection?.version)
    if (view === 'detail' && plugin === undefined) setView(previousView)
  }, [state, detailSelection, view, previousView])

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (!(event.target instanceof Element) || !event.target.closest('.eac-market__menu-wrap')) setMoreMenu(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const selectedPlugin = state.status === 'ready' ? findPlugin(state.catalog, detailSelection?.id, detailSelection?.version) : undefined
  const activeCount = state.status === 'ready' ? activeTasks(state.tasks).length : 0
  const activeTab = view === 'detail' ? detailTab(previousView) : undefined

  function clearActionFeedback(): void {
    setActionFeedback(idleActionFeedback())
  }

  function beginAction(label: string): void {
    setActionFeedback(preparingActionFeedback(label))
  }

  async function markActionRunning(label: string): Promise<void> {
    await Promise.resolve()
    setActionFeedback(runningActionFeedback(label))
  }
  function navigationSnapshot(source: NavigationSnapshot['source'], targetView: MarketView = view): NavigationSnapshot {
    return { view: targetView, source, filters, availableOnly, sort: browseSort, page, scrollTop: scrollRef.current?.scrollTop ?? 0 }
  }

  function restoreNavigation(snapshot: NavigationSnapshot): void {
    setView(snapshot.view)
    if (snapshot.view === 'discover' || snapshot.view === 'all' || snapshot.view === 'mine') setPreviousView(snapshot.view)
    else if (snapshot.view === 'skins') setPreviousView(skinOrigin)
    setFilters(snapshot.filters)
    setAvailableOnly(snapshot.availableOnly)
    setBrowseSort(snapshot.sort)
    setPage(snapshot.page)
    setBrowseContext(snapshot.source === 'discover' ? { source: 'discover', ...(snapshot.filters.category === 'all' ? {} : { category: snapshot.filters.category }), page: snapshot.page, scrollTop: snapshot.scrollTop } : undefined)
    runAfterNextFrame(() => scrollRef.current?.scrollTo({ top: snapshot.scrollTop }))
  }

  function changePage(next: number): void {
    setPage(next)
    runAfterNextFrame(() => {
      const scroller = scrollRef.current
      const meta = document.querySelector('.eac-market__directory-meta')
      if (scroller === null || meta === null) return
      const delta = meta.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: 'instant' as ScrollBehavior })
    })
  }

  function completeReturnFromSecondary(): void {
    const snapshot = secondaryOrigin.current
    secondaryOrigin.current = undefined
    if (snapshot) restoreNavigation(snapshot)
    else restoreNavigation({ view: 'discover', source: 'secondary', filters: EMPTY_FILTERS, availableOnly, sort: browseSort, page: 1, scrollTop: 0 })
  }

  function returnFromSecondary(): void {
    if (view === 'author' && authorDirty) { setAuthorLeaveIntent('return'); return }
    completeReturnFromSecondary()
  }
  function performNavigate(next: PrimaryView): void {
    const intent = ++navigationIntent.current
    const currentView = pageTab(view)
    const currentScrollTop = scrollRef.current?.scrollTop ?? 0
    if (currentView !== undefined) {
      scrollPositions.current.set(`${currentView}:${filters.category}:${filters.query}:${page}`, currentScrollTop)
    }
    secondaryOrigin.current = undefined
    extensionOrigin.current = undefined
    setView(next)
    setPreviousView(next)
    setPage(1)
    clearActionFeedback()
    if (next === 'all' && currentView !== 'all') setFilters(EMPTY_FILTERS)
    setBrowseContext(next === 'all' ? { source: 'top-nav', page: 1, scrollTop: 0 } : undefined)
    runAfterNextFrame(() => scrollRef.current?.scrollTo({ top: 0 }))
    runAfterNextFrame(() => {
      if (intent !== navigationIntent.current) return
      if (next === 'all' && typeof document !== 'undefined') document.getElementById('eac-market-search')?.focus()
    })
    if (next === 'mine') void controller.sync(true)
  }

  function navigate(next: PrimaryView): void {
    if (view === 'author' && authorDirty) { setAuthorLeaveIntent(next); return }
    performNavigate(next)
  }

  function navigateSecondary(next: 'help' | 'settings' | 'author'): void {
    if ((next === 'help' || next === 'settings') && view === 'author' && authorDirty) { setAuthorLeaveIntent(next); return }
    secondaryOrigin.current = navigationSnapshot('secondary')
    setMoreMenu(false)
    setView(next)
  }

  function confirmAuthorLeave(): void {
    const intent = authorLeaveIntent
    setAuthorLeaveIntent(undefined)
    if (intent === 'return') completeReturnFromSecondary()
    else if (intent === 'help' || intent === 'settings') {
      secondaryOrigin.current = navigationSnapshot('secondary')
      setMoreMenu(false)
      setView(intent)
    } else if (intent !== undefined) performNavigate(intent)
  }

  function openDetail(plugin: CatalogPlugin): void {
    if (state.status !== 'ready') return
    const active = typeof document === 'undefined' ? undefined : document.activeElement
    detailOrigin.current = navigationSnapshot('detail')
    detailReturnFocus.current = active instanceof HTMLElement ? active : null
    const from = view === 'skins' ? 'skins' : pageTab(view) ?? 'discover'
    scrollPositions.current.set(`${from}:${filters.category}:${filters.query}:${page}`, scrollRef.current?.scrollTop ?? 0)
    setPreviousView(from)
    setDetailSelection({ id: plugin.id, version: plugin.version })
    setView('detail')
  }

  function browse(category?: string, section: DiscoverNavigationSection = 'rules'): void {
    const intent = ++navigationIntent.current
    const scrollTop = scrollRef.current?.scrollTop ?? 0
    const normalizedCategory = category === undefined || category === 'all' ? undefined : category
    scrollPositions.current.set(`discover:${filters.category}:${filters.query}:${page}`, scrollTop)
    setFilters((current) => ({ ...current, category: normalizedCategory ?? 'all' }))
    setPage(1)
    setBrowseContext({
      source: 'discover',
      ...(normalizedCategory === undefined ? {} : { category: normalizedCategory }),
      section,
      ...(filters.query.trim() === '' ? {} : { query: filters.query }),
      page: 1,
      scrollTop,
    })
    setView('all')
    setPreviousView('all')
    clearActionFeedback()
    runAfterNextFrame(() => {
      if (intent !== navigationIntent.current) return
      scrollRef.current?.scrollTo({ top: 0 })
      if (typeof document !== 'undefined') document.getElementById('eac-market-search')?.focus()
    })
  }

  function backFromDetail(): void {
    const snapshot = detailOrigin.current
    detailOrigin.current = undefined
    const returnFocus = detailReturnFocus.current
    detailReturnFocus.current = null
    if (snapshot) {
      restoreNavigation(snapshot)
      runAfterNextFrame(() => restoreDetailReturnFocus(returnFocus, scrollRef.current, pageTab(snapshot.view) ?? (snapshot.view === 'skins' ? 'skins' : previousView)))
    } else {
      setView(previousView)
      runAfterNextFrame(() => restoreDetailReturnFocus(returnFocus, scrollRef.current, previousView))
    }
  }

  function openPlanForPlugin(plugin: CatalogPlugin): void {
    if (isSkinPlugin(plugin) && state.status === 'ready' && !state.inventory.items.some((item) => item.installed && item.packageName === SKIN_LOADER_PACKAGE)) {
      setSkinInstallGuide(plugin)
      return
    }
    setPlanTarget({ plugin, plugins: [plugin] })
    clearActionFeedback()
  }

  function openPlanForPack(pack: CatalogPack): void {
    if (state.status !== 'ready') return
    const plugins = packPlugins(pack, state.catalog.plugins)
    setPlanTarget({ pack, plugins })
    clearActionFeedback()
  }

  function openPlanForCollection(collection: CatalogCollectionView): void {
    if (state.status !== 'ready') return
    const plugins = collection.components.flatMap((component) => {
      const plugin = state.catalog.plugins.find((item) => item.id === component.pluginId && item.version === component.version && item.artifactDigest === component.artifactDigest)
      return plugin === undefined ? [] : [plugin]
    })
    setPlanTarget({ collection, plugins })
    clearActionFeedback()
  }

  function updateTask(task: TaskState, reveal = true): void {
    controller.acceptTask(task)
    if (reveal) setTaskDrawer(true)
  }

  function clearBrowseFilters(): void {
    setFilters(EMPTY_FILTERS)
    setAdvancedDraft(EMPTY_FILTERS)
    setAvailableOnly(false)
    setBrowseSort('rules')
    setAdvanced(false)
    setBrowseContext(undefined)
    setPage(1)
  }

  function browseFilterSummary(): string[] {
    const summary: string[] = []
    if (filters.query.trim() !== '') summary.push('搜索：' + filters.query.trim())
    if (filters.category !== 'all') summary.push('用途：' + filters.category)
    if (filters.verification !== 'all') summary.push('验证：' + verificationLabel(filters.verification))
    if (filters.installed !== 'all') summary.push(filters.installed === 'yes' ? '已安装' : '未安装')
    if (availableOnly) summary.push('仅可安装')
    return summary
  }

  function toggleAdvanced(): void {
    setAdvanced((current) => {
      const next = !current
      if (next) setAdvancedDraft(filters)
      return next
    })
  }

  function applyAdvancedFilters(): void {
    setFilters(advancedDraft)
    setPage(1)
    setAdvanced(false)
    clearActionFeedback()
  }

  async function refreshCatalog(sourceId?: string): Promise<CatalogRefreshView | undefined> {
    if (catalogLock.current || remote.refreshCatalog === undefined) return undefined
    catalogLock.current = true
    setCatalogBusy(true); beginAction('目录刷新')
    await markActionRunning('目录刷新')
    try {
      const result = await controller.refreshCatalog(sourceId === undefined ? undefined : { sourceId })
      if (result.status === 'refreshed') setActionFeedback(completedActionFeedback('目录刷新', '目录已刷新。插件不会自动安装或更新。', '可以继续浏览；安装和更新仍需单独确认。'))
      else setActionFeedback(partialActionFeedback('目录刷新', '目录刷新失败，仍保留上次可用目录。为避免泄露本机路径或来源凭据，详细错误不直接显示。', '确认宿主预先配置的来源或网络可用后，可手动重试。'))
      return result
    } catch (error) {
      setActionFeedback(failedActionFeedback('目录刷新', new Error('目录刷新请求未能完成；后台结果尚未确认。'), '先重新读取来源状态；确认宿主连接后再决定是否手动重试。'))
      return undefined
    } finally { catalogLock.current = false; setCatalogBusy(false) }
  }

  async function toggleInventory(item: InventoryItem, enabled: boolean): Promise<void> {
    if (item.packageName === '@dsh-eac/market') { onOpenOfficialPlugins?.(); return }
    await managementRequest.current?.submit(item, enabled ? 'enable' : 'disable')
  }

  async function recheckAction(): Promise<void> {
    if (actionFeedback.label === '目录刷新') {
      try { await controller.recheckCatalog() }
      catch { setActionFeedback(needsRecheckActionFeedback('目录刷新', '当前目录状态未能读取；不会重发刷新请求。', '确认宿主连接后，再重新核对。', false)) }
    }
    await controller.sync(true)
  }

  async function removeInventory(item: InventoryItem): Promise<void> {
    if (!removeStep) return
    if (item.packageName === '@dsh-eac/market') { onOpenOfficialPlugins?.(); return }
    await managementRequest.current?.submit(item, 'remove')
  }

  async function exportDiagnostic(): Promise<void> {
    if (diagnosticBusy) return
    setDiagnosticBusy(true)
    beginAction('生成诊断')
    await markActionRunning('生成诊断')
    try {
      if (remote.exportDiagnostic === undefined) throw new Error('当前 DSH 运行时未开放诊断导出能力')
      setDiagnostic(await boundedRequest(remote.exportDiagnostic(), '生成诊断'))
      setActionFeedback(completedActionFeedback('生成诊断', '诊断已生成，可以复制摘要交给维护者。', '诊断内容只用于排查，不会自动修改插件。'))
    } catch (error) {
      setActionFeedback(failedActionFeedback('生成诊断', error, '确认宿主仍在运行后重新导出诊断。'))
    } finally { setDiagnosticBusy(false) }
  }

  if (state.status === 'loading') {
    return (
      <MarketFrame
        view={view}
        activeCount={0}
        onNavigate={navigate}
        onTasks={() => setTaskDrawer(true)}
        onMore={() => setMoreMenu((value) => !value)}
        moreMenu={moreMenu}
        onSecondary={navigateSecondary}
        activeTab={activeTab}
      >
        <div className="eac-market__loading" aria-busy="true" aria-live="polite">
          <p>正在读取市场目录和当前插件状态…</p>
          <div className="eac-market__skeleton" /><div className="eac-market__skeleton" /><div className="eac-market__skeleton" />
        </div>
      </MarketFrame>
    )
  }

  if (state.status === 'error') {
    return (
      <MarketFrame
        view={view}
        activeCount={0}
        onNavigate={navigate}
        onTasks={() => setTaskDrawer(true)}
        onMore={() => setMoreMenu((value) => !value)}
        moreMenu={moreMenu}
        onSecondary={navigateSecondary}
        activeTab={activeTab}
      >
        <section className="eac-market__error" role="alert">
          <h2>市场暂时无法读取状态</h2>
          <p>{state.message}</p>
          <Button variant="primary" onClick={() => void controller.start()}>重新读取</Button>
        </section>
      </MarketFrame>
    )
  }

  const functionalPlugins = state.catalog.plugins.filter((plugin) => !isSkinPlugin(plugin))
  const marketPlugins = functionalPlugins.filter((plugin) => plugin.packageName !== SKIN_LOADER_PACKAGE)
  const browseable = availableOnly ? marketPlugins.filter(plugin => plugin.installability === 'bundle-installable' && plugin.verification !== 'hard-incompatible') : marketPlugins
  const filtered = browseSortPlugins(filterPlugins(browseable, state.inventory.items, filters), browseSort, state.catalog.recommendations)
  const inventoryPartition = partitionInventory(state.inventory.items.filter((item) => !item.installed || !skinCatalogForInventory(item, state.catalog.plugins)), state.catalog.plugins)
  const loaderPlugin = latestCompatiblePlugin(state.catalog, SKIN_LOADER_PACKAGE) ?? functionalPlugins.find((plugin) => plugin.packageName === SKIN_LOADER_PACKAGE)
  const openSkins = () => {
    const from = pageTab(view) ?? 'discover'
    skinOriginSnapshot.current = navigationSnapshot('skins', from)
    setSkinOrigin(from); setSkinVisited(true); setView('skins')
    window.requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }))
  }
  const hasSkinContent = state.catalog.plugins.some(isSkinPlugin) || state.inventory.items.some((item) => item.installed && skinCatalogForInventory(item, state.catalog.plugins) !== undefined)
  const skinEntry = hasSkinContent ? <SkinCenterEntry plugins={state.catalog.plugins} inventory={state.inventory.items} onOpen={openSkins} /> : null
  const perPage = 24
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage))
  const visible = filtered.slice((page - 1) * perPage, page * perPage)
  const extensionContext: Readonly<ExtensionContext> = {
    marketVersion: state.hello.marketVersion, dshVersion: state.hello.hostVersion, environmentId: state.hello.environmentId,
    capabilities: ['browse', 'open-own-page', 'request-install-review', 'preview-draft-change'], signal: extensionLifetime.current.signal,
    plugin: selectedPlugin === undefined ? undefined : { id: selectedPlugin.id, name: selectedPlugin.name, packageName: selectedPlugin.packageName, version: selectedPlugin.version, artifactDigest: selectedPlugin.artifactDigest },
    draft: extensionDraft === undefined ? undefined : { ...extensionDraft },
    openDetail(id) { const plugin = findPlugin(state.catalog, id); if (plugin) openDetail(plugin) },
    openOwnPage(id) { extensionOrigin.current = navigationSnapshot('extension'); setExtensionPage(id); setView('extension'); setMoreMenu(false) },
    requestInstallReview(request) {
      const plugin = state.catalog.plugins.find((item) => item.id === request.pluginId && item.version === request.version && item.artifactDigest === request.artifactDigest)
      if (plugin) openPlanForPlugin(plugin)
      else setActionFeedback(needsRecheckActionFeedback('扩展安装请求', '扩展引用的插件版本已变化。', '打开全部插件，重新选择当前目录中的版本。'))
    },
    previewDraftChange(change) { secondaryOrigin.current = navigationSnapshot('extension'); setDraftChange({ ...change }); setView('author') },
  }
  const surface = (slot: ExtensionSlot): React.ReactNode => extensions && renderExtensionSurface ? renderExtensionSurface({ host: extensions, slot, context: extensionContext, pageId: extensionPage }) : null

  return (
    <div className="eac-market-host">
      <MarketFrame
        view={view}
        activeCount={activeCount}
        onNavigate={navigate}
        onTasks={() => setTaskDrawer(true)}
        onMore={() => setMoreMenu((value) => !value)}
        moreMenu={moreMenu}
        activeTab={activeTab}
        scrollRef={scrollRef}
        onSecondary={navigateSecondary}
        moreSupplemental={surface(EXTENSION_SLOTS.more)}
        transitionPhase={navigationPhase}
      >
        {syncNotice && <div className="eac-market__notice eac-market__notice--warning" role="status">{syncNotice} <Button variant="outline" onClick={() => void controller.sync(true)}>重新读取</Button></div>}
        <ActionFeedback state={actionFeedback} onRefresh={() => void recheckAction()} onDismiss={clearActionFeedback} />
        <ActionFeedback state={management.feedback}
          onRefresh={management.pointer ? () => void managementRequest.current?.recheck() : undefined}
          refreshLabel={management.checking ? '正在核对原操作…' : '核对原操作'} refreshDisabled={management.checking}>
          {management.identity && <p>原目标：{management.identity.packageName} · {management.identity.expectedVersion ?? '未指定版本'} · 环境：{management.identity.environmentId} · 动作：{management.identity.action}</p>}
          {management.stage && <p>官方管理阶段：{management.stage}（不是完整业务完成证明）。</p>}
          {management.receipt && <p>官方回执：{management.receipt.status}；已发生变更：{management.receipt.changed ? '是' : '否'}；权限变化：{management.receipt.permissionChanges.length} 项。此回执不等于完整业务结果。</p>}
          {management.result && <div><p>原业务结果：{management.result.status}；已发生变更：{management.result.changed ? '是' : '否'}；权限变化：{management.result.permissionChanges.length} 项。</p>
            {management.result.permissionChanges.map((change, index) => <p key={index}>{change.packageName}：{change.decision}</p>)}
          </div>}
          {management.feedback.status === 'unknown' && onOpenOfficialPlugins && <Button variant="outline" onClick={onOpenOfficialPlugins}>到官方插件页核对</Button>}
        </ActionFeedback>

        {view === 'discover' && (
          <DiscoverView
            catalog={state.catalog}
            inventory={state.inventory.items}
            onOpen={openDetail}
            onInstall={openPlanForPlugin}
            onPack={openPlanForPack}
            onCollection={openPlanForCollection}
            onBrowse={browse}
            onHelp={() => navigateSecondary('help')}
            onSettings={() => navigateSecondary('settings')}
            onManage={() => navigate('mine')}
            skinEntry={skinEntry}
            supplemental={<>{homeSupplemental}{surface(EXTENSION_SLOTS.home)}</>}
          />
        )}

        {view === 'all' && (
          <>
            <header className="eac-market__page-head">
              <div><h1>全部插件</h1><p>内核目录中的全部插件都在这里。你可以按用途、安装状态和验证状态整理浏览。</p></div>
              <Button variant="outline" onClick={toggleAdvanced} aria-expanded={advanced}>高级筛选</Button>
            </header>
            {browseContext?.source === 'discover' && (
              <div className="eac-market__notice" role="status" data-navigation-source="discover">
                来自发现页{browseContext.category === undefined ? '' : ` · ${browseContext.category}`}
                <Button variant="ghost" size="sm" onClick={() => { setBrowseContext({ source: 'top-nav', page: 1, scrollTop: 0 }); setFilters((current) => ({ ...current, category: 'all' })); setPage(1) }}>清除来源筛选</Button>
              </div>
            )}
            <div className="eac-market__directory-meta" aria-live="polite"><span aria-hidden="true"><CountUp value={filtered.length} /> 个插件符合当前条件</span><span className="eac-market__sr-only">{filtered.length} 个插件符合当前条件</span><span className="eac-market__directory-hint">默认展示全部记录</span></div>
            {browseFilterSummary().length > 0 && <div className="eac-market__filter-summary" role="status"><span>当前筛选：{browseFilterSummary().join(' · ')}</span><Button size="sm" variant="ghost" onClick={clearBrowseFilters}>清除全部筛选</Button></div>}
            <div className="eac-market__filters" aria-label="安装包范围">
              <Pill active={availableOnly} onClick={() => applyBrowseChange(() => setAvailableOnly(true), () => setPage(1))}>可安装</Pill>
              <Pill active={!availableOnly} onClick={() => applyBrowseChange(() => setAvailableOnly(false), () => setPage(1))}>全部记录</Pill>
            </div>
            <div className="eac-market__toolbar">
              <SearchField value={filters.query} onChange={(query) => applyBrowseChange(() => setFilters((current) => ({ ...current, query })), () => setPage(1))} />
              <div className="eac-market__filters">
                <label className="eac-market__sr-only" htmlFor="eac-category">用途分类</label>
                <select id="eac-category" value={filters.category} onChange={(event) => applyBrowseChange(() => setFilters({ ...filters, category: event.currentTarget.value }), () => setPage(1))}>
                  <option value="all">全部用途</option>
                  {categoriesOf(marketPlugins).map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
                <label className="eac-market__sr-only" htmlFor="eac-sort">排序</label>
                <select id="eac-sort" value={browseSort} onChange={(event) => applyBrowseChange(() => setBrowseSort(event.currentTarget.value as BrowseSortMode), () => setPage(1))}>
                  <option value="rules">规则排序（默认）</option>
                  <option value="compatibility">兼容性优先</option>
                  <option value="recommended">团队精选优先（由我选择）</option>
                </select>
              </div>
            </div>
            {advanced && (
              <div className="eac-market__advanced" aria-label="高级筛选">
                <label>验证状态
                  <select id="eac-verification" value={advancedDraft.verification} onChange={(event) => setAdvancedDraft((current) => ({ ...current, verification: event.currentTarget.value as PluginFilters['verification'] }))}>
                    <option value="all">全部</option><option value="verified">已验证</option><option value="unverified">未验证</option>
                    <option value="hard-incompatible">已知不兼容</option><option value="unknown">状态未知</option>
                  </select>
                </label>
                <label>安装状态
                  <select id="eac-installation" value={advancedDraft.installed} onChange={(event) => setAdvancedDraft((current) => ({ ...current, installed: event.currentTarget.value as PluginFilters['installed'] }))}>
                    <option value="all">全部</option><option value="yes">已安装</option><option value="no">未安装</option>
                  </select>
                </label>
                <div className="eac-market__advanced-actions">
                  <Button variant="primary" onClick={applyAdvancedFilters}>应用筛选</Button>
                  <Button variant="outline" onClick={() => setAdvanced(false)}>取消</Button>
                  <Button variant="ghost" onClick={clearBrowseFilters}>清除全部</Button>
                </div>
              </div>
            )}
            {visible.length === 0 ? (
              <EmptyState
                title="没有匹配的插件"
                description="目录里没有满足当前搜索和筛选条件的项目。可以清除筛选，或查看全部插件。"
                action={<Button variant="outline" onClick={clearBrowseFilters}>清除全部筛选</Button>}
              />
            ) : (
              <div className="eac-market__grid eac-market__directory-grid">
                {visible.map((plugin) => <PluginCard key={plugin.id + ":" + plugin.version} plugin={plugin} inventory={state.inventory.items} onOpen={openDetail} onInstall={openPlanForPlugin} onManage={() => navigate('mine')} />)}
              </div>
            )}
            {pageCount > 1 && (
              <nav className="eac-market__pagination" aria-label="插件分页">
                <Button variant="outline" disabled={page <= 1} onClick={() => changePage(page - 1)}>上一页</Button>
                <span>第 {page} / {pageCount} 页</span>
                <Button variant="outline" disabled={page >= pageCount} onClick={() => changePage(page + 1)}>下一页</Button>
              </nav>
            )}
            {!availableOnly && <PendingListings listings={state.catalog.listings ?? []} query={filters.query} />}
          </>
        )}

        {view === 'mine' && (
          <>
            <header className="eac-market__page-head">
              <div><h1>我的插件</h1><p>这里只显示官方插件管理器返回的真实安装和启停状态。</p></div>
              {onOpenOfficialPlugins && <div className="eac-market__button-row"><Button variant="outline" onClick={onOpenOfficialPlugins}>打开官方插件页</Button></div>}
            </header>
            {skinEntry}
            {state.inventory.unknownItems.length > 0 && (
              <div className="eac-market__notice eac-market__notice--warning">
                <details><summary>有 {state.inventory.unknownItems.length} 个条目待核对</summary>{state.inventory.unknownItems.join('、')}</details>
              </div>
            )}
            {state.inventory.items.length === 0 ? (
              <EmptyState title="尚未识别到已安装插件" description="你可以先浏览全部插件。安装后，状态会由官方插件管理器同步到这里。" action={<Button variant="primary" onClick={() => navigate('all')}>查看全部插件</Button>} />
            ) : (
              <>
                <div className="eac-market__grid">
                  {inventoryPartition.userItems.map((item) => (
                    <InventoryCard
                      key={item.packageName + ":" + (item.version ?? "unknown")}
                      item={item}
                      catalogPlugin={state.catalog.plugins.find((plugin) => plugin.packageName === item.packageName && plugin.version === item.version)}
                      updatePlugin={latestCompatiblePlugin(state.catalog, item.packageName)}
                      onToggle={(target, enabled) => void toggleInventory(target, enabled)}
                      onRemove={(item) => { setRemoveStep(false); setRemoveTarget(item) }}
                      busy={managementBusy}
                      onUpdate={(_target, plugin) => openPlanForPlugin(plugin)}
                    />
                  ))}
                </div>
                {inventoryPartition.systemItems.length > 0 && (
                <details className="eac-market__system-group" open={systemOpen} onToggle={(event) => setSystemOpen(event.currentTarget.open)}>
                  <summary>
                    <span>官方与系统组件（{inventoryPartition.systemItems.length}）</span>
                    {inventoryPartition.systemNeedsAttention && <span className="eac-market__group-warning">{inventoryPartition.systemAttentionCount} 项待核对或重启</span>}
                    <span className="eac-market__group-action">{systemOpen ? '收起' : '展开'}</span>
                  </summary>
                  <p className="eac-market__system-note">DSH 自带功能与内部组件。展开查看版本和运行状态；受保护的项目请在官方插件页管理。</p>
                  <div className="eac-market__grid">
                    {systemOpen && inventoryPartition.systemItems.map((item) => (
                      <InventoryCard
                        key={`system-${item.packageName}:${item.version ?? "unknown"}`}
                        item={item}
                        catalogPlugin={state.catalog.plugins.find((plugin) => plugin.packageName === item.packageName && plugin.version === item.version)}
                      updatePlugin={latestCompatiblePlugin(state.catalog, item.packageName)}
                        onToggle={(target, enabled) => void toggleInventory(target, enabled)}
                        onRemove={(item) => { setRemoveStep(false); setRemoveTarget(item) }}
                      busy={managementBusy}
                        onUpdate={(_target, plugin) => openPlanForPlugin(plugin)}
                      />
                    ))}
                  </div>
                </details>
                )}
              </>
            )}
            {state.inventory.items.some((item) => item.restartRequired) && (
              <div className="eac-market__notice eac-market__notice--warning" data-sticker="RESTART" style={{ marginTop: 18 }}>
                有插件在等待重启。新版本已保存，下次启动 DSH 才会使用。
              </div>
            )}
          </>
        )}

        {skinVisited && <div hidden={view !== 'skins'}><SkinCenter
          catalog={state.catalog} inventory={state.inventory.items} skinService={skinService}
          onBack={() => { const snapshot = skinOriginSnapshot.current; skinOriginSnapshot.current = undefined; if (snapshot) restoreNavigation(snapshot); else setView(skinOrigin) }}
          onOpen={openDetail} onInstall={openPlanForPlugin}
          onToggle={(item, enabled) => void toggleInventory(item, enabled)}
          onRemove={(item) => { setRemoveStep(false); setRemoveTarget(item) }}
          onOpenOfficialPlugins={onOpenOfficialPlugins} managementBusy={managementBusy}
          canInstall={remote.createPlan !== undefined && remote.startTask !== undefined}
        /></div>}

        {view === 'detail' && selectedPlugin !== undefined && (
          <DetailView
            key={selectedPlugin.id + ":" + selectedPlugin.version}
            plugin={selectedPlugin}
            updatePlugin={latestCompatiblePlugin(state.catalog, selectedPlugin.packageName)}
            presentation={presentationForPlugin(state.catalog, selectedPlugin)}
            inventory={state.inventory.items}
            onBack={backFromDetail}
            backLabel={previousView === 'skins' ? '返回皮肤中心' : undefined}
            onInstall={openPlanForPlugin}
            onUpdate={openPlanForPlugin}
            canInstall={remote.createPlan !== undefined && remote.startTask !== undefined}
            onOpenOfficialPlugins={onOpenOfficialPlugins}
            supplemental={<>{detailSupplemental?.(selectedPlugin)}{surface(EXTENSION_SLOTS.detail)}</>}

          />
        )}

        {view === 'help' && (
          <>
            <Button variant="outline" onClick={returnFromSecondary}>返回市场</Button>
            <header className="eac-market__page-head"><div><h1>上手帮助</h1><p>第一次使用只需要三步。安装不是教程完成条件。</p></div></header>
            <div className="eac-market__help-steps">
              {HELP_STEPS.map((step, index) => (
                <section className="eac-market__help-step" key={step.title}>
                  <span className="eac-market__chapter-index eac-market__step-mark" aria-hidden="true">0{index + 1}</span><h3>{step.title}</h3><p>{step.text}</p>
                </section>
              ))}
            </div>
            <section className="eac-market__section">
              <div className="eac-market__section-head"><h2>常见问题</h2></div>
              <div className="eac-market__grid grid--two eac-market__grid--two eac-market__faq">
                <article className="eac-market__card"><h3>为什么会显示“需要重启”？</h3><p>新版本或启停状态已保存，但 DSH 仍使用旧实例。重启后才会使用新状态。</p></article>
                <article className="eac-market__card"><h3>为什么不能安装？</h3><p>硬性不兼容、缺少官方 bundle 或缺少制品都不能绕过。详情会给出真实原因。</p></article>
                <article className="eac-market__card"><h3>套餐部分失败怎么办？</h3><p>成功项会保留，受依赖影响的项目暂停。任务抽屉会逐项展示，不把整套假报为成功。</p></article>
                <article className="eac-market__card"><h3>会要求 GitHub 登录吗？</h3><p>不会。MVP 不提供 GitHub 登录、Star 或在线投稿。</p></article>
              </div>
            </section>
          </>
        )}

        {view === 'settings' && (
          <>
            <Button variant="outline" onClick={returnFromSecondary}>返回市场</Button>
            <header className="eac-market__page-head"><div><h1>设置</h1><p>查看目录、外观和诊断信息。</p></div></header>
            <div className="eac-market__settings-list">
              <h2 className="eac-market__chapter-head"><span className="eac-market__chapter-index" aria-hidden="true">01</span>目录与来源</h2>
              <section className="eac-market__setting">
                <div><h3>目录状态</h3><p>目录来源：{{ embedded: '随包目录', online: '在线目录', cache: '本地缓存' }[state.catalog.origin]}{state.catalog.stale ? '（缓存已过期）' : ''} · 目录生成时间：{new Date(state.catalog.generatedAt).toLocaleString('zh-CN')}。刷新目录不会安装或更新插件。</p></div>
                <Button variant="outline" disabled={catalogBusy || remote.refreshCatalog === undefined} onClick={() => void refreshCatalog()}>刷新目录</Button>
              </section>
              <h2 className="eac-market__chapter-head"><span className="eac-market__chapter-index" aria-hidden="true">02</span>检查与运行</h2>
              <SettingsRemotePanel
                remote={remote}
                capabilities={state.hello.capabilities}
                environmentId={state.hello.environmentId}
                refreshBusy={catalogBusy}
                onRefreshSource={(sourceId) => refreshCatalog(sourceId)}
              />
              <h2 className="eac-market__chapter-head"><span className="eac-market__chapter-index" aria-hidden="true">03</span>外观与诊断</h2>
              <section className="eac-market__setting">
                <div><h3>缓存清理</h3><p>当前版本暂不提供缓存清理。</p></div>
                <Button variant="outline" disabled title="当前 DSH 运行时未提供缓存清理能力">暂不可用</Button>
              </section>
              <section className="eac-market__setting">
                <div><h3>外观</h3><p>完全遵循 DSH 宿主的浅色/深色主题与减少动态效果设置。</p></div>
                <Status tone="success">遵循宿主</Status>
              </section>
              <section className="eac-market__setting">
                <div><h3>轻教学</h3><p>“找功能 → 安装 → 开始使用”，可随时重看。</p></div>
                <Button variant="outline" onClick={() => setTutorialOpen(true)}>重看教程</Button>
              </section>
              <section className="eac-market__setting">
                <div><h3>诊断信息</h3><p>导出只包含环境摘要、目录修订和任务摘要，不包含密钥、绝对路径或会话内容。</p></div>
                <Button variant="outline" disabled={diagnosticBusy || remote.exportDiagnostic === undefined} onClick={() => void exportDiagnostic()}>{diagnosticBusy ? '正在生成…' : '导出诊断'}</Button>
              </section>
            </div>
            {diagnostic !== undefined && (
              <div className="eac-market__notice" role="status">
                诊断已生成（{diagnostic.generatedAt}）：<br />{diagnostic.summaries.join('；')}
              </div>
            )}
          </>
        )}

        {view === 'extension' && <section><Button variant="outline" onClick={() => { const snapshot = extensionOrigin.current; extensionOrigin.current = undefined; if (snapshot) restoreNavigation(snapshot); else navigate('discover') }}>返回上一页</Button>{surface(EXTENSION_SLOTS.page)}</section>}
        <div hidden={view !== 'author'}><Button variant="outline" onClick={returnFromSecondary}>返回市场</Button><AuthorWorkspace remote={remote} visible={view === 'author'} onDraftSnapshot={setExtensionDraft} onDirtyChange={setAuthorDirty} draftChange={draftChange} supplemental={<>{authorSupplemental}{surface(EXTENSION_SLOTS.author)}</>} /></div>

        <p className="eac-market__footer-note">EAC 是社区整合市场，不代表 DeepSeek 官方认证。</p>
      </MarketFrame>

      <TaskDrawer
        open={taskDrawer}
        tasks={state.status === 'ready' ? state.tasks : []}
        onClose={() => setTaskDrawer(false)}
        remote={remote}
        onChanged={(task) => updateTask(task, false)}
        onRefresh={() => void controller.sync(true)}
        onOpenOfficialPlugins={onOpenOfficialPlugins}
      />
      <InstallPlanDialog
        target={planTarget}
        onOpenOfficialPlugins={onOpenOfficialPlugins}
        inventoryIssues={state.inventory.unknownItems}
        inventory={state.inventory.items}
        remote={remote}
        open={planTarget !== undefined}
        onClose={() => setPlanTarget(undefined)}
        onStarted={updateTask}
      />
      <Modal open={skinInstallGuide !== undefined} onClose={() => setSkinInstallGuide(undefined)} title="安装皮肤前，先准备管理器" closeLabel="关闭皮肤安装引导">
        <p>尚未安装皮肤管理器。{skinInstallGuide?.name} 安装后需要管理器登记并由你选择，才会改变界面。</p>
        <p>下一步只打开完整安装方案；确认前不会安装，也不会自动添加其他包。</p>
        {!loaderPlugin && <p>当前目录缺少皮肤管理器，请在官方插件页安装作者提供的管理器。</p>}
        <div className="eac-market__button-row">
          {loaderPlugin && <Button variant="primary" onClick={() => { setSkinInstallGuide(undefined); openPlanForPlugin(loaderPlugin) }}>先查看管理器安装方案</Button>}
          <Button variant="outline" onClick={() => { if (skinInstallGuide) setPlanTarget({ plugin: skinInstallGuide, plugins: [skinInstallGuide] }); setSkinInstallGuide(undefined) }}>仅查看此皮肤安装方案</Button>
          <Button variant="ghost" onClick={() => setSkinInstallGuide(undefined)}>取消</Button>
        </div>
      </Modal>
      <Modal open={removeTarget !== undefined} onClose={() => setRemoveTarget(undefined)} title={removeStep ? '再次确认卸载影响' : '确认卸载'} closeLabel="关闭卸载确认">
        <p>将卸载 <strong>{removeTarget?.packageName}</strong>。只调用必要卸载能力，不额外清理独立配置、用户文件或未知目录。</p>
        {removeStep && <div className="eac-market__notice eac-market__notice--warning"><p>版本：{removeTarget?.version ?? '未能确认'}。受影响成员：{removeTarget?.rows.map((row) => row.name).join('、') || '官方未列出运行成员'}。</p><p>市场没有此插件的完整反向依赖和数据迁移资料。第三方插件自身的卸载行为可能影响数据；请先保存工作。</p></div>}
        <div className="eac-market__button-row"><Button variant="outline" onClick={() => setRemoveTarget(undefined)}>取消</Button><Button variant="primary" disabled={managementBusy} onClick={() => { if (!removeStep) setRemoveStep(true); else if (removeTarget !== undefined) void removeInventory(removeTarget) }}>{managementBusy ? '正在提交…' : removeStep ? '已了解影响，再次确认卸载' : '继续查看卸载影响'}</Button></div>
      </Modal>
      <Modal open={authorLeaveIntent !== undefined} onClose={() => setAuthorLeaveIntent(undefined)} title="当前草稿尚未保存" closeLabel="关闭未保存提示">
        <p>作者工具中还有未保存修改。离开会暂时隐藏作者工具，但当前编辑会保留在本次市场会话中。</p>
        <div className="eac-market__button-row"><Button variant="outline" onClick={() => setAuthorLeaveIntent(undefined)}>继续编辑</Button><Button variant="primary" onClick={confirmAuthorLeave}>离开并保留编辑</Button></div>
      </Modal>
      <Modal open={tutorialOpen} onClose={() => setTutorialOpen(false)} title="三步上手" closeLabel="关闭教程">
        <div className="eac-market__help-steps">{HELP_STEPS.map((step, index) => <section className="eac-market__help-step" key={step.title}><span className="eac-market__chapter-index eac-market__step-mark" aria-hidden="true">0{index + 1}</span><h3>{step.title}</h3><p>{step.text}</p></section>)}</div>
      </Modal>

    </div>
  )
}

export function MarketFrame({ view, activeCount, onNavigate, onTasks, onMore, moreMenu, onSecondary, activeTab, scrollRef, children, moreSupplemental, transitionPhase = 'idle' }: {
  readonly view: MarketView
  readonly activeCount: number
  readonly onNavigate: (view: PrimaryView) => void
  readonly onTasks: () => void
  readonly onMore: () => void
  readonly moreMenu: boolean
  readonly onSecondary: (view: 'help' | 'settings' | 'author') => void
  readonly activeTab?: PrimaryView | undefined
  readonly moreSupplemental?: React.ReactNode
  readonly transitionPhase?: 'idle' | 'entering'
  readonly scrollRef?: React.Ref<HTMLDivElement>
  readonly children: React.ReactNode
}): React.JSX.Element {
  const currentTab = activeTab ?? pageTab(view)
  const moreTrigger = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [documentHidden, setDocumentHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  useEffect(() => {
    const sync = () => setDocumentHidden(document.hidden)
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])
  useEffect(() => { if (moreMenu) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus() }, [moreMenu])
  return (
    <div className={`eac-market${documentHidden ? ' eac-market--is-hidden' : ''}`}>
      <style dangerouslySetInnerHTML={{ __html: MARKET_CSS + MEDIA_CSS }} />
      <div className="eac-market__scroll" ref={scrollRef} tabIndex={0} role="region" aria-label="市场内容">
        <div className="eac-market__shell">
          <header className="eac-market__topbar eac-market__topbar--editorial">
            <div className="eac-market__brand"><span className="eac-market__brand-mark" aria-hidden="true">E</span><div className="eac-market__brand-copy"><strong>EAC</strong><span>插件市场</span></div></div>
            <nav className="eac-market__nav" aria-label="市场主导航" data-navigation="primary">
              <button type="button" aria-current={currentTab === 'discover' ? 'page' : undefined} onClick={() => onNavigate('discover')}>发现</button>
              <button type="button" aria-current={currentTab === 'all' ? 'page' : undefined} onClick={() => onNavigate('all')}>全部插件</button>
              <button type="button" aria-current={currentTab === 'mine' ? 'page' : undefined} onClick={() => onNavigate('mine')}>我的插件</button>
            </nav>
            <div className="eac-market__top-spacer" />
            <div className="eac-market__top-actions">
              <button type="button" className="eac-market__top-action" onClick={onTasks}>任务{activeCount > 0 && <span className="eac-market__task-count">{activeCount}</span>}</button>
              <button type="button" className="eac-market__top-action" onClick={() => onSecondary('help')}>帮助</button>
              <div className="eac-market__menu-wrap">
                <button ref={moreTrigger} type="button" className="eac-market__top-action" aria-haspopup="menu" aria-expanded={moreMenu} onClick={onMore}>更多</button>
                {moreMenu && (
                  <div ref={menuRef} className="eac-market__menu" role="menu" onKeyDown={(event) => {
                    if (event.key === 'Escape' || event.key === 'Tab') {
                      if (event.key === 'Escape') event.preventDefault()
                      onMore(); moreTrigger.current?.focus(); return
                    }
                    const options = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
                    const index = options.indexOf(document.activeElement as HTMLElement)
                    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                      event.preventDefault()
                      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
                      options[next]?.focus()
                    }
                  }}>
                    <button type="button" role="menuitem" onClick={() => onSecondary('settings')}>设置</button>
                    <button type="button" role="menuitem" onClick={() => onSecondary('author')}>作者工具</button>
                    <button type="button" role="menuitem" onClick={() => onSecondary('help')}>关于 EAC</button>
                    {moreSupplemental}
                  </div>
                )}
              </div>
            </div>
          </header>
          <main className={`eac-market__main eac-market__main--${transitionPhase}`} data-navigation-phase={transitionPhase}>{children}</main>
        </div>
      </div>
    </div>
  )
}

type DiscoveryCard = CatalogDiscoveryCard
type DiscoverySnapshot = NonNullable<CatalogSnapshot['discovery']>
type FeaturedItem = { readonly plugin: CatalogPlugin; readonly card: DiscoveryCard }
/** A directory spotlight is not a fabricated curated recommendation. */
type PosterItem = { readonly plugin: CatalogPlugin; readonly card?: DiscoveryCard }

function discoveryOf(catalog: CatalogSnapshot): DiscoverySnapshot | undefined {
  return catalog.discovery
}

function posterSource(poster: CatalogMedia | undefined): CatalogMedia | undefined {
  return poster !== undefined && poster.sourceUrl.trim() !== '' ? poster : undefined
}

function FeaturedPoster({ title, description, items, inventory, onOpen, onInstall, onManage }: {
  readonly title: string
  readonly description: string
  readonly items: readonly PosterItem[]
  readonly inventory: readonly InventoryItem[]
  readonly onOpen: (plugin: CatalogPlugin) => void
  readonly onInstall: (plugin: CatalogPlugin) => void
  readonly onManage?: (() => void) | undefined
}): React.JSX.Element {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const [announcement, setAnnouncement] = useState('')
  const [documentHidden, setDocumentHidden] = useState(() => typeof document !== 'undefined' && document.hidden)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    setActive((value) => Math.min(value, Math.max(items.length - 1, 0)))
  }, [items.length])

  useEffect(() => {
    const onVisibilityChange = () => setDocumentHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  useEffect(() => {
    if (items.length < 2 || paused || hovered || focused || reducedMotion || documentHidden) return
    const timer = window.setInterval(() => {
      const next = (active + 1) % items.length
      setActive(next)
      setAnnouncement((items[next]?.plugin.name ?? '') + '，第 ' + (next + 1) + ' 项，共 ' + items.length + ' 项')
    }, 6500)
    return () => window.clearInterval(timer)
  }, [items.length, paused, hovered, focused, reducedMotion, documentHidden, active])

  const pluginItem = (items[active] ?? items[0])!
  const plugin = pluginItem.plugin
  const reason = pluginItem.card?.reason ?? ''
  const action = pluginActionState(plugin, inventory, { canInstall: true, canManage: onManage !== undefined })
  const media = [posterSource(pluginItem.card?.poster ?? plugin.screenshots[0])].filter((item): item is CatalogMedia => item !== undefined)
  const current = media[0]
  const hasImage = current !== undefined && !failed.has(current.id + current.sourceUrl)
  const move = (delta: number) => {
    const next = (active + delta + items.length) % items.length
    setActive(next)
    setAnnouncement((items[next]?.plugin.name ?? '') + '，第 ' + (next + 1) + ' 项，共 ' + items.length + ' 项')
  }
  return <section className="eac-market__section eac-market__featured eac-market__featured-stage" aria-labelledby="featured-title" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <div className="eac-market__section-head"><div><div className="eac-market__section-title"><span className="eac-market__chapter-index" aria-hidden="true">00</span><h2 id="featured-title">{title}</h2></div><p>{description}</p></div>{items.length > 1 && <div className="eac-market__poster-controls"><button type="button" aria-label="上一项首推" onClick={() => move(-1)}>上一项</button><span aria-hidden="true">{active + 1} / {items.length}</span><span className="eac-market__sr-only" aria-live="polite">{announcement}</span><button type="button" aria-label={paused ? '继续轮播' : '暂停轮播'} onClick={() => setPaused((value) => !value)}>{paused ? '继续' : '暂停'}</button><button type="button" aria-label="下一项首推" onClick={() => move(1)}>下一项</button></div>}</div>
    <article key={plugin.id + ":" + plugin.version} className={`eac-market__poster eac-market__poster-stage${hasImage ? '' : ' eac-market__poster--fallback'}`}>
      <button type="button" className="eac-market__poster-art" onClick={() => onOpen(plugin)} aria-label={`查看 ${plugin.name} 详情`}>
        {hasImage ? <img src={current.sourceUrl} alt={current.alt || plugin.name} width={current.width ?? 1200} height={current.height ?? 675} onError={() => setFailed((value) => new Set(value).add(current.id + current.sourceUrl))} /> : <span className="eac-market__poster-fallback-copy"><strong>{pluginItem.card?.title || plugin.name}</strong><small className="eac-market__poster-fallback-meta">{plugin.version} · {plugin.packageName}</small></span>}
      </button>
      <div className="eac-market__poster-copy">{hasImage && <h3>{pluginItem.card?.title || plugin.name}</h3>}<p>{pluginItem.card?.summary || plugin.summary || '作者尚未提供一句话简介。'}</p>{reason && <p className="eac-market__recommendation">{reason}</p>}<div className="eac-market__button-row"><Button size="sm" variant="outline" onClick={() => onOpen(plugin)}>查看详情</Button>{action.kind === 'manage' && onManage ? <Button size="sm" variant="primary" onClick={onManage}>管理</Button> : <Button size="sm" variant="primary" disabled={action.disabled} title={action.reason} onClick={() => onInstall(plugin)}>{action.label}</Button>}</div>{action.reason && <p className="eac-market__action-reason">{action.reason}</p>}</div>
    </article>
  </section>
}

function discoveryItems(cards: readonly DiscoveryCard[] | undefined, plugins: readonly CatalogPlugin[]): readonly FeaturedItem[] {
  return (cards ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).flatMap((card) => {
    const plugin = plugins.find((item) => item.id === card.pluginId && item.version === card.version)
    return plugin === undefined ? [] : [{ plugin, card }]
  })
}

function discoveryScoreItems(cards: readonly DiscoveryCard[] | undefined, plugins: readonly CatalogPlugin[]): readonly FeaturedItem[] {
  return discoveryItems(cards, plugins).filter(({ card }) => card.score !== undefined && Number.isFinite(card.score.value))
}

function SkinRecommendation({ item, inventory, onOpen, onInstall, onManage }: { readonly item: FeaturedItem; readonly inventory: readonly InventoryItem[]; readonly onOpen: (plugin: CatalogPlugin) => void; readonly onInstall: (plugin: CatalogPlugin) => void; readonly onManage?: (() => void) | undefined }): React.JSX.Element {
  const { plugin, card } = item
  const action = pluginActionState(plugin, inventory, { canInstall: true, canManage: onManage !== undefined })
  return <article className="eac-market__skin-card">
    <button type="button" className="eac-market__skin-card-art" onClick={() => onOpen(plugin)} aria-label={'查看 ' + plugin.name + ' 皮肤详情'}>
      <span aria-hidden="true">{plugin.name.slice(0, 1)}</span>
    </button>
    <div className="eac-market__skin-card-copy"><h3>{card.title || plugin.name}</h3><p>{card.summary || plugin.summary}</p><p className="eac-market__skin-card-reason">{card.reason}</p><div className="eac-market__button-row"><Button size="sm" variant="outline" onClick={() => onOpen(plugin)}>查看详情</Button>{action.kind === 'manage' && onManage ? <Button size="sm" variant="primary" onClick={onManage}>管理</Button> : <Button size="sm" variant="primary" disabled={action.disabled} title={action.reason} onClick={() => onInstall(plugin)}>{action.label}</Button>}</div>{action.reason && <p className="eac-market__action-reason">{action.reason}</p>}</div>
  </article>
}

function DiscoveryScoreSection({ title, index, items, inventory, onOpen, onInstall, onManage }: {
  readonly title: string
  readonly index: string
  readonly items: readonly FeaturedItem[]
  readonly inventory: readonly InventoryItem[]
  readonly onOpen: (plugin: CatalogPlugin) => void
  readonly onInstall: (plugin: CatalogPlugin) => void
  readonly onManage?: (() => void) | undefined
}): React.JSX.Element {
  return <section className="eac-market__section eac-market__score-section" aria-label={title}><div className="eac-market__section-head"><div><div className="eac-market__section-title"><span className="eac-market__chapter-index" aria-hidden="true">{index}</span><h2>{title}</h2></div><p>按目录提供的评分排序。</p></div></div><div className="eac-market__grid eac-market__score-grid eac-market__stream">{items.slice(0, 6).map(({ plugin, card }) => <div key={plugin.id + ':' + plugin.version} className="eac-market__ranked-item">{card.score !== undefined && <span className="eac-market__score" aria-label={`评分 ${card.score.value}`}>{card.score.value.toFixed(1)}</span>}<PluginCard plugin={plugin} inventory={inventory} onOpen={onOpen} onInstall={onInstall} onManage={onManage} /></div>)}</div></section>
}

export function DiscoverView({ catalog, inventory, onOpen, onInstall, onPack, onCollection, onBrowse, onHelp, onSettings, onManage, skinEntry, supplemental }: {
  readonly catalog: CatalogSnapshot
  readonly inventory: readonly InventoryItem[]
  readonly onOpen: (plugin: CatalogPlugin) => void
  readonly onInstall: (plugin: CatalogPlugin) => void
  readonly onPack: (pack: CatalogPack) => void
  readonly onCollection?: ((collection: CatalogCollectionView) => void) | undefined
  readonly onBrowse: (category?: string) => void
  readonly onHelp: () => void
  readonly onSettings?: (() => void) | undefined
  readonly onManage?: (() => void) | undefined
  readonly skinEntry?: React.ReactNode
  readonly supplemental?: React.ReactNode
}): React.JSX.Element {
  const allPlugins = catalog.plugins
  catalog = { ...catalog, plugins: allPlugins.filter((plugin) => !isSkinPlugin(plugin) && plugin.packageName !== SKIN_LOADER_PACKAGE) }
  const categories = categoriesOf(catalog.plugins)
  const discovery = discoveryOf(catalog)
  const legacyFeatured = (catalog.recommendations ?? []).filter((record) => record.placement === 'featured' && record.reason.trim() !== '').sort((a, b) => a.order - b.order || a.pluginId.localeCompare(b.pluginId)).flatMap((record) => { const plugin = allPlugins.find((item) => recommendationMatches(record, item)); return plugin ? [{ plugin, card: { pluginId: plugin.id, version: plugin.version, reason: record.reason, title: plugin.name, summary: plugin.summary, source: 'curated' as const, order: record.order } }] : [] })
  const recommended = discoveryItems(discovery?.featured, allPlugins)
  const featured = discovery === undefined ? legacyFeatured : recommended
  const skinRecommended = discoveryItems(discovery?.recommendedSkins, allPlugins).filter(({ plugin }) => isSkinPlugin(plugin))
  const ruleSorted = browseSortPlugins(catalog.plugins.filter(plugin => plugin.installability === 'bundle-installable' && plugin.verification !== 'hard-incompatible'), 'rules')
  const posterItems: readonly PosterItem[] = featured.length > 0 ? featured : ruleSorted.slice(0, 6).map(plugin => ({ plugin }))
  const scored = discoveryScoreItems(discovery?.highScorePlugins, allPlugins)
  const scoredSkills = discoveryScoreItems(discovery?.highScoreSkills, allPlugins)
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [showAllCategories, setShowAllCategories] = useState(false)
  const visibleRuleSorted = selectedCategory === 'all' ? ruleSorted : ruleSorted.filter((plugin) => plugin.categories.includes(selectedCategory))
  let chapterCursor = 0
  const nextChapter = (): string => String(++chapterCursor).padStart(2, '0')
  const visibleCategories = showAllCategories ? categories : categories.slice(0, 4)
  return (
    <div className="eac-market__discover-page">
      <header className="eac-market__page-head eac-market__discover-head">
        <div><p className="eac-market__eyebrow" aria-hidden="true">DISCOVER · 发现</p><h1>发现适合你的插件</h1><p>{featured.length > 0 ? '从团队精选开始，了解插件与皮肤，再探索完整目录。' : '从插件海报了解功能与安装条件，再探索完整目录。'}</p><p className="eac-market__edition" aria-hidden="true">EDITION {new Date(catalog.generatedAt).toLocaleDateString('zh-CN')} · {allPlugins.length} ITEMS</p></div>
        <div className="eac-market__button-row"><Button variant="primary" onClick={() => onBrowse()}>搜索全部插件</Button><Button variant="ghost" onClick={onHelp}>使用帮助</Button></div>
      </header>
      {posterItems.length > 0 && <FeaturedPoster title={featured.length > 0 ? "团队精选" : "插件探索"} description={featured.length > 0 ? "查看真实推荐理由，了解功能与安装条件。" : "按现有目录规则展示已有安装包的插件，不代表团队精选或评分。"} items={posterItems} inventory={inventory} onOpen={onOpen} onInstall={onInstall} onManage={onManage} />}
      {skinEntry}
      {catalog.plugins.length === 0 ? (
        <section className="eac-market__notice"><strong>目录暂无功能插件</strong><p>可到设置刷新目录，或在「我的插件」查看已有功能。外观集中在皮肤中心。</p>{onSettings && <Button variant="outline" onClick={onSettings}>查看目录设置</Button>}</section>
      ) : (
        <>
          {skinRecommended.length > 0 && <section className="eac-market__section eac-market__skin-strip" aria-labelledby="skin-recommendations-title">
            <div className="eac-market__section-head"><div><div className="eac-market__section-title"><span className="eac-market__chapter-index" aria-hidden="true">{nextChapter()}</span><h2 id="skin-recommendations-title">皮肤推荐</h2></div><p>只显示目录中有明确推荐记录的皮肤；更多皮肤请从皮肤中心进入。</p></div></div>
            <div className="eac-market__grid eac-market__skin-grid eac-market__stream">{skinRecommended.slice(0, 6).map((item) => <SkinRecommendation key={item.plugin.id + ":" + item.plugin.version} item={item} inventory={inventory} onOpen={onOpen} onInstall={onInstall} onManage={onManage} />)}</div>
          </section>}

          {scored.length > 0 && <DiscoveryScoreSection title="高分插件" index={nextChapter()} items={scored} inventory={inventory} onOpen={onOpen} onInstall={onInstall} onManage={onManage} />}
          {scoredSkills.length > 0 && <DiscoveryScoreSection title="高分 skill" index={nextChapter()} items={scoredSkills} inventory={inventory} onOpen={onOpen} onInstall={onInstall} onManage={onManage} />}

          <section className="eac-market__section">
            <div className="eac-market__section-head">
              <div><div className="eac-market__section-title"><span className="eac-market__chapter-index" aria-hidden="true">{nextChapter()}</span><h2>规则发现</h2></div><p>仅展示已有安装包的功能。排序依据：兼容状态、用途和发布时间；待适配内容在全部插件中保留。</p></div>
            </div>
            {categories.length > 0 && (
              <>
                <div className="eac-market__filters" aria-label="按用途筛选发现内容">
                  <Pill active={selectedCategory === 'all'} onClick={() => setSelectedCategory('all')}>全部用途</Pill>
                  {visibleCategories.map((category) => <Pill key={category} active={selectedCategory === category} onClick={() => setSelectedCategory(category)}>{category}</Pill>)}
                  {categories.length > 4 && <Pill active={showAllCategories} onClick={() => setShowAllCategories((value) => !value)}>{showAllCategories ? '收起用途' : `更多用途（${categories.length - 4}）`}</Pill>}
                </div>
                <div className="eac-market__button-row">
                  <Button variant="outline" onClick={() => onBrowse(selectedCategory === 'all' ? undefined : selectedCategory)}>
                    {selectedCategory === 'all' ? '浏览全部插件' : `查看“${selectedCategory}”全部插件`}
                  </Button>
                  {selectedCategory !== 'all' && <Button variant="ghost" onClick={() => setSelectedCategory('all')}>清除用途筛选</Button>}
                </div>
              </>
            )}
            <div key={selectedCategory} className="eac-market__grid eac-market__discover-results eac-market__stream">
              {visibleRuleSorted.slice(0, 6).map((plugin) => <PluginCard key={plugin.id + ":" + plugin.version} plugin={plugin} inventory={inventory} onOpen={onOpen} onInstall={onInstall} onManage={onManage} />)}
            </div>
          </section>

          {catalog.packs.length > 0 && (
            <section className="eac-market__section">
              <div className="eac-market__section-head"><div className="eac-market__section-title"><span className="eac-market__chapter-index" aria-hidden="true">{nextChapter()}</span><h2>套餐</h2></div><p>一次查看所有组件与版本调整。</p></div>
              <div className="eac-market__grid grid--two eac-market__grid--two">
                {catalog.packs.map((pack) => (
                  <article className="eac-market__card" key={pack.id + ":" + pack.version}>
                    <div className="eac-market__tags"><Tag tone="info">{{ function: '功能', appearance: '外观', workflow: '工作流', unclassified: '未分类' }[pack.category]}</Tag><Status tone={pack.execution.coverage === 'complete' ? 'success' : 'warning'}>{packCoverageLabel(pack.execution.coverage)}</Status></div>
                    <h3>{pack.name}</h3>
                    <p className="eac-market__plugin-summary">{pack.summary}</p>
                    <div className="eac-market__plugin-bottom">
                      <span className="eac-market__status">{pack.components.length} 个组件 · {pack.version}</span>
                      <Button size="sm" variant="primary" onClick={() => onPack(pack)}>查看套餐变更</Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {(catalog.collections?.length ?? 0) > 0 && <section className="eac-market__section" aria-label="市场组合">
        <div className="eac-market__section-head"><div className="eac-market__section-title"><span className="eac-market__chapter-index" aria-hidden="true">{nextChapter()}</span><h2>市场组合</h2></div><p>按组合列出的确切版本预检，逐项确认安装范围。</p></div>
        <div className="eac-market__grid eac-market__grid--two">{catalog.collections?.map((collection) => <article className="eac-market__card" key={collection.id + ':' + collection.version} data-collection-id={collection.id}>
          <div className="eac-market__tags"><Tag tone="info">市场组合</Tag><Status tone={collection.execution.coverage === 'complete' ? 'success' : 'warning'}>{packCoverageLabel(collection.execution.coverage)}</Status></div>
          <h3>{collection.name}</h3><p className="eac-market__plugin-summary">{collection.summary}</p>
          <div className="eac-market__plugin-bottom"><span className="eac-market__status">{collection.components.length} 个组件 · {collection.version}</span><Button size="sm" variant="primary" disabled={onCollection === undefined} onClick={() => onCollection?.(collection)}>查看组合变更</Button></div>
        </article>)}</div>
      </section>}
      {(catalog.previewPacks?.length ?? 0) > 0 && <section className="eac-market__section" aria-label="上游整合包">
        <div className="eac-market__section-head"><div className="eac-market__section-title"><span className="eac-market__chapter-index" aria-hidden="true">{nextChapter()}</span><h2>上游整合包（组件整理中）</h2></div><p>组件尚未解析绑定，只展示原始薄包与来源；确认安装范围前不提供一键安装。</p></div>
        <div className="eac-market__grid eac-market__grid--two">{catalog.previewPacks?.map((pack) => {
          let href: string | undefined
          try { const url = new URL(pack.source.url); href = url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined } catch { href = undefined }
          return <article className="eac-market__card" key={pack.id + ':' + pack.version} data-preview-pack-id={pack.id}>
            <div className="eac-market__tags"><Tag tone="info">上游整合包</Tag><Status tone="warning">{packCoverageLabel(pack.execution.coverage)}</Status>{pack.status === 'withdrawn' && <Status tone="danger">已撤回</Status>}</div>
            <h3>{pack.name}</h3>
            <p className="eac-market__plugin-summary">{pack.summary}</p>
            <p className="eac-market__status">{pack.version} · {pack.requiresDsh === null ? '宿主要求未知' : '需要宿主 ' + pack.requiresDsh}</p>
            <p className="eac-market__status">组件：{pack.components.map((component) => component.ref).join('、')}</p>
            {pack.artifact !== undefined && <p className="eac-market__status">薄包 {pack.artifact.size} 字节 · 指纹 {pack.artifact.sha256.slice(0, 12)}…</p>}
            <div className="eac-market__plugin-bottom"><span className="eac-market__status">{pack.components.length} 个组件</span>{href === undefined ? <span>来源链接待补充</span> : <a href={href} target="_blank" rel="noreferrer">查看来源</a>}</div>
          </article>
        })}</div>
      </section>}
      {supplemental}
    </div>
  )
}

export function DetailView({ plugin, presentation, inventory, onBack, backLabel, onInstall, onUpdate, updatePlugin, canInstall = false, onOpenOfficialPlugins, supplemental }: {
  readonly plugin: CatalogPlugin
  readonly presentation: CatalogPresentation | undefined
  readonly inventory: readonly InventoryItem[]
  readonly onBack: () => void
  readonly backLabel?: string | undefined
  readonly onInstall: (plugin: CatalogPlugin) => void
  readonly onUpdate?: (plugin: CatalogPlugin) => void
  readonly updatePlugin?: CatalogPlugin | undefined
  readonly canInstall?: boolean
  readonly onOpenOfficialPlugins?: (() => void) | undefined
  readonly supplemental?: React.ReactNode
}): React.JSX.Element {
  const installed = isInstalled(inventory, plugin)
  const action = pluginActionState(plugin, inventory, { canInstall, canManage: false })
  const detailReasonId = useId()
  return (
    <>
      <Button variant="outline" onClick={onBack}>{backLabel ?? '返回插件列表'}</Button>
      <div className="eac-market__detail">
        <div className="eac-market__plugin-head">
          <CatalogMediaIcon name={plugin.name} media={plugin.media?.icon} />
          <div><h1>{plugin.name}</h1><p>{plugin.author} · {plugin.packageName} · {plugin.version}</p></div>
        </div>
        <div className="eac-market__detail-main">
          <p className="eac-market__lead">{plugin.summary || '作者尚未提供一句话简介。'}</p>
          <div className="eac-market__button-row">
            <Button variant="primary" disabled={action.disabled} title={action.reason} {...(action.reason === undefined ? {} : { 'aria-describedby': detailReasonId })} onClick={() => onInstall(plugin)}>
              {action.kind === 'install' ? '安装' : action.label}
            </Button>
            {installed !== undefined && updatePlugin !== undefined && hasCatalogUpdate(installed, updatePlugin) && canInstall && onUpdate !== undefined && (
              <Button variant="primary" onClick={() => onUpdate(updatePlugin)}>更新到 {updatePlugin.version}</Button>
            )}
            {installed?.restartRequired === true && <Status tone="warning">需要重启</Status>}
          </div>
          {action.disabled && action.reason !== undefined && (
            <div className="eac-market__detail-reason" id={detailReasonId}>
              <span className="eac-tag eac-tag--warning">暂不可用原因</span>
              <p>{action.reason}</p>
            </div>
          )}
          {installed !== undefined && (
            <div className="eac-market__notice" style={{ marginTop: 14 }}>
              <strong>使用入口：</strong>
              {plugin.requiresSetup ? '此插件需要设置，请在 DSH 官方插件页按作者说明完成。' : '请在 DSH 官方插件页或作者说明的入口打开。'}
              {onOpenOfficialPlugins && <Button variant="outline" onClick={onOpenOfficialPlugins}>打开官方插件页</Button>}
              {plugin.sourceUrl !== undefined && <> <a href={plugin.sourceUrl} target="_blank" rel="noreferrer">查看作者公开来源</a></>}
            </div>
          )}
          {(plugin.verification !== 'verified' || plugin.installability !== 'bundle-installable') && (
            <div className={`eac-market__notice ${plugin.verification === 'hard-incompatible' ? 'eac-market__notice--danger' : 'eac-market__notice--warning'}`} style={{ marginTop: 18 }}>
              {plugin.verification === 'hard-incompatible' ? '此版本存在已知兼容性风险；是否能正常使用由官方安装器和上游插件负责。' : `${verificationLabel(plugin.verification)}。${installabilityLabel(plugin.installability)}。未验证内容仍可进入安装方案，最终以官方安装结果为准。`}
            </div>
          )}
          <ScreenshotGallery screenshots={plugin.media?.previews ?? plugin.screenshots} />
          <section className="eac-market__section">
            <div className="eac-market__section-head"><h2>作者图文介绍</h2></div>
            {presentation === undefined ? (
              <EmptyState title="作者尚未提供详细介绍" description="固定信息仍可核对版本、来源、兼容与安装状态。作者后续导出资料并经团队接收后，可在此显示图文内容。" />
            ) : (
              <article className="eac-market__prose">
                <h2>{presentation.title}</h2>
                <MarkdownText text={presentation.markdown} labels={MARKDOWN_LABELS} />
              </article>
            )}
          </section>
        </div>
        <aside className="eac-market__detail-side">
          <details className="eac-market__facts-strip"><summary>
            <span><em>验证</em>{verificationLabel(plugin.verification)}</span>
            <span><em>安装</em>{installabilityLabel(plugin.installability)}</span>
            <span><em>重启</em>{plugin.requiresRestart ? '需要重启' : '不需要'}</span>
            <span className="eac-market__facts-more">来源与兼容详情</span>
          </summary>
          <div className="eac-market__section-head"><h2>安装信息</h2></div>
          <dl className="eac-market__facts">
            <dt>目标版本</dt><dd>{plugin.version}</dd>
            <dt>能力层级</dt><dd>{plugin.capabilityTier}</dd>
            <dt>验证状态</dt><dd>{verificationLabel(plugin.verification)}</dd>
            <dt>安装格式</dt><dd>{installabilityLabel(plugin.installability)}</dd>
            <dt>启用策略</dt><dd>{plugin.enabledPolicy === 'default-on' ? '默认启用' : plugin.enabledPolicy === 'default-off' ? '默认停用' : '需要先完成设置'}</dd>
            <dt>重启要求</dt><dd>{plugin.requiresRestart ? '需要重启 DSH' : '不需要重启'}</dd>
            <dt>大资源</dt><dd>{plugin.largeExternalResource ? '首次使用可能下载额外资源' : '没有额外大资源声明'}</dd>
            <dt>许可证</dt><dd>{plugin.license ?? '作者未声明'}</dd>
            <dt>来源</dt><dd>{plugin.sourceUrl === undefined ? '作者未提供公开来源' : <a href={plugin.sourceUrl} target="_blank" rel="noreferrer">{plugin.sourceUrl}</a>}</dd>
            <dt>产物摘要</dt><dd>{plugin.artifactDigest ?? '暂无摘要'}</dd>
          </dl>
          <p className="eac-market__footer-note">固定信息由目录与官方插件管理器维护，作者正文不能改写这些状态。</p>
          </details>
        </aside>
      </div>
      {supplemental}
    </>
  )
}
