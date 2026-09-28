import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MarketRuntime } from '../../packages/market/src/host/market-runtime.ts'
import { sanitizeDiagnostic } from '../../packages/market/src/host/diagnostics.ts'
import { assessRiskyAction } from '../../packages/market/src/host/management-impact.ts'
import type { AiActionImpact, CatalogPlugin } from '../../packages/market/src/contracts/types.ts'
import type { AiProposalStore } from '../../packages/market/src/host/ai-proposal-store.ts'

async function scenario(action: 'enable' | 'remove', run: (data: { runtime: MarketRuntime; calls: string[]; restart: () => MarketRuntime }) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'eac-ai-runtime-'))
  const calls: string[] = []
  let enabled = false
  let installed = true
  const manager = {
    async listBundles() { return installed ? [{ name: 'fixture', version: '1.0.0', installed: true, enabled, removable: true, rows: [], overrides: [] }] : [] },
    async listPlugins() { return [] },
    async setBundleEnabled() { calls.push('enable'); enabled = true; return { application: 'applied', changed: true } },
    async removeBundle() { calls.push('remove'); installed = false; return { application: 'applied', changed: true } },
  }
  const llm = { async *stream() {
    yield { type: 'text-delta', text: JSON.stringify({ summary: '处理所选插件', facts: ['fact-1'], actions: [{ kind: action, packageName: 'fixture', reason: '用户查看此插件的状态' }] }) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  const ctx = { profileContext: { dir: join(root, 'profile'), name: 'test' }, get: (key: string) => key === 'pluginManager' ? manager : key === 'llm' ? llm : key === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'fake', model: 'fake' }) } : undefined } as unknown as ConstructorParameters<typeof MarketRuntime>[0]
  const restart = (): MarketRuntime => new MarketRuntime(ctx, { environmentId: 'test-ai', hostVersion: '0.1.7-rc.2', profileName: 'test' }, join(root, 'market'), {
    embeddedCatalog: { schemaVersion: '1', revision: 'empty-ai-fixture', generatedAt: new Date().toISOString(), plugins: [], packs: [], presentations: [], deliveries: [] },
  })
  const runtime = restart()
  try { await run({ runtime, calls, restart }) } finally {
    await runtime.taskList()
    const rel = relative(tmpdir(), root)
    if (isAbsolute(rel) || rel.startsWith('..') || !rel.startsWith('eac-ai-runtime-')) throw new Error('Unexpected cleanup root')
    rmSync(root, { recursive: true, force: true })
  }
}

