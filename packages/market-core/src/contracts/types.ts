/**
 * Market wire contracts. This module is shared by Host and Client and therefore
 * contains only JSON-like values; runtime schema is generated from these types.
 * It never exposes local absolute paths, credentials, or executable callbacks.
 */

// v2 requires a connection-scoped handshake before writes. Cached v1 pages
// must refresh; persistent task/author/catalog schemas are unchanged.
export const PROTOCOL_VERSION = '2.0.0'
export const SERVICE_NAME = 'eacMarket'
export const MARKET_SCHEMA_VERSION = '1'

export type CapabilityName =
  | 'browse'
  | 'install'
  | 'enable'
  | 'disable'
  | 'remove'
  | 'official-plugin-navigation'
  | 'restart-handoff'

export interface EnvironmentHello {
  readonly protocolVersion: string
  readonly schemaVersion: string
  readonly marketVersion: string
  readonly environmentId: string
  readonly profileName: string
  readonly hostVersion: string
  readonly capabilities: readonly CapabilityName[]
  readonly coreVersion?: string
  readonly coreApiVersion?: string
}

/** Adapter identity is diagnostic data, never an authorization credential. */
export interface ClientHandshakeRequest {
  readonly protocolVersion: string
  readonly adapterVersion: string
}

export interface ClientHandshakeResult {
  readonly accepted: boolean
  readonly protocolVersion: string
  readonly coreVersion: string
  readonly coreApiVersion: string
  readonly reason?: string
}

export type VerificationState = 'verified' | 'unverified' | 'hard-incompatible' | 'unknown'
export type Installability =
  | 'bundle-installable'
  | 'missing-bundle'
  | 'missing-artifact'
  | 'hard-blocked'
  | 'needs-repair'

export type SourceKind = 'embedded' | 'online-index' | 'cache' | 'registry-tarball' | 'https-artifact' | 'local-file'
export type DistributionClass = 'builtin' | 'recommended' | 'external' | 'unclassified'
export type EnabledPolicy = 'default-on' | 'default-off' | 'requires-setup'

export interface CatalogMedia {
  readonly id: string
  readonly alt: string
  readonly sourceUrl: string
  readonly width?: number
  readonly height?: number
}

export interface CatalogRecommendation {
  readonly pluginId: string
  readonly version?: string
  /** 首页展示位；旧的 category/guide 仍保留兼容。 */
  readonly placement: 'featured' | 'recommended-skin' | 'top-plugin' | 'top-skill' | 'category' | 'guide'
  readonly order: number
  readonly reason: string
  readonly evidence?: string | undefined
  /** 仅在 source=score 时存在；未知评分不能填 0 或其他占位值。 */
  readonly source?: 'curated' | 'score'
  readonly score?: CatalogScore | undefined
}

export interface CatalogScore {
  /** 统一为 0..5，来源负责记录具体口径。 */
  readonly value: number
  readonly scale: 5
  readonly source: string
  readonly measuredAt?: string | undefined
}

export interface CatalogPlugin {
  readonly id: string
  readonly name: string
  readonly packageName: string
  readonly version: string
  /** A navigation category only; derived from package metadata, never an execution grant. */
  readonly kind?: 'plugin' | 'skin' | 'skill' | undefined
  readonly skinId?: string | undefined
  readonly summary: string
  readonly author: string
  readonly authorUrl?: string
  readonly sourceUrl?: string
  readonly license?: string
  readonly distribution: DistributionClass
  readonly capabilityTier: string
  readonly verification: VerificationState
  readonly installability: Installability
  readonly artifactDigest?: string
  readonly presentationId: string
  readonly categories: readonly string[]
  readonly screenshots: readonly CatalogMedia[]
  readonly enabledPolicy: EnabledPolicy
  readonly requiresRestart: boolean
  readonly requiresSetup: boolean
  readonly largeExternalResource: boolean
  readonly releasedAt?: string | undefined
  /** Team-reviewed operation evidence; absent means no data-safety claim. */
  readonly managementEvidence?: CatalogManagementEvidence | undefined
}

/** Research-only listing: no artifact, install plan, metadata or claimed exact
 * installed version. It cannot enter the installable CatalogPlugin table. */
