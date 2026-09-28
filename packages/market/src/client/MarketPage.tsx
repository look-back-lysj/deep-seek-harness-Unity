import { useEffect, useRef, useState } from 'react'
import { Button, MarkdownText, Modal, Pill, Tag } from './ui.tsx'
import type {
  CatalogPack,
  CatalogCollectionView,
  CatalogPlugin,
  CatalogPresentation,
  CatalogSnapshot,
  DiagnosticExport,
  InventoryItem,
  TaskState,
} from '../types.ts'
import {
  EMPTY_FILTERS,
  activeTasks,
  browseSortPlugins,
  categoriesOf,
  createIdempotencyKey,
  hasCatalogUpdate,
  partitionInventory,
  pluginActionFeedback,
  type BrowseSortMode,
  filterPlugins,
  findPlugin,
  latestCompatiblePlugin,
  installabilityLabel,
  isInstalled,
  packCoverageLabel,
  presentationForPlugin,
  recommendationMatches,
  verificationLabel,
  type MarketRemote,
  type MarketView,
  type PluginFilters,
  type PrimaryView,
} from './model.ts'
import {
  EmptyState,
  InstallPlanDialog,
  InventoryCard,
  PluginCard,
  ScreenshotGallery,
  SearchField,
  Status,
  TaskDrawer,
  errorMessage,
  type PlanTarget,
} from './components.tsx'
import { MARKET_CSS } from './marketStyles.ts'
import { useMarketData, boundedRequest } from './data-controller.ts'
import { AuthorWorkspace } from './AuthorWorkspace.tsx'
import { SkinCenter, SkinCenterEntry } from './SkinCenter.tsx'
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

function pageTab(view: MarketView): PrimaryView {
  return view === 'all' || view === 'detail' || view === 'skins' ? 'all' : view === 'mine' ? 'mine' : 'discover'
}

export function packPlugins(pack: CatalogPack, catalogPlugins: readonly CatalogPlugin[]): readonly CatalogPlugin[] {
  return pack.components.flatMap((component) => {
    const plugin = catalogPlugins.find((item) => item.id === component.pluginId && item.version === component.version)
    return plugin === undefined ? [] : [plugin]
  })
}

