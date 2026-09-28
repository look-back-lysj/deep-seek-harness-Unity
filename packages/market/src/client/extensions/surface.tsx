import { Component, createContext, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { EXTENSION_SLOTS, type ExtensionContext, type ExtensionSlot, type MarketExtensionHost, type RegisteredContribution } from './contract.ts'
import { createContributionContext } from './context.ts'
import { createManagedExtensionRuntime, type ManagedExtensionRuntime } from './managed.ts'
import { contributionSignal, reportExtensionIssue } from './registry.ts'

export interface ExtensionSurfaceProps {
  readonly host: MarketExtensionHost
  readonly slot: ExtensionSlot
  readonly context: Readonly<ExtensionContext>
  /** The full registry key, never a naked author-supplied route. */
  readonly pageId?: string | undefined
}
const RuntimeContext = createContext<ManagedExtensionRuntime | undefined>(undefined)
/** Wrap extension-owned event/Promise/effect work with this cooperative supervisor. */
export function useExtensionRuntime(): ManagedExtensionRuntime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('extension/runtime-not-mounted')
  return runtime
}
const fallback = <p role="status">此扩展暂时不可用。可停用后重新启用，市场其他功能仍可使用。</p>

class ContributionBoundary extends Component<{ readonly host: MarketExtensionHost; readonly entry: RegisteredContribution; readonly children: ReactNode }, { failed: boolean; entry: RegisteredContribution }> {
  override state = { failed: false, entry: this.props.entry }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  static getDerivedStateFromProps(props: { entry: RegisteredContribution }, state: { entry: RegisteredContribution }): { failed: boolean; entry: RegisteredContribution } | null { return props.entry === state.entry ? null : { failed: false, entry: props.entry } }
  override componentDidCatch(): void { reportExtensionIssue(this.props.host, { code: 'extension/render-error', extensionId: this.props.entry.extensionId, contributionKey: this.props.entry.key }) }
  override render(): ReactNode { return this.state.failed ? fallback : this.props.children }
}

function ContributionBody({ host, entry, context }: { readonly host: MarketExtensionHost; readonly entry: RegisteredContribution; readonly context: Readonly<ExtensionContext> }): ReactNode {
  const latest = useRef(context); latest.current = context
  // Pure construction avoids leaked listeners from discarded React renders.
  const runtime = useMemo(() => createManagedExtensionRuntime({ deferSignals: true, signals: [context.signal, ...(contributionSignal(entry) ? [contributionSignal(entry)!] : [])], onIssue: (code) => reportExtensionIssue(host, { code, extensionId: entry.extensionId, contributionKey: entry.key }) }), [host, entry, context.signal])
  useLayoutEffect(() => runtime.retain(), [runtime])
  const error = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const projected = createContributionContext(host, entry, () => latest.current, runtime)
  if (error) return fallback
  if (entry.contribution.slot === EXTENSION_SLOTS.more) return <button type="button" role="menuitem" onClick={() => projected.openOwnPage(entry.contribution.pageId!)}>{entry.contribution.title}<small> · {entry.extensionId}（自报）</small></button>
  const Content = entry.contribution.component!
  return <RuntimeContext.Provider value={runtime}><Content context={projected} /></RuntimeContext.Provider>
}

/** This wrapper alone enters official slots. Framework-injected props are discarded. */
export function ExtensionEntry({ host, entry, context }: { readonly host: MarketExtensionHost; readonly entry: RegisteredContribution; readonly context: Readonly<ExtensionContext> }): ReactNode {
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot)
  if (!snapshot.includes(entry) || context.signal.aborted) return null
  const c = entry.contribution
  if (c.slot === EXTENSION_SLOTS.detail && (!context.plugin || (c.pluginIds && !c.pluginIds.includes(context.plugin.id)))) return null
  const body = <ContributionBoundary key={entry.key} host={host} entry={entry}><ContributionBody host={host} entry={entry} context={context} /></ContributionBoundary>
  if (c.slot === EXTENSION_SLOTS.more) return body
  return <section className="eac-market-extension" data-market-extension={entry.key} aria-label={c.title} style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
    <h2>{c.title}</h2><p><small>提供方：{entry.extensionId} · {entry.extensionVersion}（{entry.provider === 'builtin' ? '内置模块' : '独立插件'}，身份由扩展自报）</small></p>{body}
  </section>
}

export function ExtensionSurface(props: ExtensionSurfaceProps): ReactNode {
  const snapshot = useSyncExternalStore(props.host.subscribe, props.host.getSnapshot, props.host.getSnapshot)
  const entries = snapshot.filter((entry) => entry.contribution.slot === props.slot && (props.slot !== EXTENSION_SLOTS.page || entry.key === props.pageId))
  if (!entries.length && props.slot === EXTENSION_SLOTS.page) return <p role="status">此扩展页面已停用或不可用。请返回发现。</p>
  return <>{entries.map((entry) => <ExtensionEntry key={entry.key} host={props.host} entry={entry} context={props.context} />)}</>
}
/** Exact function shape already accepted by C's MarketPage. */
export function renderExtensionSurface(props: ExtensionSurfaceProps): ReactNode { return <ExtensionSurface {...props} /> }
