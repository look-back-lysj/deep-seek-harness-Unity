/** Runtime wiring regressions. All models, receipts and cached bytes are
 * synthetic; the actual Runtime/adapter/store/locks run without network or DSH. */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MarketRuntime } from '../../packages/market-core/src/host/market-runtime.ts'
import { sourceIdentity } from '../../packages/market-core/src/host/diagnostics.ts'
import type { AiProposalStore, SavedAiProposal } from '../../packages/market-core/src/host/ai-proposal-store.ts'
import type { JsonTaskStore } from '../../packages/market-core/src/persistence/task-store.ts'
import type { AiProposedAction, CatalogPlugin, CatalogSnapshot, DeliverySource, InstallPlan } from '../../packages/market-core/src/contracts/types.ts'
import { makeTaskRecord } from '../persistence/helpers.ts'

const empty: CatalogSnapshot = { schemaVersion: '1', revision: 'synthetic-ai-wiring', generatedAt: new Date().toISOString(),
  plugins: [], packs: [], presentations: [], deliveries: [], origin: 'embedded', stale: false }
const bytes = Buffer.from('Synthetic cache fixture; never install this as a plugin.')
const installedDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const otherDigest = `sha256:${'b'.repeat(64)}`
const source: DeliverySource = { kind: 'https-artifact', ref: 'https://synthetic.invalid/fixture.tgz', priority: 0 }
const action = (kind: AiProposedAction['kind'], targetVersion?: string) => ({ kind, packageName: 'fixture', reason: 'synthetic diagnostic',
  ...(targetVersion === undefined ? {} : { targetVersion }), ...(kind === 'retry-source' ? { sourceId: sourceIdentity(source) } : {}) })

