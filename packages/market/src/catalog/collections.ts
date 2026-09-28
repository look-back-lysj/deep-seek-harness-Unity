/** 私有组合计划输入；绝不创建假 PackLock 或 npm source。 */
import type { MarketCollection } from './model.ts'
import { hash } from './input.ts'

export interface CollectionPlanInput {
  readonly kind: 'market-collection'
  readonly collectionId: string
  readonly collectionVersion: string
  readonly collectionDigest: string
  readonly documentBytes: Uint8Array
  readonly components: MarketCollection['components']
  readonly execution: MarketCollection['execution']
}

export interface CatalogCollectionView {
  readonly kind: 'market-collection'
  readonly id: string
  readonly version: string
  readonly name: string
  readonly summary: string
  readonly collectionDigest: string
  readonly components: MarketCollection['components']
  readonly execution: MarketCollection['execution']
}

/** 字段次序、可选字段和数组次序全部进入私有确认摘要，调用方拿到独立副本。 */
export function collectionPlanInput(collection: MarketCollection): CollectionPlanInput {
  const frozen = structuredClone(collection)
  const documentBytes = Buffer.from(JSON.stringify(frozen), 'utf8')
  return { kind: 'market-collection', collectionId: frozen.id, collectionVersion: frozen.version, collectionDigest: hash(documentBytes), documentBytes, components: frozen.components, execution: frozen.execution }
}

export function collectionView(collection: MarketCollection): CatalogCollectionView {
  const prepared = collectionPlanInput(collection)
  return { kind: 'market-collection', id: prepared.collectionId, version: prepared.collectionVersion, name: collection.name, summary: collection.summary, collectionDigest: prepared.collectionDigest, components: prepared.components, execution: prepared.execution }
}
