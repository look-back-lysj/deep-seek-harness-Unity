import type {
  ApprovalChallenge,
  AuthorDraft,
  AuthorDraftInput,
  CatalogPack,
  CatalogPlugin,
  CatalogPresentation,
  CatalogSnapshot,
  AiAnalyzeRequest,
  AiAnalysisResult,
  AiApplyResult,
  AiConfirmRequest,
  DiagnosticExport,
  EnvironmentHello,
  InventoryItem,
  InventorySnapshot,
  PlanCreateRequest,
  PlanResult,
  PluginActionRequest,
  PluginActionResult,
  ReadmeImportRequest,
  ReadmeImportResult,
  RemovePluginRequest,
  ResumeChallenge,
  TaskApprovalRequest,
  TaskCancelRequest,
  TaskIdRequest,
  TaskItemStatus,
  TaskResumeRequest,
  TaskStartRequest,
  TaskState,
  TaskStatus,
  TransferBeginRequest,
  TransferChunkRequest,
  TransferResult,
  VerificationState,
} from '../types.ts'

export interface MarketRemote {
  hello(): Promise<EnvironmentHello>
  catalog(): Promise<CatalogSnapshot>
  inventory(): Promise<InventorySnapshot>
  createPlan?(request: PlanCreateRequest): Promise<PlanResult>
  startTask?(request: TaskStartRequest): Promise<TaskState>
  getTask?(request: TaskIdRequest): Promise<TaskState>
  listTasks?(): Promise<readonly TaskState[]>
  cancelTask?(request: TaskCancelRequest): Promise<TaskState>
  approveTask?(request: TaskApprovalRequest): Promise<TaskState>
  resumeTask?(request: TaskResumeRequest): Promise<TaskState>
  setPluginEnabled?(request: PluginActionRequest): Promise<PluginActionResult>
  removePlugin?(request: RemovePluginRequest): Promise<PluginActionResult>
  listDrafts?(): Promise<readonly AuthorDraft[]>
  saveDraft?(request: AuthorDraftInput): Promise<AuthorDraft>
  importReadme?(request: ReadmeImportRequest): Promise<ReadmeImportResult>
  transferBegin?(request: TransferBeginRequest): Promise<TransferResult>
  transferChunk?(request: TransferChunkRequest): Promise<TransferResult>
  refreshCatalog?(): Promise<CatalogSnapshot>
  exportDiagnostic?(): Promise<DiagnosticExport>
  aiAnalyze?(request: AiAnalyzeRequest): Promise<AiAnalysisResult>
  aiConfirm?(request: AiConfirmRequest): Promise<AiApplyResult>
}

export type PrimaryView = 'discover' | 'all' | 'mine'
export type SecondaryView = 'help' | 'settings' | 'author'
export type MarketView = PrimaryView | SecondaryView | 'detail'
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
): CatalogPlugin | undefined {
  return pluginId === undefined ? undefined : catalog.plugins.find((plugin) => plugin.id === pluginId)
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
      ? '已启用'
      : item.rows.some((row) => row.state === 'disabled')
        ? '已停用'
        : '状态未知'
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
  if (left === undefined) return -1
  const normalizeParts = (value: string): readonly (string | number)[] => value
    .split(/[-+]/, 1)[0]!
    .split('.')
    .map((part) => /^\d+$/.test(part) ? Number(part) : part)
  const a = normalizeParts(left)
  const b = normalizeParts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const av = a[index] ?? 0
    const bv = b[index] ?? 0
    if (av === bv) continue
    if (typeof av === 'number' && typeof bv === 'number') return av < bv ? -1 : 1
    return String(av).localeCompare(String(bv), 'zh-CN')
  }
  return 0
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
  if (action.status === 'unknown') return { tone: 'warning', message: '操作结果未知，已重新读取库存；请核对实际状态后再继续。' }
  if (action.status === 'restart-required') return { tone: 'warning', message: '状态已保存，需要重启 DSH 后才会使用新状态。' }
  if (!action.changed) return { tone: 'neutral', message: enabled ? '插件已经是启用状态。' : '插件已经是停用状态。' }
  return { tone: 'success', message: enabled ? '插件已启用。' : '插件已停用。' }
}

export function isSystemInventoryItem(item: InventoryItem, plugin: CatalogPlugin | undefined): boolean {
  return plugin?.distribution === 'builtin' || (plugin === undefined && item.readOnlyReason === 'management-required')
}

export function partitionInventory(
  items: readonly InventoryItem[],
  plugins: readonly CatalogPlugin[],
): {
  readonly userItems: readonly InventoryItem[]
  readonly systemItems: readonly InventoryItem[]
  readonly systemNeedsAttention: boolean
} {
  const byPackage = new Map(plugins.map((plugin) => [plugin.packageName, plugin]))
  const userItems: InventoryItem[] = []
  const systemItems: InventoryItem[] = []
  for (const item of items) {
    (isSystemInventoryItem(item, byPackage.get(item.packageName)) ? systemItems : userItems).push(item)
  }
  return {
    userItems,
    systemItems,
    systemNeedsAttention: systemItems.some((item) => item.rows.some((row) => row.state === 'load-error' || row.state === 'unknown') || item.restartRequired),
  }
}

function browseRank(plugin: CatalogPlugin): number {
  return plugin.verification === 'verified' ? 0 : plugin.verification === 'unknown' ? 1 : plugin.verification === 'unverified' ? 2 : 3
}

export function browseSortPlugins(
  plugins: readonly CatalogPlugin[],
  mode: BrowseSortMode = 'rules',
): readonly CatalogPlugin[] {
  return [...plugins].sort((left, right) => {
    if (mode === 'recommended') {
      const recommended = Number(right.distribution === 'recommended') - Number(left.distribution === 'recommended')
      if (recommended !== 0) return recommended
    }
    const compatibility = (mode === 'compatibility' ? 0 : 1) * (browseRank(left) - browseRank(right))
    if (compatibility !== 0) return compatibility
    const category = (left.categories[0] ?? '').localeCompare(right.categories[0] ?? '', 'zh-CN')
    return category !== 0 ? category : left.name.localeCompare(right.name, 'zh-CN')
  })
}

export interface PlanRequestTicket {
  readonly generation: number
  readonly targetKey: string
}

export function planTargetSignature(target: {
  readonly plugin?: Pick<CatalogPlugin, 'id' | 'version' | 'artifactDigest'>
  readonly pack?: Pick<CatalogPack, 'id' | 'version'>
  readonly plugins: readonly Pick<CatalogPlugin, 'id' | 'version' | 'artifactDigest'>[]
}): string {
  return JSON.stringify({
    plugin: target.plugin === undefined ? null : [target.plugin.id, target.plugin.version, target.plugin.artifactDigest ?? null],
    pack: target.pack === undefined ? null : [target.pack.id, target.pack.version],
    plugins: target.plugins.map((plugin) => [plugin.id, plugin.version, plugin.artifactDigest ?? null]),
  })
}

export class PlanRequestGuard {
  private generation = 0
  private targetKey = ''

  begin(targetKey: string): PlanRequestTicket {
    if (targetKey !== this.targetKey) {
      this.targetKey = targetKey
      this.generation += 1
    }
    return { generation: this.generation, targetKey }
  }

  invalidate(): void {
    this.generation += 1
  }

  accept<T>(ticket: PlanRequestTicket, value: T): T | undefined {
    return ticket.generation === this.generation && ticket.targetKey === this.targetKey ? value : undefined
  }
}