function json(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

function release(version = '1.0.0', artifactDigest = installedDigest): CatalogPlugin {
  return { id: 'fixture', packageName: 'fixture', version, artifactDigest, name: 'Synthetic fixture', summary: 'Test only', author: 'Test',
    distribution: 'external', capabilityTier: 'test', verification: 'verified', installability: 'bundle-installable',
    presentationId: 'fixture', categories: [], screenshots: [], enabledPolicy: 'default-off', requiresRestart: false,
    requiresSetup: false, largeExternalResource: false,
    managementEvidence: { reviewId: 'synthetic-review', artifactDigest, reviewedBy: 'test', reviewedAt: '2026-09-27T00:00:00Z',
      stateless: true, removePreservesExternalData: true, downgradeFrom: ['2.0.0'], explanation: 'Synthetic review only.' } }
}

function setup(proposedAction: ReturnType<typeof action>, options: { initialModel?: boolean; installedVersion?: string; parent?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'eac-ai-wiring-'))
  const profileDir = join(root, 'profile')
  const cache = join(root, 'synthetic-artifact.tgz')
  const version = options.installedVersion ?? '1.0.0'
  writeFileSync(cache, bytes)
  json(join(root, 'installation', 'package.json'), { name: 'synthetic-host', version: '1.0.0' })
  json(join(profileDir, 'package.json'), { dependencies: { fixture: `file:${cache}` } })
  json(join(profileDir, 'node_modules', 'fixture', 'package.json'), { name: 'fixture', version })
  json(join(profileDir, 'eac-market', 'official-receipts', 'requests', 'synthetic.json'), {
    schemaVersion: 1, stage: 'received', request: { requestId: 'synthetic-request', enabled: false,
      artifact: { pluginId: 'fixture', packageName: 'fixture', version, localRef: cache, artifactDigest: installedDigest, size: bytes.length } },
    outcome: { kind: 'applied', changed: true, restartRequired: false, permissionChanges: [] },
  })
  let listed = [
    { name: 'fixture', version, installed: true, enabled: false, removable: true, rows: [], overrides: [] },
    ...(options.parent ? [{ name: 'parent', version: '1.0.0', installed: true, enabled: false, removable: true, rows: [], overrides: [] }] : []),
  ]
  const calls: string[] = []
  const providers: unknown[] = []
  const manager = { listBundles: async () => listed, listPlugins: async () => [],
    setBundleEnabled: async (name: string, enabled: boolean) => { calls.push('enable'); listed = listed.map(item => item.name === name ? { ...item, enabled } : item); return { application: 'applied', changed: true } },
    removeBundle: async (name: string) => { calls.push('remove'); listed = listed.filter(item => item.name !== name); return { application: 'applied', changed: true } } }
  const services = new Map<string, unknown>([['pluginManager', manager]])
  const loadModel = (provider = 'synthetic') => {
    services.set('llm', { async *stream(options: Record<string, unknown>) {
      providers.push(options.provider)
      yield { type: 'text-delta', text: JSON.stringify({ summary: 'synthetic probe', facts: ['fact-1'], actions: [proposedAction] }) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } })
    services.set('agentDefaultModel', { currentSelection: () => ({ provider, model: 'fake' }) })
  }
  if (options.initialModel !== false) loadModel()
  const ctx = { profileContext: { dir: profileDir, name: 'test', installAnchor: join(root, 'installation', 'package.json') }, get: (key: string) => services.get(key) }
  const runtime = new MarketRuntime(ctx as unknown as ConstructorParameters<typeof MarketRuntime>[0],
    { environmentId: 'test-ai-wiring', hostVersion: '0.1.7-rc.2', profileName: 'test' }, join(root, 'market'), { embeddedCatalog: empty })
  const internal = runtime as unknown as { aiProposals: AiProposalStore; taskStore: JsonTaskStore }
  const catalog = (plugin: CatalogPlugin) => vi.spyOn(runtime.catalog, 'load').mockReturnValue({ source: 'embedded', cacheUsable: true,
    snapshot: { ...empty, plugins: [plugin], deliveries: [{ pluginId: plugin.id, packageName: plugin.packageName, version: plugin.version, artifactDigest: plugin.artifactDigest!, sources: [source] }] } })
  return { root, profileDir, runtime, internal, calls, providers, loadModel, catalog }
}

async function scenario(proposedAction: ReturnType<typeof action>, run: (s: ReturnType<typeof setup>) => Promise<void>, options: Parameters<typeof setup>[1] = {}): Promise<void> {
  const s = setup(proposedAction, options)
  let passed = false
  try { await run(s); passed = true } finally {
    await s.runtime.taskList()
    // Failed fixtures remain for inspection; successful synthetic profiles can
    // be removed only after validating the exact path stays under our temp root.
    if (passed) {
      const rel = relative(tmpdir(), s.root)
      if (isAbsolute(rel) || rel.startsWith('..') || !rel.startsWith('eac-ai-wiring-')) throw new Error('Unexpected cleanup path')
      rmSync(s.root, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  }
}

function plan(runtime: MarketRuntime, version: string, digest: string, change: InstallPlan['items'][number]['action']): InstallPlan {
  return { schemaVersion: '1', planId: 'synthetic-original-plan', planDigest: 'f'.repeat(64), environmentId: runtime.identity.environmentId,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900_000).toISOString(), hostFingerprint: 'test', catalogRevision: empty.revision,
    items: [{ pluginId: 'fixture', packageName: 'fixture', action: change, currentVersion: '1.0.0', currentEnabled: false,
      targetVersion: version, targetDigest: digest, requestedEnabled: false, verification: 'verified', requiresRestart: false, blockers: [] }] }
}

async function originalTask(s: ReturnType<typeof setup>, version: string, digest: string) {
  const record = await makeTaskRecord({ plan: plan(s.runtime, version, digest, 'upgrade'), steps: [], dependencies: [], expected: [], bundleDigest: 'c'.repeat(64) }, 'synthetic-failed-task')
  const failed = { ...record, task: { ...record.task, status: 'failed' as const,
    items: record.task.items.map(item => ({ ...item, status: 'failed' as const, installOutcome: 'failed' as const, error: 'synthetic download failed' })) } }
  vi.spyOn(s.internal.taskStore, 'get').mockResolvedValue(failed)
  return failed
}

describe('AI Runtime wiring regressions D-W01–05', () => {
  it('W01 uses model services loaded after the market and a replacement default service', async () => {
    await scenario(action('enable'), async s => {
      expect((await s.runtime.aiAnalyze({ packageName: 'fixture' }, 'peer')).status).toBe('blocked')
      s.loadModel()
      expect((await s.runtime.aiAnalyze({ packageName: 'fixture' }, 'peer')).status).toBe('ready')
      s.loadModel('replacement')
      expect((await s.runtime.aiAnalyze({ packageName: 'fixture' }, 'peer')).status).toBe('ready')
      expect(s.providers).toEqual(['synthetic', 'replacement'])
      expect(s.calls).toHaveLength(0)
    }, { initialModel: false })
  })

  it.each(['missing-task', 'different-version', 'different-digest', 'downgrade'] as const)('W02 blocks retry-source with %s before any task dispatch', async mode => {
    const targetVersion = mode === 'downgrade' ? '1.0.0' : '3.0.0'
    await scenario(action('retry-source', targetVersion), async s => {
      s.catalog(release(targetVersion, otherDigest))
      const prepared = vi.spyOn(s.runtime, 'planCreate').mockResolvedValue({ status: 'ready', plan: plan(s.runtime, targetVersion, otherDigest, mode === 'downgrade' ? 'downgrade' : 'upgrade') })
      const dispatch = vi.spyOn(s.runtime, 'taskStart')
      if (mode !== 'missing-task') await originalTask(s, mode === 'different-version' ? '2.5.0' : targetVersion, mode === 'different-digest' ? installedDigest : otherDigest)
      const result = await s.runtime.aiAnalyze({ packageName: 'fixture', ...(mode === 'missing-task' ? {} : { taskId: 'synthetic-failed-task' }) }, 'peer')
      expect(result.status, result.reason).toBe('blocked')
      expect(result.proposal).toBeUndefined()
      expect(dispatch).not.toHaveBeenCalled()
      if (mode === 'downgrade') expect(prepared).toHaveBeenCalledOnce()
      else expect(prepared).not.toHaveBeenCalled()
      expect(s.calls).toHaveLength(0)
    }, { installedVersion: '2.0.0' })
  })

  it('W02 keeps a same-version same-digest source retry usable and dispatches the exact displayed plan once', async () => {
    await scenario(action('retry-source', '3.0.0'), async s => {
      s.catalog(release('3.0.0', otherDigest))
      const original = await originalTask(s, '3.0.0', otherDigest)
      const result = await s.runtime.aiAnalyze({ taskId: original.task.taskId }, 'peer')
      expect(result.status, result.reason).toBe('ready')
      expect(result.proposal?.plan?.items[0]?.targetDigest).toBe(otherDigest)
      const dispatch = vi.spyOn(s.runtime, 'taskStart').mockResolvedValue({ ...original.task, taskId: 'synthetic-retry-task', status: 'queued' })
      const proposal = result.proposal!
      const request = { proposalId: proposal.id, impactDigest: proposal.impactDigest, confirmed: true as const, idempotencyKey: 'retry' }
      expect((await s.runtime.aiConfirm(request, 'peer')).status).toBe('queued')
      expect((await s.runtime.aiConfirm(request, 'peer')).status).toBe('queued')
      expect(dispatch).toHaveBeenCalledOnce()
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ planId: proposal.plan!.planId, planDigest: proposal.plan!.planDigest, retryOfTaskId: original.task.taskId }), 'peer')
      expect(s.calls).toHaveLength(0)
    })
  })

  it('W03 drops cancellation after model finish but before durable proposal write', async () => {
    await scenario(action('enable'), async s => {
      const controller = new AbortController()
      const read = s.runtime.host.readState.bind(s.runtime.host)
      let reads = 0
      vi.spyOn(s.runtime.host, 'readState').mockImplementation(async () => { const state = await read(); if (++reads === 3) controller.abort(); return state })
      const put = vi.spyOn(s.internal.aiProposals, 'put')
      const result = await s.runtime.aiAnalyze({ packageName: 'fixture' }, 'peer', controller.signal)
      expect(result.status).toBe('failed')
      expect(put).not.toHaveBeenCalled()
      expect(s.calls).toHaveLength(0)
    })
  })

  it('W03 tombstones a cancellation during persistence while preserving the original proposal audit', async () => {
    await scenario(action('enable'), async s => {
      const controller = new AbortController()
      const put = s.internal.aiProposals.put.bind(s.internal.aiProposals)
      let saved: SavedAiProposal | undefined
      vi.spyOn(s.internal.aiProposals, 'put').mockImplementation(async record => { await put(record); saved = record; controller.abort() })
      const result = await s.runtime.aiAnalyze({ packageName: 'fixture' }, 'peer', controller.signal)
      expect(result.status).toBe('failed')
      expect(saved).toBeDefined()
      const proposal = saved!.proposal
      expect(existsSync(join(s.root, 'market', 'state', 'ai-proposals', `${proposal.id}.json`))).toBe(true)
      expect(existsSync(join(s.root, 'market', 'state', 'ai-proposals', `${proposal.id}.cancelled.json`))).toBe(true)
      expect(await s.internal.aiProposals.get(proposal.id)).toBeUndefined()
      expect((await s.runtime.aiConfirm({ proposalId: proposal.id, impactDigest: proposal.impactDigest, confirmed: true, idempotencyKey: 'late' }, 'peer')).status).toBe('blocked')
      await expect(put(saved!)).rejects.toThrow()
      expect(s.calls).toHaveLength(0)
    })
  })

  it.each([true, false])('W04 keeps the nested identity with hidden package.json exports (entry readable: %s)', async readable => {
    await scenario(action('remove'), async s => {
      json(join(s.profileDir, 'node_modules', 'parent', 'package.json'), { name: 'parent', version: '1.0.0', dependencies: { shared: '1.0.0' } })
      const nested = join(s.profileDir, 'node_modules', 'parent', 'node_modules', 'shared')
      json(join(nested, 'package.json'), { name: 'shared', version: '1.0.0', exports: { '.': './index.js' }, peerDependencies: { fixture: '1.0.0' } })
      if (readable) writeFileSync(join(nested, 'index.js'), '/* synthetic entry: resolve only, never execute */')
      json(join(s.profileDir, 'node_modules', 'shared', 'package.json'), { name: 'shared', version: '1.0.0' })
      s.catalog(release())
      const result = await s.runtime.aiAnalyze({ packageName: 'fixture' }, 'peer')
      expect(result.status, result.reason).toBe('ready')
      expect(result.proposal!.impact!.unknowns.join(' ')).toContain('依赖')
      if (readable) expect(result.proposal!.impact!.affectedPackages).toContain('shared')
      const proposal = result.proposal!
      expect((await s.runtime.aiConfirm({ proposalId: proposal.id, impactDigest: proposal.impactDigest, confirmed: true, idempotencyKey: 'remove' }, 'peer')).status).toBe('blocked')
      expect(s.calls).toHaveLength(0)
    }, { parent: true })
  })

  it('W05 blocks review evidence for different bytes under the same installed package/version', async () => {
    await scenario(action('remove'), async s => {
      s.catalog(release('1.0.0', otherDigest))
      const inventory = (await s.runtime.host.readState()).inventory
      expect(inventory.items[0]?.source).toBe('market-cache-file')
      expect(inventory.items[0]?.artifactDigest).toBe(installedDigest)
      const result = await s.runtime.aiAnalyze({ packageName: 'fixture' }, 'peer')
      expect(result.status, result.reason).toBe('ready')
      expect(result.proposal!.impact!.unknowns.join(' ')).toContain('摘要')
      const proposal = result.proposal!
      expect((await s.runtime.aiConfirm({ proposalId: proposal.id, impactDigest: proposal.impactDigest, confirmed: true, idempotencyKey: 'mismatched-review' }, 'peer')).status).toBe('blocked')
      expect(s.calls).toHaveLength(0)
    })
  })

  it('W05 allows a complete matching review only as far as a separate risk challenge', async () => {
    await scenario(action('remove'), async s => {
      s.catalog(release())
      const result = await s.runtime.aiAnalyze({ packageName: 'fixture' }, 'peer')
      expect(result.status, result.reason).toBe('ready')
      expect(result.proposal!.impact!.unknowns).toEqual([])
      const proposal = result.proposal!
      expect((await s.runtime.aiConfirm({ proposalId: proposal.id, impactDigest: proposal.impactDigest, confirmed: true, idempotencyKey: 'matching-review' }, 'peer')).status).toBe('requires-confirmation')
      expect(s.calls).toHaveLength(0)
    })
  })
})
