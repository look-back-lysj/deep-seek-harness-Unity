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
    this.agentForgeSourceOptions = options.agentForgeSourceOptions ?? {}
    this.marketVersion = options.marketVersion ?? 'development'
    this.artifactCacheDir = join(dataDirectory, 'artifacts')
    this.network = options.network
    this.host = new OfficialHostPort(ctx, identity.environmentId, { hostVersion: identity.hostVersion, profileName: identity.profileName })
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
        const current = this.catalogView().plugins.find(plugin => plugin.id === item.pluginId && plugin.version === item.targetVersion)
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
    const base = this.catalog.load().snapshot
    const extras = [...this.agentForgeCatalogs.values()].map(repository => repository.load().snapshot)
    const plugins = [...new Map([...base.plugins, ...extras.flatMap(snapshot => snapshot.plugins)].map(item => [`${item.id}:${item.version}`, item])).values()]
    const listings = [...new Map([...(base.listings ?? []), ...extras.flatMap(snapshot => snapshot.listings ?? [])].map(item => [`${item.id}:${item.requestedVersion ?? ''}`, item])).values()]
    const deliveries = [...new Map([...base.deliveries, ...extras.flatMap(snapshot => snapshot.deliveries)].map(item => [`${item.pluginId}:${item.version}:${item.artifactDigest}`, item])).values()]
    const presentations = [...base.presentations, ...extras.flatMap(snapshot => snapshot.presentations)]
    const extraRevisions = extras.map(snapshot => snapshot.revision).sort()
    const revision = extraRevisions.length === 0 ? base.revision : [base.revision, ...extraRevisions].join('|').slice(0, 200)
    return { ...base, revision, plugins, listings, deliveries, presentations, stale: base.stale || extras.some(snapshot => snapshot.stale) }
  }
  capabilities(): readonly import('../contracts/types.ts').CapabilityName[] {
    const result = new Set(this.host.capabilities())
    result.add('catalog-source-list')
    result.add('core-maintenance')
    result.add('update-check')
    result.add('update-policy')
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
        revision: `af-${source.id}-${sourceData.sourceRevision}`.slice(0, 200),
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
        current: { ...this.catalogView(), collections: this.catalog.collectionViews() },
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      }
    } catch (error) {
      return { status: 'failed', current: { ...this.catalogView(), collections: this.catalog.collectionViews() }, reason: errorText(error) }
    }
  }

  async planCreate(request: PlanCreateRequest, callerId = 'local-operator', preferredSource?: { readonly packageName: string; readonly sourceId: string }): Promise<PlanResult> {
    try {
      await this.ensureWriteReady()
      const snapshot = this.catalogView()
      const state = await this.host.readState()
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
        selections: request.selections,
        now: new Date(),
        marketManagedPackageNames,
        localIdentityByPackage,
      }
      const result = await createPlanBundle(context, pack)
      if (result.status === 'ready' && result.bundle !== undefined) await this.savePlan(result.bundle, callerId)
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
      if (output.status === 'applied' || output.status === 'restart-required') {
        await this.maintenanceIntents.setExplicit(request.packageName, true)
      }
      return output
    } catch (error) {
      return { status: 'failed', changed: false, error: errorText(error), permissionChanges: [] }
    }
  }

  async pluginRemove(request: RemovePluginRequest): Promise<PluginActionResult> {
    try {
      await this.ensureWriteReady()
      if (request.confirmed !== true) throw new Error('卸载操作尚未确认')
      const state = await this.host.readState()
      const intent = await this.maintenanceIntents.load()
      const installed = new Set(state.inventory.items.filter(item => item.installed).map(item => item.packageName))
      const protectedDependents = intent.dependencyEdges
        .filter(edge => edge.prerequisite === request.packageName && (installed.has(edge.consumer) || intent.explicitPackages.includes(edge.consumer)))
        .map(edge => edge.consumer)
      if (protectedDependents.length > 0) throw new Error(`仍有已安装或明确保留的插件依赖此包：${[...new Set(protectedDependents)].join('、')}`)
      const result = await this.tasks.manage({
        environmentId: this.identity.environmentId,
        packageName: request.packageName,
        expectedVersion: request.expectedVersion ?? '',
        action: 'remove',
        idempotencyKey: request.idempotencyKey,
      }, async () => mapOfficialChange(await this.host.remove(request.packageName)))
      const output = resultFromOutcome(result)
      if (output.status === 'applied' || output.status === 'restart-required') {
        await this.maintenanceIntents.clearPackage(request.packageName)
      }
      return output
    } catch (error) {
      return { status: 'failed', changed: false, error: errorText(error), permissionChanges: [] }
    }
  }

  /** Produces a fresh Core-owned maintenance snapshot after task recovery. */
  readonly maintenanceStatus = async (): Promise<CoreMaintenanceSnapshot> => {
    await this.recovery
    const state = await this.host.readState()
    const tasks = await this.taskStore.list(this.identity.environmentId)
    const taskStates = tasks.map(record => record.task)
    const catalogRevision = this.catalog.load().snapshot.revision
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
    const state = await this.host.readState()
    const snapshot = this.catalogView()
    return compareInstalledUpdates(state.inventory, snapshot.plugins, snapshot.revision, { catalogStale: snapshot.stale })
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
}
