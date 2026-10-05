import type {
  ApprovalChallenge,
  AuthorDraft,
  AuthorDraftInput,
  AuthorExportRequest,
  AuthorMediaReadRequest,
  AuthorMediaReadResult,
  CatalogPack,
  CatalogCollectionView,
  CatalogPlugin,
  CatalogPresentation,
  CatalogSnapshot,
  CatalogRefreshRequest,
  CatalogRefreshView,
  CatalogSourceView, CoreMaintenanceSnapshot, UpdateCheckResult, UpdatePolicySnapshot, UpdatePolicySaveRequest,
  CatalogRecommendation,
  ClientHandshakeRequest,
  ClientHandshakeResult,
  AiAnalyzeRequest,
  AiAnalysisResult,
  AiApplyResult,
  AiConfirmRequest,
  DiagnosticExport,
  EnvironmentHello,
  InstallLogEntry,
  InventoryItem,
  InventorySnapshot,
  PlanCreateRequest,
  PlanResult,
  PluginActionRequest,
  PluginActionResult,
  ReadmeImportRequest,
  ReadmeImportResult,
  ReadmePreviewView,
  ReadmeApplyPreviewRequest,
  RemovePluginRequest,
  ResumeChallenge,
  TaskApprovalRequest,
  TaskCancelRequest,
  TaskEventPage,
  TaskEventRequest,
  TaskIdRequest,
  TaskItemStatus,
  TaskResumeRequest,
  TaskStartRequest,
  TaskStartRecoveryRequest,
  TaskStartRecoveryResult,
  PluginActionRecoveryRequest,
  PluginActionRecoveryResult,
  TaskState,
  TaskStatus,
  TransferBeginRequest,
  TransferChunkRequest,
  TransferResult,
  TransferChunkReadRequest,
  TransferChunkReadResult,
  TransferDisposeRequest,
  AuthorDraftDeleteRequest,
  VerificationState,
  HostCoreSnapshot,
  ReleaseOptionsRequest,
  ReleaseOptionsResult,
} from '@dsh-eac/market-core/contracts'
import { supportsApiVersion } from '@dsh-eac/market-core/compatibility'
import { compareVersions as compareSemVer, validVersion } from '@dsh-eac/market-core/semver'
import { ADAPTER_PROTOCOL_VERSION, REQUIRED_CORE_API_VERSION } from '../version.ts'

export const PROTOCOL_REFRESH_HINT = '请刷新页面或重新打开市场；若仍不兼容，请更新市场插件后重试。'

export class ClientCompatibilityError extends Error {
  constructor(reason: string) {
    super(`${reason}已停止操作。${PROTOCOL_REFRESH_HINT}`)
    this.name = 'ClientCompatibilityError'
  }
}

/** 首次加载、同步与写入防护共用；兼容要求固定来自 adapter 自身版本文件。
 * hello 可缺少可选核心信息以保留读取能力，写入仍须通过完整握手。 */
export function assertCompatibleHello(hello: EnvironmentHello): void {
  if (typeof hello?.protocolVersion !== 'string' || !supportsApiVersion(hello.protocolVersion, ADAPTER_PROTOCOL_VERSION)) {
    throw new ClientCompatibilityError('市场页面与后台协议不兼容。')
  }
  if (hello.coreApiVersion !== undefined
    && (typeof hello.coreApiVersion !== 'string' || !supportsApiVersion(hello.coreApiVersion, REQUIRED_CORE_API_VERSION))) {
    throw new ClientCompatibilityError('市场页面与后台核心接口不兼容。')
  }
}

