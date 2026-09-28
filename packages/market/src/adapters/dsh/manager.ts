/**
 * Thin official plugin-manager adapter. The market never edits profile YAML or
 * runs its own package manager; all write calls later delegate here.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  CapabilityName,
  InventoryItem,
  InventoryRow,
  InventorySnapshot,
} from '../../types.ts'

interface RemoteRecord {
  readonly [key: string]: unknown
}

export interface OfficialManager {
  listBundles(): Promise<unknown[]>
  listPlugins(): Promise<unknown[]>
  setBundleEnabled?(name: string, enabled: boolean): Promise<unknown>
  setPluginEnabled?(id: string, enabled: boolean): Promise<unknown>
  installBundle?(spec: string, options?: unknown): Promise<unknown>
  removeBundle?(name: string, options?: unknown): Promise<unknown>
  inspect?(spec: string, options?: unknown): Promise<unknown>
  cancelInstall?(requestId: string): Promise<unknown>
  waitForInstall?(requestId: string): Promise<unknown>
}

type FiberPhase = NonNullable<InventoryRow['fiberPhase']> | null
type LocalIdentity = 'file' | 'link' | 'fork' | 'registry' | 'unknown'

export interface InventorySourceEvidence {
  readonly packageName: string
  readonly kind: 'market-cache-file' | 'profile' | 'file' | 'link' | 'fork' | 'unknown'
  readonly proven?: boolean
  readonly digest?: string
}

type InventoryRowProjection = InventoryRow & {
  readonly rowId?: string
  readonly moduleName?: string
  readonly entryId?: string
}

type InventoryItemProjection = InventoryItem & {
  readonly localIdentity?: LocalIdentity
}

function record(value: unknown): RemoteRecord {
  return typeof value === 'object' && value !== null ? value as RemoteRecord : {}
}

function stringAt(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function booleanAt(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

function fiberAt(value: unknown): FiberPhase {
  return value === 'failed' || value === 'pending' || value === 'active' || value === 'loading' || value === 'unloading'
    ? value
    : null
}

function capability(name: CapabilityName, available: boolean, result: CapabilityName[]): void {
  if (available) result.push(name)
}

function rowState(enabled: boolean, fiberPhase: FiberPhase, error?: string): InventoryRow['state'] {
  if (error !== undefined || fiberPhase === 'failed') return 'load-error'
  if (fiberPhase === 'active') return enabled ? 'enabled' : 'disabled'
  if (fiberPhase === 'pending' || fiberPhase === 'loading' || fiberPhase === 'unloading' || fiberPhase === null) return 'unknown'
  return enabled ? 'enabled' : 'disabled'
}

function sourceFor(
  item: RemoteRecord,
  evidence: readonly InventorySourceEvidence[],
): { source: InventoryItem['source']; localIdentity: LocalIdentity } {
  if (!booleanAt(item.installed)) return { source: 'installation', localIdentity: 'registry' }
  const name = stringAt(item.name)
  const proven = evidence.find((candidate) => candidate.packageName === name && candidate.proven === true)
  if (proven?.kind === 'market-cache-file') return { source: 'market-cache-file', localIdentity: 'file' }
  if (proven?.kind === 'profile') return { source: 'profile', localIdentity: 'registry' }
  // No proof means no permission to overwrite a user file/link/fork package.
  return { source: 'unknown', localIdentity: proven?.kind === 'file' || proven?.kind === 'link' || proven?.kind === 'fork'
    ? proven.kind
    : 'unknown' }
}

/** Read-only capabilities and inventory projection of the official manager. */
export class DshManagerAdapter {
  constructor(
    private readonly ctx: Context,
    private readonly environmentId = 'current',
    private readonly sourceEvidence: readonly InventorySourceEvidence[] = [],
  ) {}

  private get manager(): OfficialManager | undefined {
    return this.ctx.get('pluginManager') as OfficialManager | undefined
  }

  capabilities(): readonly CapabilityName[] {
    const manager = this.manager
    const result: CapabilityName[] = []
    capability('browse', manager !== undefined, result)
    capability('install', typeof manager?.installBundle === 'function', result)
    capability('enable', typeof manager?.setBundleEnabled === 'function', result)
    capability('disable', typeof manager?.setBundleEnabled === 'function', result)
    capability('remove', typeof manager?.removeBundle === 'function', result)
    capability('restart-handoff', true, result)
    return result
  }

