/**
 * Host entry and public Typert root. All implementation lives behind the
 * market runtime; this class exposes the stable Remote surface only.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import * as dshHost from '@deepseek-ai/dsh-app-boot'
import { Remote, bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import {
  AiAnalyzeRequest,
  AiAnalysisResult,
  AiApplyResult,
  AiConfirmRequest,
  MARKET_SCHEMA_VERSION,
  type ClientHandshakeRequest,
  type ClientHandshakeResult,
  type AuthorDraft,
  type AuthorDraftDeleteRequest,
  type AuthorDraftInput,
  type AuthorExportRequest,
  type AuthorMediaReadRequest,
  type AuthorMediaReadResult,
  type CatalogRefreshRequest,
  type CatalogRefreshView,
  type CatalogSnapshot,
  type CatalogSourceView,
  type CoreMaintenanceSnapshot,
  type UpdateCheckResult,
  type UpdatePolicySnapshot,
  type UpdatePolicySaveRequest,
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
  type TaskStartRecoveryRequest,
  type TaskStartRecoveryResult,
  type PluginActionRecoveryRequest,
  type PluginActionRecoveryResult,
  type TaskState,
  type TransferBeginRequest,
  type TransferChunkReadRequest,
  type TransferChunkReadResult,
  type TransferChunkRequest,
  type TransferDisposeRequest,
  type TransferResult,
  type HostCoreSnapshot,
  type ReleaseOptionsRequest,
  type ReleaseOptionsResult,
} from './types.ts'
import type { MarketBackend } from '@dsh-eac/market-core'
import { createDshMarketBackend } from '@dsh-eac/market-core/dsh'
import { desktopCatalogSourceOptions } from './catalog-options.ts'
import { CORE_API_VERSION, CORE_VERSION, supportsApiVersion } from '@dsh-eac/market-core/compatibility'
import { ClientSessionGate } from './session-gate.ts'
import { ADAPTER_PROVIDER_PROTOCOL_VERSION, HOST_REQUIRED_CORE_API_VERSION } from './version.ts'
import { readDshHostCore } from './host-core.ts'

export interface Config {
  readonly dataDirectory?: string
  /** Maintainer configuration, not writable by catalogRefresh or author content. */
  readonly catalogSources?: {
    readonly id: string
    readonly indexUrl: string
    readonly maintainer: string
    readonly fallbackId?: string
  }[]
  /** Host-maintained Agent Forge sources. Local paths are intentionally not accepted in plugin config. */
  readonly agentForgeSources?: {
    readonly id: string
    readonly locationUrl: string
    readonly expectedRevision: string
    readonly enabled: boolean
    readonly priority: number
    readonly refreshPolicy: string
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
  agentForgeSources: z.array(z.object({
    id: z.string().required(),
    locationUrl: z.string().required(),
    expectedRevision: z.string().required().default(''),
    enabled: z.boolean().required(),
    priority: z.number().required(),
    refreshPolicy: z.string().required().default('manual'),
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
  private readonly runtime: MarketBackend
  private readonly clientSessions = new ClientSessionGate(ADAPTER_PROVIDER_PROTOCOL_VERSION)

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'eacMarket')
    if (!supportsApiVersion(CORE_API_VERSION, HOST_REQUIRED_CORE_API_VERSION)) {
      throw new Error('市场 core 接口版本不匹配，请安装经过验证的完整市场版本。')
    }
    this.context = ctx
    this.profileDir = ctx.profileContext.dir
    this.marketDataDir = config.dataDirectory || join(this.profileDir, 'eac-market')
    this.hostVersion = officialHostVersion()
    const identity = {
      environmentId: createHash('sha256').update(`eac-market:${this.profileDir}`).digest('hex').slice(0, 24),
      profileName: ctx.profileContext.name,
      hostVersion: this.hostVersion,
    }
    this.runtime = createDshMarketBackend(ctx, identity, this.marketDataDir, {
      embeddedCatalogBytes: readFileSync(new URL('../data/index.json', import.meta.url)),
      marketVersion,
      readHostCore: () => readDshHostCore(() => typeof dshHost.getDshRuntimeVersion === 'function' ? dshHost.getDshRuntimeVersion() : undefined),
      ...desktopCatalogSourceOptions(config.catalogSources),
      agentForgeSourceOptions: { targetAgent: 'dsh' },
      agentForgeSources: (config.agentForgeSources ?? []).map(source => {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(source.id)) throw new Error('Agent Forge source ID 格式无效')
        let url: URL
        try { url = new URL(source.locationUrl) } catch { throw new Error('Agent Forge source URL 格式无效') }
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Agent Forge source 只接受无凭据 HTTPS URL')
        if (!['manual', 'on-open', 'periodic'].includes(source.refreshPolicy)) throw new Error('Agent Forge refreshPolicy 无效')
        if (!Number.isInteger(source.priority) || source.priority < 0 || source.priority > 1000) throw new Error('Agent Forge source priority 无效')
        return {
          id: source.id,
          kind: 'agent-forge' as const,
          location: { mode: 'https' as const, value: url.href },
          ...(source.expectedRevision === '' ? {} : { expectedRevision: source.expectedRevision }),
          enabled: source.enabled,
          priority: source.priority,
          refreshPolicy: source.refreshPolicy as 'manual' | 'on-open' | 'periodic',
        }
      }),
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

  private assertWriteCompatible(): void {
    const caller = this.remoteCaller()
    this.clientSessions.assert(caller.id)
  }

  @Remote
  clientConnect(request: ClientHandshakeRequest): ClientHandshakeResult {
    const caller = this.remoteCaller()
    const accepted = this.clientSessions.connect(caller.id, request?.protocolVersion)
    return {
      accepted,
      protocolVersion: ADAPTER_PROVIDER_PROTOCOL_VERSION,
      coreVersion: CORE_VERSION,
      coreApiVersion: CORE_API_VERSION,
      ...(accepted ? {} : { reason: '市场页面与后台协议不兼容，请刷新或更新市场。' }),
    }
  }

  @Remote
  hello(): EnvironmentHello {
    return {
      protocolVersion: ADAPTER_PROVIDER_PROTOCOL_VERSION,
      coreVersion: CORE_VERSION,
      coreApiVersion: CORE_API_VERSION,
      schemaVersion: MARKET_SCHEMA_VERSION,
      marketVersion,
      environmentId: createHash('sha256').update(`eac-market:${this.profileDir}`).digest('hex').slice(0, 24),
      profileName: this.context.profileContext.name,
      hostVersion: this.hostVersion,
      capabilities: this.runtime.capabilities(),
      hostCore: this.runtime.hostCore(),
    }
  }

  @Remote
  catalog(): CatalogSnapshot {
    return this.runtime.catalog()
  }

  @Remote
  hostCore(): HostCoreSnapshot {
    return this.runtime.hostCore()
  }

  @Remote
  releaseOptions(request: ReleaseOptionsRequest): Promise<ReleaseOptionsResult> {
    return this.runtime.releaseOptions(request)
  }

  @Remote
  catalogRefresh(request?: CatalogRefreshRequest): Promise<CatalogRefreshView> {
    this.assertWriteCompatible()
    return this.runtime.catalogRefresh(request)
  }

  @Remote
  catalogSources(): Promise<readonly CatalogSourceView[]> {
    return this.runtime.catalogSources()
  }

  @Remote
  agentForgeRefresh(request: { readonly sourceId: string }): Promise<CatalogRefreshView> {
    this.assertWriteCompatible()
    return this.runtime.agentForgeRefresh(request)
  }

  @Remote
  maintenanceStatus(): Promise<CoreMaintenanceSnapshot> {
    return this.runtime.maintenanceStatus()
  }

  @Remote
  checkUpdates(request?: { readonly sourceId?: string; readonly refreshFirst?: boolean }): Promise<UpdateCheckResult> {
    if (request?.refreshFirst) this.assertWriteCompatible()
    return this.runtime.checkUpdates(request)
  }

  @Remote
  updatePolicyGet(): Promise<UpdatePolicySnapshot> {
    return this.runtime.updatePolicyGet()
  }

  @Remote
  updatePolicySave(request: UpdatePolicySaveRequest): Promise<UpdatePolicySnapshot> {
    this.assertWriteCompatible()
    return this.runtime.updatePolicySave(request)
  }

  @Remote
  async inventory(): Promise<InventorySnapshot> {
    return this.runtime.inventory()
  }

  @Remote
  planCreate(request: PlanCreateRequest): Promise<PlanResult> {
    this.assertWriteCompatible()
    return this.runtime.planCreate(request, this.remoteCaller().id)
  }

  @Remote
  taskStart(request: TaskStartRequest): Promise<TaskState> {
    this.assertWriteCompatible()
    return this.runtime.taskStart(request, this.remoteCaller().id)
  }

  @Remote
  taskGet(request: TaskIdRequest): Promise<TaskState> {
    return this.runtime.taskGet(request)
  }

  @Remote
  taskStartRecover(request: TaskStartRecoveryRequest): Promise<TaskStartRecoveryResult> {
    return this.runtime.taskStartRecover(request, this.remoteCaller().id)
  }

  @Remote
  pluginActionRecover(request: PluginActionRecoveryRequest): Promise<PluginActionRecoveryResult> {
    return this.runtime.pluginActionRecover(request)
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
    this.assertWriteCompatible()
    return this.runtime.taskApproveBuilds(request)
  }

  @Remote
  taskResume(request: TaskResumeRequest): Promise<TaskState> {
    this.assertWriteCompatible()
    return this.runtime.taskResume(request)
  }

  @Remote
  taskCancel(request: TaskCancelRequest): Promise<TaskState> {
    this.assertWriteCompatible()
    return this.runtime.taskCancel(request)
  }

  @Remote
  pluginSetEnabled(request: PluginActionRequest): Promise<PluginActionResult> {
    this.assertWriteCompatible()
    return this.runtime.pluginSetEnabled(request)
  }

  @Remote
  pluginRemove(request: RemovePluginRequest): Promise<PluginActionResult> {
    this.assertWriteCompatible()
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
    this.assertWriteCompatible()
    return this.runtime.authorDraftSave(input)
  }

  @Remote
  authorDraftDelete(request: AuthorDraftDeleteRequest): boolean {
    this.assertWriteCompatible()
    return this.runtime.authorDraftDelete(request)
  }

  @Remote
  authorReadmeImport(request: ReadmeImportRequest): Promise<ReadmeImportResult> {
    this.assertWriteCompatible()
    return this.runtime.authorReadmeImport(request)
  }

  @Remote
  authorReadmePreview(request: ReadmeImportRequest): Promise<ReadmePreviewView> {
    this.assertWriteCompatible()
    return this.runtime.authorReadmePreview(request)
  }

  @Remote
  authorReadmeApplyPreview(request: ReadmeApplyPreviewRequest): ReadmeImportResult {
    this.assertWriteCompatible()
    return this.runtime.authorReadmeApplyPreview(request)
  }

  @Remote
  authorTransferBegin(request: TransferBeginRequest): TransferResult {
    this.assertWriteCompatible()
    return this.runtime.authorTransferBegin(request)
  }

  @Remote
  authorTransferChunk(request: TransferChunkRequest): Promise<TransferResult> {
    this.assertWriteCompatible()
    return this.runtime.authorTransferChunk(request)
  }

  @Remote
  authorTransferRead(request: TransferChunkReadRequest): TransferChunkReadResult {
    return this.runtime.authorTransferRead(request)
  }

  @Remote
  authorTransferDispose(request: TransferDisposeRequest): boolean {
    this.assertWriteCompatible()
    return this.runtime.authorTransferDispose({ taskId: request.transferId })
  }

  @Remote
  authorExportDraft(request: AuthorExportRequest): TransferResult {
    this.assertWriteCompatible()
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
    this.assertWriteCompatible()
    const caller = this.remoteCaller()
    return this.runtime.aiAnalyze(request, caller.id, caller.signal)
  }

  @Remote
  aiConfirm(request: AiConfirmRequest): Promise<AiApplyResult> {
    this.assertWriteCompatible()
    return this.runtime.aiConfirm(request, this.remoteCaller().id)
  }

}

export default MarketService
export type * from './types.ts'
