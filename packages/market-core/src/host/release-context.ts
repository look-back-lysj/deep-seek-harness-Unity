import type { CatalogPlugin, HostCoreSnapshot, InventorySnapshot, ReleaseSelectionContext } from '../contracts/types.ts'
import { canonicalJson } from '../core/canonical.ts'
import { MarketCoreError } from '../core/errors.ts'
import { sourceRevisions, type ReleaseOptionsSource } from './release-options.ts'

export function releaseSelectionContext(plugin: CatalogPlugin, input: {
  readonly environmentId: string
  readonly hostCore: HostCoreSnapshot
  readonly catalogRevision: string
  readonly catalogStale: boolean
  readonly inventory: InventorySnapshot
  readonly sources: readonly ReleaseOptionsSource[]
}): ReleaseSelectionContext {
  const identity = {
    pluginId: plugin.id, packageName: plugin.packageName, version: plugin.version,
    ...(plugin.metadataDigest === undefined ? {} : { metadataDigest: plugin.metadataDigest }),
    ...(plugin.artifactDigest === undefined ? {} : { artifactDigest: plugin.artifactDigest }),
    ...(plugin.releaseId === undefined ? {} : { releaseId: plugin.releaseId }),
  }
  return {
    context: { environmentId: input.environmentId, hostRevision: input.hostCore.hostRevision,
      catalogRevision: input.catalogRevision, inventoryRevision: input.inventory.revision,
      checkedAt: new Date().toISOString(), catalogStale: input.catalogStale },
    identity, sources: sourceRevisions(identity, input.sources),
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

export function assertReleaseSelectionContext(value: ReleaseSelectionContext, expected: ReleaseSelectionContext): void {
  if (!object(value) || !keys(value, ['context', 'identity', 'sources'])
    || !object(value.context) || !keys(value.context, ['environmentId', 'hostRevision', 'catalogRevision', 'inventoryRevision', 'checkedAt', 'catalogStale'])
    || !(['environmentId', 'hostRevision', 'catalogRevision', 'inventoryRevision'] as const).every(key => typeof value.context[key] === 'string' && value.context[key].length > 0)
    || typeof value.context.catalogStale !== 'boolean' || typeof value.context.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.context.checkedAt))
    || !object(value.identity) || !keys(value.identity, ['pluginId', 'packageName', 'version', 'metadataDigest', 'artifactDigest', 'releaseId'])
    || !(['pluginId', 'packageName', 'version'] as const).every(key => typeof value.identity[key] === 'string')
    || !Array.isArray(value.sources) || value.sources.some(source => !object(source) || !keys(source, ['sourceId', 'revision'])
      || typeof source.sourceId !== 'string' || typeof source.revision !== 'string')) {
    throw new MarketCoreError('release-context/invalid', '版本选择上下文无效，请重新读取列表')
  }
  const binding = (selection: ReleaseSelectionContext): string => canonicalJson({
    ...selection, context: { ...selection.context, checkedAt: '' },
    sources: [...selection.sources].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
  })
  if (binding(value) !== binding(expected)) throw new MarketCoreError('release-context/stale', '版本列表、发行身份或可信来源已变化，请重新读取并预检')
}
