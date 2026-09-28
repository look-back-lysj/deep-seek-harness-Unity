/** One in-memory registry for both adapters. Metadata is copied and frozen;
 * lifecycle ownership is explicit, never inferred from an author's ID string.
 */
import { validVersion } from '../../core/semver.ts'
import { compatibleVersion } from './compatibility.ts'
import {
  EXTENSION_API_VERSION, EXTENSION_SLOTS,
  type ExtensionCapability, type ExtensionContribution, type ExtensionDefinition,
  type ExtensionOwnerScope, type ExtensionRegistration, type MarketExtensionHost,
  type MarketExtensionService, type RegisteredContribution,
} from './contract.ts'

export interface ExtensionIssue {
  readonly code: string
  readonly extensionId?: string | undefined
  readonly contributionKey?: string | undefined
}
export interface MarketExtensionOptions {
  readonly marketVersion: string
  readonly dshVersion: string
  readonly capabilities: readonly ExtensionCapability[]
  /** Codes only: arbitrary exception messages may contain private data. */
  readonly onIssue?: ((issue: Readonly<ExtensionIssue>) => unknown) | undefined
}
export interface MarketExtensionController extends MarketExtensionHost {
  readonly service: MarketExtensionService
  registerBuiltin(owner: ExtensionOwnerScope, definition: ExtensionDefinition): ExtensionRegistration
  dispose(): void
}
const CAPABILITIES = new Set(['browse', 'open-own-page', 'request-install-review', 'preview-draft-change'])
const SLOTS = new Set<string>(Object.values(EXTENSION_SLOTS))
const ID = /^[a-z0-9][a-z0-9._-]{0,95}$/
const EMPTY: readonly RegisteredContribution[] = Object.freeze([])
const lifetimes = new WeakMap<RegisteredContribution, AbortSignal>()
const reporters = new WeakMap<MarketExtensionHost, (issue: ExtensionIssue) => void>()
export const contributionSignal = (entry: RegisteredContribution): AbortSignal | undefined => lifetimes.get(entry)
export const reportExtensionIssue = (host: MarketExtensionHost, issue: ExtensionIssue): void => { reporters.get(host)?.(issue) }

function fields(value: object, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('extension/unknown-field')
}
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max }
function validate(def: ExtensionDefinition, options: MarketExtensionOptions): { contributions: readonly ExtensionContribution[]; capabilities: readonly ExtensionCapability[] } {
  if (!def || typeof def !== 'object') throw new Error('extension/invalid-definition')
  fields(def, ['id', 'version', 'apiVersion', 'marketRange', 'dshRange', 'requiredCapabilities', 'optionalCapabilities', 'contributions'])
  if (!text(def.id, 96) || !ID.test(def.id) || !text(def.version, 128) || !validVersion(def.version)) throw new Error('extension/invalid-identity')
  if (def.apiVersion !== EXTENSION_API_VERSION) throw new Error('extension/api-version')
  if (!compatibleVersion(options.marketVersion, def.marketRange)) throw new Error('extension/market-version')
  if (!compatibleVersion(options.dshVersion, def.dshRange)) throw new Error('extension/dsh-version')
  if (!Array.isArray(def.requiredCapabilities) || (def.optionalCapabilities !== undefined && !Array.isArray(def.optionalCapabilities))) throw new Error('extension/invalid-capabilities')
  if (def.requiredCapabilities.some((c) => !CAPABILITIES.has(c) || !options.capabilities.includes(c))) throw new Error('extension/missing-capability')
  const capabilities = Object.freeze([...new Set([...def.requiredCapabilities, ...(def.optionalCapabilities ?? [])])].filter((c) => CAPABILITIES.has(c) && options.capabilities.includes(c)))
  if (!Array.isArray(def.contributions) || def.contributions.length < 1 || def.contributions.length > 64) throw new Error('extension/invalid-contributions')
  const ids = new Set<string>()
  const contributions = def.contributions.map((c: ExtensionContribution): ExtensionContribution => {
    if (!c || typeof c !== 'object') throw new Error('extension/invalid-contribution')
    fields(c, ['id', 'slot', 'title', 'order', 'pageId', 'pluginIds', 'component'])
    if (!text(c.id, 96) || !ID.test(c.id) || ids.has(c.id)) throw new Error('extension/duplicate-or-invalid-contribution-id')
    ids.add(c.id)
    if (!SLOTS.has(c.slot) || !text(c.title, 160)) throw new Error('extension/invalid-slot')
    if (c.order !== undefined && (!Number.isInteger(c.order) || Math.abs(c.order) > 1000)) throw new Error('extension/invalid-order')
    if (c.slot === EXTENSION_SLOTS.more) {
      if (c.component !== undefined || !text(c.pageId, 96) || !ID.test(c.pageId)) throw new Error('extension/invalid-menu')
    } else if (typeof c.component !== 'function' || c.pageId !== undefined) throw new Error('extension/invalid-component')
    if ((c.slot === EXTENSION_SLOTS.more || c.slot === EXTENSION_SLOTS.page) && !capabilities.includes('open-own-page')) throw new Error('extension/missing-page-capability')
    if (c.pluginIds !== undefined && (c.slot !== EXTENSION_SLOTS.detail || !Array.isArray(c.pluginIds) || !c.pluginIds.length || c.pluginIds.length > 256 || c.pluginIds.some((id) => !text(id, 256)))) throw new Error('extension/invalid-plugin-filter')
    return Object.freeze({ id: c.id, slot: c.slot, title: c.title, order: c.order ?? 0,
      ...(c.pageId === undefined ? {} : { pageId: c.pageId }),
      ...(c.pluginIds === undefined ? {} : { pluginIds: Object.freeze([...new Set(c.pluginIds)]) }),
      ...(c.component === undefined ? {} : { component: c.component }),
    })
  })
  for (const c of contributions) if (c.slot === EXTENSION_SLOTS.more && !contributions.some((p) => p.slot === EXTENSION_SLOTS.page && p.id === c.pageId)) throw new Error('extension/missing-own-page')
  return { contributions: Object.freeze(contributions), capabilities }
}

