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
  CatalogSourceView,
  CoreMaintenanceSnapshot,
  MarketCatalogSource,
  UpdatePolicySnapshot,
  UpdatePolicySaveRequest,
  DiagnosticExport,
  InstallLogEntry,
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
  HostCoreSnapshot,
  ReleaseOptionsRequest,
  ReleaseOptionsResult,
  TaskStartRecoveryRequest,
  TaskStartRecoveryResult,
  PluginActionRecoveryRequest,
  PluginActionRecoveryResult,
} from '../contracts/types.ts'
import { AiAssistant } from "./ai-assist.ts"
import { AiProposalStore } from './ai-proposal-store.ts'
import { collectDiagnostics, diagnosticDigest, sanitizeDiagnostic, sourceIdentity } from './diagnostics.ts'
import { InstallLog } from './install-log.ts'
import { assessRiskyAction, type ManagementManifest } from './management-impact.ts'
import { canonicalJson } from '../core/canonical.ts'
import { validVersion } from '../core/semver.ts'
import { evaluateHostCompatibility } from '../core/host-compatibility.ts'
import { MarketCoreError } from '../core/errors.ts'
import { buildReleaseOptions, parseReleaseOptionsRequest, type ReleaseOptionsSource } from './release-options.ts'
import { assertReleaseSelectionContext, releaseSelectionContext } from './release-context.ts'
import { assertManagementRecoveryRequest, assertTaskRecoveryRequest, decodeManagementRecord } from './operation-recovery.ts'
import { managementResultFromOutcome as resultFromOutcome } from '../core/management-record.ts'
import { isProtectedMarketPackage } from '../core/identity.ts'
import { CatalogRepository } from '../catalog/store.ts'
import { mergeCatalogSnapshots } from '../catalog/merge.ts'
import { CatalogSourceRegistry, type CatalogSourceIdentity } from '../catalog/source.ts'
import { DEFAULT_CATALOG_SOURCES } from '../catalog/defaults.ts'
import { ArtifactCache } from '../delivery/cache.ts'
import { createPlanBundle, verifyPlanBundle } from '../core/planner.ts'
import type { CollectionExecutionContext, PackExecutionContext, PlanBundle, PlanCatalogContext } from '../core/ports.ts'
import { InstallTaskManager } from '../core/task-manager.ts'
import { executionOf } from '../core/execution-state.ts'
import { buildMaintenanceSnapshot } from '../core/maintenance-state.ts'
import { MaintenanceIntentStore } from '../core/maintenance-intent-store.ts'
import { compareInstalledUpdates } from '../core/update-check.ts'
import { UpdateCheckScheduler } from '../core/update-check-scheduler.ts'
import { UpdatePolicyStore } from '../core/update-policy-store.ts'
import { readAgentForgeSource, projectAgentForgeCatalog, type AgentForgeSourceOptions, type AgentForgeVerifiedArtifact } from '../catalog/agent-forge.ts'
import { encodeJson } from '../persistence/files.ts'
import {
  AtomicProfileLocks,
  NodePersistenceFiles,
} from '../adapters/dsh/persistence-adapter.ts'
import { OfficialHostPort, mapOfficialChange } from '../adapters/dsh/host-port.ts'
import { CatalogArtifactPort } from '../adapters/dsh/artifact-adapter.ts'
import { materializeOfflineArtifacts } from '../delivery/offline-pack.ts'
import { verifyTgzFile } from '../delivery/tgz.ts'
import type { RemoteSecurityOptions } from '../delivery/security.ts'
type RuntimeNetworkOptions = Pick<RemoteSecurityOptions, 'proxy' | 'dispatcherForProxy' | 'headersTimeoutMs' | 'bodyIdleTimeoutMs' | 'timeoutMs' | 'maxRedirects' | 'lookup'> & { readonly fetch?: typeof fetch }
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
  readonly readHostCore?: () => HostCoreSnapshot
  readonly catalogSources?: readonly CatalogSourceIdentity[]
  /** Host-maintained Agent Forge sources; source URLs are never accepted from Remote input. */
  readonly agentForgeSources?: readonly MarketCatalogSource[]
  /** Host-only transport, trust and authorized local import roots. */
  readonly agentForgeSourceOptions?: AgentForgeSourceOptions
  /** Host-only network transport settings; never accepted from Client or catalog data. */
  readonly network?: RuntimeNetworkOptions
  /** Adapter 读取其随包 data/index.json 后提供原始字节；core 不猜资源路径。 */
  readonly embeddedCatalogBytes?: Uint8Array
  /** 兼容合成测试的对象注入；生产 adapter 应使用 embeddedCatalogBytes。 */
  readonly embeddedCatalog?: unknown
  readonly marketVersion?: string
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function publicManagementResult(result: PluginActionResult): PluginActionResult {
  return { ...structuredClone(result),
    ...(result.error === undefined ? {} : { error: sanitizeDiagnostic(result.error) }),
    ...(result.diagnostic === undefined ? {} : { diagnostic: sanitizeDiagnostic(result.diagnostic) }),
  }
}

