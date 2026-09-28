/**
 * 市场私有的目录输入模型。
 *
 * 公共 Mojobox 对象只读；这里额外保存 Manifest/Lock 原字节，是为了计算原字节摘要。
 * 不能通过 JSON.parse + JSON.stringify 重新序列化后再算摘要，否则排版变化也会被误判成内容变化。
 */
import type {
  CatalogDelivery,
  CatalogListing,
  CatalogPack,
  CatalogPlugin,
  CatalogPresentation,
  CatalogRecommendation,
  CatalogSnapshot,
} from '../contracts/types.ts'

export const MARKET_INDEX_SCHEMA_VERSION = '1'
export const MARKET_INDEX_V2 = '2'

export interface RawDocumentRecord {
  readonly contentBase64: string
  readonly sha256: string
}

export interface MarketPluginRecord extends CatalogPlugin {
  /** 旧 v1 字段仍只读接受；v2 用判别联合，官方包不会被制造 Manifest。 */
  readonly manifestDigest?: string
  readonly manifest?: RawDocumentRecord
  readonly metadata?: MarketPluginMetadata
  readonly releaseId?: string
  readonly evidence?: readonly RawDocumentRecord[]
}

export type MarketPluginMetadata =
  | { readonly kind: 'dsh-std'; readonly manifest: RawDocumentRecord }
  | { readonly kind: 'official-bundle'; readonly packageJson: RawDocumentRecord; readonly files: readonly string[] }

export interface ReleaseAuthorization {
  readonly basis: 'license' | 'permission'
  readonly reference: string
  readonly redistribution: true
}

export interface ReleaseOrigin {
  readonly repositoryUrl: string
  readonly commit: string
  readonly license: string
  readonly authorization: ReleaseAuthorization
}

export type ReleaseProvenance = ReleaseOrigin & (
  | { readonly kind: 'author-release'; readonly releaseUrl: string }
  | { readonly kind: 'team-build'; readonly sourceSubdir: string; readonly lockDigest: string; readonly recipeDigest: string; readonly toolchain: readonly { readonly name: string; readonly version: string }[]; readonly target: { readonly os: string; readonly arch: string }; readonly buildRun: string; readonly derivedFrom?: string }
)

export interface ReleaseRecord {
  readonly schemaVersion: '1'
  readonly releaseId: string
  readonly pluginId: string
  readonly packageName: string
  readonly version: string
  readonly artifactDigest: string
  readonly metadataDigest: string
  readonly size: number
  readonly publishedAt?: string
  readonly provenance: ReleaseProvenance
}

export interface ReleaseStatusRecord {
  readonly releaseId: string
  readonly sequence: number
  readonly status: 'active' | 'withdrawn'
  readonly reason: string
  readonly effectiveAt: string
}

export interface CatalogPublication {
  readonly sourceId: string
  readonly sequence: number
}

export interface MarketCollection {
  readonly kind: 'MarketCollection'
  readonly schemaVersion: '1'
  readonly id: string
  readonly version: string
  readonly name: string
  readonly summary: string
  readonly components: readonly { readonly pluginId: string; readonly version: string; readonly releaseId: string; readonly artifactDigest: string; readonly required: boolean; readonly enabled: boolean }[]
  readonly execution: { readonly coverage: 'complete' | 'partial' | 'unknown'; readonly edges: readonly import('../contracts/types.ts').PackExecutionEdge[]; readonly provenance: string }
}

export interface RecommendationRecord extends CatalogRecommendation {
  readonly id: string
  readonly version: string
  readonly curator: string
  readonly effectiveAt: string
  readonly expiresAt?: string
  readonly withdrawn: boolean
}

export interface MarketPackRecord extends CatalogPack {
  readonly packDigest: string
  readonly pack: RawDocumentRecord
  readonly lock: RawDocumentRecord
}

export interface MarketIndexDocument {
  readonly schemaVersion: typeof MARKET_INDEX_SCHEMA_VERSION | typeof MARKET_INDEX_V2
  readonly revision: string
  readonly generatedAt: string
  readonly plugins: readonly MarketPluginRecord[]
  readonly listings?: readonly CatalogListing[] | undefined
  readonly packs: readonly MarketPackRecord[]
  readonly presentations: readonly CatalogPresentation[]
  readonly deliveries: readonly CatalogDelivery[]
  readonly recommendations?: readonly CatalogRecommendation[]
  readonly publication?: CatalogPublication
  readonly releases?: readonly ReleaseRecord[]
  readonly releaseStatuses?: readonly ReleaseStatusRecord[]
  readonly collections?: readonly MarketCollection[]
}

export interface ValidatedCatalog {
  readonly snapshot: CatalogSnapshot
  readonly manifestBytes: ReadonlyMap<string, Uint8Array>
  readonly packBytes: ReadonlyMap<string, Uint8Array>
  readonly lockBytes: ReadonlyMap<string, Uint8Array>
  readonly evidenceBytes: ReadonlyMap<string, readonly Uint8Array[]>
  readonly metadataBytes: ReadonlyMap<string, Uint8Array>
  readonly releases: readonly ReleaseRecord[]
  readonly releaseStatuses: readonly ReleaseStatusRecord[]
  readonly collections: readonly MarketCollection[]
  readonly publication?: CatalogPublication
}

export interface CatalogHostEvidenceContext {
  readonly id: string
  readonly dshVersion: string
  readonly runtime: string
}

export interface CatalogLimitOptions {
  readonly now?: Date
  readonly host?: CatalogHostEvidenceContext
  readonly maxDocumentBytes?: number
  readonly maxPlugins?: number
  readonly maxPacks?: number
  readonly maxPresentations?: number
  readonly maxDeliveries?: number
  readonly maxTextBytes?: number
}

export const DEFAULT_CATALOG_LIMITS = {
  maxDocumentBytes: 8 * 1024 * 1024,
  maxPlugins: 10_000,
  maxPacks: 2_000,
  maxPresentations: 10_000,
  maxDeliveries: 20_000,
  maxTextBytes: 512 * 1024,
} as const

export class CatalogValidationError extends Error {
  readonly code: string
  readonly details: readonly string[]

  constructor(code: string, message: string, details: readonly string[] = []) {
    super(message)
    this.name = 'CatalogValidationError'
    this.code = code
    this.details = details
  }
}