export interface CatalogListing {
  readonly id: string
  readonly name: string
  readonly packageName: string
  readonly summary: string
  readonly reason: string
  readonly sourceUrl: string
  readonly requestedVersion?: string | undefined
}

export interface CatalogManagementEvidence {
  readonly reviewId: string
  readonly artifactDigest: string
  readonly reviewedBy: string
  readonly reviewedAt: string
  readonly stateless: boolean
  readonly removePreservesExternalData: boolean
  readonly downgradeFrom: readonly string[]
  readonly explanation: string
}

export interface PackComponent {
  readonly pluginId: string
  readonly version: string
  readonly required: boolean
}

export interface PackExecutionEdge {
  readonly prerequisiteId: string
  readonly consumerId: string
  readonly milestone: 'installed' | 'active'
}

export interface PackExecution {
  readonly schemaVersion: string
  readonly packId: string
  readonly packVersion: string
  readonly lockDigest: string
  readonly coverage: 'complete' | 'partial' | 'unknown'
  readonly edges: readonly PackExecutionEdge[]
  readonly provenance: string
}

export interface CatalogPack {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly summary: string
  readonly category: 'function' | 'appearance' | 'workflow' | 'unclassified'
  readonly components: readonly PackComponent[]
  readonly lockDigest: string
  readonly execution: PackExecution
}

/** Market-private collection, distinct from Mojobox Pack and its npm Lock. */
export interface CatalogCollectionView {
  readonly kind: 'market-collection'
  readonly id: string
  readonly version: string
  readonly name: string
  readonly summary: string
  readonly collectionDigest: string
  readonly components: readonly {
    readonly pluginId: string
    readonly version: string
    readonly releaseId: string
    readonly artifactDigest: string
    readonly required: boolean
    readonly enabled: boolean
  }[]
  readonly execution: {
    readonly coverage: 'complete' | 'partial' | 'unknown'
    readonly edges: readonly PackExecutionEdge[]
    readonly provenance: string
  }
}

export interface CatalogPresentation {
  readonly id: string
  readonly revision: string
  readonly title: string
  readonly summary: string
  readonly markdown: string
  readonly media: readonly CatalogMedia[]
  readonly sourceCommit?: string
  readonly sourceUrl?: string
  readonly importedAt?: string
}

export interface DeliverySource {
  readonly kind: SourceKind
  readonly ref: string
  readonly priority: number
  readonly size?: number
}

export interface CatalogDelivery {
  readonly pluginId: string
  readonly version: string
  readonly artifactDigest: string
  readonly packageName: string
  readonly sources: readonly DeliverySource[]
}

export interface CatalogSnapshot {
  readonly schemaVersion: string
  readonly revision: string
  readonly generatedAt: string
  readonly origin: 'embedded' | 'online' | 'cache'
  readonly stale: boolean
  readonly plugins: readonly CatalogPlugin[]
  readonly listings?: readonly CatalogListing[] | undefined
  readonly packs: readonly CatalogPack[]
  readonly presentations: readonly CatalogPresentation[]
  readonly deliveries: readonly CatalogDelivery[]
  readonly recommendations?: readonly CatalogRecommendation[] | undefined
  /** 发现页的稳定投影；缺少评分数据的高分分区会省略。 */
  readonly discovery?: CatalogDiscovery | undefined
  readonly collections?: readonly CatalogCollectionView[] | undefined
}

export interface CatalogDiscoveryCard {
  readonly pluginId: string
  readonly version: string
  readonly title: string
  readonly summary: string
  readonly reason: string
  readonly source: 'curated' | 'score'
  readonly order: number
  readonly score?: CatalogScore | undefined
  /** 有图时取首张截图/演示图；没有时由 title+summary 渲染默认海报卡。 */
  readonly poster?: CatalogMedia | undefined
}

export interface CatalogDiscovery {
  readonly featured: readonly CatalogDiscoveryCard[]
  readonly recommendedSkins: readonly CatalogDiscoveryCard[]
  readonly highScorePlugins?: readonly CatalogDiscoveryCard[] | undefined
  readonly highScoreSkills?: readonly CatalogDiscoveryCard[] | undefined
}

export interface CatalogRefreshRequest {
  readonly sourceUrl?: string
}

