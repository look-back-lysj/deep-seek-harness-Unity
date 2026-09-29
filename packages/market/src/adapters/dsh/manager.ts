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
  listBundles?(): Promise<unknown[]>
  listPlugins?(): Promise<unknown[]>
  setBundleEnabled?(name: string, enabled: boolean): Promise<unknown>
  setPluginEnabled?(id: string, enabled: boolean): Promise<unknown>
  installBundle?(spec: string, options?: unknown): Promise<unknown>
  removeBundle?(name: string): Promise<unknown>
  inspect?(spec: string, options?: unknown): Promise<unknown>
  cancelInstall?(requestId: string): Promise<unknown>
  waitForInstall?(requestId: string): Promise<unknown>
}

type FiberPhase = NonNullable<InventoryRow['fiberPhase']> | null
type LocalIdentity = 'file' | 'link' | 'fork' | 'registry' | 'unknown'

export interface InventorySourceEvidence {
  readonly packageName: string
  readonly kind: 'market-cache-file' | 'profile' | 'file' | 'link' | 'fork' | 'unknown'
  /** Produced only after durable receipt, dependency reference and bytes agree. */
  readonly receiptId?: string
  readonly version?: string
  readonly digest?: string
  readonly dependencyRef?: string
  readonly cacheRef?: string
  readonly restartRequired?: boolean
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

function errorAt(value: unknown): string | undefined {
  const text = stringAt(value)
  return text === undefined ? undefined : redactText(text.replaceAll(/[\r\n]+/g, ' | '))
}

function redactText(value: string, limit = 500): string {
  const redacted = value
    .replace(/(https?:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, '$1***@')
    .replace(/((?:bearer|basic)\s+)[A-Za-z0-9._+/=-]+/gi, '$1<redacted>')
    .replace(/((?:["']?)(?:token|password|secret|api[_-]?key|authorization)(?:["']?)\s*[:=]\s*["']?)[^"'\s,;}&]+/gi, '$1<redacted>')
    .replace(/([A-Za-z]:[\\/]|\\\\)[^\s"']+/g, '<path>')
  return redacted.length > limit ? redacted.slice(0, limit) + '…' : redacted
}

function booleanAt(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

function optionalBooleanAt(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function fiberAt(value: unknown): FiberPhase | 'unknown' {
  return value === 'failed' || value === 'pending' || value === 'active' || value === 'loading' || value === 'unloading'
    ? value
    : value === null
      ? null
      : 'unknown'
}

function capability(name: CapabilityName, available: boolean, result: CapabilityName[]): void {
  if (available) result.push(name)
}

function rowState(enabled: boolean | undefined, fiberPhase: FiberPhase | 'unknown', error?: string): InventoryRow['state'] {
  if (error !== undefined || fiberPhase === 'failed') return 'load-error'
  if (enabled === undefined || fiberPhase === 'pending' || fiberPhase === 'loading' || fiberPhase === 'unloading' || fiberPhase === null || fiberPhase === 'unknown') return 'unknown'
  return fiberPhase === 'active' ? (enabled ? 'enabled' : 'disabled') : enabled ? 'enabled' : 'disabled'
}

function unavailable(name: string, result: string[]): void {
  result.push(`${name}:unavailable`)
}

function methodError(name: string, error: unknown, result: string[]): void {
  const detail = error instanceof Error ? error.message : 'unknown-error'
  result.push(`${name}:${redactText(detail.replaceAll(/[\r\n]+/g, ' '), 300)}`)
}

function sourceFor(
  item: RemoteRecord,
  evidence: readonly InventorySourceEvidence[],
): { source: InventoryItem['source']; localIdentity: LocalIdentity } {
  if (!booleanAt(item.installed)) return { source: 'installation', localIdentity: 'registry' }
  const name = stringAt(item.name)
  const proven = evidence.find((candidate) => candidate.packageName === name && candidate.version === stringAt(item.version))
  if (proven?.kind === 'market-cache-file' && proven.receiptId && proven.digest && proven.dependencyRef && proven.cacheRef) return { source: 'market-cache-file', localIdentity: 'file' }
  // Registry ownership is not inferred merely from an unverified name.
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
    private readonly sourceEvidence: readonly InventorySourceEvidence[] | (() => Promise<readonly InventorySourceEvidence[]>) = [],
  ) {}

  private get manager(): OfficialManager | undefined {
    return this.ctx.get('pluginManager') as OfficialManager | undefined
  }

  capabilities(): readonly CapabilityName[] {
    const manager = this.manager
    const result: CapabilityName[] = []
    capability('browse', typeof manager?.listBundles === 'function' && typeof manager?.listPlugins === 'function', result)
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
    if (typeof manager.listBundles !== 'function') unavailable('listBundles', unknownItems)
    else {
      try {
        bundleValue = await manager.listBundles()
      } catch (error) {
        methodError('listBundles', error, unknownItems)
      }
    }
    if (typeof manager.listPlugins !== 'function') unavailable('listPlugins', unknownItems)
    else {
      try {
        pluginValue = await manager.listPlugins()
      } catch (error) {
        methodError('listPlugins', error, unknownItems)
      }
    }

    if (!Array.isArray(bundleValue)) { unknownItems.push(`listBundles:invalid:${typeof bundleValue}`); bundleValue = [] }
    if (!Array.isArray(pluginValue)) { unknownItems.push(`listPlugins:invalid:${typeof pluginValue}`); pluginValue = [] }
    let evidence: readonly InventorySourceEvidence[] = []
    try { evidence = typeof this.sourceEvidence === 'function' ? await this.sourceEvidence() : this.sourceEvidence }
    catch (error) { methodError('source-evidence', error, unknownItems) }
    const pluginsByEntry = new Map<string, RemoteRecord>()
    const standalone: RemoteRecord[] = []
    for (const raw of pluginValue) {
      const item = record(raw)
      const entryId = stringAt(item.entryId)
      if (entryId === undefined) {
        unknownItems.push(`plugin-entry:${stringAt(item.moduleName) ?? 'unknown'}:missing-entry-id`)
        continue
      }
      if (pluginsByEntry.has(entryId)) {
        unknownItems.push(`plugin-entry:duplicate:${entryId}`)
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
      const installed = optionalBooleanAt(item.installed)
      const enabled = optionalBooleanAt(item.enabled)
      const removable = optionalBooleanAt(item.removable)
      if (installed === undefined || enabled === undefined || removable === undefined) {
        unknownItems.push(`bundle:${name}:invalid-installed-enabled-removable`)
        continue
      }
      const rows: InventoryRowProjection[] = []
      const rawRowsValue = item.rows
      if (!Array.isArray(rawRowsValue)) unknownItems.push(`bundle:${name}:invalid-rows`)
      for (const rawRow of Array.isArray(rawRowsValue) ? rawRowsValue : []) {
        const rowRecord = record(rawRow)
        const rowId = stringAt(rowRecord.rowId) ?? stringAt(rowRecord.id)
        const moduleName = stringAt(rowRecord.moduleName) ?? stringAt(rowRecord.name)
        if (rowId === undefined || moduleName === undefined) {
          unknownItems.push(`bundle:${name}:invalid-row-identity`)
          continue
        }
        const entryId = stringAt(rowRecord.entryId)
        if ('entryId' in rowRecord && entryId === undefined) unknownItems.push(`bundle:${name}:invalid-row-entry-id:${rowId}`)
        const plugin = entryId === undefined ? undefined : pluginsByEntry.get(entryId)
        if (entryId !== undefined && plugin !== undefined) usedEntries.add(entryId)
        const error = plugin === undefined ? undefined : errorAt(record(plugin.meta).error)
        const fiberPhase = plugin === undefined ? null : fiberAt(plugin.fiberPhase)
        const pluginEnabled = plugin === undefined ? undefined : optionalBooleanAt(plugin.enabled)
        if (plugin !== undefined && pluginEnabled === undefined) unknownItems.push(`plugin-entry:${entryId}:invalid-enabled`)
        const row: InventoryRowProjection = {
          id: rowId,
          name: moduleName,
          state: entryId === undefined || plugin === undefined ? (enabled ? 'unknown' : 'disabled') : rowState(pluginEnabled, fiberPhase, error),
          rowId,
          moduleName,
          ...(entryId === undefined ? {} : { entryId }),
          fiberPhase,
          ...(error === undefined ? {} : { error }),
        }
        rows.push(row)
      }
      const source = sourceFor(item, evidence)
      const restartRequired = evidence.some(proof => proof.packageName === name && proof.version === stringAt(item.version) && proof.restartRequired === true)
      const managementError = stringAt(record(item.error).code)
      const declaredReadOnly = stringAt(item.readOnlyReason)
      const hasManagementError = item.error !== undefined
      const readOnlyReason = declaredReadOnly === 'management-required' || declaredReadOnly === 'unaddressable'
        ? declaredReadOnly
        : managementError === 'management-required' || managementError === 'unaddressable'
          ? managementError
          : declaredReadOnly !== undefined || hasManagementError
            ? 'unknown'
            : undefined
      if (item.error !== undefined && managementError === undefined) unknownItems.push(`bundle:${name}:invalid-management-error`)
      if (item.overrides !== undefined && !Array.isArray(item.overrides)) unknownItems.push(`bundle:${name}:invalid-overrides`)
      const version = stringAt(item.version)
      if (booleanAt(item.installed) && version === undefined) unknownItems.push('bundle-version:' + name)
      items.push({
        packageName: name,
        ...(version === undefined ? {} : { version }),
        ...(source.source === 'market-cache-file' ? { artifactDigest: evidence.find(proof => proof.packageName === name && proof.version === version)?.digest } : {}),
        source: source.source,
        installed,
        bundleEnabled: enabled,
        removable,
        ...(readOnlyReason === undefined ? {} : { readOnlyReason }),
        rows,
        restartRequired,
        provenance: source.source === 'market-cache-file' || source.source === 'profile' || source.source === 'installation' ? source.source : 'unknown',
        localIdentity: source.localIdentity,
      })
    }

    for (const plugin of standalone) {
      const entryId = stringAt(plugin.entryId)
      if (entryId === undefined || usedEntries.has(entryId)) continue
      const moduleName = stringAt(plugin.moduleName)
      const enabled = optionalBooleanAt(plugin.enabled)
      if (moduleName === undefined || enabled === undefined) {
        unknownItems.push(`plugin-entry:${entryId}:invalid-module-name-or-enabled`)
        continue
      }
      const error = errorAt(record(plugin.meta).error)
      const fiberPhase = fiberAt(plugin.fiberPhase)
      const row: InventoryRowProjection = {
        id: entryId,
        name: moduleName,
        state: rowState(enabled, fiberPhase, error),
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
        bundleEnabled: enabled,
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