export function MarketPage({ remote, skinService, onOpenOfficialPlugins, homeSupplemental, authorSupplemental, detailSupplemental, extensions, renderExtensionSurface }: MarketPageProps): React.JSX.Element {
  const { state, notice: syncNotice, controller } = useMarketData(remote)
  const [view, setView] = useState<MarketView>('discover')
  const [previousView, setPreviousView] = useState<PrimaryView | 'skins'>('discover')
  const [skinOrigin, setSkinOrigin] = useState<PrimaryView>('discover')
  const [skinVisited, setSkinVisited] = useState(false)
  const [skinInstallGuide, setSkinInstallGuide] = useState<CatalogPlugin>()
  const [detailSelection, setDetailSelection] = useState<{ readonly id: string; readonly version: string }>()
  const [filters, setFilters] = useState<PluginFilters>(EMPTY_FILTERS)
  const [advanced, setAdvanced] = useState(false)
  const [availableOnly, setAvailableOnly] = useState(true)
  const [page, setPage] = useState(1)
  const [taskDrawer, setTaskDrawer] = useState(false)
  const [moreMenu, setMoreMenu] = useState(false)
  const [planTarget, setPlanTarget] = useState<PlanTarget | undefined>(undefined)
  const [removeTarget, setRemoveTarget] = useState<InventoryItem | undefined>(undefined)
  const [actionNotice, setActionNotice] = useState('')
  const [diagnostic, setDiagnostic] = useState<DiagnosticExport | undefined>(undefined)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [browseSort, setBrowseSort] = useState<BrowseSortMode>('rules')
  const [systemOpen, setSystemOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const scrollPositions = useRef(new Map<string, number>())
  const [removeStep, setRemoveStep] = useState(false)
  const [managementBusy, setManagementBusy] = useState(false)
  const managementLock = useRef(false)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [extensionPage, setExtensionPage] = useState<string>()
  const [extensionDraft, setExtensionDraft] = useState<ExtensionDraftRef>()
  const [draftChange, setDraftChange] = useState<ExtensionDraftChange>()
  const extensionLifetime = useRef(new AbortController())
  useEffect(() => { const lifetime = new AbortController(); extensionLifetime.current = lifetime; return () => lifetime.abort() }, [remote])

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

  function navigate(next: PrimaryView): void {
    setView(next)
    setPreviousView(next)
    setPage(1)
    setActionNotice('')
    if (next === 'mine') void controller.sync(true)
  }

  function openDetail(plugin: CatalogPlugin): void {
    if (state.status !== 'ready') return
    const from = view === 'skins' ? 'skins' : pageTab(view)
    scrollPositions.current.set(`${from}:${filters.category}:${filters.query}:${page}`, scrollRef.current?.scrollTop ?? 0)
    setPreviousView(from)
    setDetailSelection({ id: plugin.id, version: plugin.version })
    setView('detail')
  }

  function browse(category?: string): void {
    scrollPositions.current.set(`${pageTab(view)}:${filters.category}:${filters.query}:${page}`, scrollRef.current?.scrollTop ?? 0)
    setFilters((current) => ({ ...current, category: category ?? 'all' }))
    setPage(1)
    setView('all')
    setPreviousView('all')
    window.requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: 0 }) })
  }

  function backFromDetail(): void {
    const key = `${previousView}:${filters.category}:${filters.query}:${page}`
    setView(previousView)
    window.requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollPositions.current.get(key) ?? 0 }) })
  }

  function openPlanForPlugin(plugin: CatalogPlugin): void {
    if (isSkinPlugin(plugin) && state.status === 'ready' && !state.inventory.items.some((item) => item.installed && item.packageName === SKIN_LOADER_PACKAGE)) {
      setSkinInstallGuide(plugin)
      return
    }
    setPlanTarget({ plugin, plugins: [plugin] })
    setActionNotice('')
  }

  function openPlanForPack(pack: CatalogPack): void {
    if (state.status !== 'ready') return
    const plugins = packPlugins(pack, state.catalog.plugins)
    setPlanTarget({ pack, plugins })
    setActionNotice('')
  }

  function openPlanForCollection(collection: CatalogCollectionView): void {
    if (state.status !== 'ready') return
    const plugins = collection.components.flatMap((component) => {
      const plugin = state.catalog.plugins.find((item) => item.id === component.pluginId && item.version === component.version && item.artifactDigest === component.artifactDigest)
      return plugin === undefined ? [] : [plugin]
    })
    setPlanTarget({ collection, plugins })
    setActionNotice('')
  }

  function updateTask(task: TaskState, reveal = true): void {
    controller.acceptTask(task)
    if (reveal) setTaskDrawer(true)
  }

  async function refreshCatalog(): Promise<void> {
    if (catalogBusy) return
    setCatalogBusy(true); setActionNotice('')
    try {
      const result = await controller.refreshCatalog()
      setActionNotice(result.status === 'refreshed' ? '目录已刷新。插件不会自动安装或更新。' : '目录刷新失败，继续显示上次目录：' + (result.reason ?? '后台未提供原因'))
    } catch (error) { setActionNotice(errorMessage(error)) }
    finally { setCatalogBusy(false) }
  }

  async function toggleInventory(item: InventoryItem, enabled: boolean): Promise<void> {
    if (managementLock.current) return
    if (item.packageName === '@dsh-eac/market') { onOpenOfficialPlugins?.(); return }
    managementLock.current = true; setManagementBusy(true)
    setActionNotice('')
    try {
      if (remote.setPluginEnabled === undefined) throw new Error('当前 DSH 运行时未开放启用/停用能力')
      const action = await boundedRequest(remote.setPluginEnabled({
        packageName: item.packageName,
        ...(item.version === undefined ? {} : { expectedVersion: item.version }),
        enabled,
        idempotencyKey: createIdempotencyKey('market-enable'),
      }), '更改插件启停', 20_000)
      const feedback = pluginActionFeedback(action, enabled)
      try {
        await controller.refreshInventory()
      } catch (inventoryError) {
        setActionNotice(`${feedback.message} 库存刷新失败：${errorMessage(inventoryError)}`)
        return
      }
      setActionNotice(feedback.message)
    } catch (error) {
      setActionNotice(errorMessage(error))
    } finally { managementLock.current = false; setManagementBusy(false) }
  }

  async function removeInventory(item: InventoryItem): Promise<void> {
    if (managementLock.current || !removeStep) return
    if (item.packageName === '@dsh-eac/market') { onOpenOfficialPlugins?.(); return }
    managementLock.current = true; setManagementBusy(true)
    setActionNotice('')
    try {
      if (remote.removePlugin === undefined) throw new Error('当前 DSH 运行时未开放卸载能力')
      const action = await boundedRequest(remote.removePlugin({
        packageName: item.packageName,
        ...(item.version === undefined ? {} : { expectedVersion: item.version }),
        confirmed: true,
        idempotencyKey: createIdempotencyKey('market-remove'),
      }), '卸载插件', 20_000)
      await controller.refreshInventory()
      setRemoveTarget((current) => current?.packageName === item.packageName ? undefined : current)
      if (action.status === 'failed') setActionNotice(action.error ? `卸载失败：${action.error}` : '卸载失败，官方结果未变为成功。')
      else if (action.status === 'unknown') setActionNotice('卸载结果未知，已重新读取库存；请核对后再继续。')
      else if (action.status === 'restart-required') setActionNotice('卸载请求已保存，需要重启 DSH 后才会完全生效。')
      else setActionNotice('已调用官方卸载。市场未额外清理独立配置、用户文件或未知目录。')
    } catch (error) {
      setActionNotice(errorMessage(error))
    } finally { managementLock.current = false; setManagementBusy(false) }
  }

  async function exportDiagnostic(): Promise<void> {
    setActionNotice('')
    try {
      if (remote.exportDiagnostic === undefined) throw new Error('当前 DSH 运行时未开放诊断导出能力')
      setDiagnostic(await boundedRequest(remote.exportDiagnostic(), '生成诊断'))
    } catch (error) {
      setActionNotice(errorMessage(error))
    }
  }

  if (state.status === 'loading') {
    return (
      <MarketFrame
        view={view}
        activeCount={0}
        onNavigate={navigate}
        onTasks={() => setTaskDrawer(true)}
        onMore={() => setMoreMenu((value) => !value)}
        moreMenu={false}
        onSecondary={(next) => setView(next)}
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
        moreMenu={false}
        onSecondary={(next) => setView(next)}
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
    const from = pageTab(view)
    scrollPositions.current.set(`${from}:${filters.category}:${filters.query}:${page}`, scrollRef.current?.scrollTop ?? 0)
    setSkinOrigin(from); setSkinVisited(true); setView('skins')
    window.requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }))
  }
  const skinEntry = <SkinCenterEntry plugins={state.catalog.plugins} inventory={state.inventory.items} onOpen={openSkins} />
  const perPage = 24
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage))
  const visible = filtered.slice((page - 1) * perPage, page * perPage)
  const extensionContext: Readonly<ExtensionContext> = {
    marketVersion: state.hello.marketVersion, dshVersion: state.hello.hostVersion, environmentId: state.hello.environmentId,
    capabilities: ['browse', 'open-own-page', 'request-install-review', 'preview-draft-change'], signal: extensionLifetime.current.signal,
    plugin: selectedPlugin === undefined ? undefined : { id: selectedPlugin.id, name: selectedPlugin.name, packageName: selectedPlugin.packageName, version: selectedPlugin.version, artifactDigest: selectedPlugin.artifactDigest },
    draft: extensionDraft === undefined ? undefined : { ...extensionDraft },
    openDetail(id) { const plugin = findPlugin(state.catalog, id); if (plugin) openDetail(plugin) },
    openOwnPage(id) { setExtensionPage(id); setView('extension'); setMoreMenu(false) },
    requestInstallReview(request) {
      const plugin = state.catalog.plugins.find((item) => item.id === request.pluginId && item.version === request.version && item.artifactDigest === request.artifactDigest)
      if (plugin) openPlanForPlugin(plugin)
      else setActionNotice('扩展引用的插件版本已变化，请在全部插件中重新选择。')
    },
    previewDraftChange(change) { setDraftChange({ ...change }); setView('author') },
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
        scrollRef={scrollRef}
        onSecondary={(next) => { setMoreMenu(false); setView(next) }}
        moreSupplemental={surface(EXTENSION_SLOTS.more)}
      >
        {syncNotice && <div className="eac-market__notice eac-market__notice--warning" role="status">{syncNotice} <Button variant="outline" onClick={() => void controller.sync(true)}>重新读取</Button></div>}
        {actionNotice && <div className="eac-market__notice" role="status">{actionNotice}</div>}

        {view === 'discover' && (
          <DiscoverView
            catalog={state.catalog}
            inventory={state.inventory.items}
            onOpen={openDetail}
            onInstall={openPlanForPlugin}
            onPack={openPlanForPack}
            onCollection={openPlanForCollection}
            onBrowse={browse}
            onHelp={() => setView('help')}
            onSettings={() => setView('settings')}
            skinEntry={skinEntry}
            supplemental={<>{homeSupplemental}{surface(EXTENSION_SLOTS.home)}</>}
          />
        )}

        {view === 'all' && (
          <>
            <header className="eac-market__page-head">
              <div><h1>全部插件</h1><p>默认展示有安装包的功能。待适配、缺少文件的条目可在“全部记录”查看。</p></div>
              <Button variant="outline" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}>高级筛选</Button>
            </header>
            {skinEntry}
            <div className="eac-market__filters" aria-label="安装包范围">
              <Pill active={availableOnly} onClick={() => { setAvailableOnly(true); setPage(1) }}>可安装</Pill>
              <Pill active={!availableOnly} onClick={() => { setAvailableOnly(false); setPage(1) }}>全部记录</Pill>
            </div>
            <div className="eac-market__toolbar">
              <SearchField value={filters.query} onChange={(query) => { setFilters({ ...filters, query }); setPage(1) }} />
              <div className="eac-market__filters">
                <label className="eac-market__sr-only" htmlFor="eac-category">用途分类</label>
                <select id="eac-category" value={filters.category} onChange={(event) => { setFilters({ ...filters, category: event.currentTarget.value }); setPage(1) }}>
                  <option value="all">全部用途</option>
                  {categoriesOf(marketPlugins).map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
                <label className="eac-market__sr-only" htmlFor="eac-sort">排序</label>
                <select id="eac-sort" value={browseSort} onChange={(event) => setBrowseSort(event.currentTarget.value as BrowseSortMode)}>
                  <option value="rules">规则排序（默认）</option>
                  <option value="compatibility">兼容性优先</option>
                  <option value="recommended">团队精选优先（由我选择）</option>
                </select>
              </div>
            </div>
            {advanced && (
              <div className="eac-market__advanced">
                <label>验证状态
                  <select value={filters.verification} onChange={(event) => setFilters({ ...filters, verification: event.currentTarget.value as PluginFilters['verification'] })}>
                    <option value="all">全部</option><option value="verified">已验证</option><option value="unverified">未验证</option>
                    <option value="hard-incompatible">已知不兼容</option><option value="unknown">状态未知</option>
                  </select>
                </label>
                <label>安装状态
                  <select value={filters.installed} onChange={(event) => setFilters({ ...filters, installed: event.currentTarget.value as PluginFilters['installed'] })}>
                    <option value="all">全部</option><option value="yes">已安装</option><option value="no">未安装</option>
                  </select>
                </label>
                <Button variant="ghost" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1) }}>清除筛选</Button>
              </div>
            )}
            {visible.length === 0 ? (
              <EmptyState
                title="没有匹配的插件"
                description="目录里没有满足当前搜索和筛选条件的项目。可以清除筛选，或查看全部插件。"
                action={<Button variant="outline" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1) }}>清除筛选</Button>}
              />
            ) : (
              <div className="eac-market__grid">
                {visible.map((plugin) => <PluginCard key={plugin.id + ":" + plugin.version} plugin={plugin} inventory={state.inventory.items} onOpen={openDetail} onInstall={openPlanForPlugin} />)}
              </div>
            )}
            {pageCount > 1 && (
              <nav className="eac-market__pagination" aria-label="插件分页">
                <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</Button>
                <span>第 {page} / {pageCount} 页</span>
                <Button variant="outline" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</Button>
              </nav>
            )}
            {!availableOnly && <PendingListings listings={state.catalog.listings ?? []} query={filters.query} />}
          </>
        )}

        {view === 'mine' && (
          <>
            <header className="eac-market__page-head">
              <div><h1>我的插件</h1><p>这里只显示官方插件管理器返回的真实安装和启停状态。</p></div>
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
                      onOpenOfficialPlugins={onOpenOfficialPlugins}
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
                      onOpenOfficialPlugins={onOpenOfficialPlugins}
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
              <div className="eac-market__notice eac-market__notice--warning" style={{ marginTop: 18 }}>
                有插件在等待重启。新版本已保存，下次启动 DSH 才会使用。
              </div>
            )}
          </>
        )}

        {skinVisited && <div hidden={view !== 'skins'}><SkinCenter
          catalog={state.catalog} inventory={state.inventory.items} skinService={skinService}
          onBack={() => { setView(skinOrigin); window.requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollPositions.current.get(`${skinOrigin}:${filters.category}:${filters.query}:${page}`) ?? 0 })) }}
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
            <header className="eac-market__page-head"><div><h1>上手帮助</h1><p>第一次使用只需要三步。安装不是教程完成条件。</p></div></header>
            <div className="eac-market__help-steps">
              {HELP_STEPS.map((step, index) => (
                <section className="eac-market__help-step" key={step.title}>
                  <Tag tone="info">第 {index + 1} 步</Tag><h3>{step.title}</h3><p>{step.text}</p>
                </section>
              ))}
            </div>
            <section className="eac-market__section">
              <div className="eac-market__section-head"><h2>常见问题</h2></div>
              <div className="eac-market__grid grid--two eac-market__grid--two">
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
            <header className="eac-market__page-head"><div><h1>设置</h1><p>查看目录、外观和诊断信息。</p></div></header>
            <div className="eac-market__settings-list">
              <section className="eac-market__setting">
                <div><h3>目录状态</h3><p>目录来源：{{ embedded: '随包目录', online: '在线目录', cache: '本地缓存' }[state.catalog.origin]}{state.catalog.stale ? '（缓存已过期）' : ''} · 目录生成时间：{new Date(state.catalog.generatedAt).toLocaleString('zh-CN')}。刷新目录不会安装或更新插件。</p></div>
                <Button variant="outline" disabled={catalogBusy || remote.refreshCatalog === undefined} onClick={() => void refreshCatalog()}>刷新目录</Button>
              </section>
              <section className="eac-market__setting">
                <div><h3>下载来源</h3><p>自动使用已登记并通过文件校验的同版本来源。</p></div>
                <Status tone="neutral">自动优先</Status>
              </section>
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
                <Button variant="outline" disabled={remote.exportDiagnostic === undefined} onClick={() => void exportDiagnostic()}>导出诊断</Button>
              </section>
            </div>
            {diagnostic !== undefined && (
              <div className="eac-market__notice" role="status">
                诊断已生成（{diagnostic.generatedAt}）：<br />{diagnostic.summaries.join('；')}
              </div>
            )}
          </>
        )}

        {view === 'extension' && <section><Button variant="outline" onClick={() => navigate('discover')}>返回发现</Button>{surface(EXTENSION_SLOTS.page)}</section>}
        <div hidden={view !== 'author'}><AuthorWorkspace remote={remote} onDraftSnapshot={setExtensionDraft} draftChange={draftChange} supplemental={<>{authorSupplemental}{surface(EXTENSION_SLOTS.author)}</>} /></div>

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
      <Modal open={tutorialOpen} onClose={() => setTutorialOpen(false)} title="三步上手" closeLabel="关闭教程">
        <div className="eac-market__help-steps">{HELP_STEPS.map((step, index) => <section className="eac-market__help-step" key={step.title}><Tag tone="info">第 {index + 1} 步</Tag><h3>{step.title}</h3><p>{step.text}</p></section>)}</div>
      </Modal>

    </div>
  )
}

