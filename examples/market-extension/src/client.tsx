import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
// The only market dependency is erased at build time. The browser loader has
// one market Client module, not arbitrary Node export subpaths.
import type { ExtensionContext, ExtensionDefinition } from '@dsh-eac/market/client/extensions'

const button = (title: string, onClick: () => void) => createElement('button', { type: 'button', onClick }, title)
const paragraph = (text: string) => createElement('p', null, text)
type Props = { readonly context: Readonly<ExtensionContext> }
function Home({ context }: Props) {
  return createElement('div', null, paragraph('这是独立安装的本地测试扩展。没有正式推荐或认证含义。'), button('打开示例说明', () => context.openOwnPage('guide')))
}
function Page({ context }: Props) {
  return paragraph(`独立示例已接入。市场 ${context.marketVersion}，DSH ${context.dshVersion}。本示例只打开核心预览，不直接安装或保存。`)
}
function Detail({ context }: Props) {
  const plugin = context.plugin
  return createElement('div', null,
    paragraph(plugin ? `当前查看：${plugin.name} ${plugin.version}` : '请先打开插件详情。'),
    plugin?.artifactDigest ? button('查看核心安装方案', () => context.requestInstallReview({ pluginId: plugin.id, version: plugin.version, artifactDigest: plugin.artifactDigest! })) : paragraph('此条目没有完整制品摘要，示例不发起安装预检。'),
  )
}
function Author({ context }: Props) {
  const draft = context.draft
  return draft ? button('预览给草稿增加测试说明', () => context.previewDraftChange({ draftId: draft.id, expectedRevision: draft.revision, markdown: `${draft.markdown}\n\n> 本地扩展示例建议；请自行核对后决定是否保存。` })) : paragraph('在作者工具中打开一个草稿后，可预览改动；保存仍由核心确认。')
}

export const definition: ExtensionDefinition = {
  id: 'eac.example.independent', version: '0.1.0-test.1', apiVersion: '1',
  marketRange: '>=0.1.0-mvp.1 <0.2.0', dshRange: '>=0.1.7-rc.2 <0.1.8',
  requiredCapabilities: ['browse', 'open-own-page'],
  optionalCapabilities: ['request-install-review', 'preview-draft-change'],
  contributions: [
    { id: 'home', slot: 'eac.market.home.supplemental.section', title: '本地扩展示例', order: 100, component: Home },
    { id: 'menu', slot: 'eac.market.extension.more', title: '独立扩展示例', order: 100, pageId: 'guide' },
    { id: 'guide', slot: 'eac.market.extension.page', title: '独立扩展示例说明', component: Page },
    { id: 'detail', slot: 'eac.market.detail.section', title: '示例详情补充', order: 100, component: Detail },
    { id: 'author', slot: 'eac.market.author.tool', title: '示例草稿工具', order: 100, component: Author },
  ],
}

export const inject: string[] = []
export function apply(ctx: Context): void {
  // Optional integration lives in its own waiting fiber. The package's unrelated
  // functions can still activate before the market exists or while it is disabled.
  ctx.inject(['eacMarketExtensions'], (scope) => {
    const result = scope.eacMarketExtensions.register(scope, definition)
    if (result.status === 'rejected') console.warn('[market-extension-example]', result.reason)
  })
}
