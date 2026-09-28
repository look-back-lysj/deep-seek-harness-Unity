import { useEffect, useRef, useState } from 'react'
import { Button, Input, MarkdownText, Modal, Pill, Tag } from './ui.tsx'
import type {
  AuthorDraft,
  AuthorDraftInput,
  CatalogPack,
  CatalogPlugin,
  CatalogPresentation,
  CatalogSnapshot,
  DiagnosticExport,
  InventoryItem,
  TaskState,
  TransferResult,
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
  taskStateIsNewer,
  type BrowseSortMode,
  filterPlugins,
  findPlugin,
  installabilityLabel,
  isInstalled,
  packCoverageLabel,
  presentationForPlugin,
  verificationLabel,
  type LoadState,
  type MarketRemote,
  type MarketView,
  type PluginFilters,
  type PrimaryView,
} from './model.ts'
import {
  EmptyState,
  FileTransferField,
  InstallPlanDialog,
  InventoryCard,
  PluginCard,
  ScreenshotGallery,
  SearchField,
  Status,
  TaskDrawer,
  errorMessage,
  formatTransferStatus,
  type PlanTarget,
} from './components.tsx'
import { MARKET_CSS } from './marketStyles.ts'

export type { MarketRemote } from './model.ts'

export interface MarketPageProps {
  readonly remote: MarketRemote
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
  return view === 'all' || view === 'detail' ? 'all' : view === 'mine' ? 'mine' : 'discover'
}

function initialDraft(): AuthorDraft {
  return {
    id: `draft-${Date.now()}`,
    revision: 'local-1',
    title: '',
    summary: '',
    markdown: '## 功能说明\n\n用简洁的标题、步骤和示例说明插件解决什么问题。\n\n## 使用方法\n\n1. 安装并完成必要设置\n2. 打开插件入口\n3. 按示例完成第一次使用\n',
    mediaIds: [],
    updatedAt: new Date().toISOString(),
  }
}

function draftInput(draft: AuthorDraft): AuthorDraftInput {
  return {
    id: draft.id,
    expectedRevision: draft.revision,
    title: draft.title,
    summary: draft.summary,
    markdown: draft.markdown,
    ...(draft.pluginId === undefined ? {} : { pluginId: draft.pluginId }),
    ...(draft.pluginVersion === undefined ? {} : { pluginVersion: draft.pluginVersion }),
    mediaIds: draft.mediaIds,
    ...(draft.sourceCommit === undefined ? {} : { sourceCommit: draft.sourceCommit }),
    ...(draft.sourceUrl === undefined ? {} : { sourceUrl: draft.sourceUrl }),
  }
}

function packPlugins(pack: CatalogPack, catalogPlugins: readonly CatalogPlugin[]): readonly CatalogPlugin[] {
  return pack.components.flatMap((component) => {
    const plugin = catalogPlugins.find((item) => item.id === component.pluginId)
    return plugin === undefined ? [] : [plugin]
  })
}