export interface MarketRemote {
  hostCore?(): Promise<HostCoreSnapshot>
  releaseOptions?(request: ReleaseOptionsRequest): Promise<ReleaseOptionsResult>
  hello(): Promise<EnvironmentHello>
  clientConnect?(request: ClientHandshakeRequest): Promise<ClientHandshakeResult>
  catalog(): Promise<CatalogSnapshot>
  inventory(): Promise<InventorySnapshot>
  createPlan?(request: PlanCreateRequest): Promise<PlanResult>
  startTask?(request: TaskStartRequest): Promise<TaskState>
  taskStartRecover?(request: TaskStartRecoveryRequest): Promise<TaskStartRecoveryResult>
  pluginActionRecover?(request: PluginActionRecoveryRequest): Promise<PluginActionRecoveryResult>
  getTask?(request: TaskIdRequest): Promise<TaskState>
  listTasks?(): Promise<readonly TaskState[]>
  taskEvents?(request: TaskEventRequest): Promise<TaskEventPage>
  cancelTask?(request: TaskCancelRequest): Promise<TaskState>
  approveTask?(request: TaskApprovalRequest): Promise<TaskState>
  resumeTask?(request: TaskResumeRequest): Promise<TaskState>
  setPluginEnabled?(request: PluginActionRequest): Promise<PluginActionResult>
  removePlugin?(request: RemovePluginRequest): Promise<PluginActionResult>
  listDrafts?(): Promise<readonly AuthorDraft[]>
  getDraft?(id: string): Promise<AuthorDraft>
  saveDraft?(request: AuthorDraftInput): Promise<AuthorDraft>
  deleteDraft?(request: AuthorDraftDeleteRequest): Promise<boolean>
  exportDraft?(request: AuthorExportRequest): Promise<TransferResult>
  readMedia?(request: AuthorMediaReadRequest): Promise<AuthorMediaReadResult>
  importReadme?(request: ReadmeImportRequest): Promise<ReadmeImportResult>
  previewReadme?(request: ReadmeImportRequest): Promise<ReadmePreviewView>
  applyReadmePreview?(request: ReadmeApplyPreviewRequest): Promise<ReadmeImportResult>
  transferBegin?(request: TransferBeginRequest): Promise<TransferResult>
  transferChunk?(request: TransferChunkRequest): Promise<TransferResult>
  transferRead?(request: TransferChunkReadRequest): Promise<TransferChunkReadResult>
  transferDispose?(request: TransferDisposeRequest): Promise<boolean>
  refreshCatalog?(request?: CatalogRefreshRequest): Promise<CatalogRefreshView>
  catalogSources?(): Promise<readonly CatalogSourceView[]>
  agentForgeRefresh?(request: { readonly sourceId: string }): Promise<CatalogRefreshView>
  maintenanceStatus?(): Promise<CoreMaintenanceSnapshot>
  checkUpdates?(request?: { readonly sourceId?: string; readonly refreshFirst?: boolean }): Promise<UpdateCheckResult>
  updatePolicyGet?(): Promise<UpdatePolicySnapshot>
  updatePolicySave?(request: UpdatePolicySaveRequest): Promise<UpdatePolicySnapshot>
  exportDiagnostic?(): Promise<DiagnosticExport>
  installLogRead?(request?: { readonly limit?: number }): Promise<readonly InstallLogEntry[]>
  aiAnalyze?(request: AiAnalyzeRequest): Promise<AiAnalysisResult>
  aiConfirm?(request: AiConfirmRequest): Promise<AiApplyResult>
}

export type PrimaryView = 'discover' | 'all' | 'mine'
export type SecondaryView = 'help' | 'settings' | 'author' | 'skins'
export type MarketView = PrimaryView | SecondaryView | 'detail' | 'extension'

/**
 * 记录进入完整插件目录时的用户意图。它只属于前端导航状态，
 * 不参与目录、安装或评分协议，方便返回时恢复上下文。
 */
export type BrowseNavigationSource = 'top-nav' | 'discover' | 'all' | 'mine' | 'detail' | 'skins' | 'secondary' | 'extension'
export type DiscoverNavigationSection = 'featured' | 'skins' | 'high-score-plugin' | 'high-score-skill' | 'rules'

