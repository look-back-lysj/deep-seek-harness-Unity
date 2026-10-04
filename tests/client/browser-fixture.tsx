/** Synthetic browser harness. It never mounts official Desktop or a real profile. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MarketPage } from '../../packages/market/src/client/MarketPage.tsx'
import { InstallPlanDialog } from '../../packages/market/src/client/InstallPlanDialog.tsx'
import { TaskDrawer } from '../../packages/market/src/client/TaskDrawer.tsx'
import { AuthorWorkspace } from '../../packages/market/src/client/AuthorWorkspace.tsx'
import { MARKET_CSS } from '../../packages/market/src/client/marketStyles.ts'
import { ActionFeedback } from '../../packages/market/src/client/action-feedback.tsx'
import { completedActionFeedback, failedActionFeedback } from '../../packages/market/src/client/action-state.ts'
import { decodeBase64, sha256Hex } from '../../packages/market/src/client/transfer.ts'
import type { MarketRemote } from '../../packages/market/src/client/model.ts'
import type { AiConfirmRequest, AuthorDraft, AuthorDraftInput, CatalogCollectionView, CatalogPack, PlanCreateRequest, PlanResult, TaskStartRequest, CatalogSourceView, CoreMaintenanceSnapshot, UpdateCheckResult, UpdatePolicySaveRequest } from '../../packages/market/src/types.ts'
import { catalogFixture, helloFixture, inventoryFixture, pluginFixtures, readOnlyRemote, taskFixture } from './fixtures.ts'
import { renderSkinFixture, skinFixture } from './skin-browser-fixture.tsx'

const element = document.getElementById('root')!
const root = createRoot(element)
const pluginA = { ...pluginFixtures.unverified, id: 'A', name: '合成插件 A', packageName: '@test/A' }
const pluginB = { ...pluginA, id: 'B', name: '合成插件 B', packageName: '@test/B', verification: 'verified' as const }
const stats: { plans: PlanCreateRequest[]; starts: TaskStartRequest[]; closes: number; started: string[]; ai: AiConfirmRequest[]; saved: AuthorDraftInput[]; exports: number; mediaUploads: unknown[]; dispose: number; official: number; sourceRefreshes: string[]; updateChecks: number; policyWrites: UpdatePolicySaveRequest[]; policyReads: number; maintenanceReads: number; taskEventReads: number; taskEventOffsets: number[] } = { plans: [], starts: [], closes: 0, started: [], ai: [], saved: [], exports: 0, mediaUploads: [], dispose: 0, official: 0, sourceRefreshes: [], updateChecks: 0, policyWrites: [], policyReads: 0, maintenanceReads: 0, taskEventReads: 0, taskEventOffsets: [] }
let settleA = (): void => {}
let openB = (): void => {}
const remote: MarketRemote = {
  ...readOnlyRemote(),
  listTasks: async () => [],
  inventory: async () => ({ ...inventoryFixture, items: [] }),
  taskEvents: async ({ afterSequence = 0, limit = 100 }) => {
    stats.taskEventReads += 1
    stats.taskEventOffsets.push(afterSequence)
    const all = Array.from({ length: 130 }, (_, index) => ({ sequence: index, at: `2026-10-02T09:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`, phase: 'installing' as const, message: `合成历史事件 ${index + 1}`, level: 'info' as const }))
    const events = all.filter(event => event.sequence > afterSequence).slice(0, limit)
    return { events, nextSequence: (events.at(-1)?.sequence ?? afterSequence) + 1, truncated: false }
  },
}
let settingsSources: readonly CatalogSourceView[] = [
  { id: 'curated-main', kind: 'agent-forge', mode: 'https', enabled: true, priority: 1, refreshPolicy: 'manual', status: 'stale', revision: 'catalog:old', reason: 'synthetic fetch failed: https://fixture-user:fixture-token@example.invalid/index.json at C:\\fixture-private\\source.json' },
  { id: 'offline-import', kind: 'market-index', mode: 'offline-pack', enabled: true, priority: 2, refreshPolicy: 'manual', status: 'not-checked' },
]
let settingsPolicy = { revision: 'policy:r1', policy: { automaticChecksEnabled: true, automaticDownloadsEnabled: false, automaticInstallsEnabled: false, intervalMinutes: 60 } }
let settingsPolicyConflict = false
const settingsMaintenance: CoreMaintenanceSnapshot = {
  schemaVersion: '1', revision: 'maintenance:test', environmentId: helloFixture.environmentId, generatedAt: '2026-10-02T09:00:00.000Z',
  updatePolicy: { automaticChecksEnabled: true, automaticDownloadsEnabled: false, automaticInstallsEnabled: false },
  packages: [{ packageName: '@test/update', pluginId: 'update-plugin', installedVersion: '1.0.0', targetVersion: '2.0.0', installState: 'installed', enabledState: 'enabled', explicitState: 'explicit', dependencyState: { dependencyOf: [], requiredByCount: 0, releasable: true }, effectiveState: 'retain', reasons: [] }],
  activeTaskIds: ['task-running'], pendingRestart: true,
}
const settingsRemote: MarketRemote = {
  ...remote,
  catalogSources: async () => settingsSources,
  maintenanceStatus: async () => { stats.maintenanceReads += 1; return settingsMaintenance },
  refreshCatalog: async (request) => { stats.sourceRefreshes.push(request?.sourceId ?? 'all'); settingsSources = settingsSources.map(source => source.id === request?.sourceId ? { ...source, status: 'ready', revision: 'catalog:new' } : source); return { status: 'refreshed', current: catalogFixture } },
  checkUpdates: async (): Promise<UpdateCheckResult> => {
    stats.updateChecks += 1
    return { checkedAt: '2026-10-02T09:05:00.000Z', sourceRevision: 'catalog:accepted', catalogStale: true, inventoryRevision: 'inventory:test', items: [
      { packageName: '@test/update', pluginId: 'update-plugin', installedVersion: '1.0.0', latestVersion: '2.0.0', status: 'update-available' },
      { packageName: '@test/unknown', installedVersion: '3.0.0', status: 'unknown', reason: 'synthetic uncertainty' },
    ] }
  },
  updatePolicyGet: async () => { stats.policyReads += 1; return settingsPolicy },
  updatePolicySave: async (request) => {
    stats.policyWrites.push(request)
    if (settingsPolicyConflict) {
      settingsPolicyConflict = false
      settingsPolicy = { revision: 'policy:r2', policy: { automaticChecksEnabled: true, automaticDownloadsEnabled: false, automaticInstallsEnabled: false, intervalMinutes: 180 } }
      throw Object.assign(new Error('policy revision changed'), { code: 'update-policy/revision-conflict' })
    }
    if (request.expectedRevision !== settingsPolicy.revision) throw Object.assign(new Error('policy revision changed'), { code: 'update-policy/revision-conflict' })
    settingsPolicy = { revision: 'policy:r2', policy: request.policy }
    return settingsPolicy
  },
}
const settingsRefreshFailureRemote: MarketRemote = {
  ...settingsRemote,
  refreshCatalog: async (request) => {
    stats.sourceRefreshes.push(request?.sourceId ?? 'all')
    return { status: 'failed', current: catalogFixture, reason: 'request https://fixture-user:fixture-token@example.invalid/index.json failed at C:\\fixture-private\\source.json' }
  },
}
const settingsForeignEnvironmentRemote: MarketRemote = {
  ...settingsRemote,
  maintenanceStatus: async () => ({ ...settingsMaintenance, environmentId: 'different-profile' }),
}
const settingsCapabilityMissingRemote: MarketRemote = {
  ...settingsRemote,
  hello: async () => ({ ...helloFixture, capabilities: helloFixture.capabilities.filter((capability) => !['core-maintenance', 'update-check', 'catalog-source-list', 'update-policy'].includes(capability)) }),
}
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
          : mode === 'collection-unsafe' ? { ...row, action: 'blocked', blockers: ['artifact:not-installable'] }
          : (mode === 'collection-home' || mode === 'pack-partial') && row.pluginId === 'A' ? { ...row, action: 'blocked', blockers: ['artifact:not-installable'] }
          : row.pluginId === 'D' ? { ...row, action: 'blocked', verification: 'hard-incompatible', blockers: ['verification:hard-incompatible'] }
          : row),
      } }
    },
    startTask: async (request) => { stats.starts.push(request); return taskFixture({ status: 'partial' }) },
  }
}
let renderEpoch = 0
function render(name: string): void {
  const renderKey = `${name}:${++renderEpoch}`
  stats.plans = []; stats.starts = []; stats.closes = 0; stats.started = []; stats.ai = []; stats.saved = []; stats.exports = 0; stats.dispose = 0; stats.mediaUploads = []; stats.sourceRefreshes = []; stats.updateChecks = 0; stats.policyWrites = []; stats.policyReads = 0; stats.maintenanceReads = 0; stats.taskEventReads = 0; stats.taskEventOffsets = []; settingsPolicy = { revision: 'policy:r1', policy: { automaticChecksEnabled: true, automaticDownloadsEnabled: name === 'settings-unsafe-policy', automaticInstallsEnabled: name === 'settings-unsafe-policy', intervalMinutes: 60 } }; settingsPolicyConflict = name === 'settings-conflict'; stored = draft
  element.classList.toggle('official-panel-fixture', name === 'inventory-scroll' || name.startsWith('skins-'))
  if (name.startsWith('skins-')) renderSkinFixture(root, name)
  if (name === 'inventory-scroll') {
    const installed = { ...inventoryFixture.items[0]!, packageName: '@test/my-feature', readOnlyReason: undefined, source: 'profile' as const }
    const official = Array.from({ length: 28 }, (_, i) => ({ ...installed, packageName: `@deepseek-ai/builtin-${i}`, source: 'installation' as const,
      installed: false, removable: false, bundleEnabled: false, restartRequired: i === 1,
      rows: i === 0 ? [{ id: 'bad', name: 'bad', state: 'load-error' as const }] : [] }))
    root.render(<MarketPage key={renderKey} remote={{ ...remote, catalog: async () => ({ ...catalogFixture, plugins: [], packs: [], recommendations: [] }),
      inventory: async () => ({ ...inventoryFixture, unknownItems: [], items: [installed, ...official] }) }} />)
  }
  if (name === 'install' || name === 'late' || name === 'downgrade') root.render(<InstallHarness key={renderKey} late={name === 'late'} downgrade={name === 'downgrade'} />)
  if (name === 'ai' || name === 'ai-queued') root.render(<div className="eac-market"><TaskDrawer key={renderKey} open tasks={[taskFixture({ taskId: 'A', status: 'failed' }), taskFixture({ taskId: 'B', status: 'failed' })]} onClose={() => {}} remote={aiRemote(name === 'ai-queued')} onChanged={(task) => stats.started.push(task.taskId)} /></div>)
  if (name === 'author') root.render(<div className="eac-market"><AuthorWorkspace key={renderKey} remote={authorRemote} /></div>)
  if (name === 'feedback-completed' || name === 'feedback-failed') {
    const state = name === 'feedback-completed'
      ? completedActionFeedback('合成安装', '安装已完成。', '打开我的插件核对真实状态。')
      : failedActionFeedback('合成安装', '安装未完成。', '查看失败原因后重试。')
    root.render(<div className="eac-market"><ActionFeedback key={renderKey} state={state} /></div>)
  }
  if (name === 'task-events') { const task = taskFixture({ events: Array.from({ length: 12 }, (_, index) => ({ sequence: 118 + index, at: `2026-10-02T10:00:${String(index).padStart(2, '0')}.000Z`, phase: 'installing', message: `合成历史事件 ${119 + index}`, level: 'info' })) }); root.render(<div className="eac-market"><TaskDrawer key={renderKey} open tasks={[task]} onClose={() => {}} remote={remote} onChanged={() => {}} /></div>) }
  if (name === 'task-events-no-api') root.render(<div className="eac-market"><TaskDrawer key={renderKey} open tasks={[taskFixture()]} onClose={() => {}} remote={readOnlyRemote()} onChanged={() => {}} /></div>)
  if (name === 'task-events-legacy-cursor' || name === 'task-events-truncated' || name === 'task-events-failure') {
    const historyRemote: MarketRemote = { ...remote, taskEvents: async (request) => {
      if (name === 'task-events-failure') throw new Error('synthetic unavailable archive')
      const page = await remote.taskEvents!(request)
      return { ...page, nextSequence: name === 'task-events-legacy-cursor' ? 130 : page.nextSequence, truncated: name === 'task-events-truncated' }
    } }
    root.render(<div className="eac-market"><TaskDrawer key={renderKey} open tasks={[taskFixture()]} onClose={() => {}} remote={historyRemote} onChanged={() => {}} /></div>)
  }
  if (name === 'settings' || name === 'settings-conflict' || name === 'settings-unsafe-policy') root.render(<MarketPage key={renderKey} remote={settingsRemote} />)
  if (name === 'settings-refresh-failure') root.render(<MarketPage key={renderKey} remote={settingsRefreshFailureRemote} />)
  if (name === 'settings-foreign-environment') root.render(<MarketPage key={renderKey} remote={settingsForeignEnvironmentRemote} />)
  if (name === 'settings-capability-missing') root.render(<MarketPage key={renderKey} remote={settingsCapabilityMissingRemote} />)
  if (name === 'versions-home' || name === 'versions-installed') {
    const plugins = ['2.0.0', '1.0.0', '2.0.0-rc.2', '2.0.0-rc.10', '99.0.0', '3.0.0'].map((version) => ({ ...pluginB, id: 'same-id', name: `精确版本 ${version}`, packageName: '@test/versioned', version, verification: version === '99.0.0' ? 'hard-incompatible' as const : 'verified' as const, artifactDigest: `sha256:test-${version}` }))
    const pack: CatalogPack = { ...catalogFixture.packs[0]!, id: 'versioned-pack', name: '固定旧版套餐', components: [{ pluginId: 'same-id', version: '1.0.0', required: true }], execution: { ...catalogFixture.packs[0]!.execution, coverage: 'complete', edges: [] } }
    root.render(<MarketPage key={renderKey} remote={{ ...remote,
      catalog: async () => ({ ...catalogFixture, plugins, packs: [pack], collections: [], recommendations: [], deliveries: plugins.filter((plugin) => plugin.version !== '3.0.0').map((plugin) => ({ pluginId: plugin.id, version: plugin.version, packageName: plugin.packageName, artifactDigest: plugin.artifactDigest, sources: [{ kind: 'https-artifact', ref: 'https://example.invalid/test.tgz', priority: 0 }] })) }),
      inventory: async () => ({ ...inventoryFixture, unknownItems: [], items: name === 'versions-installed' ? [{ ...inventoryFixture.items[0]!, packageName: '@test/versioned', version: '0.5.0', restartRequired: false, rows: [] }] : [] }),
      createPlan: async (request) => makePlan(request),
      startTask: async (request) => { stats.starts.push(request); return taskFixture({ status: 'completed' }) },
    }} />)
  }
  if (name.startsWith('collection-') || name === 'pack-partial') root.render(<MarketPage key={renderKey} remote={groupRemote(name)} />)
  if (name.startsWith('trial-')) {
    const plugin = { ...pluginFixtures.unverified, id: 'trial-main', name: '目录中的资料整理助手', verification: name === 'trial-unrelated-inventory' ? 'verified' as const : pluginFixtures.unverified.verification, screenshots: name === 'trial-broken-poster' ? [{ id: 'trial-broken', sourceUrl: '/missing-trial-poster.png', alt: '作者海报' }] : [] }
    const catalog = { ...catalogFixture, recommendations: [], discovery: { featured: [], recommendedSkins: [] }, plugins: [plugin, { ...plugin, id: 'trial-second', name: '目录中的会话整理助手' }, { ...pluginFixtures.blocked, name: '真实硬不兼容插件' }] }
    root.render(<MarketPage key={renderKey} remote={{ ...remote,
      catalog: async () => catalog,
      inventory: async () => ({ ...inventoryFixture, unknownItems: name === 'trial-unrelated-inventory' ? ['bundle-version:legacy-skin'] : [], items: [] }),
      createPlan: async (request): Promise<PlanResult> => {
        if (name === 'trial-environment-blocked') { stats.plans.push(request); return { status: 'blocked', reason: '当前库存或安装活动无法完整核实，请稍后重新预检', blockers: ['inventory:unverified-state'] } }
        return makePlan(request)
      },
      startTask: async (request) => { stats.starts.push(request); return taskFixture({ status: 'queued' }) },
    }} onOpenOfficialPlugins={() => { stats.official += 1 }} />)
  }
  if (name === 'all-sections') {
    const skin = { ...pluginFixtures.verified, id: 'skin-featured', kind: 'skin' as const, skinId: 'skin-featured', name: '雾蓝工作台', packageName: '@example/skin-featured', categories: ['外观'], screenshots: [] }
    const skill = { ...pluginFixtures.unverified, id: 'skill-featured', kind: 'skill' as const, name: '资料归纳 Skill', packageName: '@example/skill-featured', categories: ['skill', '资料整理'], screenshots: [] }
    const catalog = { ...catalogFixture, plugins: [...catalogFixture.plugins, skin, skill], discovery: {
      featured: [{ pluginId: pluginFixtures.verified.id, version: pluginFixtures.verified.version, title: pluginFixtures.verified.name, summary: pluginFixtures.verified.summary, reason: '把真实任务整理成清晰的安装和使用路径。', source: 'curated' as const, order: 0 }],
      recommendedSkins: [{ pluginId: skin.id, version: skin.version, title: skin.name, summary: skin.summary, reason: '适合长时间工作的低干扰外观。', source: 'curated' as const, order: 0 }],
      highScorePlugins: [{ pluginId: pluginFixtures.verified.id, version: pluginFixtures.verified.version, title: pluginFixtures.verified.name, summary: pluginFixtures.verified.summary, reason: '维护者审核评分。', source: 'score' as const, order: 0, score: { value: 4.8, scale: 5 as const, source: 'editorial-review' } }],
      highScoreSkills: [{ pluginId: skill.id, version: skill.version, title: skill.name, summary: skill.summary, reason: '维护者审核评分。', source: 'score' as const, order: 0, score: { value: 4.6, scale: 5 as const, source: 'editorial-review' } }],
    } }
    root.render(<MarketPage key={renderKey} remote={{ ...remote, catalog: async () => catalog, inventory: async () => ({ ...inventoryFixture, items: [] }) }} />)
  }  if (name === 'home' || name === 'empty' || name === 'long' || name === 'remove') {
    root.render(<MarketPage key={renderKey} remote={{ ...remote,
      inventory: async () => name === 'remove' ? inventoryFixture : { ...inventoryFixture, items: [] },
      catalog: async () => ({ ...catalogFixture, recommendations: [{ pluginId: pluginFixtures.verified.id, placement: 'featured', order: 1, reason: '用于验证图文推荐的合成理由，不是正式推荐' }], plugins: name === 'empty' ? [] : name === 'long' ? Array.from({ length: 100 }, (_, i) => ({ ...pluginB, id: `long-${i}`, name: `很长的插件名称和详细版本说明${'长内容'.repeat(22)}${i}`, summary: '用途说明'.repeat(90), packageName: `@test/package-${i}` })) : catalogFixture.plugins }),
      refreshCatalog: async () => ({ status: 'failed', current: catalogFixture, reason: '合成来源离线' }),
      removePlugin: async () => { stats.started.push('remove'); return { status: 'applied', changed: true, permissionChanges: [] } },
    }} onOpenOfficialPlugins={() => { stats.official += 1 }} />)
  }
}
const style = document.createElement('style'); style.textContent = MARKET_CSS + 'html,body,#root{margin:0;min-height:100%;}#root.official-panel-fixture{display:flex;flex-direction:column;height:calc(100dvh - 32px);overflow:hidden;margin-top:32px;}'; document.head.append(style)
Object.assign(window, { skinFixture, fixture: { render, stats, resolveA: () => settleA(), openB: () => openB(), conflict: () => { stored = { ...stored, revision: 'changed-elsewhere' } }, forcePolicyConflict: () => { settingsPolicyConflict = true } } })
render('home')
