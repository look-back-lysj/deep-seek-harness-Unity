import { describe, expect, it } from 'vitest'
import { createPlanBundle, verifyPlanBundle } from '../../packages/market-core/src/core/planner.ts'
import { collectionPlanInput } from '../../packages/market-core/src/catalog/collections.ts'
import type { MarketCollection } from '../../packages/market-core/src/catalog/model.ts'
import type { PlanCatalogContext } from '../../packages/market-core/src/core/ports.ts'

const hash = `sha256:${'a'.repeat(64)}`
const collection: MarketCollection = {
  kind: 'MarketCollection', schemaVersion: '1', id: 'test.collection', version: '1.0.0', name: 'Test only', summary: 'Not a public Pack',
  components: [
    { pluginId: 'base', version: '1.0.0', artifactDigest: hash, releaseId: 'base-release', required: true, enabled: true },
    { pluginId: 'consumer', version: '1.0.0', artifactDigest: hash, releaseId: 'consumer-release', required: true, enabled: true },
  ],
  execution: { coverage: 'complete', provenance: 'synthetic fixture', edges: [{ prerequisiteId: 'base', consumerId: 'consumer', milestone: 'active' }] },
}
function context(): PlanCatalogContext {
  return { environmentId: 'test', hostFingerprint: 'test', catalogRevision: 'test', now: new Date(), inventory: [],
    plugins: collection.components.map(item => ({ pluginId: item.pluginId, packageName: item.pluginId, version: item.version, artifactDigest: hash, verification: 'verified', requiresRestart: false, installable: true })),
    selections: [...collection.components].reverse().map(item => ({ pluginId: item.pluginId, packageName: item.pluginId, targetVersion: item.version, targetDigest: hash, enabledIntent: true, tryUnverified: false })),
  }
}

describe('private collections share execution without forging a public Lock', () => {
  it('binds private identity/digest and preserves the real dependency order', async () => {
    const input = collectionPlanInput(collection)
    const result = await createPlanBundle(context(), input)
    expect(result.status).toBe('ready')
    expect(result.bundle?.plan).toMatchObject({ collectionId: collection.id, collectionVersion: collection.version, collectionDigest: input.collectionDigest })
    expect(result.bundle?.plan).not.toHaveProperty('packId')
    expect(result.bundle?.steps.map(step => step.pluginId)).toEqual(['base', 'consumer'])
    expect(await verifyPlanBundle(result.bundle!)).toBe(true)
  })

  it('rejects changed document bytes, removed required components and substituted versions', async () => {
    const input = collectionPlanInput(collection)
    expect((await createPlanBundle(context(), { ...input, documentBytes: new TextEncoder().encode('{}') })).status).toBe('blocked')
    expect((await createPlanBundle({ ...context(), selections: context().selections.filter(item => item.pluginId !== 'base') }, input)).status).toBe('blocked')
    expect((await createPlanBundle({ ...context(), selections: context().selections.map(item => ({ ...item, targetVersion: '2.0.0' })) }, input)).status).toBe('blocked')
  })
})
