/**
 * Host-side composition root. It wires the official adapter, verified
 * delivery, profile-local persistence, task runner, catalog and authoring
 * services; the public MarketService only exposes typed Remote methods.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {
  AiAnalyzeRequest,
  AiAnalysisResult,
  AiApplyResult,
  AiConfirmRequest,
  AiProposal,
  AuthorDraft,
  AuthorDraftDeleteRequest,
  AuthorDraftInput,
  AuthorExportRequest,
  CatalogRefreshRequest,
  CatalogRefreshView,
  DiagnosticExport,
  PlanCreateRequest,
  PlanResult,
  PluginActionResult,
  PluginActionRequest,
  ReadmeImportRequest,
  ReadmeImportResult,
  RemovePluginRequest,
  TaskApprovalRequest,
  TaskCancelRequest,
  TaskEventPage,
  TaskEventRequest,
  TaskIdRequest,
  TaskResumeRequest,
  TaskStartRequest,
  TaskState,
  TransferBeginRequest,
  TransferChunkReadRequest,
  TransferChunkReadResult,
  TransferChunkRequest,
  TransferResult,
} from '../contracts/types.ts'
import { AiAssistant } from "./ai-assist.ts"
import { CatalogRepository } from '../catalog/store.ts'
import { ArtifactCache } from '../delivery/cache.ts'
import { safeFetch } from '../delivery/security.ts'
import { createPlanBundle } from '../core/planner.ts'
import type { PackExecutionContext, PlanBundle, PlanCatalogContext } from '../core/ports.ts'
import { InstallTaskManager } from '../core/task-manager.ts'
import {
  AtomicProfileLocks,
  NodePersistenceFiles,
} from '../adapters/dsh/persistence-adapter.ts'
import { OfficialHostPort } from '../adapters/dsh/host-port.ts'
import { CatalogArtifactPort } from '../adapters/dsh/artifact-adapter.ts'
import { JsonTaskStore } from '../persistence/task-store.ts'
import { SegmentedEventLog } from '../persistence/event-log.ts'
import {
  AuthorPackageService,
  ReadmeImporter,
  TransferManager,
} from '../authoring/index.ts'

export interface RuntimeIdentity {
  readonly environmentId: string
  readonly profileName: string
  readonly hostVersion: string
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resultFromOutcome(outcome: import('../core/ports.ts').HostInstallOutcome): PluginActionResult {
  if (outcome.kind === 'applied') {
    return {
      status: outcome.restartRequired ? 'restart-required' : 'applied',
      changed: outcome.changed,
      permissionChanges: outcome.permissionChanges,
    }
  }
  if (outcome.kind === 'failed') {
    return { status: 'failed', changed: outcome.changed, error: outcome.error, permissionChanges: outcome.permissionChanges }
  }
  if (outcome.kind === 'unknown') return { status: 'unknown', changed: false, error: outcome.error, permissionChanges: outcome.permissionChanges }
  return {
    status: 'unknown',
    changed: 'changed' in outcome ? outcome.changed : false,
    error: outcome.kind === 'awaiting-approval' ? 'awaiting build approval' : 'cancelled',
    permissionChanges: outcome.permissionChanges,
  }
}

export class MarketRuntime {
  readonly host: OfficialHostPort
  readonly catalog: CatalogRepository
  readonly artifacts: CatalogArtifactPort
  readonly tasks: InstallTaskManager
  readonly authoring: AuthorPackageService
  readonly readme: ReadmeImporter
  readonly transfers: TransferManager
  private recovery: Promise<void>
  private readonly files: NodePersistenceFiles
  private readonly taskStore: JsonTaskStore
  private readonly aiProposals = new Map<string, AiProposal>()
  private readonly assistant: AiAssistant

  constructor(ctx: Context, readonly identity: RuntimeIdentity, dataDirectory: string) {
    this.host = new OfficialHostPort(ctx, identity.environmentId)
    this.files = new NodePersistenceFiles(join(dataDirectory, 'state'))
    const locks = new AtomicProfileLocks(dataDirectory)
    // Bundle output lives at lib/index.js, so package data is one level up.
    const embeddedPath = fileURLToPath(new URL('../data/index.json', import.meta.url))
    this.catalog = new CatalogRepository(JSON.parse(readFileSync(embeddedPath, 'utf8')), join(dataDirectory, 'catalog'))
    const testLocalSources = (process.env.EAC_MARKET_TEST_ALLOW_LOCAL_SOURCES ?? '')
      .split(';').map((value) => value.trim()).filter((value) => value.length > 0)
    const cache = new ArtifactCache({
      cacheDir: join(dataDirectory, 'artifacts'),
      ...(testLocalSources.length === 0 ? {} : { allowLocalFileSources: testLocalSources }),
    })
    this.artifacts = new CatalogArtifactPort(cache, () => this.catalog.load().snapshot.deliveries, testLocalSources)
    this.taskStore = new JsonTaskStore(this.files, locks, `market-${identity.environmentId}`)
    this.tasks = new InstallTaskManager({
      host: this.host,
      artifacts: this.artifacts,
      store: this.taskStore,
      locks,
      events: new SegmentedEventLog(this.files),
    })
    const authorRoot = join(dataDirectory, 'authoring')
    const serviceContext = {
      llm: ctx.get("llm") as ConstructorParameters<typeof AiAssistant>[0],
      agentDefaultModel: ctx.get("agentDefaultModel") as ConstructorParameters<typeof AiAssistant>[1],
    }
    this.assistant = new AiAssistant(serviceContext.llm, serviceContext.agentDefaultModel)
    this.authoring = new AuthorPackageService(authorRoot)
    this.readme = new ReadmeImporter(authorRoot)
    this.transfers = new TransferManager(join(dataDirectory, 'transfers'), {
      finisher: async ({ path, request }) => {
        const bytes = new Uint8Array(readFileSync(path))
        if (request.purpose === 'draft-media') {
          const stored = this.authoring.media.save(bytes, request.filename)
          if (request.targetId !== undefined) {
            const draft = this.authoring.drafts.get(request.targetId)
            this.authoring.drafts.update({
              ...draft,
              id: draft.id,
              expectedRevision: request.expectedRevision ?? draft.revision,
              mediaIds: [...draft.mediaIds, stored.id],
            })
          }
          return stored.id
        }
        if (request.purpose === 'author-import') {
          return this.authoring.import(bytes, {
            ...(request.targetId === undefined ? {} : { targetDraftId: request.targetId }),
            ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision }),
          }).draft.id
        }
        return undefined
      },
    })
    this.recovery = this.tasks.reconcileInterrupted(identity.environmentId)
      .then(() => undefined)
      .catch((error: unknown) => { console.error('[eac-market/host] interrupted task recovery failed', error) })
  }

  private planPath(planId: string): string {
    return `plans/${planId}.json`
  }

  private async savePlan(bundle: PlanBundle): Promise<void> {
    await this.files.writeAtomic(this.planPath(bundle.plan.planId), new TextEncoder().encode(JSON.stringify(bundle)))
  }

  private async loadPlan(planId: string): Promise<PlanBundle> {
    const bytes = await this.files.read(this.planPath(planId))
    if (bytes === undefined) throw new Error('Host 未保存该安装计划')
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as PlanBundle
  }

  async catalogRefresh(request?: CatalogRefreshRequest): Promise<CatalogRefreshView> {
    const sourceUrl = request?.sourceUrl
    if (sourceUrl === undefined) {
      const current = this.catalog.load()
      return { status: 'failed', current: current.snapshot, reason: '未提供受控目录来源' }
    }
    const result = await this.catalog.refresh(async () => {
      const response = await safeFetch(sourceUrl)
      return new Uint8Array(await response.arrayBuffer())
    })
    return {
      status: result.status,
      current: result.current.snapshot,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
    }
  }

  async planCreate(request: PlanCreateRequest): Promise<PlanResult> {
    try {
      const snapshot = this.catalog.load().snapshot
      const state = await this.host.readState()
      const facts = snapshot.plugins.map((plugin) => ({
        pluginId: plugin.id,
        packageName: plugin.packageName,
        version: plugin.version,
        artifactDigest: plugin.artifactDigest ?? '',
        verification: plugin.verification,
        requiresRestart: plugin.requiresRestart,
        installable: plugin.installability === 'bundle-installable',
      }))
      const localIdentityByPackage: Record<string, 'file' | 'link' | 'fork' | 'registry' | 'unknown'> = {}
      const marketManagedPackageNames: string[] = []
      for (const item of state.inventory.items) {
        if (item.source === 'market-cache-file') {
          localIdentityByPackage[item.packageName] = 'file'
          marketManagedPackageNames.push(item.packageName)
        } else if (item.source === 'unknown') {
          localIdentityByPackage[item.packageName] = 'unknown'
        }
      }
      let pack: PackExecutionContext | undefined
      if (request.packId !== undefined) {
        const catalogPack = snapshot.packs.find((item) => item.id === request.packId && item.version === request.packVersion)
        const lockBytes = this.catalog.lockBytes(request.packId, request.packVersion ?? '')
        if (catalogPack === undefined || lockBytes === undefined) {
          return { status: 'blocked', reason: 'pack-not-found', blockers: ['pack-not-found'] }
        }
        pack = {
          packId: catalogPack.id,
          packVersion: catalogPack.version,
          components: catalogPack.components.map((component) => ({ pluginId: component.pluginId, required: component.required })),
          execution: catalogPack.execution,
          lockBytes,
        }
      }
      const context: PlanCatalogContext = {
        ...(request.planId === undefined ? {} : { planId: request.planId }),
        catalogRevision: snapshot.revision,
        environmentId: this.identity.environmentId,
        hostFingerprint: `${this.identity.hostVersion}:${this.identity.profileName}`,
        inventory: state.inventory.items,
        plugins: facts,
        selections: request.selections,
        now: new Date(),
        marketManagedPackageNames,
        localIdentityByPackage,
      }
      const result = await createPlanBundle(context, pack)
      if (result.status === 'ready' && result.bundle !== undefined) await this.savePlan(result.bundle)
      if (result.status === 'ready' && result.bundle !== undefined) return { status: 'ready', plan: result.bundle.plan }
      if (result.status === 'stale') return { status: 'stale', reason: result.reason ?? 'stale', details: result.details ?? [] }
      return { status: 'blocked', reason: result.reason ?? 'blocked', blockers: result.blockers ?? [] }
    } catch (error) {
      return { status: 'blocked', reason: errorText(error), blockers: [errorText(error)] }
    }
  }

  async taskStart(request: TaskStartRequest): Promise<TaskState> {
    await this.recovery
    const bundle = await this.loadPlan(request.planId)
    const baseline = await this.host.readState()
    return (await this.tasks.start(bundle, request, baseline)).task
  }

  async taskGet(request: TaskIdRequest): Promise<TaskState> {
    await this.recovery
    const task = await this.tasks.get(request.taskId)
    if (task === undefined) throw new Error('任务不存在')
    return task
  }

  async taskList(): Promise<readonly TaskState[]> {
    await this.recovery
    return (await this.taskStore.list(this.identity.environmentId)).map((record) => record.task)
  }

  async taskEvents(request: TaskEventRequest): Promise<TaskEventPage> {
    return this.tasks.events(request.taskId, request.afterSequence ?? 0, request.limit ?? 100)
  }

  async taskApproveBuilds(request: TaskApprovalRequest): Promise<TaskState> {
    await this.recovery
    return this.tasks.approveBuilds(request)
  }

  async taskResume(request: TaskResumeRequest): Promise<TaskState> {
    await this.recovery
    return this.tasks.resume(request)
  }

  async taskCancel(request: TaskCancelRequest): Promise<TaskState> {
    await this.recovery
    return this.tasks.cancel(request)
  }

  async pluginSetEnabled(request: PluginActionRequest): Promise<PluginActionResult> {
    return resultFromOutcome(await this.host.setEnabled(request.packageName, request.enabled))
  }

  async pluginRemove(request: RemovePluginRequest): Promise<PluginActionResult> {
    try {
      const result = await this.host.remove(request.packageName)
      if (result.application === 'applied' || result.application === 'restart-required') {
        return resultFromOutcome({ kind: 'applied', changed: result.changed, restartRequired: result.application === 'restart-required', permissionChanges: [] })
      }
      if (result.application === 'overridden') return { status: 'unknown', changed: result.changed, error: 'official removal state was overridden', permissionChanges: [] }
      if (result.application === 'cancelled') return resultFromOutcome({ kind: 'cancelled', changed: result.changed, permissionChanges: [] })
      if (result.application === 'failed') return resultFromOutcome({ kind: 'failed', changed: result.changed, error: result.error?.code ?? 'operation-error', permissionChanges: [] })
      return { status: 'unknown', changed: false, error: 'unrecognised official removal result', permissionChanges: [] }
    } catch (error) {
      return { status: 'failed', changed: false, error: errorText(error), permissionChanges: [] }
    }
  }

  authorDraftList(): readonly AuthorDraft[] {
    return this.authoring.drafts.list()
  }

  authorDraftGet(id: string): AuthorDraft {
    return this.authoring.drafts.get(id)
  }

  authorDraftSave(input: AuthorDraftInput): AuthorDraft {
    return input.id === undefined ? this.authoring.drafts.create(input) : this.authoring.drafts.update({ ...input, id: input.id })
  }

  authorDraftDelete(request: AuthorDraftDeleteRequest): boolean {
    this.authoring.drafts.delete(request.id, request.expectedRevision)
    return true
  }

  authorReadmeImport(request: ReadmeImportRequest): Promise<ReadmeImportResult> {
    return this.readme.importReadme(request)
  }

  authorTransferBegin(request: TransferBeginRequest): TransferResult {
    return this.transfers.begin(request, {
      ownerId: this.identity.environmentId,
      ...(request.targetId === undefined ? {} : { targetId: request.targetId }),
    })
  }

  authorTransferChunk(request: TransferChunkRequest): Promise<TransferResult> {
    return this.transfers.writeChunk(this.identity.environmentId, request)
  }

  authorTransferRead(request: TransferChunkReadRequest): TransferChunkReadResult {
    return this.transfers.readChunk(this.identity.environmentId, request.transferId, request.sequence)
  }

  authorTransferDispose(request: TaskIdRequest): boolean {
    this.transfers.dispose(this.identity.environmentId, request.taskId)
    return true
  }

  authorExportDraft(request: AuthorExportRequest): TransferResult {
    const bytes = this.authoring.export(request.draftId, {
      ...(request.repositoryUrl === undefined ? {} : { repositoryUrl: request.repositoryUrl }),
      ...(request.commit === undefined ? {} : { commit: request.commit }),
      ...(request.license === undefined ? {} : { license: request.license }),
      ...(request.licenseNotice === undefined ? {} : { licenseNotice: request.licenseNotice }),
      ...(request.notes === undefined ? {} : { notes: request.notes }),
    })
    return this.transfers.stageOutbound(this.identity.environmentId, {
      purpose: 'author-export',
      filename: 'presentation.eac-market-presentation.zip',
      mediaType: 'application/zip',
      ...(request.targetId === undefined ? {} : { targetId: request.targetId }),
    }, bytes)
  }

  async aiAnalyze(request: AiAnalyzeRequest): Promise<AiAnalysisResult> {
    return this.assistant.analyze(request, await this.diagnosticsExport())
  }

  async aiConfirm(request: AiConfirmRequest): Promise<AiApplyResult> {
    const proposal = this.aiProposals.get(request.proposalId)
    if (proposal === undefined || Date.parse(proposal.expiresAt) <= Date.now()) return { status: "blocked", changed: false, error: "提案不存在或已过期" }
    if (request.impactDigest !== this.assistant.impactDigest(proposal)) return { status: "blocked", changed: false, error: "确认范围与提案不一致" }
    const action = proposal.actions[0]
    if (action === undefined) return { status: "blocked", changed: false, error: "提案没有可执行动作" }
    if (action.requiresSecondConfirmation && request.riskConfirmed !== true) return { status: "blocked", changed: false, error: "卸载或降级需要单独确认影响" }
    if (action.kind === "enable" || action.kind === "disable") {
      const result = await this.pluginSetEnabled({ packageName: action.packageName, enabled: action.kind === "enable", idempotencyKey: request.idempotencyKey })
      return { status: result.status, changed: result.changed, ...(result.error === undefined ? {} : { error: result.error }) }
    }
    if (action.kind === "remove") {
      const result = await this.pluginRemove({ packageName: action.packageName, confirmed: true, idempotencyKey: request.idempotencyKey })
      return { status: result.status, changed: result.changed, ...(result.error === undefined ? {} : { error: result.error }) }
    }
    const plugin = this.catalog.load().snapshot.plugins.find((item) => item.packageName === action.packageName && (action.targetVersion === undefined || item.version === action.targetVersion))
    if (plugin === undefined || plugin.artifactDigest === undefined) return { status: "blocked", changed: false, error: "提案缺少可安装制品" }
    const plan = await this.planCreate({ selections: [{ pluginId: plugin.id, packageName: plugin.packageName, targetVersion: plugin.version, targetDigest: plugin.artifactDigest, enabledIntent: true, tryUnverified: false }] })
    if (plan.status !== "ready") return { status: "blocked", changed: false, error: plan.reason }
    const task = await this.taskStart({ planId: plan.plan.planId, planDigest: plan.plan.planDigest, idempotencyKey: request.idempotencyKey, confirmed: true, retryOfTaskId: request.proposalId })
    return { status: task.status === "completed" ? "applied" : task.status === "failed" ? "failed" : "unknown", changed: true, taskId: task.taskId }
  }

  async diagnosticsExport(): Promise<DiagnosticExport> {
    return {
      schemaVersion: '1',
      generatedAt: new Date().toISOString(),
      marketVersion: '0.1.0-mvp.0',
      environmentId: this.identity.environmentId,
      summaries: ['catalog', 'tasks', 'authoring'], diagnostics: [], redacted: true,
    }
  }
}