export function MarketPage({ remote }: MarketPageProps): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [view, setView] = useState<MarketView>('discover')
  const [previousView, setPreviousView] = useState<PrimaryView>('discover')
  const [selectedPluginId, setSelectedPluginId] = useState<string | undefined>(undefined)
  const [filters, setFilters] = useState<PluginFilters>(EMPTY_FILTERS)
  const [advanced, setAdvanced] = useState(false)
  const [page, setPage] = useState(1)
  const [taskDrawer, setTaskDrawer] = useState(false)
  const [moreMenu, setMoreMenu] = useState(false)
  const [planTarget, setPlanTarget] = useState<PlanTarget | undefined>(undefined)
  const [removeTarget, setRemoveTarget] = useState<InventoryItem | undefined>(undefined)
  const [actionNotice, setActionNotice] = useState('')
  const [draft, setDraft] = useState<AuthorDraft>(initialDraft)
  const [draftDirty, setDraftDirty] = useState(false)
  const [draftNotice, setDraftNotice] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [transfer, setTransfer] = useState<TransferResult | undefined>(undefined)
  const [diagnostic, setDiagnostic] = useState<DiagnosticExport | undefined>(undefined)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [browseSort, setBrowseSort] = useState<BrowseSortMode>('rules')
  const [systemOpen, setSystemOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const scrollPositions = useRef(new Map<string, number>())
  const pollingRef = useRef(false)


  async function load(showLoading = true): Promise<void> {
    if (showLoading) setState({ status: 'loading' })
    try {
      const [hello, catalog, inventory, tasks] = await Promise.all([
        remote.hello(),
        remote.catalog(),
        remote.inventory(),
        remote.listTasks?.() ?? Promise.resolve([]),
      ])
      setState({ status: 'ready', hello, catalog, inventory, tasks })
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) })
    }
  }

  useEffect(() => {
    void load()
  }, [remote])

  useEffect(() => {
    if (state.status !== 'ready' || remote.getTask === undefined) return
    const pending = state.tasks.filter((task) => activeTasks([task]).length > 0)
    if (pending.length === 0) return
    let disposed = false
    async function pollOnce(): Promise<void> {
      if (disposed || pollingRef.current) return
      pollingRef.current = true
      try {
        let becameTerminal = false
        for (const previous of pending) {
          if (disposed) break
          try {
            const task = await remote.getTask?.({ taskId: previous.taskId })
            if (disposed || task === undefined) continue
            becameTerminal ||= activeTasks([task]).length === 0
            setState((current) => {
              if (current.status !== 'ready') return current
              const index = current.tasks.findIndex((item) => item.taskId === task.taskId)
              if (index < 0 || !taskStateIsNewer(current.tasks[index], task)) return current
              return { ...current, tasks: current.tasks.map((item, itemIndex) => itemIndex === index ? task : item) }
            })
          } catch {
            // A transient read failure keeps the last real state visible.
          }
        }
        if (becameTerminal && !disposed) {
          try {
            const inventory = await remote.inventory()
            if (!disposed) setState((current) => current.status === 'ready' ? { ...current, inventory } : current)
          } catch {
            // The next manual refresh will reconcile inventory.
          }
        }
      } finally {
        pollingRef.current = false
      }
    }
    const timer = window.setInterval(() => { void pollOnce() }, 700)
    void pollOnce()
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [remote, state])

  useEffect(() => {
    if (state.status !== 'ready') return
    const plugin = findPlugin(state.catalog, selectedPluginId)
    if (view === 'detail' && plugin === undefined) setView(previousView)
  }, [state, selectedPluginId, view, previousView])

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (!(event.target instanceof Element) || !event.target.closest('.eac-market__menu-wrap')) setMoreMenu(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const selectedPlugin = state.status === 'ready' ? findPlugin(state.catalog, selectedPluginId) : undefined
  const activeCount = state.status === 'ready' ? activeTasks(state.tasks).length : 0

  function navigate(next: PrimaryView): void {
    setView(next)
    setPreviousView(next)
    setPage(1)
    setActionNotice('')
  }

  function openDetail(plugin: CatalogPlugin): void {
    if (state.status !== 'ready') return
    const from = pageTab(view)
    scrollPositions.current.set(`${from}:${filters.category}:${filters.query}:${page}`, scrollRef.current?.scrollTop ?? 0)
    setPreviousView(from)
    setSelectedPluginId(plugin.id)
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
    setPlanTarget({ plugin, plugins: [plugin] })
    setActionNotice('')
  }

  function openPlanForPack(pack: CatalogPack): void {
    if (state.status !== 'ready') return
    const plugins = packPlugins(pack, state.catalog.plugins)
    setPlanTarget({ pack, plugins })
    setActionNotice('')
  }

  function updateTask(task: TaskState): void {
    setState((current) => {
      if (current.status !== 'ready') return current
      const index = current.tasks.findIndex((item) => item.taskId === task.taskId)
      if (index < 0) return { ...current, tasks: [...current.tasks, task] }
      if (!taskStateIsNewer(current.tasks[index], task)) return current
      return { ...current, tasks: current.tasks.map((item, itemIndex) => itemIndex === index ? task : item) }
    })
    setTaskDrawer(true)
  }

  async function refreshCatalog(): Promise<void> {
    setActionNotice('')
    try {
      if (remote.refreshCatalog === undefined) throw new Error('当前 DSH 运行时未开放目录刷新能力')
      const catalog = await remote.refreshCatalog()
      setState((current) => current.status === 'ready' ? { ...current, catalog } : current)
      setActionNotice('目录已刷新。刷新目录不会安装或更新用户插件。')
    } catch (error) {
      setActionNotice(errorMessage(error))
    }
  }

  async function toggleInventory(item: InventoryItem, enabled: boolean): Promise<void> {
    setActionNotice('')
    try {
      if (remote.setPluginEnabled === undefined) throw new Error('当前 DSH 运行时未开放启用/停用能力')
      const action = await remote.setPluginEnabled({
        packageName: item.packageName,
        ...(item.version === undefined ? {} : { expectedVersion: item.version }),
        enabled,
        idempotencyKey: createIdempotencyKey('market-enable'),
      })
      const feedback = pluginActionFeedback(action, enabled)
      try {
        const inventory = await remote.inventory()
        setState((current) => current.status === 'ready' ? { ...current, inventory } : current)
      } catch (inventoryError) {
        setActionNotice(`${feedback.message} 库存刷新失败：${errorMessage(inventoryError)}`)
        return
      }
      setActionNotice(feedback.message)
    } catch (error) {
      setActionNotice(errorMessage(error))
    }
  }

  async function removeInventory(item: InventoryItem): Promise<void> {
    setActionNotice('')
    try {
      if (remote.removePlugin === undefined) throw new Error('当前 DSH 运行时未开放卸载能力')
      const action = await remote.removePlugin({
        packageName: item.packageName,
        ...(item.version === undefined ? {} : { expectedVersion: item.version }),
        confirmed: true,
        idempotencyKey: createIdempotencyKey('market-remove'),
      })
      const inventory = await remote.inventory()
      setState((current) => current.status === 'ready' ? { ...current, inventory } : current)
      setRemoveTarget(undefined)
      if (action.status === 'failed') setActionNotice(action.error ? `卸载失败：${action.error}` : '卸载失败，官方结果未变为成功。')
      else if (action.status === 'unknown') setActionNotice('卸载结果未知，已重新读取库存；请核对后再继续。')
      else if (action.status === 'restart-required') setActionNotice('卸载请求已保存，需要重启 DSH 后才会完全生效。')
      else setActionNotice('已调用官方卸载。市场未额外清理独立配置、用户文件或未知目录。')
    } catch (error) {
      setActionNotice(errorMessage(error))
    }
  }

  async function saveDraft(): Promise<void> {
    setDraftNotice('')
    try {
      const updated = { ...draft, updatedAt: new Date().toISOString() }
      if (remote.saveDraft !== undefined) {
        const saved = await remote.saveDraft(draftInput(updated))
        setDraft(saved)
        try { window.localStorage.removeItem('eac-market-author-draft') } catch {}
      } else {
        setDraft(updated)
        window.localStorage.setItem('eac-market-author-draft', JSON.stringify(updated))
      }
      setDraftDirty(false)
      setDraftNotice('草稿已保存在当前客户端。没有在线投稿或发布状态。')
    } catch (error) {
      setDraftNotice(errorMessage(error))
    }
  }

  async function importReadme(): Promise<void> {
    setDraftNotice('')
    try {
      if (remote.importReadme === undefined) throw new Error('当前 DSH 运行时未开放 README 导入能力')
      const result = await remote.importReadme({
        repositoryUrl: repoUrl,
        ...(draft.id === undefined ? {} : { targetDraftId: draft.id }),
      })
      setDraft(result.draft)
      setDraftDirty(true)
      setDraftNotice(`已导入 ${result.repositoryUrl} 的 README，提交 ${result.commit}。${result.mediaWarnings.join('；')}`)
    } catch (error) {
      setDraftNotice(errorMessage(error))
    }
  }

  function importLocalMarkdown(file: File | undefined): void {
    if (file === undefined) return
    void file.text().then((text) => {
      setDraft((current) => ({
        ...current,
        title: current.title || file.name.replace(/\.md$/i, ''),
        markdown: text,
        updatedAt: new Date().toISOString(),
      }))
      setDraftDirty(true)
      setDraftNotice('Markdown 已载入草稿。若文件较大，请继续用分块传输保存附件。')
    }).catch((error: unknown) => setDraftNotice(errorMessage(error)))
  }

  function exportDraft(): void {
    const payload = JSON.stringify({ schemaVersion: '1', kind: 'eac-author-presentation', draft: draftInput(draft) }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${draft.title.trim() || 'eac-author-presentation'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setDraftNotice('已准备下载介绍资料包。保存完成后可交给团队校验；这不是“已上架”。')
  }

  async function exportDiagnostic(): Promise<void> {
    setActionNotice('')
    try {
      if (remote.exportDiagnostic === undefined) throw new Error('当前 DSH 运行时未开放诊断导出能力')
      setDiagnostic(await remote.exportDiagnostic())
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
          <Button variant="primary" onClick={() => void load()}>重新读取</Button>
        </section>
      </MarketFrame>
    )
  }

  const filtered = browseSortPlugins(filterPlugins(state.catalog.plugins, state.inventory.items, filters), browseSort)
  const inventoryPartition = partitionInventory(state.inventory.items, state.catalog.plugins)
  const perPage = 24
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage))
  const visible = filtered.slice((page - 1) * perPage, page * perPage)

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
      >
        {actionNotice && <div className="eac-market__notice" role="status">{actionNotice}</div>}

        {view === 'discover' && (
          <DiscoverView
            catalog={state.catalog}
            inventory={state.inventory.items}
            onOpen={openDetail}
            onInstall={openPlanForPlugin}
            onPack={openPlanForPack}
            onBrowse={browse}
            onHelp={() => setView('help')}
          />
        )}

        {view === 'all' && (
          <>
            <header className="eac-market__page-head">
              <div><h1>全部插件</h1><p>按用途、作者或包名查找。未验证、已知不兼容和缺少安装包会明确区分。</p></div>
              <Button variant="outline" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}>高级筛选</Button>
            </header>
            <div className="eac-market__toolbar">
              <SearchField value={filters.query} onChange={(query) => { setFilters({ ...filters, query }); setPage(1) }} />
              <div className="eac-market__filters">
                <label className="eac-market__sr-only" htmlFor="eac-category">用途分类</label>
                <select id="eac-category" value={filters.category} onChange={(event) => { setFilters({ ...filters, category: event.currentTarget.value }); setPage(1) }}>
                  <option value="all">全部用途</option>
                  {categoriesOf(state.catalog.plugins).map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
                <label className="eac-market__sr-only" htmlFor="eac-sort">排序</label>
                <select id="eac-sort" value={browseSort} onChange={(event) => setBrowseSort(event.currentTarget.value as BrowseSortMode)}>
                  <option value="rules">规则排序（默认）</option>
                  <option value="compatibility">兼容性优先</option>
                  <option value="recommended">推荐标记优先（由我选择）</option>
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
                {visible.map((plugin) => <PluginCard key={plugin.id} plugin={plugin} inventory={state.inventory.items} onOpen={openDetail} onInstall={openPlanForPlugin} />)}
              </div>
            )}
            {pageCount > 1 && (
              <nav className="eac-market__pagination" aria-label="插件分页">
                <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</Button>
                <span>第 {page} / {pageCount} 页</span>
                <Button variant="outline" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</Button>
              </nav>
            )}
          </>
        )}

        {view === 'mine' && (
          <>
            <header className="eac-market__page-head">
              <div><h1>我的插件</h1><p>这里只显示官方插件管理器返回的真实安装和启停状态。</p></div>
            </header>
            {state.inventory.unknownItems.length > 0 && (
              <div className="eac-market__notice eac-market__notice--warning">
                有 {state.inventory.unknownItems.length} 个条目无法归类：{state.inventory.unknownItems.join('、')}
              </div>
            )}
            {state.inventory.items.length === 0 ? (
              <EmptyState title="尚未识别到已安装插件" description="你可以先浏览全部插件。安装后，状态会由官方插件管理器同步到这里。" action={<Button variant="primary" onClick={() => navigate('all')}>查看全部插件</Button>} />
            ) : (
              <>
                <div className="eac-market__grid">
                  {inventoryPartition.userItems.map((item) => (
                    <InventoryCard
                      key={item.packageName}
                      item={item}
                      catalogPlugin={state.catalog.plugins.find((plugin) => plugin.packageName === item.packageName)}
                      onToggle={(target, enabled) => void toggleInventory(target, enabled)}
                      onRemove={setRemoveTarget}
                      onUpdate={(_target, plugin) => openPlanForPlugin(plugin)}
                    />
                  ))}
                </div>
                {inventoryPartition.systemItems.some((item) => item.rows.some((row) => row.state === 'load-error' || row.state === 'unknown') || item.restartRequired) && (
                  <section className="eac-market__section" aria-labelledby="system-attention-title">
                    <div className="eac-market__section-head"><h2 id="system-attention-title">系统组件需处理</h2><p>这些真实错误和重启状态不会被折叠隐藏。</p></div>
                    <div className="eac-market__grid">
                      {inventoryPartition.systemItems.filter((item) => item.rows.some((row) => row.state === 'load-error' || row.state === 'unknown') || item.restartRequired).map((item) => (
                        <InventoryCard
                          key={`attention-${item.packageName}`}
                          item={item}
                          catalogPlugin={state.catalog.plugins.find((plugin) => plugin.packageName === item.packageName)}
                          onToggle={(target, enabled) => void toggleInventory(target, enabled)}
                          onRemove={setRemoveTarget}
                          onUpdate={(_target, plugin) => openPlanForPlugin(plugin)}
                        />
                      ))}
                    </div>
                  </section>
                )}
                <details className="eac-market__system-group" open={systemOpen} onToggle={(event) => setSystemOpen(event.currentTarget.open)}>
                  <summary>系统组件（{inventoryPartition.systemItems.length}）</summary>
                  <p className="eac-market__system-note">默认折叠的是系统内部组件，不按包名前缀猜测；展开后仍显示真实版本、启停、错误和只读原因。</p>
                  <div className="eac-market__grid">
                    {inventoryPartition.systemItems.filter((item) => !(item.rows.some((row) => row.state === 'load-error' || row.state === 'unknown') || item.restartRequired)).map((item) => (
                      <InventoryCard
                        key={`system-${item.packageName}`}
                        item={item}
                        catalogPlugin={state.catalog.plugins.find((plugin) => plugin.packageName === item.packageName)}
                        onToggle={(target, enabled) => void toggleInventory(target, enabled)}
                        onRemove={setRemoveTarget}
                        onUpdate={(_target, plugin) => openPlanForPlugin(plugin)}
                      />
                    ))}
                  </div>
                </details>
              </>
            )}
            {state.inventory.items.some((item) => item.restartRequired) && (
              <div className="eac-market__notice eac-market__notice--warning" style={{ marginTop: 18 }}>
                有插件在等待重启。新版本已保存，下次启动 DSH 才会使用。
              </div>
            )}
          </>
        )}

        {view === 'detail' && selectedPlugin !== undefined && (
          <DetailView
            plugin={selectedPlugin}
            presentation={presentationForPlugin(state.catalog, selectedPlugin)}
            inventory={state.inventory.items}
            onBack={backFromDetail}
            onInstall={openPlanForPlugin}
            onUpdate={openPlanForPlugin}
            canInstall={remote.createPlan !== undefined && remote.startTask !== undefined}

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
            <header className="eac-market__page-head"><div><h1>设置</h1><p>只展示当前 DSH 契约真正支持的设置，不创建无法工作的开关。</p></div></header>
            <div className="eac-market__settings-list">
              <section className="eac-market__setting">
                <div><h3>目录状态</h3><p>目录来源：{state.catalog.origin}{state.catalog.stale ? '（缓存已过期）' : ''} · 修订 {state.catalog.revision}。刷新目录不会安装或更新插件。</p></div>
                <Button variant="outline" disabled={remote.refreshCatalog === undefined} onClick={() => void refreshCatalog()}>刷新目录</Button>
              </section>
              <section className="eac-market__setting">
                <div><h3>下载来源</h3><p>自动优先使用经核验的同版本来源。当前冻结 Host 契约未提供来源偏好写入，因此不显示假开关。</p></div>
                <Status tone="neutral">自动优先</Status>
              </section>
              <section className="eac-market__setting">
                <div><h3>缓存清理</h3><p>只清理不使用中的下载缓存；不会删除插件配置或用户文件。当前 Host 契约未提供缓存管理。</p></div>
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

        {view === 'author' && (
          <>
            <header className="eac-market__page-head">
              <div><h1>作者资料编辑器</h1><p>本地编辑和预览插件介绍，导出后交给团队私下校验。MVP 不提供在线投稿、认领或发布。</p></div>
              <Status tone={draftDirty ? 'warning' : 'neutral'}>{draftDirty ? '有未保存修改' : '草稿已同步'}</Status>
            </header>
            <div className="eac-market__button-row" style={{ marginBottom: 16 }}>
              <Button variant="primary" onClick={() => void saveDraft()}>保存草稿</Button>
              <Button variant="outline" onClick={exportDraft}>准备导出资料包</Button>
              <label className="eac-market__link" style={{ cursor: 'pointer' }}>
                导入本地 Markdown
                <input className="eac-market__sr-only" type="file" accept=".md,text/markdown" onChange={(event) => importLocalMarkdown(event.currentTarget.files?.[0])} />
              </label>
            </div>
            <div className="eac-market__split">
              <section>
                <div className="eac-market__form">
                  <div className="eac-market__field"><label htmlFor="draft-title">标题</label><Input id="draft-title" value={draft.title} placeholder="例如：结构化任务面板" onChange={(event) => { setDraft({ ...draft, title: event.currentTarget.value }); setDraftDirty(true) }} /></div>
                  <div className="eac-market__field"><label htmlFor="draft-summary">一句话简介</label><Input id="draft-summary" value={draft.summary} placeholder="用一句话说明用户能得到什么" onChange={(event) => { setDraft({ ...draft, summary: event.currentTarget.value }); setDraftDirty(true) }} /></div>
                  <div className="eac-market__field"><label htmlFor="draft-markdown">图文正文</label><small>支持 Markdown 标题、段落、列表、表格、代码示例和 HTTPS 图片。代码只复制，不执行。</small><textarea id="draft-markdown" value={draft.markdown} onChange={(event) => { setDraft({ ...draft, markdown: event.currentTarget.value }); setDraftDirty(true) }} /></div>
                  <div className="eac-market__field"><label>附件分块传输</label><FileTransferField remote={remote} purpose="draft-media" label="选择图片或附件" accept="image/*,.json,.zip" onComplete={(result) => { setTransfer(result); setDraft({ ...draft, mediaIds: [...draft.mediaIds, result.resultId ?? result.transferId] }); setDraftDirty(true) }} /><small>{formatTransferStatus(transfer)}。文件以 base64 文本块发送，避免 JSON 二进制不兼容。</small></div>
                  <div className="eac-market__field">
                    <label htmlFor="repo-url">从 GitHub README 导入</label>
                    <small>必须由 Host 获取并保留仓库、提交和署名信息；市场不自行抓取任意网页。</small>
                    <div className="eac-market__button-row"><Input id="repo-url" value={repoUrl} placeholder="https://github.com/owner/repository" onChange={(event) => setRepoUrl(event.currentTarget.value)} /><Button variant="outline" disabled={remote.importReadme === undefined || repoUrl.trim() === ''} onClick={() => void importReadme()}>导入 README</Button></div>
                  </div>
                </div>
              </section>
              <section>
                <div className="eac-market__section-head"><h2>阅读预览</h2></div>
                <div className="eac-market__preview eac-market__prose">
                  <h1>{draft.title || '未命名插件介绍'}</h1>
                  <p style={{ color: 'var(--eac-text-2)' }}>{draft.summary || '还没有一句话简介。'}</p>
                  <MarkdownText text={draft.markdown} labels={MARKDOWN_LABELS} />
                </div>
              </section>
            </div>
            {draftNotice && <div className="eac-market__notice" role="status">{draftNotice}</div>}
          </>
        )}

        <p className="eac-market__footer-note">EAC 是社区整合市场，不代表 DeepSeek 官方认证。MVP 不提供 Star、GitHub 登录或在线投稿。</p>
      </MarketFrame>

      <TaskDrawer
        open={taskDrawer}
        tasks={state.status === 'ready' ? state.tasks : []}
        onClose={() => setTaskDrawer(false)}
        remote={remote}
        onChanged={updateTask}
      />
      <InstallPlanDialog
        target={planTarget}
        inventory={state.inventory.items}
        remote={remote}
        open={planTarget !== undefined}
        onClose={() => setPlanTarget(undefined)}
        onStarted={updateTask}
      />
      <Modal open={removeTarget !== undefined} onClose={() => setRemoveTarget(undefined)} title="确认卸载" closeLabel="关闭卸载确认">
        <p>将卸载 <strong>{removeTarget?.packageName}</strong>。只调用必要卸载能力，不额外清理独立配置、用户文件或未知目录。</p>
        <div className="eac-market__button-row"><Button variant="outline" onClick={() => setRemoveTarget(undefined)}>取消</Button><Button variant="primary" onClick={() => { if (removeTarget !== undefined) void removeInventory(removeTarget) }}>确认卸载</Button></div>
      </Modal>
      <Modal open={tutorialOpen} onClose={() => setTutorialOpen(false)} title="三步上手" closeLabel="关闭教程">
        <div className="eac-market__help-steps">{HELP_STEPS.map((step, index) => <section className="eac-market__help-step" key={step.title}><Tag tone="info">第 {index + 1} 步</Tag><h3>{step.title}</h3><p>{step.text}</p></section>)}</div>
      </Modal>

    </div>
  )
}

