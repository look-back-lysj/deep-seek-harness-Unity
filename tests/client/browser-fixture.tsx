/** Synthetic browser harness. It never mounts official Desktop or a real profile. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MarketPage } from '../../packages/market/src/client/MarketPage.tsx'
import { InstallPlanDialog } from '../../packages/market/src/client/InstallPlanDialog.tsx'
import { TaskDrawer } from '../../packages/market/src/client/TaskDrawer.tsx'
import { AuthorWorkspace } from '../../packages/market/src/client/AuthorWorkspace.tsx'
import { MARKET_CSS } from '../../packages/market/src/client/marketStyles.ts'
import { decodeBase64, sha256Hex } from '../../packages/market/src/client/transfer.ts'
import type { MarketRemote } from '../../packages/market/src/client/model.ts'
import type { AiConfirmRequest, AuthorDraft, AuthorDraftInput, CatalogCollectionView, CatalogPack, PlanCreateRequest, PlanResult, TaskStartRequest } from '../../packages/market/src/types.ts'
import { catalogFixture, helloFixture, inventoryFixture, pluginFixtures, readOnlyRemote, taskFixture } from './fixtures.ts'
import { renderSkinFixture, skinFixture } from './skin-browser-fixture.tsx'

const element = document.getElementById('root')!
const root = createRoot(element)
const pluginA = { ...pluginFixtures.unverified, id: 'A', name: '合成插件 A', packageName: '@test/A' }
const pluginB = { ...pluginA, id: 'B', name: '合成插件 B', packageName: '@test/B', verification: 'verified' as const }
const stats: { plans: PlanCreateRequest[]; starts: TaskStartRequest[]; closes: number; started: string[]; ai: AiConfirmRequest[]; saved: AuthorDraftInput[]; exports: number; mediaUploads: unknown[]; dispose: number; official: number } = { plans: [], starts: [], closes: 0, started: [], ai: [], saved: [], exports: 0, mediaUploads: [], dispose: 0, official: 0 }
let settleA = (): void => {}
let openB = (): void => {}
const remote: MarketRemote = { ...readOnlyRemote(), listTasks: async () => [], inventory: async () => ({ ...inventoryFixture, items: [] }) }
function makePlan(request: PlanCreateRequest, downgrade = false) {
  stats.plans.push(request)
  return {
    status: 'ready' as const,
    plan: { planId: request.selections[0]!.pluginId, schemaVersion: '1', environmentId: helloFixture.environmentId, hostFingerprint: 'test', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), catalogRevision: 'test', planDigest: 'sha256:test', items: request.selections.map((selection) => ({ pluginId: selection.pluginId, packageName: selection.packageName, action: downgrade ? 'downgrade' as const : 'add' as const, ...(downgrade ? { currentVersion: '3.0.0' } : {}), targetVersion: selection.targetVersion, targetDigest: selection.targetDigest, currentEnabled: false, requestedEnabled: selection.enabledIntent, verification: selection.pluginId === 'A' ? 'unverified' as const : 'verified' as const, requiresRestart: false, blockers: [] })) },
  }
}
function InstallHarness({ late = false, downgrade = false }: { late?: boolean; downgrade?: boolean }) {
  const [target, setTarget] = useState({ plugin: late || !downgrade ? pluginA : pluginB, plugins: [late || !downgrade ? pluginA : pluginB] })
  const [open, setOpen] = useState(false)
  openB = () => setTarget({ plugin: pluginB, plugins: [pluginB] })
  const [service] = useState<MarketRemote>(() => ({
    ...remote,
    createPlan: async (request) => makePlan(request, downgrade),
    startTask: async (request) => {
      stats.starts.push(request)
      if (late) await new Promise<void>((resolve) => { settleA = resolve })
      return taskFixture({ taskId: request.planId, status: 'completed' })
    },
  }))
  return <div className="eac-market"><button id="launch" onClick={() => setOpen(true)}>打开安装窗口</button><InstallPlanDialog open={open} target={target} inventory={[]} remote={service} onClose={() => { stats.closes += 1; setOpen(false) }} onStarted={(task) => stats.started.push(task.taskId)} /></div>
}
const draft: AuthorDraft = { id: 'draft-one', revision: 'r1', title: '合成草稿', summary: '测试介绍', markdown: '旧正文', mediaIds: [], updatedAt: new Date().toISOString() }
let stored: AuthorDraft = draft
let previewRevision = ''
const authorRemote: MarketRemote = {
  ...remote, listDrafts: async () => [stored], getDraft: async () => stored,
  saveDraft: async (input) => {
    stats.saved.push(input)
    if (input.id && input.expectedRevision !== stored.revision) throw new Error('草稿 revision 已变化，拒绝覆盖')
    stored = { ...input, id: input.id ?? 'new-draft', revision: `r${stats.saved.length + 1}`, updatedAt: new Date().toISOString() }; return stored
  },
  importReadme: async () => ({ draft: { ...draft, id: 'preview', markdown: 'README 新正文', sourceUrl: 'https://github.com/example/test', sourceCommit: 'abc123' }, repositoryUrl: 'https://github.com/example/test', commit: 'abc123', importedAt: new Date().toISOString(), mediaWarnings: [] }),
  previewReadme: async () => { previewRevision = stored.revision; return { previewId: 'preview', expiresAt: new Date(Date.now() + 60_000).toISOString(), before: stored, candidate: { ...stored, markdown: 'README 新正文' }, repositoryUrl: 'https://github.com/example/test', commit: 'a'.repeat(40), importedAt: new Date().toISOString(), mediaWarnings: [] } },
  applyReadmePreview: async (request) => {
    if (request.expectedRevision !== stored.revision || previewRevision !== stored.revision) throw new Error('草稿 revision 已变化，拒绝覆盖')
    stored = { ...stored, markdown: 'README 新正文', revision: 'readme-applied' }
    return { draft: stored, repositoryUrl: 'https://github.com/example/test', commit: 'a'.repeat(40), importedAt: new Date().toISOString(), mediaWarnings: [] }
  },
  exportDraft: async () => { stats.exports += 1; return { transferId: 'out', complete: true, receivedBytes: 4 } },
  transferBegin: async (request) => { stats.mediaUploads.push(request); return { transferId: 'upload', complete: false, receivedBytes: 0 } },
  transferChunk: async (request) => { stored = { ...stored, revision: 'media-revision', mediaIds: ['img-fixture'] }; return { transferId: 'upload', complete: true, receivedBytes: decodeBase64(request.data).length, resultId: 'img-fixture' } },
  readMedia: async () => {
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    return { id: 'img-fixture', mediaType: 'image/png', data, sha256: `sha256:${await sha256Hex(decodeBase64(data))}` }
  },
  transferRead: async (request) => ({ ...request, data: 'UEsDBA==', last: true }),
  transferDispose: async () => { stats.dispose += 1; return true },
}
function aiRemote(queued = false): MarketRemote {
  const impact = { summary: '卸载合成测试插件', currentVersion: '1.0.0', affectedPackages: ['@test/A'], dataBehavior: '仅必要卸载，不额外清理独立配置', unknowns: ['插件自身数据行为未知'] }
  return { ...remote,
    aiAnalyze: async (request) => ({ status: 'ready', proposal: { id: `proposal-${request.taskId}`, environmentId: helloFixture.environmentId, taskId: request.taskId, diagnosticDigest: 'sha256:test', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), impactDigest: 'impact', summary: `只属于 ${request.taskId} 的方案`, facts: ['合成错误事实'], actions: [{ kind: 'remove', packageName: '@test/A', reason: '合成原因', requiresSecondConfirmation: true }], impact } }),
    getTask: async (request) => taskFixture({ taskId: request.taskId, status: 'queued' }),
    aiConfirm: async (request) => { stats.ai.push(request); return queued ? { status: 'queued', changed: false, taskId: 'ai-queued-task' } : request.challengeId ? { status: 'applied', changed: true } : { status: 'requires-confirmation', changed: false, challenge: { id: 'challenge', digest: 'challenge-digest', expiresAt: new Date(Date.now() + 60_000).toISOString(), impact } } },
  }
}

function groupRemote(mode: string): MarketRemote {
  const plugins = [pluginA, pluginB, { ...pluginB, id: 'C', name: '依赖 A 的插件 C', packageName: '@test/C' }, { ...pluginB, id: 'D', name: '硬不兼容插件 D', packageName: '@test/D', verification: 'hard-incompatible' as const }]
  const edges = [{ prerequisiteId: 'A', consumerId: 'C', milestone: 'installed' as const }]
  const collection: CatalogCollectionView = {
    kind: 'market-collection', id: 'collection-test', version: '2.0.0', name: '合成精确版本组合', summary: '包含未验证、独立安全项和依赖项的合成组合。', collectionDigest: 'sha256:collection-test',
    components: plugins.map((plugin) => ({ pluginId: plugin.id, version: plugin.version, releaseId: `test-${plugin.id}`, artifactDigest: plugin.artifactDigest, required: true, enabled: false })),
    execution: { coverage: 'complete', edges, provenance: 'test' },
  }
  const pack: CatalogPack = { ...catalogFixture.packs[0]!, id: 'pack-test', name: '合成公共套餐', components: plugins.map((plugin) => ({ pluginId: plugin.id, version: plugin.version, required: true })), execution: { ...catalogFixture.packs[0]!.execution, coverage: 'complete', edges } }
  return { ...remote,
    catalog: async () => ({ ...catalogFixture, plugins, packs: mode === 'pack-partial' ? [pack] : [], collections: mode === 'pack-partial' ? [] : [collection], recommendations: [] }),
    createPlan: async (request): Promise<PlanResult> => {
      const initial = makePlan(request)
      return { status: 'ready', plan: { ...initial.plan,
        ...(request.collectionId ? { collectionId: request.collectionId, collectionVersion: request.collectionVersion!, collectionDigest: mode === 'collection-stale' ? 'sha256:drifted' : collection.collectionDigest } : { packId: request.packId!, packVersion: request.packVersion! }),
        items: initial.plan.items.map((row) => mode === 'collection-all-blocked' ? { ...row, action: 'blocked', blockers: ['artifact:not-installable'] }
          : row.pluginId === 'D' ? { ...row, action: 'blocked', verification: 'hard-incompatible', blockers: ['verification:hard-incompatible'] }
          : row.pluginId === 'A' && !request.attemptUnknown && mode !== 'collection-unsafe' ? { ...row, action: 'blocked', blockers: ['verification:unverified-not-confirmed'] }
          : row),
      } }
    },
    startTask: async (request) => { stats.starts.push(request); return taskFixture({ status: 'partial' }) },
  }
}
function render(name: string): void {
  stats.plans = []; stats.starts = []; stats.closes = 0; stats.started = []; stats.ai = []; stats.saved = []; stats.exports = 0; stats.dispose = 0; stats.mediaUploads = []; stored = draft
  element.classList.toggle('official-panel-fixture', name === 'inventory-scroll' || name.startsWith('skins-'))
  if (name.startsWith('skins-')) renderSkinFixture(root, name)
  if (name === 'inventory-scroll') {
    const installed = { ...inventoryFixture.items[0]!, packageName: '@test/my-feature', readOnlyReason: undefined, source: 'profile' as const }
    const official = Array.from({ length: 28 }, (_, i) => ({ ...installed, packageName: `@deepseek-ai/builtin-${i}`, source: 'installation' as const,
      installed: false, removable: false, bundleEnabled: false, restartRequired: i === 1,
      rows: i === 0 ? [{ id: 'bad', name: 'bad', state: 'load-error' as const }] : [] }))
    root.render(<MarketPage key={name} remote={{ ...remote, catalog: async () => ({ ...catalogFixture, plugins: [], packs: [], recommendations: [] }),
      inventory: async () => ({ ...inventoryFixture, unknownItems: [], items: [installed, ...official] }) }} />)
  }
  if (name === 'install' || name === 'late' || name === 'downgrade') root.render(<InstallHarness key={name} late={name === 'late'} downgrade={name === 'downgrade'} />)
  if (name === 'ai' || name === 'ai-queued') root.render(<div className="eac-market"><TaskDrawer key={name} open tasks={[taskFixture({ taskId: 'A', status: 'failed' }), taskFixture({ taskId: 'B', status: 'failed' })]} onClose={() => {}} remote={aiRemote(name === 'ai-queued')} onChanged={(task) => stats.started.push(task.taskId)} /></div>)
  if (name === 'author') root.render(<div className="eac-market"><AuthorWorkspace key={name} remote={authorRemote} /></div>)
  if (name === 'versions-home' || name === 'versions-installed') {
    const plugins = ['2.0.0', '1.0.0', '2.0.0-rc.2', '2.0.0-rc.10', '99.0.0', '3.0.0'].map((version) => ({ ...pluginB, id: 'same-id', name: `精确版本 ${version}`, packageName: '@test/versioned', version, verification: version === '99.0.0' ? 'hard-incompatible' as const : 'verified' as const, artifactDigest: `sha256:test-${version}` }))
    const pack: CatalogPack = { ...catalogFixture.packs[0]!, id: 'versioned-pack', name: '固定旧版套餐', components: [{ pluginId: 'same-id', version: '1.0.0', required: true }], execution: { ...catalogFixture.packs[0]!.execution, coverage: 'complete', edges: [] } }
    root.render(<MarketPage key={name} remote={{ ...remote,
      catalog: async () => ({ ...catalogFixture, plugins, packs: [pack], collections: [], recommendations: [], deliveries: plugins.filter((plugin) => plugin.version !== '3.0.0').map((plugin) => ({ pluginId: plugin.id, version: plugin.version, packageName: plugin.packageName, artifactDigest: plugin.artifactDigest, sources: [{ kind: 'https-artifact', ref: 'https://example.invalid/test.tgz', priority: 0 }] })) }),
      inventory: async () => ({ ...inventoryFixture, unknownItems: [], items: name === 'versions-installed' ? [{ ...inventoryFixture.items[0]!, packageName: '@test/versioned', version: '0.5.0', restartRequired: false, rows: [] }] : [] }),
      createPlan: async (request) => makePlan(request),
      startTask: async (request) => { stats.starts.push(request); return taskFixture({ status: 'completed' }) },
    }} />)
  }
  if (name.startsWith('collection-') || name === 'pack-partial') root.render(<MarketPage key={name} remote={groupRemote(name)} />)
  if (name === 'home' || name === 'empty' || name === 'long' || name === 'remove') {
    root.render(<MarketPage key={name} remote={{ ...remote,
      inventory: async () => name === 'remove' ? inventoryFixture : { ...inventoryFixture, items: [] },
      catalog: async () => ({ ...catalogFixture, recommendations: [{ pluginId: pluginFixtures.verified.id, placement: 'featured', order: 1, reason: '用于验证图文推荐的合成理由，不是正式推荐' }], plugins: name === 'empty' ? [] : name === 'long' ? Array.from({ length: 100 }, (_, i) => ({ ...pluginB, id: `long-${i}`, name: `很长的插件名称和详细版本说明${'长内容'.repeat(22)}${i}`, summary: '用途说明'.repeat(90), packageName: `@test/package-${i}` })) : catalogFixture.plugins }),
      refreshCatalog: async () => ({ status: 'failed', current: catalogFixture, reason: '合成来源离线' }),
      removePlugin: async () => { stats.started.push('remove'); return { status: 'applied', changed: true, permissionChanges: [] } },
    }} onOpenOfficialPlugins={() => { stats.official += 1 }} />)
  }
}
const style = document.createElement('style'); style.textContent = MARKET_CSS + 'html,body,#root{margin:0;min-height:100%;}#root.official-panel-fixture{display:flex;flex-direction:column;height:calc(100dvh - 32px);overflow:hidden;margin-top:32px;}'; document.head.append(style)
Object.assign(window, { skinFixture, fixture: { render, stats, resolveA: () => settleA(), openB: () => openB(), conflict: () => { stored = { ...stored, revision: 'changed-elsewhere' } } } })
render('home')