export interface CatalogRefreshView {
  readonly status: 'refreshed' | 'failed'
  readonly current: CatalogSnapshot
  readonly reason?: string
}

/** Agent Forge v2 source registration. `value` is a controlled source value,
 * never an arbitrary path supplied directly by a client. */
export interface MarketCatalogSource {
  readonly id: string
  readonly kind: 'agent-forge'
  readonly location: { readonly mode: 'https' | 'local-file' | 'offline-pack'; readonly value: string }
  readonly expectedRevision?: string
  readonly enabled: boolean
  readonly priority: number
  readonly refreshPolicy: 'manual' | 'on-open' | 'periodic'
}

export interface UpdatePolicy {
  /** Defaults to true when omitted by a persisted settings migration. */
  readonly automaticChecksEnabled: boolean
  /** Both download and install remain opt-in and default to false. */
  readonly automaticDownloadsEnabled: boolean
  readonly automaticInstallsEnabled: boolean
  readonly intervalMinutes?: number
}

export interface OfflinePackArtifact {
  readonly digest: string
  readonly filename: string
  readonly size: number
  readonly relativePath: string
}

export interface OfflinePackManifest {
  readonly schemaVersion: '1'
  readonly packId: string
  readonly sourceRevision: string
  readonly targetAgent: string
  readonly packages: readonly { readonly pluginId: string; readonly packageName: string; readonly version: string; readonly artifactDigest: string; readonly optional: true }[]
  readonly artifacts: readonly OfflinePackArtifact[]
}

export type SelectionNodeKind = 'bundle' | 'plugin' | 'dependency'

export interface BundleSelectionNode {
  readonly id: string
  readonly kind: SelectionNodeKind
  readonly parentId?: string
  readonly pluginId?: string
  readonly packageName?: string
  readonly version?: string
  /** Every Bundle member and dependency is optional in this phase. */
  readonly optional: true
  readonly selected: boolean
  readonly dependencies: readonly string[]
}

export interface BundleSelectionGraph {
  readonly revision: string
  readonly rootId: string
  readonly nodes: readonly BundleSelectionNode[]
  readonly edges: readonly PackExecutionEdge[]
}

export type CancellationPreservationReason =
  | 'has-selected-dependent'
  | 'has-installed-dependent'
  | 'explicitly-installed'
  | 'selected-in-parallel-task'
  | 'selected-in-other-bundle'
  | 'completed-outside-current-task'
  | 'unknown-state'
  | 'official-protected'

export interface PreservedCancellationItem {
  readonly packageName: string
  readonly reasons: readonly CancellationPreservationReason[]
  readonly dependentPackages: readonly string[]
}

export interface CancelSelectionResult {
  readonly status: 'cancelled' | 'blocked' | 'partial' | 'not-found'
  readonly dependentPackages: readonly string[]
  readonly cascadedCancelled: readonly string[]
  readonly preservedPackages: readonly PreservedCancellationItem[]
  readonly reasons: readonly string[]
}

export interface MaintenancePackageState {
  readonly pluginId?: string
  readonly packageName: string
  readonly installedVersion?: string
  readonly targetVersion?: string
  readonly installState: 'not-installed' | 'installed' | 'installing' | 'updating' | 'uninstalling' | 'failed' | 'unknown'
  readonly enabledState: 'enabled' | 'disabled' | 'pending-restart' | 'unknown'
  readonly explicitState: 'explicit' | 'implicit' | 'none' | 'unknown'
  readonly dependencyState: { readonly dependencyOf: readonly string[]; readonly requiredByCount: number; readonly releasable: boolean }
  readonly effectiveState: 'retain' | 'install' | 'update' | 'remove' | 'blocked' | 'unknown'
  readonly reasons: readonly string[]
}

export interface CoreMaintenanceSnapshot {
  readonly schemaVersion: '1'
  readonly revision: string
  readonly environmentId: string
  readonly generatedAt: string
  readonly updatePolicy: UpdatePolicy
  readonly packages: readonly MaintenancePackageState[]
  readonly activeTaskIds: readonly string[]
  readonly pendingRestart: boolean
}

