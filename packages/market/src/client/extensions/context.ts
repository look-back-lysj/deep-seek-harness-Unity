import { EXTENSION_SLOTS, type ExtensionContext, type ExtensionDraftChange, type ExtensionInstallReviewRequest, type MarketExtensionHost, type RegisteredContribution } from './contract.ts'
import type { ManagedExtensionRuntime } from './managed.ts'

const isText = (value: unknown, max = 512): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max
function only(value: object, keys: readonly string[]): void {
  if (!value || typeof value !== 'object' || Object.keys(value).some((key) => !keys.includes(key))) throw new Error('extension/invalid-request')
}

/** Pick fields explicitly. Even a wider runtime object supplied by the host
 * never forwards its Remote, Context, task methods or arbitrary extra fields.
 */
export function createContributionContext(host: MarketExtensionHost, entry: RegisteredContribution, source: () => Readonly<ExtensionContext>, runtime: ManagedExtensionRuntime): Readonly<ExtensionContext> {
  const initial = source()
  const capabilities = Object.freeze(entry.capabilities.filter((c) => initial.capabilities.includes(c)))
  const allowed = (capability: typeof capabilities[number]): Readonly<ExtensionContext> => {
    const current = source()
    if (runtime.signal.aborted || current.signal.aborted || !host.getSnapshot().includes(entry)) throw new Error('extension/stale-context')
    if (!capabilities.includes(capability) || !current.capabilities.includes(capability)) throw new Error('extension/capability-denied')
    return current
  }
  return Object.freeze({
    marketVersion: initial.marketVersion, dshVersion: initial.dshVersion, environmentId: initial.environmentId,
    capabilities, signal: runtime.signal,
    ...(initial.plugin === undefined || !capabilities.includes('browse') ? {} : { plugin: Object.freeze({ id: initial.plugin.id, name: initial.plugin.name, packageName: initial.plugin.packageName, version: initial.plugin.version, artifactDigest: initial.plugin.artifactDigest }) }),
    ...(initial.draft === undefined || !capabilities.includes('preview-draft-change') ? {} : { draft: Object.freeze({ id: initial.draft.id, revision: initial.draft.revision, title: initial.draft.title, summary: initial.draft.summary, markdown: initial.draft.markdown }) }),
    openDetail: runtime.guard((pluginId: string) => { const current = allowed('browse'); if (!isText(pluginId)) throw new Error('extension/invalid-plugin'); return current.openDetail(pluginId) }),
    openOwnPage: runtime.guard((pageId: string) => {
      const current = allowed('open-own-page')
      const page = host.getSnapshot().find((item) => item.extensionId === entry.extensionId && item.contribution.slot === EXTENSION_SLOTS.page && item.contribution.id === pageId)
      if (!page) throw new Error('extension/page-not-owned')
      return current.openOwnPage(page.key)
    }),
    requestInstallReview: runtime.guard((request: ExtensionInstallReviewRequest) => {
      const current = allowed('request-install-review')
      only(request, ['pluginId', 'version', 'artifactDigest'])
      if (!isText(request.pluginId) || !isText(request.version, 128) || !/^(?:sha256:)?[a-f0-9]{64}$/i.test(request.artifactDigest)) throw new Error('extension/invalid-install-request')
      // Core re-resolves this exact identity against its current catalogue; no consent enters this face.
      return current.requestInstallReview(Object.freeze({ pluginId: request.pluginId, version: request.version, artifactDigest: request.artifactDigest }))
    }),
    previewDraftChange: runtime.guard((change: ExtensionDraftChange) => {
      const current = allowed('preview-draft-change')
      only(change, ['draftId', 'expectedRevision', 'title', 'summary', 'markdown'])
      if (!initial.draft || !current.draft || change.draftId !== initial.draft.id || change.expectedRevision !== initial.draft.revision || change.draftId !== current.draft.id || change.expectedRevision !== current.draft.revision) throw new Error('extension/stale-draft')
      if (![change.title, change.summary, change.markdown].some((v) => v !== undefined)) throw new Error('extension/empty-draft-change')
      for (const [key, limit] of [['title', 200], ['summary', 2000], ['markdown', 100_000]] as const) if (change[key] !== undefined && (typeof change[key] !== 'string' || change[key]!.length > limit)) throw new Error('extension/invalid-draft-change')
      return current.previewDraftChange(Object.freeze({ draftId: change.draftId, expectedRevision: change.expectedRevision, ...(change.title === undefined ? {} : { title: change.title }), ...(change.summary === undefined ? {} : { summary: change.summary }), ...(change.markdown === undefined ? {} : { markdown: change.markdown }) }))
    }),
  })
}
