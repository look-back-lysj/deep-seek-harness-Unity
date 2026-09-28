/**
 * Host entry and public Typert root. All implementation lives behind the
 * market runtime; this class exposes the stable Remote surface only.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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
  type AuthorMediaReadRequest,
  type AuthorMediaReadResult,
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
  type ReadmePreviewView,
  type ReadmeApplyPreviewRequest,
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
  /** Maintainer configuration, not writable by catalogRefresh or author content. */
  readonly catalogSources?: {
    readonly id: string
    readonly indexUrl: string
    readonly maintainer: string
    readonly fallbackId?: string
  }[]
}

const ConfigSchema: z<Config> = z.object({
  dataDirectory: z.string().default(''),
  catalogSources: z.array(z.object({
    id: z.string().required(),
    indexUrl: z.string().required(),
    maintainer: z.string().required(),
    fallbackId: z.string().default(''),
  })).default([]),
})

const marketVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version

function officialHostVersion(): string {
  try {
    const metadata = createRequire(import.meta.url)('@deepseek-ai/dsh-app-boot/package.json') as { version?: unknown }
    return typeof metadata.version === 'string' ? metadata.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** @typert service eacMarket */
export class MarketService extends Service {
  static inject = ['profileContext']
  static Config: z<Config> = ConfigSchema

  private readonly context: Context
  private readonly profileDir: string
  private readonly marketDataDir: string
  private readonly hostVersion: string
  readonly typertRemote: unknown = bindTypertRemote(this, 'eacMarket')
  private readonly runtime: MarketRuntime

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'eacMarket')
    this.context = ctx
    this.profileDir = ctx.profileContext.dir
    this.marketDataDir = config.dataDirectory || join(this.profileDir, 'eac-market')
    this.hostVersion = officialHostVersion()
    const identity = {
      environmentId: createHash('sha256').update(`eac-market:${this.profileDir}`).digest('hex').slice(0, 24),
      profileName: ctx.profileContext.name,
      hostVersion: this.hostVersion,
    }
    this.runtime = new MarketRuntime(ctx, identity, this.marketDataDir, {
      marketVersion,
      catalogSources: (config.catalogSources ?? []).map((source) => ({
        id: source.id,
        indexUrl: source.indexUrl,
        maintainer: source.maintainer,
        trust: 'team-registered',
        ...(source.fallbackId ? { fallbackId: source.fallbackId } : {}),
      })),
    })
  }

  private remoteCaller(): { readonly id: string; readonly signal: AbortSignal } {
    // Official RemoteInvocation (typert/protocol/src/types.ts) is attached to
    // the call-scoped receiver. Our minimal generator ambient shim does not
    // redeclare Cordis; consume only these verified fields structurally.
    const invocation = (this.ctx as Context & { readonly invocation?: {
      readonly peer: { readonly id: string }
      readonly signal: AbortSignal
    } }).invocation
    if (!invocation?.peer.id || !invocation.signal) throw new Error('当前调用缺少官方连接身份，无法确认写入')
    return { id: String(invocation.peer.id), signal: invocation.signal }
  }

  @Remote
  hello(): EnvironmentHello {
    return {
      protocolVersion: PROTOCOL_VERSION,
      schemaVersion: MARKET_SCHEMA_VERSION,
      marketVersion,
      environmentId: createHash('sha256').update(`eac-market:${this.profileDir}`).digest('hex').slice(0, 24),
      profileName: this.context.profileContext.name,
      hostVersion: this.hostVersion,
      capabilities: this.runtime.host.capabilities(),
    }
  }

  @Remote
  catalog(): CatalogSnapshot {
    return { ...this.runtime.catalog.load().snapshot, collections: this.runtime.catalog.collectionViews() }
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
    return this.runtime.planCreate(request, this.remoteCaller().id)
  }

  @Remote
  taskStart(request: TaskStartRequest): Promise<TaskState> {
    return this.runtime.taskStart(request, this.remoteCaller().id)
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
  authorReadmePreview(request: ReadmeImportRequest): Promise<ReadmePreviewView> {
    return this.runtime.authorReadmePreview(request)
  }

  @Remote
  authorReadmeApplyPreview(request: ReadmeApplyPreviewRequest): ReadmeImportResult {
    return this.runtime.authorReadmeApplyPreview(request)
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
  authorMediaRead(request: AuthorMediaReadRequest): AuthorMediaReadResult {
    return this.runtime.authorMediaRead(request)
  }

  @Remote
  diagnosticsExport(): Promise<DiagnosticExport> {
    return this.runtime.diagnosticsExport()
  }

  @Remote
  aiAnalyze(request: AiAnalyzeRequest): Promise<AiAnalysisResult> {
    const caller = this.remoteCaller()
    return this.runtime.aiAnalyze(request, caller.id, caller.signal)
  }

  @Remote
  aiConfirm(request: AiConfirmRequest): Promise<AiApplyResult> {
    return this.runtime.aiConfirm(request, this.remoteCaller().id)
  }

}

export default MarketService
export type * from './types.ts'