export type InventoryRowState = 'enabled' | 'disabled' | 'load-error' | 'unknown'
export interface InventoryRow {
  readonly id: string
  readonly name: string
  readonly state: InventoryRowState
  readonly error?: string | undefined
  readonly entryId?: string | undefined
  readonly rowId?: string
  readonly moduleName?: string | undefined
  readonly fiberPhase?: 'failed' | 'pending' | 'active' | 'loading' | 'unloading' | 'unknown' | null | undefined
}

export interface InventoryItem {
  readonly pluginId?: string | undefined
  readonly packageName: string
  readonly version?: string | undefined
  /** Verified installed reference/cache receipt identity, not a claim about every runtime file. */
  readonly artifactDigest?: string | undefined
  readonly source: 'profile' | 'installation' | 'market-cache-file' | 'unknown'
  readonly installed: boolean
  readonly bundleEnabled: boolean
  readonly removable: boolean
  readonly readOnlyReason?: 'management-required' | 'unaddressable' | 'unknown' | undefined
  readonly rows: readonly InventoryRow[]
  readonly restartRequired: boolean
  readonly entryId?: string | undefined
  readonly moduleName?: string | undefined
  readonly provenance?: 'market-cache-file' | 'profile' | 'installation' | 'unknown' | undefined
}

export interface InventorySnapshot {
  readonly environmentId: string
  readonly revision: string
  readonly items: readonly InventoryItem[]
  readonly unknownItems: readonly string[]
}

export interface PlanSelection {
  readonly pluginId: string
  readonly packageName: string
  readonly targetVersion: string
  readonly targetDigest: string
  readonly enabledIntent: boolean
  readonly tryUnverified: boolean
}

export interface PlanCreateRequest {
  readonly planId?: string
  readonly packId?: string
  readonly packVersion?: string
  readonly collectionId?: string
  readonly collectionVersion?: string
  readonly selections: readonly PlanSelection[]
  readonly attemptUnknown?: boolean
}

export type PlanAction = 'keep' | 'add' | 'upgrade' | 'downgrade' | 'blocked'

export interface InstallPlanItem {
  readonly pluginId: string
  readonly packageName: string
  readonly action: PlanAction
  readonly currentVersion?: string
  readonly currentEnabled: boolean
  readonly targetVersion: string
  readonly targetDigest: string
  readonly requestedEnabled: boolean
  readonly verification: VerificationState
  readonly requiresRestart: boolean
  readonly blockers: readonly string[]
}

export interface InstallPlan {
  readonly planId: string
  readonly schemaVersion: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly environmentId: string
  readonly hostFingerprint: string
  readonly catalogRevision: string
  readonly packId?: string
  readonly packVersion?: string
  readonly packExecutionDigest?: string
  readonly collectionId?: string
  readonly collectionVersion?: string
  readonly collectionDigest?: string
  readonly items: readonly InstallPlanItem[]
  readonly planDigest: string
}

export type PlanResult =
  | { readonly status: 'ready'; readonly plan: InstallPlan }
  | { readonly status: 'stale'; readonly reason: string; readonly details: readonly string[] }
  | { readonly status: 'blocked'; readonly reason: string; readonly blockers: readonly string[] }

export type TaskStatus =
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'awaiting-approval'
  | 'awaiting-resume'
  | 'cancelling'
  | 'applying'
  | 'checking'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'needs-attention'
  | 'unknown'

export type TaskItemStatus =
  | 'pending'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'restart-required'
  | 'blocked-by-dependency'
  | 'blocked-on-restart'
  | 'failed'
  | 'cancelled'
  | 'unknown'

export interface PermissionChange {
  readonly packageName: string
  readonly decision: 'approved' | 'revoked' | 'already-approved'
}

export interface TaskItemResult {
  readonly pluginId: string
  readonly packageName: string
  readonly targetVersion: string
  readonly status: TaskItemStatus
  readonly changed: boolean
  readonly error?: string | undefined
  readonly packageResultCode?: string | undefined
  readonly errorCode?: string | undefined
  readonly diagnostic?: string | undefined
  readonly installOutcome: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled' | 'unknown'
  readonly permissionChanges: readonly PermissionChange[]
}

export interface ApprovalChallenge {
  readonly id: string
  readonly attemptId: string
  readonly digest: string
  readonly packages: readonly string[]
  readonly createdAt: string
}

