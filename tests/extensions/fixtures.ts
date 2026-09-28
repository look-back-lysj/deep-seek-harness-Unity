import { vi } from 'vitest'
import { EXTENSION_SLOTS, type ExtensionContext, type ExtensionDefinition, type ExtensionOwnerScope } from '../../packages/market/src/client/extensions/contract.ts'
import { createMarketExtensionHost } from '../../packages/market/src/client/extensions/registry.ts'

export class TestOwner implements ExtensionOwnerScope {
  readonly effects = new Set<() => void>()
  stopped = false
  effect(setup: () => (() => void)): () => void {
    if (this.stopped) throw new Error('inactive test owner')
    const cleanup = setup()
    let disposed = false
    const dispose = (): void => { if (disposed) return; disposed = true; this.effects.delete(dispose); cleanup() }
    this.effects.add(dispose)
    return dispose
  }
  dispose(): void { this.stopped = true; for (const effect of [...this.effects]) effect() }
}
export const capabilities = ['browse', 'open-own-page', 'request-install-review', 'preview-draft-change'] as const
export const makeHost = () => createMarketExtensionHost({ marketVersion: '0.1.0-mvp.1', dshVersion: '0.1.7-rc.2', capabilities })
export function definition(id = 'test.extension'): ExtensionDefinition {
  return { id, version: '1.0.0', apiVersion: '1', marketRange: '>=0.1.0-mvp.0 <0.2.0', dshRange: '>=0.1.7-rc.2 <0.1.8', requiredCapabilities: [...capabilities], contributions: [
    { id: 'home', title: '合成首页', slot: EXTENSION_SLOTS.home, component: () => '合成首页内容' },
    { id: 'more', title: '合成工具', slot: EXTENSION_SLOTS.more, pageId: 'page' },
    { id: 'page', title: '合成页面', slot: EXTENSION_SLOTS.page, component: () => '合成页面内容' },
    { id: 'detail', title: '合成详情', slot: EXTENSION_SLOTS.detail, pluginIds: ['fixture'], component: () => '合成详情内容' },
    { id: 'author', title: '合成作者工具', slot: EXTENSION_SLOTS.author, component: () => '合成作者内容' },
  ] }
}
export function context(): ExtensionContext {
  return { marketVersion: '0.1.0-mvp.1', dshVersion: '0.1.7-rc.2', environmentId: 'test-only', capabilities, signal: new AbortController().signal,
    plugin: { id: 'fixture', name: '合成插件', packageName: 'fixture', version: '1.0.0', artifactDigest: 'a'.repeat(64) },
    draft: { id: 'test-draft', revision: 'r1', title: '合成草稿', summary: '合成简介', markdown: '合成正文' },
    openDetail: vi.fn(), openOwnPage: vi.fn(), requestInstallReview: vi.fn(), previewDraftChange: vi.fn(),
  }
}