export interface BrowseNavigationContext {
  readonly source: BrowseNavigationSource
  readonly category?: string
  readonly section?: DiscoverNavigationSection
  readonly query?: string
  readonly page: number
  readonly scrollTop: number
}

/** 完整的 Client 返回快照；不进入 Remote 或 Core 合同。 */
export interface NavigationSnapshot {
  readonly view: MarketView
  readonly source: BrowseNavigationSource
  readonly filters: PluginFilters
  readonly availableOnly: boolean
  readonly sort: BrowseSortMode
  readonly page: number
  readonly scrollTop: number
  readonly section?: string | undefined
}
export type LoadState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly hello: EnvironmentHello
      readonly catalog: CatalogSnapshot
      readonly inventory: InventorySnapshot
      readonly tasks: readonly TaskState[]
    }
  | { readonly status: 'error'; readonly message: string }

export interface PluginFilters {
  readonly query: string
  readonly category: string
  readonly verification: 'all' | VerificationState
  readonly installed: 'all' | 'yes' | 'no'
}

export const EMPTY_FILTERS: PluginFilters = {
  query: '',
  category: 'all',
  verification: 'all',
  installed: 'all',
}

export function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN')
}

export function filterPlugins(
  plugins: readonly CatalogPlugin[],
  inventory: readonly InventoryItem[],
  filters: PluginFilters,
): readonly CatalogPlugin[] {
  const query = normalize(filters.query)
  const installedPackages = new Set(inventory.filter((item) => item.installed).map((item) => item.packageName))
  return plugins.filter((plugin) => {
    const haystack = normalize([
      plugin.name,
      plugin.packageName,
      plugin.author,
      plugin.summary,
      ...plugin.categories,
    ].join(' '))
    if (query !== '' && !haystack.includes(query)) return false
    if (filters.category !== 'all' && !plugin.categories.includes(filters.category)) return false
    if (filters.verification !== 'all' && plugin.verification !== filters.verification) return false
    if (filters.installed === 'yes' && !installedPackages.has(plugin.packageName)) return false
    if (filters.installed === 'no' && installedPackages.has(plugin.packageName)) return false
    return true
  })
}