export interface ResumeChallenge {
  readonly id: string
  readonly digest: string
  readonly remainingPluginIds: readonly string[]
  readonly createdAt: string
}

export interface TaskEvent {
  readonly sequence: number
  readonly at: string
  readonly phase: TaskStatus
  readonly pluginId?: string | undefined
  readonly message: string
  readonly level: 'info' | 'warning' | 'error'
}

export interface TaskEventPage {
  readonly events: readonly TaskEvent[]
  readonly nextSequence: number
  readonly truncated: boolean
}

export interface TaskState {
  readonly taskId: string
  readonly planId: string
  readonly planDigest: string
  readonly environmentId: string
  readonly status: TaskStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly items: readonly TaskItemResult[]
  readonly events: readonly TaskEvent[]
  readonly approval?: ApprovalChallenge
  readonly resume?: ResumeChallenge
  readonly retryOfTaskId?: string | undefined
  readonly nextAction: string
}

export interface TaskStartRequest {
  readonly planId: string
  readonly planDigest: string
  readonly idempotencyKey: string
  readonly confirmed: true
  readonly retryOfTaskId?: string | undefined
}

export interface TaskIdRequest {
  readonly taskId: string
}

export interface TaskEventRequest {
  readonly taskId: string
  readonly afterSequence?: number
  readonly limit?: number
}

export interface TaskApprovalRequest {
  readonly taskId: string
  readonly attemptId: string
  readonly challengeId: string
  readonly pendingBuildsDigest: string
  readonly approvedBuilds: readonly string[]
  readonly idempotencyKey: string
}

export interface TaskResumeRequest {
  readonly taskId: string
  readonly challengeId: string
  readonly resumeDigest: string
  readonly idempotencyKey: string
}

export interface TaskCancelRequest {
  readonly taskId: string
  readonly idempotencyKey: string
}

export interface PluginActionRequest {
  readonly packageName: string
  readonly expectedVersion?: string
  readonly enabled: boolean
  readonly idempotencyKey: string
}

export interface RemovePluginRequest {
  readonly packageName: string
  readonly expectedVersion?: string
  readonly confirmed: true
  readonly idempotencyKey: string
}

export interface PluginActionResult {
  readonly status: 'applied' | 'restart-required' | 'failed' | 'unknown'
  readonly changed: boolean
  readonly error?: string | undefined
  readonly errorCode?: string | undefined
  readonly diagnostic?: string | undefined
  readonly permissionChanges: readonly PermissionChange[]
}

export interface AuthorDraft {
  readonly id: string
  readonly revision: string
  readonly title: string
  readonly summary: string
  readonly markdown: string
  readonly pluginId?: string | undefined
  readonly pluginVersion?: string
  readonly mediaIds: readonly string[]
  readonly sourceCommit?: string
  readonly sourceUrl?: string
  readonly updatedAt: string
}

export interface AuthorDraftInput {
  readonly id?: string
  readonly expectedRevision?: string
  readonly title: string
  readonly summary: string
  readonly markdown: string
  readonly pluginId?: string | undefined
  readonly pluginVersion?: string
  readonly mediaIds: readonly string[]
  readonly sourceCommit?: string
  readonly sourceUrl?: string
}

export interface AuthorDraftDeleteRequest {
  readonly id: string
  readonly expectedRevision: string
}

export interface ReadmeImportRequest {
  readonly repositoryUrl: string
  readonly branch?: string
  readonly path?: string
  readonly targetDraftId?: string
  readonly expectedRevision?: string | undefined
}

export interface ReadmeImportResult {
  readonly draft: AuthorDraft
  readonly repositoryUrl: string
  readonly commit: string
  readonly importedAt: string
  readonly mediaWarnings: readonly string[]
}

export interface ReadmePreviewView {
  readonly previewId: string
  readonly expiresAt: string
  readonly candidate: AuthorDraftInput
  readonly before?: AuthorDraft
  readonly repositoryUrl: string
  readonly commit: string
  readonly importedAt: string
  readonly mediaWarnings: readonly string[]
}

export interface ReadmeApplyPreviewRequest {
  readonly previewId: string
  readonly expectedRevision?: string
}