describe('AI proposal → durable confirmation → coordinated official call', () => {
  it('persists normal proposals, rejects another peer, and executes one time across duplicate confirmations/restart', async () => {
    await scenario('enable', async ({ runtime, calls, restart }) => {
      const analysis = await runtime.aiAnalyze({ packageName: 'fixture' }, 'peer-one')
      expect(analysis.status, analysis.reason).toBe('ready')
      expect((await runtime.diagnosticsExport({ packageName: 'fixture' })).diagnostics.length).toBeGreaterThan(1)
      const proposal = analysis.proposal!
      const confirm = { proposalId: proposal.id, impactDigest: proposal.impactDigest, confirmed: true as const, idempotencyKey: 'one' }
      expect((await runtime.aiConfirm(confirm, 'peer-two')).status).toBe('blocked')
      expect(calls).toHaveLength(0)
      const first = await runtime.aiConfirm(confirm, 'peer-one')
      expect(first.status, first.error).toBe('applied')
      expect(await runtime.aiConfirm({ ...confirm, idempotencyKey: 'another-click' }, 'peer-one')).toEqual(first)
      expect(await restart().aiConfirm(confirm, 'peer-one')).toEqual(first)
      expect(calls).toEqual(['enable'])
    })
  })

  it('requires a Host-issued second challenge even if a caller pre-sends riskConfirmed', async () => {
    await scenario('remove', async ({ runtime, calls }) => {
      // Synthetic reviewed impact, tested separately below. This is not a real
      // third-party data-safety or filesystem graph verification claim.
      const impact: AiActionImpact = { summary: '移除无状态fixture', currentVersion: '1.0.0', affectedPackages: ['fixture'], dataBehavior: 'test fixture has no state', unknowns: [] }
      vi.spyOn(runtime as unknown as { riskyImpact(): AiActionImpact }, 'riskyImpact').mockReturnValue(impact)
      const analysis = await runtime.aiAnalyze({ packageName: 'fixture' }, 'peer-one')
      expect(analysis.status, analysis.reason).toBe('ready')
      const proposal = analysis.proposal!
      const request = { proposalId: proposal.id, impactDigest: proposal.impactDigest, confirmed: true as const, idempotencyKey: 'remove', riskConfirmed: true as const }
      const first = await runtime.aiConfirm(request, 'peer-one')
      expect(first.status).toBe('requires-confirmation')
      expect(calls).toHaveLength(0)
      expect((await runtime.aiConfirm({ ...request, challengeId: 'forged', challengeDigest: 'bad' }, 'peer-one')).status).toBe('requires-confirmation')
      expect(calls).toHaveLength(0)
      const result = await runtime.aiConfirm({ ...request, challengeId: first.challenge!.id, challengeDigest: first.challenge!.digest }, 'peer-one')
      expect(result.status, result.error).toBe('applied')
      expect(calls).toEqual(['remove'])
    })
  })

  it('serializes concurrent confirmations with the real file lock and keeps one official call', async () => {
    await scenario('enable', async ({ runtime, calls }) => {
      const proposal = (await runtime.aiAnalyze({ packageName: 'fixture' }, 'peer-one')).proposal!
      const request = { proposalId: proposal.id, impactDigest: proposal.impactDigest, confirmed: true as const, idempotencyKey: 'concurrent' }
      const [first, second] = await Promise.all([runtime.aiConfirm(request, 'peer-one'), runtime.aiConfirm(request, 'peer-one')])
      expect(first.status, first.error).toBe('applied')
      expect(second).toEqual(first)
      expect(calls).toEqual(['enable'])
    })
  })

  it('keeps unknown dispatch non-replayable when the official call finished but proposal settlement failed', async () => {
    await scenario('enable', async ({ runtime, calls, restart }) => {
      const proposal = (await runtime.aiAnalyze({ packageName: 'fixture' }, 'peer-one')).proposal!
      const request = { proposalId: proposal.id, impactDigest: proposal.impactDigest, confirmed: true as const, idempotencyKey: 'lost-receipt' }
      const store = (runtime as unknown as { aiProposals: AiProposalStore }).aiProposals
      const put = store.put.bind(store)
      vi.spyOn(store, 'put').mockImplementation(record => record.stage === 'settled' ? Promise.reject(new Error('synthetic completion write loss')) : put(record))
      const unsettled = await runtime.aiConfirm(request, 'peer-one')
      expect(unsettled.status).toBe('unknown')
      expect(unsettled.changed).toBe(true)
      expect(calls).toEqual(['enable'])
      expect((await runtime.aiConfirm(request, 'peer-one')).status).toBe('unknown')
      expect((await restart().aiConfirm(request, 'peer-one')).status).toBe('unknown')
      expect(calls).toEqual(['enable'])
    })
  })

  it('refuses an expired proposal without writes', async () => {
    await scenario('enable', async ({ runtime, calls }) => {
      const proposal = (await runtime.aiAnalyze({ packageName: 'fixture' }, 'peer-one')).proposal!
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(proposal.expiresAt) + 1)
      try {
        const result = await runtime.aiConfirm({ proposalId: proposal.id, impactDigest: proposal.impactDigest, confirmed: true, idempotencyKey: 'expired' }, 'peer-one')
        expect(result.status).toBe('blocked')
        expect(result.error).toContain('过期')
        expect(calls).toHaveLength(0)
      } finally { clock.mockRestore() }
    })
  })

  it('rejects challenges from another peer/proposal and a changed impact, then an expired challenge', async () => {
    await scenario('remove', async ({ runtime, calls }) => {
      const impact: AiActionImpact = { summary: 'synthetic review', currentVersion: '1.0.0', affectedPackages: ['fixture'], dataBehavior: 'synthetic no-state fixture', unknowns: [] }
      const risk = vi.spyOn(runtime as unknown as { riskyImpact(): AiActionImpact }, 'riskyImpact').mockReturnValue(impact)
      const firstProposal = (await runtime.aiAnalyze({ packageName: 'fixture' }, 'peer-one')).proposal!
      const secondProposal = (await runtime.aiAnalyze({ packageName: 'fixture' }, 'peer-one')).proposal!
      const request = (proposal: typeof firstProposal) => ({ proposalId: proposal.id, impactDigest: proposal.impactDigest, confirmed: true as const, idempotencyKey: proposal.id })
      const first = await runtime.aiConfirm(request(firstProposal), 'peer-one')
      await runtime.aiConfirm(request(secondProposal), 'peer-one')
      const secondConfirmation = { riskConfirmed: true as const, challengeId: first.challenge!.id, challengeDigest: first.challenge!.digest }
      expect((await runtime.aiConfirm({ ...request(firstProposal), ...secondConfirmation }, 'peer-two')).status).toBe('blocked')
      expect((await runtime.aiConfirm({ ...request(secondProposal), ...secondConfirmation }, 'peer-one')).status).toBe('requires-confirmation')
      risk.mockReturnValue({ ...impact, dataBehavior: 'changed reviewed scope' })
      expect((await runtime.aiConfirm({ ...request(firstProposal), ...secondConfirmation }, 'peer-one')).status).toBe('blocked')
      risk.mockReturnValue(impact)
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(first.challenge!.expiresAt) + 1)
      try { expect((await runtime.aiConfirm({ ...request(firstProposal), ...secondConfirmation }, 'peer-one')).status).toBe('blocked') }
      finally { clock.mockRestore() }
      expect(calls).toHaveLength(0)
    })
  })

  it('redacts credentials, query tokens, paths, headers and contact details before model material', () => {
    const text = sanitizeDiagnostic('api_key="secret-value"\nAuthorization: Bearer sensitive-token\nC:\\Users\\private\\file.json https://user:password@example.com/a?token=private someone@example.org sk-test_secret_key_1234')
    for (const secret of ['secret-value', 'sensitive-token', 'private', 'user:password', 'someone@example.org', 'sk-test_secret']) expect(text).not.toContain(secret)
  })
})

