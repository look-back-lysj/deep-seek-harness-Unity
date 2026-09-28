/** Official 0.1.7-rc.2 adapter: runtime declaration != TypeScript SlotMap merge.
 * Only the market's existing main entry declares these children; we never claim root/main.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ChildrenDecl, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { EXTENSION_SERVICE, EXTENSION_SLOTS, type ExtensionSlot, type ExtensionSlotOwner, type RegisteredContribution } from './contract.ts'
import { type MarketExtensionController, reportExtensionIssue } from './registry.ts'
import { ExtensionEntry, type ExtensionSurfaceProps } from './surface.tsx'

export const EXTENSION_CHILDREN = Object.freeze({
  [EXTENSION_SLOTS.home]: Object.freeze({ kind: 'list', scope: 'root' }),
  [EXTENSION_SLOTS.more]: Object.freeze({ kind: 'list', scope: 'root' }),
  [EXTENSION_SLOTS.page]: Object.freeze({ kind: 'keyed', scope: 'root' }),
  [EXTENSION_SLOTS.detail]: Object.freeze({ kind: 'list', scope: 'root' }),
  [EXTENSION_SLOTS.author]: Object.freeze({ kind: 'list', scope: 'root' }),
} as const satisfies ChildrenDecl)

/** Mirror only accepted registry records. Each inject waits for a real parent
 * declaration and re-registers after that declaration is torn down/recreated.
 */
export function attachDshSlots(ctx: Context, host: MarketExtensionController): () => void {
  const projections = new Map<RegisteredContribution, { dispose: () => void; rank: number }>()
  let stopped = false
  const issue = (entry: RegisteredContribution, code: string): void => reportExtensionIssue(host, { code, extensionId: entry.extensionId, contributionKey: entry.key })
  const cleanup = (entry: RegisteredContribution, dispose: () => void): void => {
    try { void Promise.resolve(dispose()).catch(() => issue(entry, 'extension/slot-cleanup-error')) } catch { issue(entry, 'extension/slot-cleanup-error') }
  }
  const reconcile = (): void => {
    if (stopped) return
    const entries = host.getSnapshot()
    for (const [entry, projection] of projections) if (entries.indexOf(entry) !== projection.rank) { projections.delete(entry); cleanup(entry, projection.dispose) }
    for (const [rank, entry] of entries.entries()) {
      if (projections.has(entry)) continue
      try {
        const dispose = ctx.slots.inject(entry.contribution.slot, () => {
          if (stopped || !host.getSnapshot().includes(entry)) return () => {}
          try {
            const View = (props: ExtensionSlotOwner): ReactNode => <ExtensionEntry host={host} entry={entry} context={props.context} />
            // Fixed priority, private namespaced keys. Authors cannot shadow any cell.
            if (entry.contribution.slot === EXTENSION_SLOTS.page) return ctx.slots.register({ name: EXTENSION_SLOTS.page, key: entry.key, priority: 0, inject: () => ({}) }, View)
            return ctx.slots.register({ name: entry.contribution.slot, id: entry.key, order: rank, priority: 0, inject: () => ({}) }, View)
          } catch {
            // slots.inject otherwise rethrows a delayed failure in a microtask.
            issue(entry, 'extension/slot-registration-error')
            return () => {}
          }
        })
        projections.set(entry, { dispose, rank })
      } catch { issue(entry, 'extension/slot-injection-error') }
    }
  }
  const unsubscribe = host.subscribe(reconcile)
  reconcile()
  return () => {
    if (stopped) return
    stopped = true; unsubscribe()
    for (const [entry, projection] of projections) cleanup(entry, projection.dispose)
    projections.clear()
  }
}

/** Owns host disposal and the restricted service publication. Call once from
 * the market client fiber after its required `slots` service is available.
 */
export function attachDshService(ctx: Context, host: MarketExtensionController): () => Promise<void> {
  return ctx.effect(() => {
    const detachSlots = attachDshSlots(ctx, host)
    let unprovide: (() => unknown) | undefined
    try { unprovide = ctx.reflect.provide(EXTENSION_SERVICE, host.service) }
    catch (error) { detachSlots(); host.dispose(); throw error }
    let task: Promise<void> | undefined
    return () => {
      if (task) return task
      host.dispose(); detachSlots()
      return task = Promise.resolve(unprovide!()).then(() => undefined)
    }
  }, 'eac-market: extensions')
}

export type MarketExtensionSlotRenderer = PropsRenderSlots<ExtensionSlot>['renderSlot']
function DshExtensionSurface({ renderSlot, ...props }: ExtensionSurfaceProps & { readonly renderSlot: MarketExtensionSlotRenderer }): ReactNode {
  const snapshot = useSyncExternalStore(props.host.subscribe, props.host.getSnapshot, props.host.getSnapshot)
  if (props.slot === EXTENSION_SLOTS.page && !snapshot.some((entry) => entry.contribution.slot === props.slot && entry.key === props.pageId)) return <p role="status">此扩展页面已停用或不可用。请返回发现。</p>
  return renderSlot(props.slot, { context: props.context }, props.slot === EXTENSION_SLOTS.page && props.pageId !== undefined ? { entryKey: props.pageId } : undefined)
}

/** Pass the real renderSlot received by the main-slot component, not ctx.slots.renderSlot
 * (that public service method only renders root). Compatible with C's existing seam.
 */
export function createDshExtensionRenderer(renderSlot: MarketExtensionSlotRenderer): (props: ExtensionSurfaceProps) => ReactNode {
  return (props) => <DshExtensionSurface {...props} renderSlot={renderSlot} />
}