export function categoriesOf(plugins: readonly CatalogPlugin[]): readonly string[] {
  return [...new Set(plugins.flatMap((plugin) => plugin.categories))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export function isInstalled(
  inventory: readonly InventoryItem[],
  plugin: CatalogPlugin,
): InventoryItem | undefined {
  return inventory.find((item) => item.packageName === plugin.packageName && item.installed)
}

export function verificationLabel(value: VerificationState): string {
  switch (value) {
    case 'verified': return '已验证'
    case 'unverified': return '未验证'
    case 'hard-incompatible': return '已知不兼容'
    case 'unknown': return '状态未知'
  }
}


export type PluginActionKind = 'manage' | 'install' | 'confirm' | 'blocked' | 'runtime-unavailable'
export interface PluginActionState {
  readonly kind: PluginActionKind
  readonly label: string
  readonly disabled: boolean
  readonly reason?: string
  readonly installed?: InventoryItem
}

export function pluginActionState(plugin: CatalogPlugin, inventory: readonly InventoryItem[], options: { readonly canInstall?: boolean; readonly canManage?: boolean } = {}): PluginActionState {
  const installed = isInstalled(inventory, plugin)
  if (installed !== undefined) {
    return options.canManage === true
      ? { kind: 'manage', label: '管理', disabled: false, installed }
      : { kind: 'manage', label: '已安装', disabled: true, reason: '已安装，请到“我的插件”管理。', installed }
  }
  if (options.canInstall === false) return { kind: 'runtime-unavailable', label: '暂不可安装', disabled: true, reason: '当前市场未提供安装服务。' }
  if (plugin.verification === 'hard-incompatible' && plugin.installability === 'bundle-installable') return { kind: 'confirm', label: '查看安装方案', disabled: false, reason: '已知兼容性风险；安装结果由官方安装器和上游插件负责。' }
  if (plugin.installability !== 'bundle-installable') return { kind: 'blocked', label: '暂不可安装', disabled: true, reason: installabilityLabel(plugin.installability) + '。' }
  if (plugin.verification === 'unverified' || plugin.verification === 'unknown') return { kind: 'confirm', label: '查看安装方案', disabled: false, reason: '兼容性尚未验证；安装结果由官方安装器和上游插件负责。' }
  return { kind: 'install', label: '查看安装方案', disabled: false }
}

export function installabilityLabel(value: CatalogPlugin['installability']): string {
  switch (value) {
    case 'bundle-installable': return '可安装'
    case 'missing-bundle': return '待作者提供可安装包'
    case 'missing-artifact': return '缺少可下载制品'
    case 'hard-blocked': return '安装已阻止'
    case 'needs-repair': return '需要修复资料'
  }
}

export function taskStatusLabel(value: TaskStatus | 'cancelling'): string {
  switch (value) {
    case 'queued': return '排队中'
    case 'downloading': return '下载中'
    case 'verifying': return '校验中'
    case 'installing': return '安装中'
    case 'awaiting-approval': return '待脚本授权'
    case 'awaiting-resume': return '等待重启'
    case 'applying': return '应用中'
    case 'checking': return '检查中'
    case 'completed': return '已完成'
    case 'partial': return '部分完成'
    case 'failed': return '失败'
    case 'cancelled': return '已取消'
    case 'interrupted': return '已中断'
    case 'needs-attention': return '需要处理'
    case 'unknown': return '状态未知'
    case 'cancelling': return '取消中'
  }
}

export function taskItemStatusLabel(value: TaskItemStatus): string {
  switch (value) {
    case 'pending': return '待处理'
    case 'downloading': return '下载中'
    case 'verifying': return '校验中'
    case 'installing': return '安装中'
    case 'installed': return '已安装'
    case 'enabled': return '已启用'
    case 'disabled': return '已停用'
    case 'restart-required': return '需要重启'
    case 'blocked-by-dependency': return '依赖项暂停'
    case 'blocked-on-restart': return '等待重启'
    case 'failed': return '失败'
    case 'cancelled': return '已取消'
    case 'unknown': return '状态未知'
  }
}

export function taskTone(value: TaskStatus | 'cancelling'): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  if (value === 'completed') return 'success'
  if (value === 'failed') return 'danger'
  if (value === 'partial' || value === 'needs-attention' || value === 'awaiting-approval' || value === 'awaiting-resume' || value === 'interrupted' || value === 'cancelling') return 'warning'
  if (value === 'cancelled' || value === 'unknown') return 'neutral'
  return 'info'
}

export function activeTasks(tasks: readonly TaskState[]): readonly TaskState[] {
  return tasks.filter((task) => !['completed', 'partial', 'failed', 'cancelled', 'needs-attention', 'unknown'].includes(task.status))
}

export function packPluginIds(pack: CatalogPack): readonly string[] {
  return pack.components.map((component) => component.pluginId)
}

export function findPlugin(
  catalog: CatalogSnapshot,
  pluginId: string | undefined,
  version?: string,
): CatalogPlugin | undefined {
  if (pluginId === undefined) return undefined
  const matches = catalog.plugins.filter((plugin) => plugin.id === pluginId && (version === undefined || plugin.version === version))
  return matches.sort(catalogVersionOrder)[0]
}

/** Deterministic ordering only; an explicit detail selection never falls back to a
 * different version. Invalid version labels may be browsed but cannot win updates. */
function catalogVersionOrder(left: CatalogPlugin, right: CatalogPlugin): number {
  const leftValid = validVersion(left.version)
  const rightValid = validVersion(right.version)
  if (leftValid !== rightValid) return leftValid ? -1 : 1
  const order = leftValid && rightValid ? compareSemVer(right.version, left.version) : 0
  return order || left.version.localeCompare(right.version) || left.id.localeCompare(right.id) || (left.artifactDigest ?? '').localeCompare(right.artifactDigest ?? '')
}

/** Default update suggestions require known compatibility and the registered
 * delivery of the same package/version/digest. Unknown compatibility is not a
 * default update recommendation; it remains available in explicit detail flows. */
export function latestCompatiblePlugin(catalog: CatalogSnapshot, packageName: string): CatalogPlugin | undefined {
  return catalog.plugins.filter((plugin) => plugin.packageName === packageName
    && validVersion(plugin.version) && plugin.verification === 'verified' && plugin.installability === 'bundle-installable'
    && plugin.artifactDigest !== undefined && catalog.deliveries.some((delivery) => delivery.pluginId === plugin.id
      && delivery.packageName === plugin.packageName && delivery.version === plugin.version
      && delivery.artifactDigest === plugin.artifactDigest && delivery.sources.length > 0))
    .sort(catalogVersionOrder)[0]
}

export function presentationForPlugin(
  catalog: CatalogSnapshot,
  plugin: CatalogPlugin,
): CatalogPresentation | undefined {
  return catalog.presentations.find((presentation) => presentation.id === plugin.presentationId)
}

export function summarizeInventory(item: InventoryItem): string {
  const state = item.rows.some((row) => row.state === 'load-error')
    ? '加载失败'
    : item.rows.some((row) => row.state === 'enabled')
      ? item.rows.some((row) => row.fiberPhase === 'active') ? '运行中' : '已配置启用（运行待核对）'
      : item.rows.some((row) => row.state === 'disabled')
        ? '已停用'
        : item.installed && !item.bundleEnabled ? '已停用' : '运行状态未知'
  return item.restartRequired ? `${state} · 需要重启` : state
}

export function readOnlyLabel(item: InventoryItem): string | undefined {
  if (item.readOnlyReason === 'management-required') return '由官方插件管理器管理'
  if (item.readOnlyReason === 'unaddressable') return '当前环境无法操作此项目'
  if (item.readOnlyReason === 'unknown') return '管理状态未知'
  return undefined
}

export function formatBytes(size: number | undefined): string {
  if (size === undefined) return '大小未知'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / 1024 / 1024).toFixed(1)} MiB`
}

export function packCoverageLabel(value: CatalogPack['execution']['coverage']): string {
  if (value === 'complete') return '执行资料完整'
  if (value === 'partial') return '执行资料部分完整'
  return '执行资料未知'
}

export function approvalPackages(challenge: ApprovalChallenge | undefined): readonly string[] {
  return challenge?.packages ?? []
}

export function resumePlugins(challenge: ResumeChallenge | undefined): readonly string[] {
  return challenge?.remainingPluginIds ?? []
}

export function createIdempotencyKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${random}`
}