export class MarketRuntime {
  readonly host: OfficialHostPort
  readonly installLog: InstallLog
  readonly catalog: CatalogRepository
  readonly artifacts: CatalogArtifactPort
  readonly tasks: InstallTaskManager
  readonly authoring: AuthorPackageService
  readonly readme: ReadmeImporter
  readonly transfers: TransferManager
  private recovery: Promise<void>
  private recoveryError: unknown
  private readonly sources: CatalogSourceRegistry
  private readonly agentForgeSources = new Map<string, MarketCatalogSource>()
  private readonly agentForgeCatalogs = new Map<string, CatalogRepository>()
  private readonly agentForgeStatus = new Map<string, CatalogSourceView['status']>()
  private readonly updatePolicy: UpdatePolicyStore
  private readonly updateCheckScheduler: UpdateCheckScheduler
  private readonly agentForgeSourceOptions: AgentForgeSourceOptions
  private readonly files: NodePersistenceFiles
  private readonly taskStore: JsonTaskStore
  private readonly aiProposals: AiProposalStore
  private readonly context: Context
  private readonly marketVersion: string
  private readonly artifactCacheDir: string
  private readonly network: RuntimeNetworkOptions | undefined
  private readonly readHostCore: (() => HostCoreSnapshot) | undefined
  private readonly maintenanceIntents: MaintenanceIntentStore

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
    this.readHostCore = options.readHostCore
    this.agentForgeSourceOptions = options.agentForgeSourceOptions ?? {}
    this.marketVersion = options.marketVersion ?? 'development'
    this.artifactCacheDir = join(dataDirectory, 'artifacts')
    this.network = options.network
    this.installLog = new InstallLog(join(dataDirectory, 'logs'), identity.hostVersion)
    this.host = new OfficialHostPort(ctx, identity.environmentId, { hostVersion: identity.hostVersion, profileName: identity.profileName },
      options.readHostCore === undefined ? undefined : () => this.hostCore().hostRevision, this.installLog)
    this.files = new NodePersistenceFiles(join(dataDirectory, 'state'))
    const locks = new AtomicProfileLocks(dataDirectory)
    this.maintenanceIntents = new MaintenanceIntentStore(this.files, locks)
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
    this.sources = new CatalogSourceRegistry(options.catalogSources ?? DEFAULT_CATALOG_SOURCES, options.network === undefined ? {} : { security: options.network })
    for (const source of options.agentForgeSources ?? []) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(source.id)) throw new Error('Agent Forge source ID 必须是安全的单路径段')
      if (this.sources.list().some(item => item.id === source.id) || this.agentForgeSources.has(source.id)) throw new Error(`重复目录来源 ID: ${source.id}`)
      if (!source.enabled) { this.agentForgeSources.set(source.id, source); this.agentForgeStatus.set(source.id, 'not-checked'); continue }
      if (source.location.mode === 'https') {
        const url = new URL(source.location.value)
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(`Agent Forge source ${source.id} must use credential-free HTTPS`)
      } else {
        const roots = options.agentForgeSourceOptions?.localRoots ?? []
        if (roots.length === 0) throw new Error(`Agent Forge local source ${source.id} has no Host-authorized import root`)
      }
      this.agentForgeSources.set(source.id, structuredClone(source))
      this.agentForgeStatus.set(source.id, 'not-checked')
      const emptyCatalog = {
        schemaVersion: '1', revision: `agent-forge-unloaded-${source.id}`.slice(0, 200),
        generatedAt: new Date(0).toISOString(), plugins: [], listings: [], packs: [], presentations: [], deliveries: [],
      }
      this.agentForgeCatalogs.set(source.id, new CatalogRepository(emptyCatalog, join(dataDirectory, 'catalog-sources', source.id)))
    }
    this.updatePolicy = new UpdatePolicyStore(this.files, locks)
    this.updateCheckScheduler = new UpdateCheckScheduler({
      files: this.files,
      locks,
      getPolicy: () => this.updatePolicy.get(),
      checkUpdates: request => this.checkUpdates(request),
      onError: error => console.error('[eac-market/host] automatic update check failed', error),
    })
    const testLocalSources = (process.env.EAC_MARKET_TEST_ALLOW_LOCAL_SOURCES ?? '')
      .split(';').map((value) => value.trim()).filter((value) => value.length > 0)
    const cache = new ArtifactCache({
      cacheDir: this.artifactCacheDir,
      ...(testLocalSources.length === 0 ? {} : { allowLocalFileSources: testLocalSources }),
      ...(options.network === undefined ? {} : options.network),
    })
    this.artifacts = new CatalogArtifactPort(cache, () => this.catalogView().deliveries, testLocalSources)
    this.taskStore = new JsonTaskStore(this.files, locks, `market-${identity.environmentId}`)
    this.tasks = new InstallTaskManager({
      host: this.host,
      artifacts: this.artifacts,
      store: this.taskStore,
      coordinationFiles: this.files,
      validateStart: async bundle => {
        const state = await this.host.readState()
        if (bundle.plan.hostFingerprint !== state.hostFingerprint) throw new MarketCoreError('plan/stale-host', '宿主核心版本或能力已变化，请重新预检确认')
        this.assertPlanReleaseContext(bundle, state.inventory)
        for (const step of bundle.steps) {
          const item = bundle.plan.items.find(candidate => candidate.pluginId === step.pluginId)
          if (!item) throw new Error('当前步骤不在已确认方案中')
          this.assertSelectedReleaseActive(item)
        }
      },
      validateWrite: async (bundle, pluginId, state) => {
        const record = await this.taskStore.getByPlan(bundle.plan.environmentId, bundle.plan.planId)
        const dispatched = record !== undefined && Object.values(executionOf(record)?.attempts ?? {}).some(attempt => attempt.stage !== 'prepared')
        const currentState = state ?? (dispatched ? undefined : await this.host.readState())
        this.assertPlanReleaseContext(bundle, dispatched ? undefined : currentState?.inventory)
        const item = bundle.plan.items.find(candidate => candidate.pluginId === pluginId)
        if (!item) throw new Error('当前步骤不在已确认方案中')
        this.assertSelectedReleaseActive(item)
      },
      locks,
      events: new SegmentedEventLog(this.files),
      installLog: this.installLog,
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
        // Restore only checksum-protected Core-owned intent. Historical success
        // is evidence of the past, not a user's explicit selection.
        await this.maintenanceIntents.load()
      })
      .catch((error: unknown) => {
        this.recoveryError = error
        console.error('[eac-market/host] interrupted task recovery failed', error)
      })

    // Cordis binds effects to the owning plugin Fiber and awaits the disposer
    // during Fiber disposal. Minimal non-Cordis unit-test contexts do not own
    // lifecycle effects, so they must not start an orphan background timer.
    if (typeof this.context.effect === 'function') {
      this.context.effect(async () => {
        await this.updateCheckScheduler.start()
        return () => this.updateCheckScheduler.stop()
      }, 'eac-market:auto-update-check')
    }
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

  catalogView(): import('../contracts/types.ts').CatalogSnapshot {
    return this.readCatalogContext().catalog
  }

  private readCatalogContext(): { readonly catalog: import('../contracts/types.ts').CatalogSnapshot; readonly sources: readonly ReleaseOptionsSource[] } {
    const base = this.catalog.sourceSnapshot()
    const extras = [...this.agentForgeCatalogs.entries()].map(([sourceId, repository]) => ({ sourceId: `agent-forge:${sourceId}`, ...repository.sourceSnapshot() }))
    const sources = [{ sourceId: 'market-index:primary', ...base }, ...extras]
    if (extras.length === 0) return { catalog: base.snapshot, sources }
    const merged = mergeCatalogSnapshots({ sourceId: 'market-index:primary', snapshot: base.snapshot }, extras)
    return { catalog: { ...merged.snapshot, sourceRevisions: merged.sourceRevisions, mergeIssues: merged.issues }, sources }
  }

  hostCore(): HostCoreSnapshot {
    const unavailable: HostCoreSnapshot = {
      agentId: null, agentName: '未知 Agent', version: null, status: 'unknown', source: 'unavailable',
      hostRevision: createHash('sha256').update(canonicalJson({ environmentId: this.identity.environmentId, status: 'unknown' })).digest('hex'),
      reason: 'host-core-binding-unavailable',
    }
    try {
      const snapshot = this.readHostCore?.()
      if (snapshot === undefined || snapshot.agentId === null || typeof snapshot.agentId !== 'string' || snapshot.agentId.length > 200
        || !snapshot.agentId.trim() || typeof snapshot.agentName !== 'string' || !snapshot.agentName.trim() || snapshot.agentName.length > 200
        || typeof snapshot.hostRevision !== 'string' || !/^(?:sha256:)?[a-f0-9]{64}$/u.test(snapshot.hostRevision)
        || typeof snapshot.source !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(snapshot.source)) return unavailable
      if (snapshot.status === 'known' && (typeof snapshot.version !== 'string' || !validVersion(snapshot.version))) return unavailable
      if (snapshot.status !== 'known' && snapshot.status !== 'unknown') return unavailable
      return { agentId: snapshot.agentId, agentName: snapshot.agentName, version: snapshot.status === 'known' ? snapshot.version : null,
        status: snapshot.status, hostRevision: snapshot.hostRevision, source: snapshot.source,
        ...(snapshot.versionScheme === undefined ? {} : { versionScheme: snapshot.versionScheme }),
        ...(snapshot.status === 'unknown' ? { reason: 'host-core-version-unavailable' } : {}),
      }
    } catch { return unavailable }
  }

  async releaseOptions(request: ReleaseOptionsRequest): Promise<ReleaseOptionsResult> {
    parseReleaseOptionsRequest(request)
    const captured = this.readCatalogContext()
    const catalog = captured.catalog
    const hostCore = this.hostCore()
    let inventory: InventorySnapshot
    try { inventory = (await this.host.readState()).inventory }
    catch { inventory = { environmentId: this.identity.environmentId, revision: 'inventory-unavailable', items: [], unknownItems: ['listBundles:unavailable'] } }
    const current = this.hostCore()
    if (current.hostRevision !== hostCore.hostRevision || this.fingerprint(this.readCatalogContext()) !== this.fingerprint(captured)) {
      throw new MarketCoreError('release-options/stale-context', '宿主核心或目录在读取期间发生变化，请重新读取版本列表')
    }
    return buildReleaseOptions(request, {
      environmentId: this.identity.environmentId, hostCore, catalog, inventory,
      sources: captured.sources,
    })
  }

  private assertSelectedReleaseActive(item: import('../contracts/types.ts').InstallPlanItem): void {
    this.catalog.assertReleaseActive(item.pluginId, item.targetVersion, item.targetDigest)
    const current = this.catalogView().plugins.find(plugin => plugin.id === item.pluginId && plugin.packageName === item.packageName
      && plugin.version === item.targetVersion && plugin.artifactDigest === item.targetDigest)
    if (current === undefined || current.publication === 'withdrawn' || current.installability !== 'bundle-installable') throw new Error('所选发行已缺失、发生冲突、被撤回或无法安装，请重新预检')
    if (item.releaseContext !== undefined) {
      const captured = this.readCatalogContext()
      const expected = releaseSelectionContext(current, { environmentId: this.identity.environmentId, hostCore: this.hostCore(),
        catalogRevision: captured.catalog.revision, catalogStale: captured.catalog.stale,
        inventory: { environmentId: this.identity.environmentId, revision: item.releaseContext.context.inventoryRevision, items: [], unknownItems: [] }, sources: captured.sources })
      assertReleaseSelectionContext(item.releaseContext, expected)
    }
    const compatibility = evaluateHostCompatibility(this.hostCore(), current.hostRequirements)
    if (compatibility.status === 'incompatible' || compatibility.status === 'conflict') {
      throw new MarketCoreError(compatibility.reason ?? 'core-range-mismatch', '所选发行不适配当前宿主核心，请重新预检')
    }
    for (const repository of this.agentForgeCatalogs.values()) {
      if (repository.load().snapshot.plugins.some(plugin => plugin.id === item.pluginId && plugin.version === item.targetVersion && plugin.artifactDigest === item.targetDigest)) {
        repository.assertReleaseActive(item.pluginId, item.targetVersion, item.targetDigest)
      }
    }
  }
  private assertPlanReleaseContext(bundle: PlanBundle, inventory?: InventorySnapshot): void {
    const frozen = bundle.releaseValidation
    if (frozen === undefined) return
    if (frozen.hostBinding !== this.fingerprint(this.hostCore())) throw new MarketCoreError('plan/stale-host', '宿主核心事实已变化，请重新预检确认')
    if (frozen.catalogBinding !== this.fingerprint(this.readCatalogContext())) throw new MarketCoreError('release-context/stale', '目录、发行 metadata 或可信来源已变化，请重新预检确认')
    if (inventory !== undefined && (inventory.revision !== frozen.inventoryRevision || this.fingerprint(inventory) !== frozen.inventoryBinding)) throw new MarketCoreError('plan/stale-inventory', '库存事实已变化，请重新预检确认')
  }
  capabilities(): readonly import('../contracts/types.ts').CapabilityName[] {
    const result = new Set(this.host.capabilities())
    result.add('catalog-source-list')
    result.add('core-maintenance')
    result.add('update-check')
    result.add('update-policy')
    result.add('host-release-options')
    result.add('host-release-context')
    result.add('operation-recovery')
    if (this.agentForgeSources.size > 0) result.add('agent-forge-refresh')
    return [...result]
  }

  async catalogSources(): Promise<readonly CatalogSourceView[]> {
    const base = this.catalog.load()
    const marketSources = this.sources.list().map(source => ({
      id: source.id, kind: 'market-index' as const, mode: 'https' as const, enabled: true, priority: 0,
      refreshPolicy: 'manual' as const, status: base.snapshot.stale ? 'stale' as const : base.cacheUsable ? 'ready' as const : 'not-checked' as const,
      revision: base.snapshot.revision, ...(base.reason === undefined ? {} : { reason: base.reason }),
    }))
    const agentSources = [...this.agentForgeSources.values()].map(source => {
      const snapshot = this.agentForgeCatalogs.get(source.id)?.load()
      const status = snapshot?.snapshot.stale
        ? 'stale' as const
        : snapshot?.cacheUsable
          ? 'ready' as const
          : this.agentForgeStatus.get(source.id) ?? 'not-checked'
      this.agentForgeStatus.set(source.id, status)
      return {
        id: source.id, kind: 'agent-forge' as const, mode: source.location.mode, enabled: source.enabled,
        priority: source.priority, refreshPolicy: source.refreshPolicy,
        status,
        ...(snapshot?.cacheUsable ? { revision: snapshot.snapshot.revision } : {}),
        ...(snapshot?.reason === undefined ? {} : { reason: snapshot.reason }),
      }
    })
    return [...marketSources, ...agentSources].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  }

  async agentForgeRefresh(request: { readonly sourceId: string }): Promise<CatalogRefreshView> {
    const source = this.agentForgeSources.get(request?.sourceId)
    if (!source || !source.enabled) return { status: 'failed', current: this.catalogView(), reason: 'Agent Forge source is not registered or is disabled' }
    const repository = this.agentForgeCatalogs.get(source.id)
    if (!repository) return { status: 'failed', current: this.catalogView(), reason: 'Agent Forge source repository is unavailable' }
    try {
      const sourceData = await readAgentForgeSource(source, {
        ...this.agentForgeSourceOptions,
        ...(this.network === undefined ? {} : this.network),
        ...(this.agentForgeSourceOptions.targetAgent === undefined ? {} : { targetAgent: this.agentForgeSourceOptions.targetAgent }),
        localRoots: this.agentForgeSourceOptions.localRoots ?? [],
      })
      let offlineArtifacts: readonly AgentForgeVerifiedArtifact[] | undefined
      if (sourceData.offline !== undefined) {
        const materialized = materializeOfflineArtifacts(sourceData.offline, this.artifactCacheDir)
        const byDigest = new Map(materialized.map(item => [item.digest, item]))
        const verified: AgentForgeVerifiedArtifact[] = []
        for (const packageEntry of sourceData.offline.manifest.packages) {
          const record = sourceData.packages.get(packageEntry.packageName)
          if (record?.type !== 'plugin') continue
          const materializedArtifact = byDigest.get(packageEntry.artifactDigest)
          if (materializedArtifact === undefined) throw new Error(`离线包制品未物化：${packageEntry.packageName}@${packageEntry.version}`)
          const checked = await verifyTgzFile(materializedArtifact.path, {
            artifactDigest: packageEntry.artifactDigest, packageName: packageEntry.packageName, version: packageEntry.version, requireBundle: true,
          })
          verified.push({ pluginId: packageEntry.pluginId, packageName: checked.packageName, version: checked.version,
            artifactDigest: checked.artifactDigest, size: checked.size, packageJson: checked.packageJson, files: checked.files })
        }
        offlineArtifacts = verified
      }
      const projected = projectAgentForgeCatalog(sourceData, {
        revision: `af-${source.id}-${sourceData.sourceRevision}`,
        generatedAt: String(sourceData.index.generatedAt ?? new Date().toISOString()),
        sourceUrl: String(sourceData.source.baseUrl),
        ...(offlineArtifacts === undefined ? {} : { offlineArtifacts }),
      })
      const result = await repository.refresh(async () => encodeJson(projected))
      if (result.status !== 'refreshed') {
        this.agentForgeStatus.set(source.id, result.current.snapshot.stale ? 'stale' : 'unavailable')
        return { status: 'failed', current: this.catalogView(), ...(result.reason === undefined ? {} : { reason: result.reason }) }
      }
      this.agentForgeStatus.set(source.id, 'ready')
      return { status: 'refreshed', current: this.catalogView() }
    } catch (error) {
      const previous = repository.load()
      this.agentForgeStatus.set(source.id, previous.cacheUsable ? 'stale' : 'unavailable')
      return { status: 'failed', current: this.catalogView(), reason: errorText(error) }
    }
  }

  async catalogRefresh(request?: CatalogRefreshRequest): Promise<CatalogRefreshView> {
    if (request?.sourceId && this.agentForgeSources.has(request.sourceId)) return this.agentForgeRefresh({ sourceId: request.sourceId })
    try {
      const source = request?.sourceId ? this.sources.list().find(item => item.id === request.sourceId) : undefined
      if (request?.sourceId && !source) throw new Error(`目录来源未登记：${request.sourceId}`)
      const result = await this.catalog.refreshWithSource(this.sources.connection(source ? { sourceUrl: source.indexUrl } : request ?? {}))
      return {
        status: result.status,
        current: this.catalogView(),
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      }
    } catch (error) {
      return { status: 'failed', current: this.catalogView(), reason: errorText(error) }
    }
  }

  async planCreate(request: PlanCreateRequest, callerId = 'local-operator', preferredSource?: { readonly packageName: string; readonly sourceId: string }): Promise<PlanResult> {
    try {
      await this.ensureWriteReady()
      const captured = this.readCatalogContext()
      const snapshot = captured.catalog
      const hostCore = this.hostCore()
      const state = await this.host.readState()
      if (this.fingerprint(hostCore) !== this.fingerprint(this.hostCore()) || this.fingerprint(captured) !== this.fingerprint(this.readCatalogContext())) return { status: 'stale', reason: 'release-context/stale', details: ['宿主核心或目录在预检期间发生变化，请重新读取'] }
      const selections = request.selections.map(selection => {
        const plugin = snapshot.plugins.find(candidate => candidate.id === selection.pluginId && candidate.packageName === selection.packageName
          && candidate.version === selection.targetVersion && candidate.artifactDigest === selection.targetDigest)
        if (plugin === undefined) return selection
        const expected = releaseSelectionContext(plugin, { environmentId: this.identity.environmentId, hostCore,
          catalogRevision: snapshot.revision, catalogStale: snapshot.stale, inventory: state.inventory, sources: captured.sources })
        if (selection.releaseContext !== undefined) {
          assertReleaseSelectionContext(selection.releaseContext, expected)
          if (snapshot.stale) throw new MarketCoreError('release-context/catalog-stale', '版本列表来自过期目录，请刷新目录后重新选择')
        }
        return { ...selection, releaseContext: expected }
      })
      for (const selection of selections) {
        const plugin = snapshot.plugins.find(candidate => candidate.id === selection.pluginId && candidate.packageName === selection.packageName
          && candidate.version === selection.targetVersion && candidate.artifactDigest === selection.targetDigest)
        if (plugin === undefined || state.inventory.items.some(item => item.packageName === selection.packageName && item.installed && item.version === selection.targetVersion)) continue
        const compatibility = evaluateHostCompatibility(hostCore, plugin.hostRequirements)
        if (compatibility.status === 'incompatible' || compatibility.status === 'conflict') {
          return { status: 'blocked', reason: compatibility.reason ?? 'core-range-mismatch', blockers: [compatibility.reason ?? 'core-range-mismatch'] }
        }
      }
      // Native-like installation policy: unrelated inventory uncertainty is an
      // advisory condition, not a global preflight blocker. Target identity,
      // frozen delivery and actual write safety are checked by the planner/task
      // manager and the official installer.
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
        selections,
        releaseValidation: { hostBinding: this.fingerprint(hostCore), catalogBinding: this.fingerprint(captured), inventoryRevision: state.inventory.revision, inventoryBinding: this.fingerprint(state.inventory) },
        now: new Date(),
        marketManagedPackageNames,
        localIdentityByPackage,
      }
      const result = await createPlanBundle(context, pack)
      const currentState = await this.host.readState()
      if (this.fingerprint(captured) !== this.fingerprint(this.readCatalogContext()) || this.fingerprint(hostCore) !== this.fingerprint(this.hostCore())
        || state.hostFingerprint !== currentState.hostFingerprint || this.fingerprint(state.inventory) !== this.fingerprint(currentState.inventory)) {
        return { status: 'stale', reason: 'release-context/stale', details: ['预检期间列表事实发生变化，请重新读取并确认'] }
      }
      if (result.status === 'ready' && result.bundle !== undefined) await this.savePlan(result.bundle, callerId)
      if (result.status === 'ready' && result.bundle !== undefined) return { status: 'ready', plan: result.bundle.plan }
      if (result.status === 'stale') return { status: 'stale', reason: result.reason ?? 'stale', details: result.details ?? [] }
      return { status: 'blocked', reason: result.reason ?? 'blocked', blockers: result.blockers ?? [] }
    } catch (error) {
      if (error instanceof MarketCoreError && error.code === 'release-context/stale') return { status: 'stale', reason: error.code, details: [error.message] }
      return { status: 'blocked', reason: errorText(error), blockers: [errorText(error)] }
    }
  }

  async taskStart(request: TaskStartRequest, callerId = 'local-operator'): Promise<TaskState> {
    if (request.confirmed !== true || !request.idempotencyKey) throw new MarketCoreError('plan/not-confirmed', '缺少明确确认或幂等键')
    const original = await this.taskStartRecover({ planId: request.planId, planDigest: request.planDigest, idempotencyKey: request.idempotencyKey }, callerId)
    if (original.status === 'found') return original.task
    await this.ensureWriteReady()
    const bundle = await this.loadPlan(request.planId, callerId)
    const baseline = await this.host.readState()
    const previousIntent = await this.maintenanceIntents.load()
    const packageByPlugin = new Map(bundle.plan.items.map(item => [item.pluginId, item.packageName]))
    const explicitPackages = (bundle.explicitPluginIds ?? [])
      .map(pluginId => packageByPlugin.get(pluginId))
      .filter((packageName): packageName is string => packageName !== undefined)
    const dependencyEdges = bundle.dependencies.flatMap(edge => {
      const prerequisite = packageByPlugin.get(edge.prerequisiteId)
      const consumer = packageByPlugin.get(edge.consumerId)
      return prerequisite === undefined || consumer === undefined ? [] : [{ prerequisite, consumer }]
    })
    // Persist the confirmed intent before InstallTaskManager can enqueue writes.
    await this.maintenanceIntents.recordPlan(explicitPackages, dependencyEdges)
    try {
      return (await this.tasks.start(bundle, request, baseline)).task
    } catch (error) {
      // Roll back only when no durable task was committed. If commit status is
      // uncertain, retaining the intent is safer than forgetting a possible write.
      const existing = await this.taskStore.getByPlan(this.identity.environmentId, request.planId)
      if (existing === undefined) await this.maintenanceIntents.replace({
        explicitPackages: previousIntent.explicitPackages,
        dependencyEdges: previousIntent.dependencyEdges,
      })
      throw error
    }
  }

  async taskStartRecover(request: TaskStartRecoveryRequest, callerId: string): Promise<TaskStartRecoveryResult> {
    assertTaskRecoveryRequest(request, callerId)
    const bytes = await this.files.read(this.planPath(request.planId))
    let bundle: PlanBundle | undefined
    if (bytes !== undefined) {
      let saved: { schemaVersion?: number; callerId?: string; bundle?: PlanBundle }
      try { saved = JSON.parse(new TextDecoder().decode(bytes)) as typeof saved }
      catch { throw new MarketCoreError('operation-recovery/corrupt-plan', '原计划记录损坏，不能证明未写入') }
      if (saved === null || saved.schemaVersion !== 2 || saved.bundle === undefined) throw new MarketCoreError('operation-recovery/corrupt-plan', '原计划记录无效，不能证明未写入')
      if (saved.callerId !== callerId) throw new MarketCoreError('operation-recovery/caller-mismatch', '原计划不属于当前连接')
      bundle = saved.bundle
      if (!await verifyPlanBundle(bundle)) throw new MarketCoreError('operation-recovery/corrupt-plan', '原计划摘要校验失败')
      if (bundle.plan.environmentId !== this.identity.environmentId || bundle.plan.planId !== request.planId || bundle.plan.planDigest !== request.planDigest) {
        throw new MarketCoreError('plan/confirmation-mismatch', '查询身份与原计划不一致')
      }
    }
    const record = await this.taskStore.getByPlan(this.identity.environmentId, request.planId)
    if (record === undefined) return { status: 'not-found' }
    if (bundle === undefined) throw new MarketCoreError('operation-recovery/ownership-unavailable', '原任务存在，但计划归属记录缺失，不能安全恢复')
    if (!await verifyPlanBundle(record.bundle) || record.bundle.bundleDigest !== bundle.bundleDigest
      || record.task.environmentId !== this.identity.environmentId || record.task.planId !== request.planId || record.task.planDigest !== request.planDigest) {
      throw new MarketCoreError('operation-recovery/task-conflict', '原任务与计划耐久身份冲突')
    }
    if (!Object.hasOwn(record.idempotency, request.idempotencyKey) || record.idempotency[request.idempotencyKey] !== 'start') {
      throw new MarketCoreError('task/idempotency-conflict', '查询幂等键不是原任务的开始操作')
    }
    return { status: 'found', task: structuredClone(record.task) }
  }

  async pluginActionRecover(request: PluginActionRecoveryRequest): Promise<PluginActionRecoveryResult> {
    assertManagementRecoveryRequest(request)
    const saved = await this.savedManagement({ environmentId: this.identity.environmentId, ...request, expectedVersion: request.expectedVersion ?? '' })
    if (saved === undefined) return { status: 'not-found' }
    const receipt = saved.stage === 'settled' ? saved.outcome : saved.receipt ?? saved.outcome
    if (receipt === undefined) return { status: 'found', stage: saved.stage }
    const official = publicManagementResult(resultFromOutcome(receipt))
    if (saved.completion !== undefined) return { status: 'found', stage: saved.stage, receipt: official, result: publicManagementResult(saved.completion.result) }
    return { status: 'found', stage: saved.stage, receipt: official, result: { ...official, status: 'unknown',
      error: '仅恢复原官方回执；维护状态保存结果未记录，不能证明整个业务完成。', errorCode: 'management/business-result-unavailable' } }
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
    return this.managePlugin({
      environmentId: this.identity.environmentId,
      packageName: request.packageName,
      expectedVersion: request.expectedVersion ?? '',
      action: request.enabled ? 'enable' : 'disable',
      idempotencyKey: request.idempotencyKey,
    }, () => this.host.setEnabled(request.packageName, request.enabled),
    () => this.maintenanceIntents.setExplicit(request.packageName, true))
  }

  async pluginRemove(request: RemovePluginRequest): Promise<PluginActionResult> {
    return this.managePlugin({
      environmentId: this.identity.environmentId,
      packageName: request.packageName,
      expectedVersion: request.expectedVersion ?? '',
      action: 'remove',
      idempotencyKey: request.idempotencyKey,
    }, async () => mapOfficialChange(await this.host.remove(request.packageName)),
    () => this.maintenanceIntents.clearPackage(request.packageName), async () => {
      if (request.confirmed !== true) throw new Error('卸载操作尚未确认')
      const state = await this.host.readState()
      const intent = await this.maintenanceIntents.load()
      const installed = new Set(state.inventory.items.filter(item => item.installed).map(item => item.packageName))
      const protectedDependents = intent.dependencyEdges
        .filter(edge => edge.prerequisite === request.packageName && (installed.has(edge.consumer) || intent.explicitPackages.includes(edge.consumer)))
        .map(edge => edge.consumer)
      if (protectedDependents.length > 0) throw new Error(`仍有已安装或明确保留的插件依赖此包：${[...new Set(protectedDependents)].join('、')}`)
    })
  }

  private async savedManagement(request: Parameters<InstallTaskManager['manage']>[0]): Promise<import('../core/execution-state.ts').ManagementRecord | undefined> {
    const digest = createHash('sha256').update(request.environmentId + ':' + request.idempotencyKey).digest('hex')
    const bytes = await this.files.read(`management/${digest}.json`)
    if (bytes === undefined) return undefined
    const record = decodeManagementRecord(bytes)
    const fingerprint = createHash('sha256').update(canonicalJson(request)).digest('hex')
    if (record.fingerprint !== fingerprint) throw new MarketCoreError('task/idempotency-conflict', '管理幂等键已用于其他内容')
    return record
  }

  private async managePlugin(
    request: Parameters<InstallTaskManager['manage']>[0],
    write: () => Promise<import('../core/ports.ts').HostInstallOutcome>,
    saveMaintenance: () => Promise<{ readonly revision: number }>,
    preflight?: () => Promise<void>,
  ): Promise<PluginActionResult> {
    let receipt: import('../core/ports.ts').HostInstallOutcome | undefined
    let output: PluginActionResult | undefined
    let dispatched = false
    let businessPrepared = false
    try {
      const saved = await this.savedManagement(request)
      if (saved?.completion !== undefined) return publicManagementResult(saved.completion.result)
      await this.ensureWriteReady()
      const result = await this.tasks.manage(request, async () => {
        dispatched = true
        receipt = await write()
        return receipt
      }, async record => {
        output = resultFromOutcome(record.outcome!)
        let maintenance: import('../core/execution-state.ts').ManagementCompletion['maintenance'] = { status: 'not-required' }
        if (output.status === 'applied' || output.status === 'restart-required') {
          const state = await saveMaintenance()
          maintenance = { status: 'saved', revision: state.revision }
        }
        businessPrepared = true
        return maintenance
      }, preflight)
      output = resultFromOutcome(result)
      if (output.status === 'unknown' && receipt !== undefined) {
        const official = resultFromOutcome(receipt)
        output = { ...output, changed: official.changed, diagnostic: sanitizeDiagnostic([
          `官方回执：${official.status}，changed=${official.changed}`, output.diagnostic, official.diagnostic,
        ].filter(Boolean).join('；')) }
      }
      return publicManagementResult(output)
    } catch (error) {
      let diagnostic = errorText(error)
      if (receipt === undefined && output === undefined) {
        try {
          const saved = await this.savedManagement(request)
          if (saved !== undefined) {
            dispatched = true
            receipt = saved.receipt ?? saved.outcome
          }
        } catch (recoveryError) {
          if (!(recoveryError instanceof MarketCoreError && recoveryError.code === 'task/idempotency-conflict')) dispatched = true
          diagnostic += '；管理回执读取失败：' + errorText(recoveryError)
        }
      }
      const known = output ?? (receipt === undefined ? undefined : resultFromOutcome(receipt))
      if (!dispatched && known === undefined) {
        return { status: 'failed', changed: false, error: sanitizeDiagnostic(diagnostic), permissionChanges: [] }
      }
      const maintenanceFailed = !businessPrepared && (output?.status === 'applied' || output?.status === 'restart-required')
      return {
        status: 'unknown',
        changed: known?.changed ?? false,
        permissionChanges: known?.permissionChanges ?? [],
        error: businessPrepared ? '官方管理和维护结果已返回，但完整业务凭证未保存；请核对原操作，不会重复写入。'
          : maintenanceFailed ? '官方管理结果已确认，但维护状态未保存；请核对原操作，不会重复写入。'
          : '管理写入结果尚未完整核实；请核对原操作，不会重复写入。',
        errorCode: businessPrepared ? 'management/business-result-save-failed' : maintenanceFailed ? 'management/maintenance-save-failed' : 'management/outcome-unverified',
        diagnostic: sanitizeDiagnostic([
          known === undefined ? undefined : `官方回执：${known.status}，changed=${known.changed}`, diagnostic,
          known?.errorCode, known?.error, known?.diagnostic,
        ].filter(Boolean).join('；')),
      }
    }
  }

  /** Produces a fresh Core-owned maintenance snapshot after task recovery. */
  readonly maintenanceStatus = async (): Promise<CoreMaintenanceSnapshot> => {
    await this.recovery
    const state = await this.host.readState()
    const tasks = await this.taskStore.list(this.identity.environmentId)
    const taskStates = tasks.map(record => record.task)
    const catalogRevision = this.catalogView().revision
    const intent = await this.maintenanceIntents.load()
    return buildMaintenanceSnapshot({
      environmentId: this.identity.environmentId,
      revision: `maintenance:${catalogRevision}:${state.inventory.revision}:${intent.revision}:${taskStates.map(task => `${task.taskId}:${task.updatedAt}`).join('|')}`,
      inventory: state.inventory,
      tasks: taskStates,
      explicitPackages: intent.explicitPackages,
      selectedPackages: intent.explicitPackages,
      dependencyEdges: intent.dependencyEdges,
      unknownPackages: state.inventory.unknownItems,
    })
  }

  readonly checkUpdates = async (request?: { readonly sourceId?: string; readonly refreshFirst?: boolean }): Promise<import('../contracts/types.ts').UpdateCheckResult> => {
    await this.recovery
    if (request?.refreshFirst) await this.catalogRefresh(request.sourceId ? { sourceId: request.sourceId } : undefined)
    const captured = this.readCatalogContext()
    const hostCore = this.hostCore()
    const state = await this.host.readState()
    if (hostCore.hostRevision !== this.hostCore().hostRevision || this.fingerprint(captured) !== this.fingerprint(this.readCatalogContext())) {
      throw new MarketCoreError('update-check/stale-context', '宿主核心或目录在检查期间发生变化，请重新检查')
    }
    return compareInstalledUpdates(state.inventory, captured.catalog.plugins, captured.catalog.revision, { catalogStale: captured.catalog.stale, hostCore, catalog: captured.catalog })
  }

  async updatePolicyGet(): Promise<UpdatePolicySnapshot> {
    return this.updatePolicy.get()
  }

  async updatePolicySave(request: UpdatePolicySaveRequest): Promise<UpdatePolicySnapshot> {
    await this.ensureWriteReady()
    const saved = await this.updatePolicy.save(request)
    await this.updateCheckScheduler.refresh()
    return saved
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
    return this.catalogView().plugins.find(item => item.packageName === action.packageName && item.version === action.targetVersion)
  }

  private targetDelivery(plugin: CatalogPlugin | undefined): CatalogDelivery | undefined {
    if (!plugin) return undefined
    return this.catalogView().deliveries.find(item => item.pluginId === plugin.id && item.version === plugin.version && item.artifactDigest === plugin.artifactDigest)
  }

  private riskyImpact(kind: 'remove' | 'downgrade', current: InventoryItem, target: CatalogPlugin | undefined, inventory: InventorySnapshot): AiActionImpact {
    const roots = new Map<string, string>()
    const profile = this.context.profileContext
    const official = createRequire(import.meta.url)('@deepseek-ai/dsh-app-boot') as {
      resolveBundleDir(bin: string, name: string, anchor: string, profileDir: string): string
    }
    const impact = assessRiskyAction({ kind, packageName: current.packageName, currentVersion: current.version ?? '', target,
      current: this.catalogView().plugins.find(item => item.packageName === current.packageName && item.version === current.version), inventory,
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
    const currentRelease = this.catalogView().plugins.find(item => item.packageName === current.packageName && item.version === current.version)
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
      const targetUnknown = state.inventory.unknownItems.some(issue => issue === `bundle-version:${action.packageName}` || issue.startsWith(`bundle:${action.packageName}:`))
      if (state.activity.writeBarrier === true || state.activeRequests.length > 0 || targetUnknown) return { status: 'blocked', reason: '目标或活动写入状态尚未核实，暂不能生成可执行建议' }
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
        const targetUnknown = state.inventory.unknownItems.some(issue => issue === `bundle-version:${action.packageName}` || issue.startsWith(`bundle:${action.packageName}:`))
        if (state.activity.writeBarrier === true || state.activeRequests.length > 0 || targetUnknown
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

  /** 安装日志只读出口（B 档）：最多返回 500 条，字段已脱敏。 */
  installLogRead(request?: { readonly limit?: number }): Promise<readonly InstallLogEntry[]> {
    return this.installLog.read(request?.limit)
  }
}
