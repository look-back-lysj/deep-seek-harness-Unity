/**
 * Host entry and public Typert root. All implementation lives behind the
 * market runtime; this class exposes the stable Remote surface only.
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import { Remote, bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import {
  AiAnalyzeRequest,
  AiAnalysisResult,
  AiApplyResult,
  AiConfirmRequest,
  MARKET_SCHEMA_VERSION,
  PROTOCOL_VERSION,
  type AuthorDraft,
  type AuthorDraftDeleteRequest,
  type AuthorDraftInput,
  type AuthorExportRequest,
  type CatalogRefreshRequest,
  type CatalogRefreshView,
  type CatalogSnapshot,
  type DiagnosticExport,
  type EnvironmentHello,
  type InventorySnapshot,
  type PlanCreateRequest,
  type PlanResult,
  type PluginActionResult,
  type PluginActionRequest,
  type ReadmeImportRequest,
  type ReadmeImportResult,
  type RemovePluginRequest,
  type TaskApprovalRequest,
  type TaskCancelRequest,
  type TaskEventPage,
  type TaskEventRequest,
  type TaskIdRequest,
  type TaskResumeRequest,
  type TaskStartRequest,
  type TaskState,
  type TransferBeginRequest,
  type TransferChunkReadRequest,
  type TransferChunkReadResult,
  type TransferChunkRequest,
  type TransferDisposeRequest,
  type TransferResult,
} from './types.ts'
import { MarketRuntime } from './host/market-runtime.ts'

export interface Config {
  readonly dataDirectory?: string
}

const ConfigSchema = z.object({ dataDirectory: z.string().default('') })

/** @typert service eacMarket */
export class MarketService extends Service {
  static inject = ['profileContext']
  static Config = ConfigSchema

  private readonly context: Context
  private readonly profileDir: string
  private readonly marketDataDir: string
  readonly typertRemote: unknown = bindTypertRemote(this, 'eacMarket')
  private readonly runtime: MarketRuntime

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'eacMarket')
    this.context = ctx
    this.profileDir = ctx.profileContext.dir
    this.marketDataDir = config.dataDirectory || join(this.profileDir, 'eac-market')
    const identity = {
      environmentId: createHash('sha256').update(`eac-market:${this.profileDir}`).digest('hex').slice(0, 24),
      profileName: ctx.profileContext.name,
      hostVersion: '0.1.7-rc.2',
    }
    this.runtime = new MarketRuntime(ctx, identity, this.marketDataDir)
  }

  @Remote
  hello(): EnvironmentHello {
    return {
      protocolVersion: PROTOCOL_VERSION,
      schemaVersion: MARKET_SCHEMA_VERSION,
      marketVersion: '0.1.0-mvp.0',
      environmentId: createHash('sha256').update(`eac-market:${this.profileDir}`).digest('hex').slice(0, 24),
      profileName: this.context.profileContext.name,
      hostVersion: '0.1.7-rc.2',
      capabilities: this.runtime.host.capabilities(),
    }
  }

  @Remote
  catalog(): CatalogSnapshot {
    return this.runtime.catalog.load().snapshot
  }

  @Remote
  catalogRefresh(request?: CatalogRefreshRequest): Promise<CatalogRefreshView> {
    return this.runtime.catalogRefresh(request)
  }

  @Remote
  async inventory(): Promise<InventorySnapshot> {
    return (await this.runtime.host.readState()).inventory
  }

  @Remote
  planCreate(request: PlanCreateRequest): Promise<PlanResult> {
    return this.runtime.planCreate(request)
  }

  @Remote
  taskStart(request: TaskStartRequest): Promise<TaskState> {
    return this.runtime.taskStart(request)
  }

  @Remote
  taskGet(request: TaskIdRequest): Promise<TaskState> {
    return this.runtime.taskGet(request)
  }

  @Remote
  taskList(): Promise<readonly TaskState[]> {
    return this.runtime.taskList()
  }

  @Remote
  taskEvents(request: TaskEventRequest): Promise<TaskEventPage> {
    return this.runtime.taskEvents(request)
  }

  @Remote
  taskApproveBuilds(request: TaskApprovalRequest): Promise<TaskState> {
    return this.runtime.taskApproveBuilds(request)
  }

  @Remote
  taskResume(request: TaskResumeRequest): Promise<TaskState> {
    return this.runtime.taskResume(request)
  }

  @Remote
  taskCancel(request: TaskCancelRequest): Promise<TaskState> {
    return this.runtime.taskCancel(request)
  }

  @Remote
  pluginSetEnabled(request: PluginActionRequest): Promise<PluginActionResult> {
    return this.runtime.pluginSetEnabled(request)
  }

  @Remote
  pluginRemove(request: RemovePluginRequest): Promise<PluginActionResult> {
    return this.runtime.pluginRemove(request)
  }

  @Remote
  authorDraftList(): readonly AuthorDraft[] {
    return this.runtime.authorDraftList()
  }

  @Remote
  authorDraftGet(id: string): AuthorDraft {
    return this.runtime.authorDraftGet(id)
  }

  @Remote
  authorDraftSave(input: AuthorDraftInput): AuthorDraft {
    return this.runtime.authorDraftSave(input)
  }

  @Remote
  authorDraftDelete(request: AuthorDraftDeleteRequest): boolean {
    return this.runtime.authorDraftDelete(request)
  }

  @Remote
  authorReadmeImport(request: ReadmeImportRequest): Promise<ReadmeImportResult> {
    return this.runtime.authorReadmeImport(request)
  }

  @Remote
  authorTransferBegin(request: TransferBeginRequest): TransferResult {
    return this.runtime.authorTransferBegin(request)
  }

  @Remote
  authorTransferChunk(request: TransferChunkRequest): Promise<TransferResult> {
    return this.runtime.authorTransferChunk(request)
  }

  @Remote
  authorTransferRead(request: TransferChunkReadRequest): TransferChunkReadResult {
    return this.runtime.authorTransferRead(request)
  }

  @Remote
  authorTransferDispose(request: TransferDisposeRequest): boolean {
    return this.runtime.authorTransferDispose({ taskId: request.transferId })
  }

  @Remote
  authorExportDraft(request: AuthorExportRequest): TransferResult {
    return this.runtime.authorExportDraft(request)
  }

  @Remote
  diagnosticsExport(): Promise<DiagnosticExport> {
    return this.runtime.diagnosticsExport()
  }

  @Remote
  aiAnalyze(request: AiAnalyzeRequest): Promise<AiAnalysisResult> {
    return this.runtime.aiAnalyze(request)
  }

  @Remote
  aiConfirm(request: AiConfirmRequest): Promise<AiApplyResult> {
    return this.runtime.aiConfirm(request)
  }

}

export default MarketService
export type * from './types.ts'
