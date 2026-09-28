/**
 * 市场私有的目录输入模型。
 *
 * 公共 Mojobox 对象只读；这里额外保存 Manifest/Lock 原字节，是为了计算原字节摘要。
 * 不能通过 JSON.parse + JSON.stringify 重新序列化后再算摘要，否则排版变化也会被误判成内容变化。
 */
import type {
  CatalogDelivery,
  CatalogPack,
  CatalogPlugin,
  CatalogPresentation,
  CatalogSnapshot,
} from '../contracts/types.ts'

export const MARKET_INDEX_SCHEMA_VERSION = '1'

export interface RawDocumentRecord {
  readonly contentBase64: string
  readonly sha256: string
}

export interface MarketPluginRecord extends CatalogPlugin {
  readonly manifestDigest: string
  readonly manifest: RawDocumentRecord
  readonly evidence?: readonly RawDocumentRecord[]
}

export interface MarketPackRecord extends CatalogPack {
  readonly packDigest: string
  readonly pack: RawDocumentRecord
  readonly lock: RawDocumentRecord
}

export interface MarketIndexDocument {
  readonly schemaVersion: typeof MARKET_INDEX_SCHEMA_VERSION
  readonly revision: string
  readonly generatedAt: string
  readonly plugins: readonly MarketPluginRecord[]
  readonly packs: readonly MarketPackRecord[]
  readonly presentations: readonly CatalogPresentation[]
  readonly deliveries: readonly CatalogDelivery[]
}

export interface ValidatedCatalog {
  readonly snapshot: CatalogSnapshot
  readonly manifestBytes: ReadonlyMap<string, Uint8Array>
  readonly packBytes: ReadonlyMap<string, Uint8Array>
  readonly lockBytes: ReadonlyMap<string, Uint8Array>
  readonly evidenceBytes: ReadonlyMap<string, readonly Uint8Array[]>
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
