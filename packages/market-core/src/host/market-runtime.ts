/**
 * Host-side composition root. It wires the official adapter, verified
 * delivery, profile-local persistence, task runner, catalog and authoring
 * services; the public MarketService only exposes typed Remote methods.
 */
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  AiAnalyzeRequest,
  AiAnalysisResult,
  AiApplyResult,
  AiConfirmRequest,
  AiProposal,
  AiActionImpact,
  CatalogPlugin,
  CatalogDelivery,
  InventoryItem,
  InventorySnapshot,
  AuthorDraft,
  AuthorDraftDeleteRequest,
  AuthorDraftInput,
  AuthorExportRequest,
  AuthorMediaReadRequest,
  AuthorMediaReadResult,
  CatalogRefreshRequest,
  CatalogRefreshView,
  CoreMaintenanceSnapshot,
  DiagnosticExport,
  PlanCreateRequest,
  PlanResult,
  PluginActionResult,
  PluginActionRequest,
  ReadmeImportRequest,
  ReadmeImportResult,
  ReadmePreviewView,
  ReadmeApplyPreviewRequest,
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
import { AiProposalStore } from './ai-proposal-store.ts'
import { collectDiagnostics, diagnosticDigest, sanitizeDiagnostic, sourceIdentity } from './diagnostics.ts'
import { assessRiskyAction, type ManagementManifest } from './management-impact.ts'
import { canonicalJson } from '../core/canonical.ts'
import { isProtectedMarketPackage } from '../core/identity.ts'
import { CatalogRepository } from '../catalog/store.ts'
import { CatalogSourceRegistry, type CatalogSourceIdentity } from '../catalog/source.ts'
import { DEFAULT_CATALOG_SOURCES } from '../catalog/defaults.ts'
import { ArtifactCache } from '../delivery/cache.ts'
import { createPlanBundle } from '../core/planner.ts'
import type { CollectionExecutionContext, PackExecutionContext, PlanBundle, PlanCatalogContext } from '../core/ports.ts'
import { InstallTaskManager } from '../core/task-manager.ts'
import { buildMaintenanceSnapshot } from '../core/maintenance-state.ts'
import type { PackageDependencyEdge } from '../core/sync-state.ts'
import { compareInstalledUpdates, type UpdateCheckResult } from '../core/update-check.ts'
import {
  AtomicProfileLocks,
  NodePersistenceFiles,
} from '../adapters/dsh/persistence-adapter.ts'
import { OfficialHostPort, mapOfficialChange } from '../adapters/dsh/host-port.ts'
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
  readonly hostId?: string
}