export function MarketFrame({ view, activeCount, onNavigate, onTasks, onMore, moreMenu, onSecondary, scrollRef, children }: {
  readonly view: MarketView
  readonly activeCount: number
  readonly onNavigate: (view: PrimaryView) => void
  readonly onTasks: () => void
  readonly onMore: () => void
  readonly moreMenu: boolean
  readonly onSecondary: (view: 'help' | 'settings' | 'author') => void
  readonly scrollRef?: React.Ref<HTMLDivElement>
  readonly children: React.ReactNode
}): React.JSX.Element {
  const currentTab = pageTab(view)
  return (
    <div className="eac-market">
      <style dangerouslySetInnerHTML={{ __html: MARKET_CSS }} />
      <div className="eac-market__scroll" ref={scrollRef}>
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
                <button type="button" className="eac-market__top-action" aria-haspopup="menu" aria-expanded={moreMenu} onClick={onMore}>更多</button>
                {moreMenu && (
                  <div className="eac-market__menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => onSecondary('settings')}>设置</button>
                    <button type="button" role="menuitem" onClick={() => onSecondary('author')}>作者工具</button>
                    <button type="button" role="menuitem" onClick={() => onSecondary('help')}>关于 EAC</button>
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

export function DiscoverView({ catalog, inventory, onOpen, onInstall, onPack, onBrowse, onHelp }: {
  readonly catalog: CatalogSnapshot
  readonly inventory: readonly InventoryItem[]
  readonly onOpen: (plugin: CatalogPlugin) => void
  readonly onInstall: (plugin: CatalogPlugin) => void
  readonly onPack: (pack: CatalogPack) => void
  readonly onBrowse: (category?: string) => void
  readonly onHelp: () => void
}): React.JSX.Element {
  const categories = categoriesOf(catalog.plugins)
  const recommended = catalog.plugins.filter((plugin) => plugin.distribution === 'recommended')
  const ruleSorted = browseSortPlugins(catalog.plugins, 'rules')
  return (
    <>
      <section className="eac-market__hero">
        <div>
          <h1>精选功能，轻松装进 DSH</h1>
          <p>EAC 把插件用途、真实版本、安装条件和使用入口放在一起。先看懂，再按需安装，不需要命令行或包名知识。</p>
          <div className="eac-market__hero-actions">
            <Button variant="primary" onClick={() => onBrowse()}>搜索全部插件</Button>
            <Button variant="outline" onClick={onHelp}>查看三步上手</Button>
          </div>
        </div>
        <div className="eac-market__steps" aria-label="使用步骤">
          {HELP_STEPS.map((step, index) => (
            <div className="eac-market__step" key={step.title}>
              <span className="eac-market__step-number">{index + 1}</span>
              <div><strong>{step.title}</strong><span>{step.text}</span></div>
            </div>
          ))}
        </div>
      </section>

      {catalog.plugins.length === 0 ? (
        <section className="eac-market__section">
          <EmptyState
            title="随包目录暂无插件"
            description="当前目录没有可真实展示的推荐或套餐。你可以查看全部插件，或稍后刷新在线目录；市场不会填入假榜单、下载量或空推广卡片。"
            action={<Button variant="primary" onClick={() => onBrowse()}>查看全部插件</Button>}
          />
        </section>
      ) : (
        <>
          <section className="eac-market__section">
            <div className="eac-market__section-head">
              <div><h2>团队精选</h2><p>推荐理由：当前目录没有独立团队精选理由字段，下面只展示目录的真实 recommended 标记和一句话用途，不冒充团队审核或官方认证。</p></div>
              <button type="button" className="eac-market__link" onClick={() => onBrowse()}>查看全部插件</button>
            </div>
            {recommended.length === 0 ? (
              <EmptyState title="暂无团队精选记录" description="目录没有可核实的推荐位置时，这里保持空态；规则发现仍可使用。" action={<Button variant="outline" onClick={() => onBrowse()}>查看全部插件</Button>} />
            ) : (
              <div className="eac-market__grid">
                {recommended.slice(0, 6).map((plugin) => <PluginCard key={plugin.id} plugin={plugin} inventory={inventory} onOpen={onOpen} onInstall={onInstall} />)}
              </div>
            )}
          </section>

          <section className="eac-market__section">
            <div className="eac-market__section-head">
              <div><h2>规则发现</h2><p>排序依据：兼容状态 → 用途 → 名称。目录没有可靠版本发布时间，因此不显示“最近更新”假排序。</p></div>
            </div>
            {categories.length > 0 && (
              <div className="eac-market__filters" aria-label="按用途进入全部插件">
                {categories.map((category) => <Pill key={category} onClick={() => onBrowse(category)}>{category}</Pill>)}
              </div>
            )}
            <div className="eac-market__grid">
              {ruleSorted.slice(0, 6).map((plugin) => <PluginCard key={plugin.id} plugin={plugin} inventory={inventory} onOpen={onOpen} onInstall={onInstall} />)}
            </div>
          </section>

          {catalog.packs.length > 0 && (
            <section className="eac-market__section">
              <div className="eac-market__section-head"><h2>套餐</h2><p>一次查看所有组件与版本调整。</p></div>
              <div className="eac-market__grid grid--two eac-market__grid--two">
                {catalog.packs.map((pack) => (
                  <article className="eac-market__card" key={pack.id}>
                    <div className="eac-market__tags"><Tag tone="info">{pack.category}</Tag><Status tone={pack.execution.coverage === 'complete' ? 'success' : 'warning'}>{packCoverageLabel(pack.execution.coverage)}</Status></div>
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
    </>
  )
}

export function DetailView({ plugin, presentation, inventory, onBack, onInstall, onUpdate, canInstall = false }: {
  readonly plugin: CatalogPlugin
  readonly presentation: CatalogPresentation | undefined
  readonly inventory: readonly InventoryItem[]
  readonly onBack: () => void
  readonly onInstall: (plugin: CatalogPlugin) => void
  readonly onUpdate?: (plugin: CatalogPlugin) => void
  readonly canInstall?: boolean
}): React.JSX.Element {
  const installed = isInstalled(inventory, plugin)
  const blocked = !canInstall || plugin.verification === 'hard-incompatible' || plugin.installability !== 'bundle-installable'
  return (
    <>
      <Button variant="ghost" onClick={onBack}>返回插件列表</Button>
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
            {installed !== undefined && hasCatalogUpdate(installed, plugin) && canInstall && onUpdate !== undefined && (
              <Button variant="primary" onClick={() => onUpdate(plugin)}>更新到 {plugin.version}</Button>
            )}
            {installed?.restartRequired === true && <Status tone="warning">需要重启</Status>}
          </div>
          {installed !== undefined && (
            <div className="eac-market__notice" style={{ marginTop: 14 }}>
              <strong>使用入口：</strong>
              {plugin.requiresSetup ? '此插件需要先完成设置；当前市场契约没有可调用的设置接口，请在 DSH 官方插件页按作者说明完成设置。' : '当前市场契约没有可调用的打开接口；请在 DSH 官方插件页或作者说明的入口打开。'}
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
        </aside>
      </div>
    </>
  )
}