export function MarketFrame({ view, activeCount, onNavigate, onTasks, onMore, moreMenu, onSecondary, scrollRef, children, moreSupplemental }: {
  readonly view: MarketView
  readonly activeCount: number
  readonly onNavigate: (view: PrimaryView) => void
  readonly onTasks: () => void
  readonly onMore: () => void
  readonly moreMenu: boolean
  readonly onSecondary: (view: 'help' | 'settings' | 'author') => void
  readonly moreSupplemental?: React.ReactNode
  readonly scrollRef?: React.Ref<HTMLDivElement>
  readonly children: React.ReactNode
}): React.JSX.Element {
  const currentTab = pageTab(view)
  const moreTrigger = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (moreMenu) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus() }, [moreMenu])
  return (
    <div className="eac-market">
      <style dangerouslySetInnerHTML={{ __html: MARKET_CSS }} />
      <div className="eac-market__scroll" ref={scrollRef} tabIndex={0} role="region" aria-label="市场内容">
        <div className="eac-market__shell">
          <header className="eac-market__topbar">
            <div className="eac-market__brand"><strong>EAC</strong><span>插件市场</span></div>
            <nav className="eac-market__nav" aria-label="市场主导航">
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
          <main className="eac-market__main">{children}</main>
        </div>
      </div>
    </div>
  )
}