export type BrowseSortMode = 'rules' | 'compatibility' | 'recommended'

export function compareVersions(left: string | undefined, right: string): number {
  // Share the installer's pure SemVer rules, including prereleases. Missing or
  // invalid installed versions cannot justify advertising an update button.
  if (left === undefined || !validVersion(left) || !validVersion(right)) return 0
  return compareSemVer(left, right)
}

export function hasCatalogUpdate(installed: InventoryItem | undefined, plugin: CatalogPlugin): boolean {
  return installed?.installed === true && compareVersions(installed.version, plugin.version) < 0
}

function taskEventSequence(task: TaskState): number {
  return task.events.reduce((max, event) => Math.max(max, event.sequence), 0)
}

function taskPhaseRank(status: TaskStatus): number {
  return ['queued', 'downloading', 'verifying', 'installing', 'awaiting-approval', 'awaiting-resume', 'applying', 'checking', 'completed', 'partial', 'failed', 'cancelled', 'interrupted', 'needs-attention', 'unknown'].indexOf(status)
}

const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'partial', 'failed', 'cancelled', 'needs-attention', 'unknown']

export function taskStateIsNewer(current: TaskState | undefined, next: TaskState): boolean {
  if (current === undefined) return true
  if (next.updatedAt > current.updatedAt) return true
  if (TERMINAL_TASK_STATUSES.includes(current.status) && TERMINAL_TASK_STATUSES.includes(next.status)) return false
  if (next.updatedAt < current.updatedAt) return false
  const nextSequence = taskEventSequence(next)
  const currentSequence = taskEventSequence(current)
  if (nextSequence !== currentSequence) return nextSequence > currentSequence
  return taskPhaseRank(next.status) > taskPhaseRank(current.status)
}

