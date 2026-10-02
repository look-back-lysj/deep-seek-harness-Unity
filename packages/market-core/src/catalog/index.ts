/**
 * Catalog 模块入口：公共目录只读投影、市场私有 PackExecution 绑定、离线缓存切换。
 * 本模块不下载制品、不执行安装，也不把 Presentation 文本写回技术 Manifest。
 */
export {
  CatalogValidationError,
  DEFAULT_CATALOG_LIMITS,
  MARKET_INDEX_SCHEMA_VERSION,
  MARKET_INDEX_V2,
  type CatalogHostEvidenceContext,
  type CatalogLimitOptions,
  type MarketIndexDocument,
  type MarketPackRecord,
  type MarketPluginRecord,
  type ValidatedCatalog,
  type MarketPluginMetadata,
  type MarketCollection,
  type ReleaseRecord,
  type ReleaseProvenance,
  type ReleaseStatusRecord,
  type RecommendationRecord,
  type CatalogPublication,
} from './model.ts'
export { isCompletePackExecution, validateMarketIndex } from './validate.ts'
export {
  evidenceSupportsVerification,
  validatePublicEvidence,
  validatePublicManifest,
  validatePublicPack,
  validatePublicPackLock,
  type EvidenceSummary,
  type PublicPackLockComponent,
} from './public-format.ts'
export {
  CatalogSourceConfigurationError,
  CatalogSourceRegistry,
  type CatalogSourceConnection,
  type CatalogSourceIdentity,
  type CatalogSourceReadResult,
  type CatalogSourceRegistryOptions,
  type CatalogSourceTrust,
} from './source.ts'
export {
  CatalogRepository,
  type CatalogLoadResult,
  type CatalogRefreshResult,
  type CatalogSourceReader,
  type CatalogSourceRefreshInput,
} from './store.ts'
export { parseCollection, parseRelease, parseReleaseStatus, releaseIdFor } from './releases.ts'
export { buildCatalogDiscovery, filterCatalogDiscovery } from './discovery.ts'
export { validateBuildRecipe, validateAuthorSubmission, validateProductionCatalog, type BuildRecipe, type SubmissionValidation } from './submission.ts'
export { collectionPlanInput, collectionView, type CollectionPlanInput, type CatalogCollectionView } from './collections.ts'
export {
  AgentForgeSourceError,
  AgentForgeSourceCache,
  readAgentForgeSource,
  projectAgentForgeCatalog,
  type AgentForgeCatalog,
  type AgentForgeProjectionOptions,
  type AgentForgeRefreshResult,
  type AgentForgeSourceOptions,
} from './agent-forge.ts'
export {
  OfflinePackError,
  createOfflinePack,
  readOfflinePack,
  readOfflinePackFile,
  type OfflinePackContents,
  type OfflinePackBuildInput,
  type OfflinePackLimits,
} from './offline-pack.ts'
export {
  canCancelSelection,
  buildBundleSelectionGraph,
  buildAgentForgeBundleSelectionGraph,
  agentForgeBundleRecords,
  cancelSelection,
  indexSelectionGraph,
  selectionDependencies,
  selectionDependents,
  validateSelectionGraph,
  type CancellationSelectionContext,
  type AgentForgeBundleMemberInput,
  type AgentForgeBundleRecordInput,
  type AgentForgePackageRecord,
  type BuildSelectionGraphResult,
  type SelectionGraphIndex,
  type SelectionGraphValidation,
} from './bundle-selection.ts'