export function DiscoverView({ catalog, inventory, onOpen, onInstall, onPack, onCollection, onBrowse, onHelp, onSettings, skinEntry, supplemental }: {
  readonly catalog: CatalogSnapshot
  readonly inventory: readonly InventoryItem[]
  readonly onOpen: (plugin: CatalogPlugin) => void
  readonly onInstall: (plugin: CatalogPlugin) => void
  readonly onPack: (pack: CatalogPack) => void
  readonly onCollection?: ((collection: CatalogCollectionView) => void) | undefined
  readonly onBrowse: (category?: string) => void
  readonly onHelp: () => void
  readonly onSettings?: (() => void) | undefined
  readonly skinEntry?: React.ReactNode
  readonly supplemental?: React.ReactNode
}): React.JSX.Element {
  catalog = { ...catalog, plugins: catalog.plugins.filter((plugin) => !isSkinPlugin(plugin) && plugin.packageName !== SKIN_LOADER_PACKAGE) }
  const categories = categoriesOf(catalog.plugins)
  const recommended = (catalog.recommendations ?? []).filter((record) => record.placement === 'featured' && record.reason.trim() !== '').sort((a, b) => a.order - b.order || a.pluginId.localeCompare(b.pluginId)).flatMap((record) => { const plugin = catalog.plugins.find((item) => recommendationMatches(record, item)); return plugin ? [{ plugin, reason: record.reason }] : [] })
  const ruleSorted = browseSortPlugins(catalog.plugins.filter(plugin => plugin.installability === 'bundle-installable' && plugin.verification !== 'hard-incompatible'), 'rules')
  return (
    <>
      <header className="eac-market__page-head eac-market__discover-head">
        <div><h1>发现适合你的插件</h1><p>浏览用途和安装条件，按需扩展 DSH。</p></div>
        <div className="eac-market__button-row"><Button variant="primary" onClick={() => onBrowse()}>搜索全部插件</Button><Button variant="ghost" onClick={onHelp}>使用帮助</Button></div>
      </header>
      {skinEntry}
      {catalog.plugins.length === 0 ? (
        <section className="eac-market__notice"><strong>目录暂无功能插件</strong><p>可到设置刷新目录，或在「我的插件」查看已有功能。外观集中在皮肤中心。</p>{onSettings && <Button variant="outline" onClick={onSettings}>查看目录设置</Button>}</section>
      ) : (
        <>
          {recommended.length > 0 && <section className="eac-market__section">
            <div className="eac-market__section-head"><h2>团队精选</h2><p>每项推荐都有对应理由。</p></div>
            <div className="eac-market__grid">{recommended.slice(0, 6).map(({ plugin, reason }) => <div key={plugin.id + ":" + plugin.version}><p className="eac-market__recommendation">推荐理由：{reason}</p><PluginCard plugin={plugin} inventory={inventory} onOpen={onOpen} onInstall={onInstall} /></div>)}</div>
          </section>}

          <section className="eac-market__section">
            <div className="eac-market__section-head">
              <div><h2>规则发现</h2><p>仅展示已有安装包的功能。排序依据：兼容状态、用途和发布时间；待适配内容在全部插件中保留。</p></div>
            </div>
            {categories.length > 0 && (
              <div className="eac-market__filters" aria-label="按用途进入全部插件">
                {categories.map((category) => <Pill key={category} onClick={() => onBrowse(category)}>{category}</Pill>)}
              </div>
            )}
            <div className="eac-market__grid">
              {ruleSorted.slice(0, 6).map((plugin) => <PluginCard key={plugin.id + ":" + plugin.version} plugin={plugin} inventory={inventory} onOpen={onOpen} onInstall={onInstall} />)}
            </div>
          </section>

          {catalog.packs.length > 0 && (
            <section className="eac-market__section">
              <div className="eac-market__section-head"><h2>套餐</h2><p>一次查看所有组件与版本调整。</p></div>
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
        <div className="eac-market__section-head"><h2>市场组合</h2><p>按组合列出的确切版本预检，逐项确认安装范围。</p></div>
        <div className="eac-market__grid eac-market__grid--two">{catalog.collections?.map((collection) => <article className="eac-market__card" key={collection.id + ':' + collection.version} data-collection-id={collection.id}>
          <div className="eac-market__tags"><Tag tone="info">市场组合</Tag><Status tone={collection.execution.coverage === 'complete' ? 'success' : 'warning'}>{packCoverageLabel(collection.execution.coverage)}</Status></div>
          <h3>{collection.name}</h3><p className="eac-market__plugin-summary">{collection.summary}</p>
          <div className="eac-market__plugin-bottom"><span className="eac-market__status">{collection.components.length} 个组件 · {collection.version}</span><Button size="sm" variant="primary" disabled={onCollection === undefined} onClick={() => onCollection?.(collection)}>查看组合变更</Button></div>
        </article>)}</div>
      </section>}
      {supplemental}
    </>
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
  const blocked = !canInstall || plugin.verification === 'hard-incompatible' || plugin.installability !== 'bundle-installable'
  return (
    <>
      <Button variant="ghost" onClick={onBack}>{backLabel ?? '返回插件列表'}</Button>
      <div className="eac-market__detail">
        <div className="eac-market__detail-main">
          <div className="eac-market__plugin-head">
            <span className="eac-market__plugin-icon" aria-hidden="true">{plugin.name.slice(0, 1).toUpperCase()}</span>
            <div><h1>{plugin.name}</h1><p>{plugin.author} · {plugin.packageName} · {plugin.version}</p></div>
          </div>
          <p className="eac-market__lead">{plugin.summary || '作者尚未提供一句话简介。'}</p>
          <div className="eac-market__button-row">
            <Button variant="primary" disabled={blocked || installed !== undefined} title={!canInstall ? '当前 DSH 运行时未开放正式安装计划' : blocked ? installabilityLabel(plugin.installability) : installed !== undefined ? '已安装，请到我的插件管理' : undefined} onClick={() => onInstall(plugin)}>
              {installed !== undefined ? '已安装' : blocked ? '暂不可安装' : plugin.verification === 'unverified' || plugin.verification === 'unknown' ? '确认安装条件' : '安装'}
            </Button>
            {installed !== undefined && updatePlugin !== undefined && hasCatalogUpdate(installed, updatePlugin) && canInstall && onUpdate !== undefined && (
              <Button variant="primary" onClick={() => onUpdate(updatePlugin)}>更新到 {updatePlugin.version}</Button>
            )}
            {installed?.restartRequired === true && <Status tone="warning">需要重启</Status>}
          </div>
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
              {plugin.verification === 'hard-incompatible' ? '此版本与当前环境已知不兼容，不能用“仍然尝试安装”绕过。' : `${verificationLabel(plugin.verification)}。${installabilityLabel(plugin.installability)}。未验证内容只有在可安装时才能进入明确确认流程。`}
            </div>
          )}
          <ScreenshotGallery screenshots={plugin.screenshots} />
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
          <details><summary>来源与兼容详情</summary>
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