export function pluginActionFeedback(action: Pick<PluginActionResult, 'status' | 'changed' | 'error'>, enabled: boolean): {
  readonly tone: 'success' | 'warning' | 'danger' | 'neutral'
  readonly message: string
} {
  if (action.status === 'failed') return { tone: 'danger', message: action.error ? `操作失败：${action.error}` : '操作失败，未把请求返回当成成功。' }
  if (action.status === 'unknown') return { tone: 'warning', message: '操作结果未知；请重新读取并核对实际状态后再继续。' }
  if (action.status === 'restart-required') return { tone: 'warning', message: '状态已保存，需要重启 DSH 后才会使用新状态。' }
  if (!action.changed) return { tone: 'neutral', message: enabled ? '插件已经是启用状态。' : '插件已经是停用状态。' }
  return { tone: 'success', message: enabled ? '启用设置已保存，请在插件列表核对运行状态。' : '停用设置已保存，请在插件列表核对运行状态。' }
}

export function isSystemInventoryItem(item: InventoryItem, plugin: CatalogPlugin | undefined): boolean {
  // The official inventory distinguishes installation-supplied bundles from
  // profile packages. Package-name prefixes alone do not establish ownership.
  return item.source === 'installation' || plugin?.distribution === 'builtin'
    || item.readOnlyReason === 'management-required' || item.readOnlyReason === 'unaddressable'
}

export function partitionInventory(
  items: readonly InventoryItem[],
  plugins: readonly CatalogPlugin[],
): {
  readonly userItems: readonly InventoryItem[]
  readonly systemItems: readonly InventoryItem[]
  readonly systemNeedsAttention: boolean
  readonly systemAttentionCount: number
} {
  const byPackage = new Map(plugins.map((plugin) => [plugin.packageName, plugin]))
  const userItems: InventoryItem[] = []
  const systemItems: InventoryItem[] = []
  for (const item of items) {
    (isSystemInventoryItem(item, byPackage.get(item.packageName)) ? systemItems : userItems).push(item)
  }
  const systemAttentionCount = systemItems.filter(item => item.restartRequired || item.rows.some(row =>
    row.state === 'load-error' || (item.bundleEnabled && row.state === 'unknown'))).length
  return {
    userItems,
    systemItems,
    systemNeedsAttention: systemAttentionCount > 0,
    systemAttentionCount,
  }
}

function browseRank(plugin: CatalogPlugin): number {
  return plugin.verification === 'verified' ? 0 : plugin.verification === 'unknown' ? 1 : plugin.verification === 'unverified' ? 2 : 3
}

export function recommendationMatches(record: CatalogRecommendation, plugin: CatalogPlugin): boolean {
  return record.reason.trim() !== '' && record.pluginId === plugin.id && (record.version === undefined || record.version === plugin.version)
}

