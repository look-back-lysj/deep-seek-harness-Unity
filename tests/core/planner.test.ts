import { describe, expect, it } from 'vitest'
import { verifyPlanBundle } from '../../packages/market-core/src/core/planner.ts'
import { makeBundle } from './helpers.ts'

describe('core planner', () => {
  it('binds PackExecution to exact Lock bytes and rejects drift', async () => {
    const ok = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }], lockBytes: new TextEncoder().encode('lock-a') })
    expect(ok.plan.packExecutionDigest).toHaveLength(64)
    await expect(verifyPlanBundle(ok)).resolves.toBe(true)

    const result = await (await import('../../packages/market-core/src/core/planner.ts')).createPlanBundle({
      planId: 'plan-drift',
      catalogRevision: 'catalog-1',
      environmentId: 'env-test',
      hostFingerprint: 'host-test',
      inventory: [],
      plugins: [{ pluginId: 'p0', packageName: 'a', version: '1.0.0', artifactDigest: 'digest-a', verification: 'verified', requiresRestart: false, installable: true }],
      selections: [{ pluginId: 'p0', packageName: 'a', targetVersion: '1.0.0', targetDigest: 'digest-a', enabledIntent: true, tryUnverified: false }],
      now: new Date('2026-09-27T00:00:00Z'),
    }, {
      packId: 'pack-test',
      packVersion: '1.0.0',
      components: [{ pluginId: 'p0', required: true }],
      execution: {
        schemaVersion: '1',
        packId: 'pack-test',
        packVersion: '1.0.0',
        lockDigest: 'wrong',
        coverage: 'complete',
        edges: [],
        provenance: 'synthetic-test-only',
      },
      lockBytes: new TextEncoder().encode('actual-lock'),
    })
    expect(result.status).toBe('blocked')
    expect(result.details).toContain('pack-execution:lock-digest-mismatch')
  })

  it('creates immutable plan and detects digest tampering', async () => {
    const bundle = await makeBundle({ plugins: [{ packageName: 'a', version: '1.0.0' }] })
    expect(Object.isFrozen(bundle)).toBe(true)
    expect(Object.isFrozen(bundle.plan)).toBe(true)
    expect(Object.isFrozen(bundle.plan.items[0])).toBe(true)
    const tampered = { ...bundle, plan: { ...bundle.plan, planDigest: '0'.repeat(64) } }
    await expect(verifyPlanBundle(tampered)).resolves.toBe(false)
  })

  it('orders PackExecution dependencies topologically', async () => {
    const bundle = await makeBundle({
      plugins: [{ packageName: 'first', version: '1.0.0' }, { packageName: 'second', version: '1.0.0' }],
      edges: [{ prerequisiteId: 'p1', consumerId: 'p0', milestone: 'installed' }],
    })
    expect(bundle.plan.items.map((item) => item.pluginId)).toEqual(['p1', 'p0'])
    expect(bundle.steps.map((step) => step.pluginId)).toEqual(['p1', 'p0'])
  })

  it('rejects incomplete dependency coverage and protects local identities', async () => {
    await expect(makeBundle({
      plugins: [{ packageName: 'a', version: '1.0.0' }],
      coverage: 'partial',
    })).rejects.toThrow(/coverage-partial/)
    const blocked = await makeBundle({
      plugins: [{ packageName: 'local', version: '1.0.0', currentVersion: '0.9.0', localIdentity: 'file' }],
    })
    expect(blocked.plan.items[0]?.action).toBe('blocked')
    expect(blocked.plan.items[0]?.blockers).toContain('local-identity:protected')
  })
})
