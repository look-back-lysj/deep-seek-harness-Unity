import { describe, expect, it } from 'vitest'
import { MaintenanceIntentStore } from '../../packages/market-core/src/core/maintenance-intent-store.ts'
import { InMemoryFiles, TestLocks } from '../persistence/helpers.ts'

function fixture(files = new InMemoryFiles(), locks = new TestLocks()) {
  return { files, locks, store: new MaintenanceIntentStore(files, locks) }
}

describe('MaintenanceIntentStore', () => {
  it('persists explicit selections separately from dependency edges and restores after recreation', async () => {
    const { files, locks, store } = fixture()
    const first = await store.recordPlan(['@test/app'], [{ prerequisite: '@test/base', consumer: '@test/app' }])
    expect(first.explicitPackages).toEqual(['@test/app'])
    expect(first.dependencyEdges).toEqual([{ prerequisite: '@test/base', consumer: '@test/app' }])
    expect(await new MaintenanceIntentStore(files, locks).load()).toEqual(first)
  })

  it('does not infer explicit intent from success records and replaces the selected consumer graph', async () => {
    const { store } = fixture()
    await store.recordPlan(['@test/app', '@test/other'], [
      { prerequisite: '@test/base-v1', consumer: '@test/app' },
      { prerequisite: '@test/base', consumer: '@test/other' },
    ])
    const next = await store.recordPlan(['@test/app'], [{ prerequisite: '@test/base-v2', consumer: '@test/app' }])
    expect(next.explicitPackages).toEqual(['@test/app', '@test/other'])
    expect(next.dependencyEdges).toEqual([
      { prerequisite: '@test/base', consumer: '@test/other' },
      { prerequisite: '@test/base-v2', consumer: '@test/app' },
    ])
  })

  it('clears an explicitly removed package and all edges involving it', async () => {
    const { store } = fixture()
    await store.recordPlan(['@test/app'], [{ prerequisite: '@test/base', consumer: '@test/app' }])
    expect(await store.clearPackage('@test/base')).toMatchObject({ explicitPackages: ['@test/app'], dependencyEdges: [] })
    expect(await store.clearPackage('@test/app')).toMatchObject({ explicitPackages: [], dependencyEdges: [] })
  })

  it('detects checksum corruption and retains original bytes for diagnosis', async () => {
    const { files, store } = fixture()
    await store.setExplicit('@test/app', true)
    const path = 'maintenance/intent.json'
    const document = JSON.parse(new TextDecoder().decode(files.files.get(path)!)) as { state: { explicitPackages: string[] } }
    document.state.explicitPackages = ['@test/other']
    files.files.set(path, new TextEncoder().encode(JSON.stringify(document)))
    const corrupted = new Uint8Array(files.files.get(path)!)
    await expect(store.load()).rejects.toMatchObject({ code: 'maintenance/intent-checksum' })
    expect(files.files.get(path)).toEqual(corrupted)
  })

  it('serializes concurrent explicit changes without losing either', async () => {
    const { files, locks, store } = fixture()
    await Promise.all([store.setExplicit('@test/a', true), store.setExplicit('@test/b', true)])
    expect(await new MaintenanceIntentStore(files, locks).load()).toMatchObject({ explicitPackages: ['@test/a', '@test/b'] })
  })
})
