import { describe, expect, it } from 'vitest'
import { UpdatePolicyStore } from '../../packages/market-core/src/core/update-policy-store.ts'
import { InMemoryFiles, TestLocks } from '../persistence/helpers.ts'

function createStore(files = new InMemoryFiles(), locks = new TestLocks()) {
  return { files, locks, store: new UpdatePolicyStore(files, locks) }
}

describe('UpdatePolicyStore', () => {
  it('returns safe defaults without persisting a read', async () => {
    const { files, store } = createStore()
    const snapshot = await store.get()
    expect(snapshot.policy).toEqual({ automaticChecksEnabled: true, automaticDownloadsEnabled: false, automaticInstallsEnabled: false })
    expect(snapshot.revision).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(files.files.size).toBe(0)
  })

  it('saves atomically and requires the exact current revision', async () => {
    const { files, store } = createStore()
    const initial = await store.get()
    const saved = await store.save({
      expectedRevision: initial.revision,
      policy: { automaticChecksEnabled: false, automaticDownloadsEnabled: false, automaticInstallsEnabled: false, intervalMinutes: 90 },
    })
    expect(saved.policy.intervalMinutes).toBe(90)
    expect((await store.get())).toEqual(saved)
    expect(files.files.has('settings/update-policy.json')).toBe(true)
    await expect(store.save({ expectedRevision: initial.revision, policy: initial.policy }))
      .rejects.toMatchObject({ code: 'update-policy/revision-conflict' })
  })

  it('serializes concurrent writes so only one stale revision wins', async () => {
    const { store } = createStore()
    const initial = await store.get()
    const writes = await Promise.allSettled([
      store.save({ expectedRevision: initial.revision, policy: { automaticChecksEnabled: true, automaticDownloadsEnabled: false, automaticInstallsEnabled: false } }),
      store.save({ expectedRevision: initial.revision, policy: { automaticChecksEnabled: false, automaticDownloadsEnabled: false, automaticInstallsEnabled: false } }),
    ])
    expect(writes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(writes.filter(item => item.status === 'rejected')).toHaveLength(1)
    expect(writes.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'update-policy/revision-conflict' } })
  })

  it('fails closed on corrupt data and malformed writes', async () => {
    const { files, store } = createStore()
    files.files.set('settings/update-policy.json', new TextEncoder().encode('{broken'))
    await expect(store.get()).rejects.toMatchObject({ code: 'update-policy/corrupt' })
    expect(files.files.has('settings/update-policy.json')).toBe(true)

    const fresh = createStore()
    const current = await fresh.store.get()
    await expect(fresh.store.save({ expectedRevision: current.revision, policy: { automaticChecksEnabled: true, automaticDownloadsEnabled: 'yes', automaticInstallsEnabled: false } as never }))
      .rejects.toMatchObject({ code: 'update-policy/corrupt' })
  })

  it('keeps the previous value when atomic persistence fails', async () => {
    const { files, store } = createStore()
    const initial = await store.get()
    const saved = await store.save({ expectedRevision: initial.revision, policy: { automaticChecksEnabled: false, automaticDownloadsEnabled: false, automaticInstallsEnabled: false } })
    const bytes = files.files.get('settings/update-policy.json')
    files.failNextAtomic = true
    await expect(store.save({ expectedRevision: saved.revision, policy: { automaticChecksEnabled: true, automaticDownloadsEnabled: false, automaticInstallsEnabled: false } }))
      .rejects.toThrow(/simulated atomic write failure/)
    expect(files.files.get('settings/update-policy.json')).toEqual(bytes)
    expect(await store.get()).toEqual(saved)
  })
})
