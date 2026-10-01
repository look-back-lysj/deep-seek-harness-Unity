/** Delivery 模块入口：URL安全、本地tgz核验、同摘要缓存与引用保护。 */
export {
  DeliverySecurityError,
  assertSafeRemoteUrl,
  isPrivateAddress,
  safeFetch,
  type RemoteSecurityOptions,
  type SafeFetchOptions,
} from './security.ts'
export {
  DEFAULT_TGZ_LIMITS,
  TgzVerificationError,
  verifyTgzFile,
  type ExpectedTgzIdentity,
  type TgzLimits,
  type VerifiedTgz,
} from './tgz.ts'
export {
  ArtifactCache,
  DeliveryError,
  publicArtifactView,
  type AcquiredArtifact,
  type ArtifactCacheOptions,
  type CacheReference,
  type CacheReferenceKind,
  type DeliveryAttempt,
  type DownloadArtifactOptions,
} from './cache.ts'
export {
  OfflineArtifactError,
  describeOfflineArtifact,
  materializeOfflineArtifacts,
  type MaterializedOfflineArtifact,
} from './offline-pack.ts'
