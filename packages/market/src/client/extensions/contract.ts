/**
 * EAC-private client extension API v1. These React callbacks never enter the
 * JSON Remote contract. This API coordinates reviewed plugins in one JS realm;
 * it is not a sandbox or proof of publisher identity.
 */
import type { ComponentType } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

export const EXTENSION_API_VERSION = '1'
export const EXTENSION_SERVICE = 'eacMarketExtensions'
export const EXTENSION_SLOTS = {
  home: 'eac.market.home.supplemental.section',
  more: 'eac.market.extension.more',
  page: 'eac.market.extension.page',
  detail: 'eac.market.detail.section',
  author: 'eac.market.author.tool',
} as const
export type ExtensionSlot = typeof EXTENSION_SLOTS[keyof typeof EXTENSION_SLOTS]
export type ExtensionCapability = 'browse' | 'open-own-page' | 'request-install-review' | 'preview-draft-change'

export interface ExtensionPluginRef {
  readonly id: string
  readonly name: string
  readonly packageName: string
  readonly version: string
  readonly artifactDigest?: string | undefined
}

export interface ExtensionDraftRef {
  readonly id: string
  readonly revision: string
  readonly title: string
  readonly summary: string
  readonly markdown: string
}

export interface ExtensionInstallReviewRequest {
  readonly pluginId: string
  readonly version: string
  readonly artifactDigest: string
}

export interface ExtensionDraftChange {
  readonly draftId: string
  readonly expectedRevision: string
  readonly title?: string | undefined
  readonly summary?: string | undefined
  readonly markdown?: string | undefined
}

export interface ExtensionContext {
  readonly marketVersion: string
  readonly dshVersion: string
  readonly environmentId: string
  readonly capabilities: readonly ExtensionCapability[]
  readonly plugin?: ExtensionPluginRef | undefined
  readonly draft?: ExtensionDraftRef | undefined
  readonly signal: AbortSignal
  openDetail(pluginId: string): void
  openOwnPage(pageId: string): void
  /** Opens core preflight only. This never accepts confirmation or starts a task. */
  requestInstallReview(request: ExtensionInstallReviewRequest): void
  /** Opens an editable diff preview; only the market can save it after approval. */
  previewDraftChange(change: ExtensionDraftChange): void
}

export interface ExtensionContribution {
  /** Namespaced by its owning extension at registration. */
  readonly id: string
  readonly slot: ExtensionSlot
  readonly title: string
  readonly order?: number | undefined
  /** More-menu descriptions target one page within the same extension. */
  readonly pageId?: string | undefined
  readonly pluginIds?: readonly string[] | undefined
  readonly component?: ComponentType<{ readonly context: Readonly<ExtensionContext> }> | undefined
}

export interface ExtensionDefinition {
  readonly id: string
  readonly version: string
  readonly apiVersion: string
  readonly marketRange: string
  readonly dshRange: string
  readonly requiredCapabilities: readonly ExtensionCapability[]
  readonly optionalCapabilities?: readonly ExtensionCapability[] | undefined
  readonly contributions: readonly ExtensionContribution[]
}

/** Minimal lifecycle face; it is not an authentication principal. */
export interface ExtensionOwnerScope {
  effect(callback: () => (() => void), label?: string): unknown
}

export interface RegisteredContribution {
  readonly extensionId: string
  readonly extensionVersion: string
  readonly provider: 'builtin' | 'dsh-plugin'
  readonly key: string
  readonly contribution: ExtensionContribution
  readonly capabilities: readonly ExtensionCapability[]
}

export type ExtensionRegistration =
  | { readonly status: 'registered'; readonly dispose: () => void }
  | { readonly status: 'rejected'; readonly reason: string }

export interface MarketExtensionHost {
  getSnapshot(): readonly RegisteredContribution[]
  subscribe(listener: () => void): () => void
}

export interface MarketExtensionService extends MarketExtensionHost {
  register(owner: ExtensionOwnerScope, definition: ExtensionDefinition): ExtensionRegistration
}

/** Owner props passed only by the market wrapper; framework Context is not exposed. */
export interface ExtensionSlotOwner {
  readonly context: Readonly<ExtensionContext>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'eac.market.home.supplemental.section': { kind: 'list'; scope: 'root'; owner: ExtensionSlotOwner }
    'eac.market.extension.more': { kind: 'list'; scope: 'root'; owner: ExtensionSlotOwner }
    'eac.market.extension.page': { kind: 'keyed'; scope: 'root'; owner: ExtensionSlotOwner }
    'eac.market.detail.section': { kind: 'list'; scope: 'root'; owner: ExtensionSlotOwner }
    'eac.market.author.tool': { kind: 'list'; scope: 'root'; owner: ExtensionSlotOwner }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    eacMarketExtensions: MarketExtensionService
  }
}