export interface TransferBeginRequest {
  readonly purpose: 'draft-media' | 'author-export' | 'author-import'
  /** Draft/package target the transfer is bound to; Host rejects cross-target writes. */
  readonly targetId?: string
  readonly expectedRevision?: string
  readonly filename: string
  readonly size: number
  readonly mediaType: string
  readonly sha256: string
}

export interface TransferChunkRequest {
  readonly transferId: string
  readonly sequence: number
  /** Base64 text keeps the wire JSON-safe; Host enforces decoded block bounds. */
  readonly data: string
}

export interface TransferChunkReadRequest {
  readonly transferId: string
  readonly sequence: number
}

export interface TransferDisposeRequest {
  readonly transferId: string
}

export interface TransferChunkReadResult {
  readonly transferId: string
  readonly sequence: number
  readonly data: string
  readonly last: boolean
}

export interface AuthorExportRequest {
  readonly draftId: string
  readonly targetId?: string
  readonly repositoryUrl?: string
  readonly commit?: string
  readonly license?: string
  readonly licenseNotice?: string
  readonly notes?: string
}

/** Media is scoped to the saved draft; no arbitrary paths or URLs are accepted. */
export interface AuthorMediaReadRequest {
  readonly draftId: string
  readonly mediaId: string
}

export interface AuthorMediaReadResult {
  readonly id: string
  readonly mediaType: string
  readonly data: string
  readonly sha256: string
}

export interface TransferResult {
  readonly transferId: string
  readonly complete: boolean
  readonly receivedBytes: number
  readonly resultId?: string
}

export type AiActionKind = 'install' | 'update' | 'retry-source' | 'enable' | 'disable' | 'remove' | 'downgrade'

export interface AiProposedAction {
  readonly kind: AiActionKind
  readonly packageName: string
  readonly targetVersion?: string | undefined
  readonly sourceId?: string | undefined
  readonly reason: string
  readonly requiresSecondConfirmation: boolean
}

export interface AiProposal {
  readonly id: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly impactDigest: string
  readonly summary: string
  readonly facts: readonly string[]
  readonly actions: readonly AiProposedAction[]
  readonly environmentId?: string | undefined
  readonly taskId?: string | undefined
  readonly diagnosticDigest?: string | undefined
  /** The actual preflight presented for an install-class suggestion. */
  readonly plan?: InstallPlan | undefined
  readonly impact?: AiActionImpact | undefined
}

export interface AiActionImpact {
  readonly summary: string
  readonly currentVersion?: string | undefined
  readonly targetVersion?: string | undefined
  readonly affectedPackages: readonly string[]
  readonly dataBehavior: string
  readonly unknowns: readonly string[]
}

export interface AiRiskChallenge {
  readonly id: string
  readonly digest: string
  readonly expiresAt: string
  readonly impact: AiActionImpact
}

export interface AiAnalyzeRequest {
  readonly taskId?: string | undefined
  readonly packageName?: string | undefined
}

export interface AiAnalysisResult {
  readonly status: 'ready' | 'blocked' | 'failed'
  readonly proposal?: AiProposal | undefined
  readonly reason?: string | undefined
}

export interface AiConfirmRequest {
  readonly proposalId: string
  readonly confirmed: true
  readonly impactDigest: string
  readonly idempotencyKey: string
  readonly riskConfirmed?: true | undefined
  readonly challengeId?: string | undefined
  readonly challengeDigest?: string | undefined
}

export interface AiApplyResult {
  readonly status: 'applied' | 'restart-required' | 'failed' | 'unknown' | 'blocked' | 'requires-confirmation' | 'queued'
  readonly changed: boolean
  readonly taskId?: string | undefined
  readonly error?: string | undefined
  readonly challenge?: AiRiskChallenge | undefined
}

export interface DiagnosticEntry {
  readonly id: string
  readonly category: 'catalog' | 'tasks' | 'install' | 'inventory' | 'authoring' | 'environment' | 'unknown'
  readonly message: string
  readonly source?: string | undefined
  readonly redacted?: boolean | undefined
}

export interface DiagnosticExport {
  readonly schemaVersion: string
  readonly generatedAt: string
  readonly marketVersion: string
  readonly environmentId: string
  readonly summaries: readonly string[]
  readonly diagnostics: readonly DiagnosticEntry[]
  readonly redacted: boolean
}