export function createMarketExtensionHost(input: MarketExtensionOptions): MarketExtensionController {
  const options = { ...input, capabilities: [...input.capabilities] }
  if (!validVersion(options.marketVersion) || !validVersion(options.dshVersion)) throw new Error('extension/invalid-host-version')
  const groups = new Map<string, { entries: readonly RegisteredContribution[]; dispose: () => void }>()
  const listeners = new Set<() => void>()
  let snapshot = EMPTY; let stopped = false
  const report = (issue: ExtensionIssue): void => {
    try { void Promise.resolve(options.onIssue?.(Object.freeze({ ...issue }))).catch(() => {}) } catch { /* Diagnostics must not crash another extension. */ }
  }
  const publish = (): void => {
    snapshot = Object.freeze([...groups.values()].flatMap((g) => g.entries).sort((a, b) => (a.contribution.order ?? 0) - (b.contribution.order ?? 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)))
    for (const listener of [...listeners]) {
      try { void Promise.resolve(listener()).catch(() => report({ code: 'extension/subscriber-error' })) }
      catch { report({ code: 'extension/subscriber-error' }) }
    }
  }
  const register = (owner: ExtensionOwnerScope, definition: ExtensionDefinition, provider: RegisteredContribution['provider']): ExtensionRegistration => {
    if (stopped) return { status: 'rejected', reason: 'extension/host-disposed' }
    let validated: ReturnType<typeof validate>
    try {
      validated = validate(definition, options)
      if (!owner || typeof owner.effect !== 'function') throw new Error('extension/invalid-owner')
      if (groups.has(definition.id)) throw new Error('extension/duplicate-id')
    } catch (error) { return { status: 'rejected', reason: error instanceof Error && error.message.startsWith('extension/') ? error.message : 'extension/invalid-definition' } }
    const id = definition.id
    const lifetime = new AbortController()
    const entries = validated.contributions.map((contribution): RegisteredContribution => {
      const entry = Object.freeze({ extensionId: id, extensionVersion: definition.version, provider, key: `${id}:${contribution.id}`, contribution, capabilities: validated.capabilities })
      lifetimes.set(entry, lifetime.signal)
      return entry
    })
    let disposed = false; let releaseOwner: unknown
    const dispose = (): void => {
      if (disposed) return
      disposed = true
      lifetime.abort()
      if (groups.get(id)?.dispose === dispose) { groups.delete(id); publish() }
      if (typeof releaseOwner === 'function') {
        try { void Promise.resolve(releaseOwner()).catch(() => report({ code: 'extension/cleanup-error', extensionId: id })) }
        catch { report({ code: 'extension/cleanup-error', extensionId: id }) }
      }
    }
    // Reserve before invoking the owner so even a reentrant registration cannot steal this ID.
    groups.set(id, { entries, dispose })
    try {
      let installed = false
      releaseOwner = owner.effect(() => { installed = true; return dispose }, `market-extension:${id}`)
      if (!installed || disposed || stopped) throw new Error('inactive owner')
    } catch { dispose(); return { status: 'rejected', reason: 'extension/owner-unavailable' } }
    publish()
    return { status: 'registered', dispose }
  }
  const getSnapshot = (): readonly RegisteredContribution[] => snapshot
  const subscribe = (listener: () => void): (() => void) => {
    if (stopped) return () => {}
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  const service: MarketExtensionService = Object.freeze({ getSnapshot, subscribe, register: (owner: ExtensionOwnerScope, definition: ExtensionDefinition) => register(owner, definition, 'dsh-plugin') })
  const host: MarketExtensionController = {
    getSnapshot, subscribe, service,
    registerBuiltin: (owner, definition) => register(owner, definition, 'builtin'),
    dispose() {
      if (stopped) return
      stopped = true
      for (const group of [...groups.values()]) group.dispose()
      listeners.clear()
    },
  }
  reporters.set(host, report); reporters.set(service, report)
  return Object.freeze(host)
}