  async inventory(environmentId = this.environmentId): Promise<InventorySnapshot> {
    const manager = this.manager
    if (manager === undefined) {
      return { environmentId, revision: 'unavailable', items: [], unknownItems: ['pluginManager:unavailable'] }
    }

    let bundleValue: unknown[] = []
    let pluginValue: unknown[] = []
    const unknownItems: string[] = []
    try {
      bundleValue = await manager.listBundles()
    } catch (error) {
      unknownItems.push(`listBundles:${error instanceof Error ? error.message : 'unknown-error'}`)
    }
    try {
      pluginValue = await manager.listPlugins()
    } catch (error) {
      unknownItems.push(`listPlugins:${error instanceof Error ? error.message : 'unknown-error'}`)
    }

    const pluginsByEntry = new Map<string, RemoteRecord>()
    const standalone: RemoteRecord[] = []
    for (const raw of pluginValue) {
      const item = record(raw)
      const entryId = stringAt(item.entryId)
      if (entryId === undefined) {
        unknownItems.push(`plugin-entry:${stringAt(item.moduleName) ?? 'unknown'}`)
        continue
      }
      pluginsByEntry.set(entryId, item)
      standalone.push(item)
    }

    const usedEntries = new Set<string>()
    const items: InventoryItemProjection[] = []
    for (const raw of bundleValue) {
      const item = record(raw)
      const name = stringAt(item.name)
      if (name === undefined) {
        unknownItems.push('bundle-entry:missing-name')
        continue
      }
      const rows: InventoryRowProjection[] = []
      const rawRows = Array.isArray(item.rows) ? item.rows : []
      for (const rawRow of rawRows) {
        const rowRecord = record(rawRow)
        const rowId = stringAt(rowRecord.rowId) ?? stringAt(rowRecord.id) ?? stringAt(rowRecord.moduleName) ?? name
        const moduleName = stringAt(rowRecord.moduleName) ?? stringAt(rowRecord.name) ?? rowId
        const entryId = stringAt(rowRecord.entryId)
        const plugin = entryId === undefined ? undefined : pluginsByEntry.get(entryId)
        if (entryId !== undefined && plugin !== undefined) usedEntries.add(entryId)
        const error = plugin === undefined ? undefined : stringAt(record(plugin.meta).error)
        const fiberPhase = plugin === undefined ? null : fiberAt(plugin.fiberPhase)
        const row: InventoryRowProjection = {
          id: rowId,
          name: moduleName,
          state: entryId === undefined ? 'unknown' : rowState(booleanAt(plugin?.enabled), fiberPhase, error),
          rowId,
          moduleName,
          ...(entryId === undefined ? {} : { entryId }),
          fiberPhase,
          ...(error === undefined ? {} : { error }),
        }
        rows.push(row)
      }
      const source = sourceFor(item, this.sourceEvidence)
      const hasUnknownRuntimeRow = rows.some((row) => row.state === 'unknown')
      const managementError = stringAt(record(item.error).code)
      const declaredReadOnly = stringAt(item.readOnlyReason)
      const readOnlyReason = declaredReadOnly === 'management-required' || declaredReadOnly === 'unaddressable'
        ? declaredReadOnly
        : managementError === 'management-required' || managementError === 'unaddressable'
          ? managementError
          : undefined
      const version = stringAt(item.version)
      items.push({
        packageName: name,
        ...(version === undefined ? {} : { version }),
        source: source.source,
        installed: booleanAt(item.installed),
        bundleEnabled: booleanAt(item.enabled),
        removable: booleanAt(item.removable),
        ...(readOnlyReason === 'management-required' || readOnlyReason === 'unaddressable' ? { readOnlyReason } : {}),
        rows,
        restartRequired: booleanAt(item.enabled) && hasUnknownRuntimeRow,
        provenance: source.source === 'market-cache-file' || source.source === 'profile' || source.source === 'installation' ? source.source : 'unknown',
        localIdentity: source.localIdentity,
      })
    }

    for (const plugin of standalone) {
      const entryId = stringAt(plugin.entryId)
      if (entryId === undefined || usedEntries.has(entryId)) continue
      const moduleName = stringAt(plugin.moduleName)
      if (moduleName === undefined) {
        unknownItems.push(`plugin-entry:${entryId}`)
        continue
      }
      const error = stringAt(record(plugin.meta).error)
      const fiberPhase = fiberAt(plugin.fiberPhase)
      const row: InventoryRowProjection = {
        id: entryId,
        name: moduleName,
        state: rowState(booleanAt(plugin.enabled), fiberPhase, error),
        rowId: entryId,
        moduleName,
        entryId,
        fiberPhase,
        ...(error === undefined ? {} : { error }),
      }
      items.push({
        pluginId: entryId,
        packageName: moduleName,
        source: 'unknown',
        installed: true,
        bundleEnabled: booleanAt(plugin.enabled),
        removable: false,
        readOnlyReason: 'unaddressable',
        rows: [row],
        restartRequired: false,
        provenance: 'unknown',
        entryId,
        moduleName,
        localIdentity: 'unknown',
      })
    }

    return {
      environmentId,
      revision: `inventory-${items.length}-${rowsCount(items)}-${unknownItems.length}`,
      items,
      unknownItems,
    }
  }
}

function rowsCount(items: readonly InventoryItemProjection[]): number {
  return items.reduce((total, item) => total + item.rows.length, 0)
}