export function browseSortPlugins(
  plugins: readonly CatalogPlugin[],
  mode: BrowseSortMode = 'rules',
  recommendations: readonly CatalogRecommendation[] = [],
): readonly CatalogPlugin[] {
  const ranks = new Map(plugins.map((plugin) => [plugin, recommendations.filter((record) => recommendationMatches(record, plugin)).reduce((rank, record) => Math.min(rank, record.order), Number.MAX_SAFE_INTEGER)]))
  return [...plugins].sort((left, right) => {
    if (mode === 'recommended') {
      const recommended = (ranks.get(left) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(right) ?? Number.MAX_SAFE_INTEGER)
      if (recommended !== 0) return recommended
    }
    const available = Number(left.installability !== 'bundle-installable') - Number(right.installability !== 'bundle-installable')
    if (available !== 0) return available
    const compatibility = browseRank(left) - browseRank(right)
    if (compatibility !== 0) return compatibility
    const category = (left.categories[0] ?? '').localeCompare(right.categories[0] ?? '', 'zh-CN')
    if (category !== 0 && mode !== 'compatibility') return category
    // Only release dates participate. Presentation edits are not new releases.
    const released = (Date.parse(right.releasedAt ?? '') || 0) - (Date.parse(left.releasedAt ?? '') || 0)
    return released || left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id)
  })
}

export interface PlanRequestTicket {
  readonly generation: number
  readonly targetKey: string
}

export function planTargetSignature(target: {
  readonly plugin?: Pick<CatalogPlugin, 'id' | 'version' | 'artifactDigest' | 'verification'>
  readonly pack?: Pick<CatalogPack, 'id' | 'version'>
  readonly collection?: Pick<CatalogCollectionView, 'kind' | 'id' | 'version' | 'collectionDigest'>
  readonly plugins: readonly Pick<CatalogPlugin, 'id' | 'version' | 'artifactDigest' | 'verification'>[]
}): string {
  return JSON.stringify({
    plugin: target.plugin === undefined ? null : [target.plugin.id, target.plugin.version, target.plugin.artifactDigest ?? null],
    pack: target.pack === undefined ? null : [target.pack.id, target.pack.version],
    collection: target.collection === undefined ? null : [target.collection.kind, target.collection.id, target.collection.version, target.collection.collectionDigest],
    plugins: target.plugins.map((plugin) => [plugin.id, plugin.version, plugin.artifactDigest ?? null, plugin.verification]),
  })
}

export class PlanRequestGuard {
  private generation = 0
  private targetKey = ''

  begin(targetKey: string): PlanRequestTicket {
    this.targetKey = targetKey
    this.generation += 1
    return { generation: this.generation, targetKey }
  }

  invalidate(): void {
    this.generation += 1
  }

  accept<T>(ticket: PlanRequestTicket, value: T): T | undefined {
    return ticket.generation === this.generation && ticket.targetKey === this.targetKey ? value : undefined
  }
}

/** Next steps stay understandable even when an older Host returns a machine enum. */
export function taskNextStep(task: TaskState): string {
  if (task.status === 'awaiting-approval') return '查看脚本清单，授权后继续；未授权不会运行这些脚本。'
  if (task.status === 'unknown' || task.status === 'needs-attention' || task.status === 'interrupted') return '结果尚未核定。先到官方插件页核对，不要重复安装。'
  if (task.status === 'awaiting-resume' || task.items.some((item) => item.status === 'restart-required' || item.status === 'blocked-on-restart')) return '保存正在进行的工作并重启 DSH，再回来核对状态。'
  if (task.status === 'completed') return '安装处理已完成。查看我的插件，按作者说明开始使用。'
  if (task.status === 'partial') return '成功项已保留；查看失败或暂停项后再处理。'
  if (task.status === 'failed') return '查看下方失败原因，或使用 AI 辅助分析。'
  if (task.status === 'cancelled') return '任务已停止；已经完成的更改会保留。'
  return '正在处理。关闭面板不会取消已经发起的任务。'
}

export function isTaskSettled(task: TaskState): boolean {
  return !['queued', 'downloading', 'verifying', 'installing', 'applying', 'checking'].includes(task.status)
}