describe('risky action evidence', () => {
  const current = { id: 'fixture', packageName: 'fixture', version: '1.0.0', artifactDigest: `sha256:${'a'.repeat(64)}`, managementEvidence: {
    reviewId: 'test-review', artifactDigest: `sha256:${'a'.repeat(64)}`, reviewedBy: 'test', reviewedAt: '2026-09-28T00:00:00Z', stateless: true,
    removePreservesExternalData: true, downgradeFrom: ['2.0.0'], explanation: 'synthetic fixture only',
  }, name: 'Synthetic fixture', summary: 'Test only', author: 'Test', distribution: 'external', capabilityTier: 'test',
    verification: 'unverified', installability: 'bundle-installable', presentationId: 'fixture', categories: [], screenshots: [],
    enabledPolicy: 'default-off', requiresRestart: false, requiresSetup: false, largeExternalResource: false } satisfies CatalogPlugin
  const inventory = { environmentId: 'test', revision: 'test', unknownItems: [], items: [
    { packageName: 'fixture', version: '1.0.0', source: 'market-cache-file' as const, installed: true, bundleEnabled: false, removable: true, rows: [], restartRequired: false },
    { packageName: 'consumer', version: '1.0.0', source: 'market-cache-file' as const, installed: true, bundleEnabled: true, removable: true, rows: [], restartRequired: false },
  ] }

  it('accepts a proven stateless fixture but blocks actual reverse dependencies and missing evidence', () => {
    const base = { kind: 'remove' as const, packageName: 'fixture', currentVersion: '1.0.0', current, inventory }
    expect(assessRiskyAction({ ...base, readManifest: name => ({ name, version: '1.0.0', resolutionKey: `/synthetic/${name}` }) }).unknowns).toEqual([])
    expect(assessRiskyAction({ ...base, readManifest: name => ({ name, version: '1.0.0', resolutionKey: `/synthetic/${name}`, ...(name === 'consumer' ? { dependencies: { fixture: '1.0.0' } } : {}) }) }).unknowns.join(' ')).toContain('依赖')
    expect(assessRiskyAction({ ...base, current: undefined, readManifest: () => undefined }).unknowns.length).toBeGreaterThan(0)
  })
})
