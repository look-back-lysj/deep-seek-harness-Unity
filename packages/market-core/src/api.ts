/** 浏览器安全的业务合同。只描述输入/输出，不导入宿主或执行器。
 * Backend 可由不同界面复用；callerId 必须由可信适配层取自当前连接，
 * 不能由 Client 自报，也不能以固定身份代替用户审批的归属。
 */
import type {
  AiAnalyzeRequest, AiAnalysisResult, AiApplyResult, AiConfirmRequest,
  AuthorDraft, AuthorDraftDeleteRequest, AuthorDraftInput, AuthorExportRequest,
  AuthorMediaReadRequest, AuthorMediaReadResult, CapabilityName,
  CatalogRefreshRequest, CatalogRefreshView, CatalogSnapshot, DiagnosticExport,
  InstallLogEntry, InventorySnapshot, PlanCreateRequest, PlanResult, PluginActionRequest, PluginActionResult,
  CoreMaintenanceSnapshot, UpdateCheckResult, CatalogSourceView, UpdatePolicySnapshot, UpdatePolicySaveRequest,
  ReadmeApplyPreviewRequest, ReadmeImportRequest, ReadmeImportResult, ReadmePreviewView,
  RemovePluginRequest, TaskApprovalRequest, TaskCancelRequest, TaskEventPage,
  TaskEventRequest, TaskIdRequest, TaskResumeRequest, TaskStartRequest, TaskState,
  TransferBeginRequest, TransferChunkReadRequest, TransferChunkReadResult,
  TransferChunkRequest, TransferResult,
} from './contracts/types.ts'

export interface MarketBackend {
  capabilities(): readonly CapabilityName[]
  catalog(): CatalogSnapshot
  inventory(): Promise<InventorySnapshot>
  catalogRefresh(request?: CatalogRefreshRequest): Promise<CatalogRefreshView>
  catalogSources(): Promise<readonly CatalogSourceView[]>
  agentForgeRefresh(request: { readonly sourceId: string }): Promise<CatalogRefreshView>
  maintenanceStatus(): Promise<CoreMaintenanceSnapshot>
  checkUpdates(request?: { readonly sourceId?: string; readonly refreshFirst?: boolean }): Promise<UpdateCheckResult>
  updatePolicyGet(): Promise<UpdatePolicySnapshot>
  updatePolicySave(request: UpdatePolicySaveRequest): Promise<UpdatePolicySnapshot>
  planCreate(request: PlanCreateRequest, callerId: string): Promise<PlanResult>
  taskStart(request: TaskStartRequest, callerId: string): Promise<TaskState>
  taskGet(request: TaskIdRequest): Promise<TaskState>
  taskList(): Promise<readonly TaskState[]>
  taskEvents(request: TaskEventRequest): Promise<TaskEventPage>
  taskApproveBuilds(request: TaskApprovalRequest): Promise<TaskState>
  taskResume(request: TaskResumeRequest): Promise<TaskState>
  taskCancel(request: TaskCancelRequest): Promise<TaskState>
  pluginSetEnabled(request: PluginActionRequest): Promise<PluginActionResult>
  pluginRemove(request: RemovePluginRequest): Promise<PluginActionResult>
  authorDraftList(): readonly AuthorDraft[]
  authorDraftGet(id: string): AuthorDraft
  authorDraftSave(input: AuthorDraftInput): AuthorDraft
  authorDraftDelete(request: AuthorDraftDeleteRequest): boolean
  authorReadmeImport(request: ReadmeImportRequest): Promise<ReadmeImportResult>
  authorReadmePreview(request: ReadmeImportRequest): Promise<ReadmePreviewView>
  authorReadmeApplyPreview(request: ReadmeApplyPreviewRequest): ReadmeImportResult
  authorTransferBegin(request: TransferBeginRequest): TransferResult
  authorTransferChunk(request: TransferChunkRequest): Promise<TransferResult>
  authorTransferRead(request: TransferChunkReadRequest): TransferChunkReadResult
  /** 保留原运行时参数；Remote 的 transferId → taskId 转换由 adapter 负责。 */
  authorTransferDispose(request: TaskIdRequest): boolean
  authorExportDraft(request: AuthorExportRequest): TransferResult
  authorMediaRead(request: AuthorMediaReadRequest): AuthorMediaReadResult
  diagnosticsExport(selection?: AiAnalyzeRequest): Promise<DiagnosticExport>
  /** B 档安装日志：只读、最多 500 条、字段已脱敏。 */
  installLogRead(request?: { readonly limit?: number }): Promise<readonly InstallLogEntry[]>
  aiAnalyze(request: AiAnalyzeRequest, callerId: string, signal?: AbortSignal): Promise<AiAnalysisResult>
  aiConfirm(request: AiConfirmRequest, callerId: string): Promise<AiApplyResult>
}