export interface RuntimeOptions {
  readonly catalogSources?: readonly CatalogSourceIdentity[]
  /** Adapter 读取其随包 data/index.json 后提供原始字节；core 不猜资源路径。 */
  readonly embeddedCatalogBytes?: Uint8Array
  /** 兼容合成测试的对象注入；生产 adapter 应使用 embeddedCatalogBytes。 */
  readonly embeddedCatalog?: unknown
  readonly marketVersion?: string
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
    return { status: 'failed', changed: outcome.changed, error: outcome.error, errorCode: outcome.errorCode, diagnostic: outcome.diagnostic, permissionChanges: outcome.permissionChanges }
  }
  if (outcome.kind === 'unknown') return { status: 'unknown', changed: false, error: outcome.error, errorCode: outcome.errorCode, diagnostic: outcome.diagnostic, permissionChanges: outcome.permissionChanges }
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
  private recoveryError: unknown
  private readonly sources: CatalogSourceRegistry
  private readonly files: NodePersistenceFiles
  private readonly taskStore: JsonTaskStore
  private readonly aiProposals: AiProposalStore
  private readonly context: Context
  private readonly marketVersion: string
  /** Core-owned intent; adapters must not infer this from inventory provenance. */
  private readonly explicitPackages = new Set<string>()
  private readonly dependencyEdges = new Map<string, PackageDependencyEdge>()

  constructor(ctx: Context, readonly identity: RuntimeIdentity, dataDirectory: string, options: RuntimeOptions = {}) {
    if (options.embeddedCatalogBytes !== undefined && !(options.embeddedCatalogBytes instanceof Uint8Array)) {
      throw new Error('embeddedCatalogBytes 必须是 Uint8Array')
    }
    // 在接触宿主或启动恢复前验证资源输入。原始字节优先，不能由测试对象
    // 覆盖生产摘要；拷贝防止调用方随后改动目录字节。
    const embeddedRaw = options.embeddedCatalogBytes === undefined ? undefined : new Uint8Array(options.embeddedCatalogBytes)
    if (embeddedRaw === undefined && options.embeddedCatalog === undefined) {
      throw new Error('缺少随包目录 embeddedCatalogBytes；DSH adapter 必须提供 data/index.json 原始字节')
    }
    const embeddedCatalog = embeddedRaw === undefined ? options.embeddedCatalog : JSON.parse(Buffer.from(embeddedRaw).toString('utf8')) as unknown
    this.context = ctx
    this.marketVersion = options.marketVersion ?? 'development'
    this.host = new OfficialHostPort(ctx, identity.environmentId, { hostVersion: identity.hostVersion, profileName: identity.profileName })
    this.files = new NodePersistenceFiles(join(dataDirectory, 'state'))
    const locks = new AtomicProfileLocks(dataDirectory)
    this.aiProposals = new AiProposalStore(this.files, locks, identity.environmentId)
    this.catalog = new CatalogRepository(embeddedCatalog, join(dataDirectory, 'catalog'), {
      host: {
        // This is the market adapter's explicit host identity, not an invented
        // field purported to have been provided by an official DSH API.
        id: identity.hostId ?? `@deepseek-ai/dsh-app-boot#${identity.profileName}`,
        dshVersion: identity.hostVersion,
        runtime: `node${process.versions.node.split('.')[0]}`,
      },
    }, embeddedRaw)
    this.sources = new CatalogSourceRegistry(options.catalogSources ?? DEFAULT_CATALOG_SOURCES)
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
      coordinationFiles: this.files,
      validateWrite: async (bundle, pluginId) => {
        const item = bundle.plan.items.find(candidate => candidate.pluginId === pluginId)
        if (!item) throw new Error('当前步骤不在已确认方案中')
        this.catalog.assertReleaseActive(item.pluginId, item.targetVersion, item.targetDigest)
        const current = this.catalog.load().snapshot.plugins.find(plugin => plugin.id === item.pluginId && plugin.version === item.targetVersion)
        if (current?.verification === 'hard-incompatible' || current?.installability === 'hard-blocked') throw new Error('制品在执行前已撤回或确认不兼容')
      },
      locks,
      events: new SegmentedEventLog(this.files),
    })
    const authorRoot = join(dataDirectory, 'authoring')
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
      .then(async () => {
        // Rebuild Core-owned intent from durable task records after restart;
        // inventory provenance alone is never treated as Explicit intent.
        const records = await this.taskStore.list(identity.environmentId)
        for (const record of records) {
          for (const item of record.task.items) {
            if (['installed', 'enabled', 'disabled', 'restart-required'].includes(item.status)) this.explicitPackages.add(item.packageName)
          }
          const packageByPlugin = new Map(record.bundle.plan.items.map(item => [item.pluginId, item.packageName]))
          for (const edge of record.bundle.dependencies) {
            const prerequisite = packageByPlugin.get(edge.prerequisiteId)
            const consumer = packageByPlugin.get(edge.consumerId)
            if (prerequisite !== undefined && consumer !== undefined) this.dependencyEdges.set(`${prerequisite}->${consumer}`, { prerequisite, consumer })
          }
        }
      })
      .catch((error: unknown) => {
        this.recoveryError = error
        console.error('[eac-market/host] interrupted task recovery failed', error)
      })
  }

  private async ensureWriteReady(): Promise<void> {
    await this.recovery
    if (this.recoveryError !== undefined) throw new Error('历史任务恢复失败，写入暂停；请先检查市场诊断。')
  }

  private get assistant(): AiAssistant {
    // Optional model services may be mounted after the market. Never freeze
    // their construction-time absence into a permanently disabled feature.
    return new AiAssistant(this.context.get('llm') as ConstructorParameters<typeof AiAssistant>[0],
      this.context.get('agentDefaultModel') as ConstructorParameters<typeof AiAssistant>[1])
  }

  private planPath(planId: string): string {
    return `plans/${planId}.json`
  }

  private async savePlan(bundle: PlanBundle, callerId: string): Promise<void> {
    await this.files.writeAtomic(this.planPath(bundle.plan.planId), new TextEncoder().encode(JSON.stringify({ schemaVersion: 2, callerId, bundle })))
  }

  private async loadPlan(planId: string, callerId: string): Promise<PlanBundle> {
    const bytes = await this.files.read(this.planPath(planId))
    if (bytes === undefined) throw new Error('Host 未保存该安装计划')
    const saved = JSON.parse(Buffer.from(bytes).toString('utf8')) as { schemaVersion?: number; callerId?: string; bundle?: PlanBundle }
    if (saved.schemaVersion !== 2 || saved.callerId !== callerId || saved.bundle === undefined) {
      throw new Error('安装方案已失效或来自其他连接，请重新预检确认')
    }
    return saved.bundle
  }

  async catalogRefresh(request?: CatalogRefreshRequest): Promise<CatalogRefreshView> {
    try {
      const result = await this.catalog.refreshWithSource(this.sources.connection(request ?? {}))
      return {
        status: result.status,
        current: { ...result.current.snapshot, collections: this.catalog.collectionViews() },
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      }
    } catch (error) {
      return { status: 'failed', current: { ...this.catalog.load().snapshot, collections: this.catalog.collectionViews() }, reason: errorText(error) }
    }
  }

  async planCreate(request: PlanCreateRequest, callerId = 'local-operator', preferredSource?: { readonly packageName: string; readonly sourceId: string }): Promise<PlanResult> {
    try {
      await this.ensureWriteReady()
      const snapshot = this.catalog.load().snapshot
      const state = await this.host.readState()
      if (!state.activity.stable || state.activity.unknownSharedImpact || state.inventory.unknownItems.length || state.activeRequests.length) {
        return { status: 'blocked', reason: '当前库存或安装活动无法完整核实，请稍后重新预检', blockers: ['inventory:unverified-state'] }
      }
      const facts = snapshot.plugins.filter(plugin => request.selections.some(selection => selection.pluginId === plugin.id && selection.targetVersion === plugin.version)).map((plugin) => ({
        pluginId: plugin.id,
        packageName: plugin.packageName,
        version: plugin.version,
        artifactDigest: plugin.artifactDigest ?? '',
        verification: plugin.verification,
        requiresRestart: plugin.requiresRestart,
        installable: plugin.installability === 'bundle-installable',
        delivery: (() => {
          const delivery = snapshot.deliveries.find((candidate) => candidate.pluginId === plugin.id && candidate.version === plugin.version && candidate.artifactDigest === plugin.artifactDigest)
          if (!delivery || preferredSource?.packageName !== plugin.packageName) return delivery
          if (!delivery.sources.some(source => sourceIdentity(source) === preferredSource.sourceId)) throw new Error('建议来源已不在登记清单中')
          return { ...delivery, sources: [...delivery.sources].sort((a, b) => Number(sourceIdentity(b) === preferredSource.sourceId) - Number(sourceIdentity(a) === preferredSource.sourceId))
            .map((source, priority) => ({ ...source, priority })) }
        })(),
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
      let pack: PackExecutionContext | CollectionExecutionContext | undefined
      if (request.packId !== undefined && request.collectionId !== undefined) throw new Error('公共套餐与市场组合不能混用同一身份')
      if (request.collectionId !== undefined) {
        if (!request.collectionVersion) throw new Error('组合缺少确切版本')
        pack = this.catalog.collectionForPlan(request.collectionId, request.collectionVersion, request.selections.map(item => item.pluginId))
      }
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
        hostFingerprint: state.hostFingerprint!,
        inventory: state.inventory.items,
        plugins: facts,
        selections: request.selections,
        now: new Date(),
        marketManagedPackageNames,
        localIdentityByPackage,
      }
      const result = await createPlanBundle(context, pack)
      if (result.status === 'ready' && result.bundle !== undefined) {
        await this.savePlan(result.bundle, callerId)
        for (const selection of request.selections) this.explicitPackages.add(selection.packageName)
        const packageByPlugin = new Map(result.bundle.plan.items.map(item => [item.pluginId, item.packageName]))
        for (const edge of result.bundle.dependencies) {
          const prerequisite = packageByPlugin.get(edge.prerequisiteId)
          const consumer = packageByPlugin.get(edge.consumerId)
          if (prerequisite !== undefined && consumer !== undefined) this.dependencyEdges.set(`${prerequisite}->${consumer}`, { prerequisite, consumer })
        }
      }
      if (result.status === 'ready' && result.bundle !== undefined) return { status: 'ready', plan: result.bundle.plan }
      if (result.status === 'stale') return { status: 'stale', reason: result.reason ?? 'stale', details: result.details ?? [] }
      return { status: 'blocked', reason: result.reason ?? 'blocked', blockers: result.blockers ?? [] }
    } catch (error) {
      return { status: 'blocked', reason: errorText(error), blockers: [errorText(error)] }
    }
  }

  async taskStart(request: TaskStartRequest, callerId = 'local-operator'): Promise<TaskState> {
    await this.ensureWriteReady()
    const bundle = await this.loadPlan(request.planId, callerId)
    const baseline = await this.host.readState()
    if (bundle.plan.hostFingerprint !== baseline.hostFingerprint) throw new Error('宿主版本或能力已变化，请重新预检')
    for (const item of bundle.plan.items) {
      this.catalog.assertReleaseActive(item.pluginId, item.targetVersion, item.targetDigest)
      const current = this.catalog.load().snapshot.plugins.find(plugin => plugin.id === item.pluginId && plugin.version === item.targetVersion)
      if (current?.verification === 'hard-incompatible' || current?.installability === 'hard-blocked') throw new Error('该版本已被撤回或确认不兼容，请重新预检')
    }
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
    await this.ensureWriteReady()
    return this.tasks.approveBuilds(request)
  }

  async taskResume(request: TaskResumeRequest): Promise<TaskState> {
    await this.ensureWriteReady()
    return this.tasks.resume(request)
  }

  async taskCancel(request: TaskCancelRequest): Promise<TaskState> {
    await this.recovery
    return this.tasks.cancel(request)
  }

  async pluginSetEnabled(request: PluginActionRequest): Promise<PluginActionResult> {
    try {
      await this.ensureWriteReady()
      const result = await this.tasks.manage({
        environmentId: this.identity.environmentId,
        packageName: request.packageName,
        expectedVersion: request.expectedVersion ?? '',
        action: request.enabled ? 'enable' : 'disable',
        idempotencyKey: request.idempotencyKey,
      }, () => this.host.setEnabled(request.packageName, request.enabled))
      const output = resultFromOutcome(result)
      if (output.status === 'applied' || output.status === 'restart-required') this.explicitPackages.add(request.packageName)
      return output
    } catch (error) {
      return { status: 'failed', changed: false, error: errorText(error), permissionChanges: [] }
    }
  }

  async pluginRemove(request: RemovePluginRequest): Promise<PluginActionResult> {
    try {
      await this.ensureWriteReady()
      if (request.confirmed !== true) throw new Error('卸载操作尚未确认')
      const result = await this.tasks.manage({
        environmentId: this.identity.environmentId,
        packageName: request.packageName,
        expectedVersion: request.expectedVersion ?? '',
        action: 'remove',
        idempotencyKey: request.idempotencyKey,
      }, async () => mapOfficialChange(await this.host.remove(request.packageName)))
      const output = resultFromOutcome(result)
      if (output.status === 'applied' || output.status === 'restart-required') this.explicitPackages.delete(request.packageName)
      return output
    } catch (error) {
      return { status: 'failed', changed: false, error: errorText(error), permissionChanges: [] }
    }
  }

  /**
   * Produces the Core-owned maintenance state consumed by an Adapter. The
   * snapshot deliberately combines host facts with Core intent and dependency
   * edges; it does not ask the Adapter to recalculate either sync dimension.
   */
  readonly maintenanceStatus = async (): Promise<CoreMaintenanceSnapshot> => {
    await this.recovery
    const state = await this.host.readState()
    const tasks = await this.taskStore.list(this.identity.environmentId)
    const taskStates = tasks.map(record => record.task)
    const catalogRevision = this.catalog.load().snapshot.revision
    return buildMaintenanceSnapshot({
      environmentId: this.identity.environmentId,
      inventory: state.inventory,
      revision: `maintenance:${catalogRevision}:${state.sessionRevision}:${taskStates.map(task => `${task.taskId}:${task.updatedAt}`).join('|')}`,
      tasks: taskStates,
      explicitPackages: [...this.explicitPackages],
      selectedPackages: [...this.explicitPackages],
      dependencyEdges: [...this.dependencyEdges.values()],
      unknownPackages: state.inventory.unknownItems,
    })
  }

  /** Read-only inventory/catalog comparison for manual or scheduled checks. */
  readonly checkUpdates = async (): Promise<UpdateCheckResult> => {
    await this.recovery
    const state = await this.host.readState()
    const snapshot = this.catalog.load().snapshot
    return compareInstalledUpdates(state.inventory, snapshot.plugins, snapshot.revision)
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

  authorReadmePreview(request: ReadmeImportRequest): Promise<ReadmePreviewView> {
    return this.readme.previewReadme(request)
  }

  authorReadmeApplyPreview(request: ReadmeApplyPreviewRequest): ReadmeImportResult {
    return this.readme.applyReadmePreview(request)
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
    const overrides = {
      ...(request.repositoryUrl === undefined ? {} : { repositoryUrl: request.repositoryUrl }),
      ...(request.commit === undefined ? {} : { commit: request.commit }),
      ...(request.license === undefined ? {} : { license: request.license }),
      ...(request.licenseNotice === undefined ? {} : { licenseNotice: request.licenseNotice }),
      ...(request.notes === undefined ? {} : { notes: request.notes }),
    }
    // No override means retain the imported package's attribution and license.
    const bytes = this.authoring.export(request.draftId, Object.keys(overrides).length === 0
      ? undefined
      : { ...this.authoring.readProvenance(request.draftId), ...overrides })
    return this.transfers.stageOutbound(this.identity.environmentId, {
      purpose: 'author-export',
      filename: 'presentation.eac-market-presentation.zip',
      mediaType: 'application/zip',
      ...(request.targetId === undefined ? {} : { targetId: request.targetId }),
    }, bytes)
  }

  authorMediaRead(request: AuthorMediaReadRequest): AuthorMediaReadResult {
    const draft = this.authoring.drafts.get(request.draftId)
    if (!draft.mediaIds.includes(request.mediaId)) throw new Error('该图片不属于当前草稿')
    const media = this.authoring.media.get(request.mediaId)
    return { id: media.metadata.id, mediaType: media.metadata.mediaType, data: Buffer.from(media.bytes).toString('base64'), sha256: media.metadata.sha256 }
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value ?? null)).digest('hex')
  }

  private targetState(inventory: InventorySnapshot, packageName: string): InventoryItem | undefined {
    return inventory.items.find(item => item.packageName === packageName)
  }

  private targetRelease(proposal: AiProposal): CatalogPlugin | undefined {
    const action = proposal.actions[0]!
    return this.catalog.load().snapshot.plugins.find(item => item.packageName === action.packageName && item.version === action.targetVersion)
  }

  private targetDelivery(plugin: CatalogPlugin | undefined): CatalogDelivery | undefined {
    if (!plugin) return undefined
    return this.catalog.load().snapshot.deliveries.find(item => item.pluginId === plugin.id && item.version === plugin.version && item.artifactDigest === plugin.artifactDigest)
  }

  private riskyImpact(kind: 'remove' | 'downgrade', current: InventoryItem, target: CatalogPlugin | undefined, inventory: InventorySnapshot): AiActionImpact {
    const roots = new Map<string, string>()
    const profile = this.context.profileContext
    const official = createRequire(import.meta.url)('@deepseek-ai/dsh-app-boot') as {
      resolveBundleDir(bin: string, name: string, anchor: string, profileDir: string): string
    }
    const impact = assessRiskyAction({ kind, packageName: current.packageName, currentVersion: current.version ?? '', target,
      current: this.catalog.load().snapshot.plugins.find(item => item.packageName === current.packageName && item.version === current.version), inventory,
      readManifest: (name, parent): ManagementManifest | undefined => {
        let directory: string
        if (parent && roots.has(parent)) {
          try { directory = dirname(createRequire(join(roots.get(parent)!, 'package.json')).resolve(`${name}/package.json`)) }
          catch {
            // Hidden package.json exports do not authorize resolving a different
            // root copy. Walk the *same nested resolution's* entry ancestry.
            let cursor = dirname(createRequire(join(roots.get(parent)!, 'package.json')).resolve(name))
            let found: string | undefined
            for (let depth = 0; depth < 20; depth += 1) {
              try {
                const candidate = JSON.parse(readFileSync(join(cursor, 'package.json'), 'utf8')) as { name?: string }
                if (candidate.name === name) { found = cursor; break }
              } catch { /* Continue only within this resolved entry's ancestry. */ }
              const next = dirname(cursor)
              if (next === cursor) break
              cursor = next
            }
            if (!found) return undefined
            directory = found
          }
        } else directory = official.resolveBundleDir('dsh', name, profile.installAnchor, profile.dir)
        const value = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as ManagementManifest
        if (value.name !== name || typeof value.version !== 'string') return undefined
        roots.set(directory, directory)
        return { ...value, resolutionKey: directory }
      },
    })
    const currentRelease = this.catalog.load().snapshot.plugins.find(item => item.packageName === current.packageName && item.version === current.version)
    return current.source === 'market-cache-file' && current.artifactDigest !== undefined
      && current.artifactDigest === currentRelease?.artifactDigest ? impact
      : { ...impact, unknowns: [...impact.unknowns, '当前安装回执摘要与目录审查制品不一致或不可核实'] }
  }

  async aiAnalyze(request: AiAnalyzeRequest, callerId = 'local-operator', signal?: AbortSignal): Promise<AiAnalysisResult> {
    try {
      await this.ensureWriteReady()
      if (!request.taskId && !request.packageName) return { status: 'blocked', reason: '请先选择需要帮助的任务或插件' }
      const selectedTask = request.taskId ? await this.tasks.get(request.taskId) : undefined
      if (request.taskId && (!selectedTask || selectedTask.environmentId !== this.identity.environmentId)) return { status: 'blocked', reason: '所选任务不属于当前环境' }
      const before = await this.host.readState()
      const diagnostics = await this.diagnosticsExport(request)
      const analysis = await this.assistant.analyze(request, diagnostics, signal)
      signal?.throwIfAborted()
      if (analysis.status !== 'ready' || !analysis.proposal) return analysis
      const action = analysis.proposal.actions[0]!
      const allowed = new Set(request.packageName ? [request.packageName] : selectedTask?.items.map(item => item.packageName))
      if (!allowed.has(action.packageName) || isProtectedMarketPackage(action.packageName)) return { status: 'blocked', reason: '建议不属于本次所选目标，或目标是市场自身' }
      const state = await this.host.readState()
      if (!state.activity.stable || state.activity.unknownSharedImpact || state.inventory.unknownItems.length || state.activeRequests.length) return { status: 'blocked', reason: '当前安装状态尚未核实，暂不能生成可执行建议' }
      const current = this.targetState(state.inventory, action.packageName)
      if (this.fingerprint(current) !== this.fingerprint(this.targetState(before.inventory, action.packageName))) return { status: 'blocked', reason: '分析期间插件状态变化，请重新分析' }
      if (current?.readOnlyReason) return { status: 'blocked', reason: '该项目应通过官方管理入口处理' }
      let proposal: AiProposal = { ...analysis.proposal, environmentId: this.identity.environmentId,
        ...(request.taskId ? { taskId: request.taskId } : {}), diagnosticDigest: diagnosticDigest(diagnostics) }
      const installAction = ['install', 'update', 'retry-source', 'downgrade'].includes(action.kind)
      let target: CatalogPlugin | undefined
      if (installAction) {
        if (!action.targetVersion) return { status: 'blocked', reason: '安装建议缺少确切版本' }
        target = this.targetRelease(proposal)
        if (!target?.artifactDigest) return { status: 'blocked', reason: '建议版本没有登记的可校验制品' }
        if (action.kind === 'install' && current?.installed) return { status: 'blocked', reason: '目标已安装，请使用明确的更新建议' }
        if ((action.kind === 'update' || action.kind === 'downgrade') && !current?.installed) return { status: 'blocked', reason: '目标未安装，不能按更新或降级执行' }
        if (action.kind === 'retry-source' && !action.sourceId) return { status: 'blocked', reason: '换源建议缺少登记的来源编号' }
        if (action.kind === 'retry-source') {
          const original = request.taskId ? await this.taskStore.get(request.taskId) : undefined
          const originalItem = original?.bundle.plan.items.find(item => item.packageName === action.packageName)
          if (!original || !['failed', 'cancelled', 'partial'].includes(original.task.status)
            || originalItem?.targetVersion !== target.version || originalItem.targetDigest !== target.artifactDigest) {
            return { status: 'blocked', reason: '换源重试必须绑定原已核定任务的同版本、同摘要制品' }
          }
        }
        const created = await this.planCreate({ selections: [{ pluginId: target.id, packageName: target.packageName,
          targetVersion: target.version, targetDigest: target.artifactDigest,
          enabledIntent: current?.installed ? current.bundleEnabled : target.enabledPolicy === 'default-on' && !target.requiresSetup && !target.largeExternalResource,
          tryUnverified: false }] }, callerId,
          action.kind === 'retry-source' ? { packageName: target.packageName, sourceId: action.sourceId! } : undefined)
        if (created.status !== 'ready' || created.plan.items.some(item => item.action === 'blocked')) return { status: 'blocked', reason: created.status === 'ready' ? '该制品需要手动试装确认或存在阻断条件，请查看普通安装方案' : created.reason }
        const actualAction = created.plan.items[0]?.action
        if (actualAction === 'downgrade' && action.kind !== 'downgrade') return { status: 'blocked', reason: '建议实际会降级，必须另建降级影响方案' }
        if (action.kind === 'update' && actualAction !== 'upgrade' || action.kind === 'downgrade' && actualAction !== 'downgrade') return { status: 'blocked', reason: '模型动作与实际版本调整方向不一致' }
        proposal = { ...proposal, plan: created.plan }
      } else if (!current?.version || !current.installed) return { status: 'blocked', reason: '无法核实当前已安装版本' }
      let impact: AiActionImpact = { summary: action.reason, currentVersion: current?.version,
        ...(target ? { targetVersion: target.version } : {}), affectedPackages: [action.packageName],
        dataBehavior: '只执行已显示的官方插件操作；保留已有启停选择。', unknowns: [] }
      if (action.kind === 'remove' || action.kind === 'downgrade') {
        if (!current?.installed || !current.version || action.kind === 'remove' && !current.removable) return { status: 'blocked', reason: '无法确认目标允许此管理操作' }
        impact = this.riskyImpact(action.kind, current, target, state.inventory)
      }
      proposal = { ...proposal, impact }
      proposal = { ...proposal, impactDigest: this.assistant.impactDigest(proposal) }
      signal?.throwIfAborted()
      await this.aiProposals.put({ schemaVersion: 1, callerId, proposal, stage: 'proposed',
        inventoryDigest: this.fingerprint(current), deliveryDigest: this.fingerprint(this.targetDelivery(target)) })
      if (signal?.aborted) {
        await this.aiProposals.invalidateAnalysis(proposal.id)
        signal.throwIfAborted()
      }
      return { status: 'ready', proposal }
    } catch (error) {
      return { status: 'failed', reason: sanitizeDiagnostic(errorText(error)) }
    }
  }

  async aiConfirm(request: AiConfirmRequest, callerId = 'local-operator'): Promise<AiApplyResult> {
    let dispatched = false
    let knownResult: AiApplyResult | undefined
    try {
      await this.ensureWriteReady()
      return await this.aiProposals.exclusive(request.proposalId, async () => {
        let saved = await this.aiProposals.get(request.proposalId)
        if (!saved || saved.callerId !== callerId || request.confirmed !== true) return { status: 'blocked', changed: false, error: '提案不存在或不属于当前连接' }
        const proposal = saved.proposal
        if (request.impactDigest !== proposal.impactDigest || request.impactDigest !== this.assistant.impactDigest(proposal)) return { status: 'blocked', changed: false, error: '确认内容与后台保存的提案不一致' }
        if (saved.stage === 'settled' && saved.result) return saved.result
        if (saved.stage === 'dispatched') return { status: 'unknown', changed: false, error: '该建议已发起但回执未核定；请检查原任务，不会重复执行' }
        if (Date.parse(proposal.expiresAt) <= Date.now()) return { status: 'blocked', changed: false, error: '提案已过期，请重新分析' }
        const action = proposal.actions[0]!
        if (proposal.actions.length !== 1 || isProtectedMarketPackage(action.packageName)) return { status: 'blocked', changed: false, error: '动作清单无效' }
        const state = await this.host.readState()
        const current = this.targetState(state.inventory, action.packageName)
        if (!state.activity.stable || state.activity.unknownSharedImpact || state.inventory.unknownItems.length || state.activeRequests.length
          || this.fingerprint(current) !== saved.inventoryDigest
          || this.fingerprint(this.targetDelivery(this.targetRelease(proposal))) !== saved.deliveryDigest) return { status: 'blocked', changed: false, error: '确认前环境、版本、启停或来源已变化，请重新分析' }
        if (action.requiresSecondConfirmation) {
          const impact = this.riskyImpact(action.kind as 'remove' | 'downgrade', current!, this.targetRelease(proposal), state.inventory)
          if (impact.unknowns.length) return { status: 'blocked', changed: false, error: impact.unknowns.join('；') }
          if (this.fingerprint(impact) !== this.fingerprint(proposal.impact)) return { status: 'blocked', changed: false, error: '危险操作影响发生变化，请重新确认新方案' }
          if (!saved.challenge) {
            const challenge = { id: randomUUID(), digest: this.fingerprint({ proposalId: proposal.id, impact }), expiresAt: proposal.expiresAt, impact }
            saved = { ...saved, stage: 'challenge', challenge }
            await this.aiProposals.put(saved)
            return { status: 'requires-confirmation', changed: false, challenge }
          }
          if (request.riskConfirmed !== true || request.challengeId !== saved.challenge.id || request.challengeDigest !== saved.challenge.digest
            || Date.parse(saved.challenge.expiresAt) <= Date.now()) return { status: 'requires-confirmation', changed: false, challenge: saved.challenge }
        }
        const executionKey = `ai-${proposal.id}`
        await this.aiProposals.put({ ...saved, stage: 'dispatched', executionKey })
        dispatched = true
        const result = await this.executeAiProposal(proposal, executionKey, callerId)
        knownResult = result
        await this.aiProposals.put({ ...saved, stage: 'settled', executionKey, result })
        return result
      })
    } catch (error) {
      return { status: dispatched ? 'unknown' : 'blocked', changed: knownResult?.changed ?? false,
        ...(knownResult?.taskId ? { taskId: knownResult.taskId } : {}),
        error: dispatched ? '操作已发起，但最终记录未完整保存，请核对原任务；不会重复执行。' : sanitizeDiagnostic(errorText(error)) }
    }
  }

  private async executeAiProposal(proposal: AiProposal, idempotencyKey: string, callerId: string): Promise<AiApplyResult> {
    const action = proposal.actions[0]!
    if (action.kind === 'enable' || action.kind === 'disable') return this.pluginSetEnabled({ packageName: action.packageName,
      expectedVersion: proposal.impact!.currentVersion!, enabled: action.kind === 'enable', idempotencyKey })
    if (action.kind === 'remove') return this.pluginRemove({ packageName: action.packageName,
      expectedVersion: proposal.impact!.currentVersion!, confirmed: true, idempotencyKey })
    if (!proposal.plan) return { status: 'blocked', changed: false, error: '没有已展示并保存的安装方案' }
    const task = await this.taskStart({ planId: proposal.plan.planId, planDigest: proposal.plan.planDigest,
      confirmed: true, idempotencyKey, ...(proposal.taskId ? { retryOfTaskId: proposal.taskId } : {}) }, callerId)
    return { status: task.status === 'completed' ? 'applied' : task.status === 'failed' ? 'failed' : 'queued',
      changed: task.items.some(item => item.changed), taskId: task.taskId }
  }

  async diagnosticsExport(selection?: AiAnalyzeRequest): Promise<DiagnosticExport> {
    await this.recovery
    const errors: string[] = []
    if (this.recoveryError) errors.push(errorText(this.recoveryError))
    let tasks: readonly TaskState[] = []
    let inventory: InventorySnapshot | undefined
    try { tasks = (await this.taskStore.list(this.identity.environmentId)).map(record => record.task) } catch (error) { errors.push(errorText(error)) }
    try { inventory = (await this.host.readState()).inventory } catch (error) { errors.push(errorText(error)) }
    return collectDiagnostics({ environmentId: this.identity.environmentId, hostVersion: this.identity.hostVersion,
      marketVersion: this.marketVersion, selection, tasks, inventory, catalog: this.catalog.load().snapshot, errors })
  }
}
