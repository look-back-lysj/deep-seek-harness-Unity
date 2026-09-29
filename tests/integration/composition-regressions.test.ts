import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { MarketRuntime } from '../../packages/market-core/src/host/market-runtime.ts'
import { CatalogArtifactPort } from '../../packages/market-core/src/adapters/dsh/artifact-adapter.ts'
import type { ArtifactCache } from '../../packages/market-core/src/delivery/cache.ts'
import type { CatalogDelivery } from '../../packages/market-core/src/contracts/types.ts'

const digest = `sha256:${'a'.repeat(64)}`
const delivery: CatalogDelivery = {
  pluginId: 'test.bound-source', packageName: '@test/bound-source', version: '1.0.0', artifactDigest: digest,
  sources: [{ kind: 'https-artifact', ref: 'https://approved.invalid/v1.tgz', priority: 0 }],
}

async function withRuntime(action: (runtime: MarketRuntime) => Promise<void>): Promise<void> {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'eac-host-wiring-'))
  const ctx = { profileContext: { dir: join(temporaryRoot, 'profile'), name: 'isolated-test' }, get: () => undefined } as unknown as Context
  const runtime = new MarketRuntime(ctx, { environmentId: 'wiring-test', profileName: 'isolated-test', hostVersion: '0.1.7-rc.2' }, join(temporaryRoot, 'market'), {
    catalogSources: [], // This failure fixture must never contact the default public mirror.
    embeddedCatalog: { schemaVersion: '1', revision: 'empty-test', generatedAt: new Date().toISOString(), plugins: [], packs: [], presentations: [], deliveries: [] },
  })
  try {
    await action(runtime)
  } finally {
    await runtime.taskList()
    const rel = relative(tmpdir(), temporaryRoot)
    if (isAbsolute(rel) || rel.startsWith('..') || !rel.startsWith('eac-host-wiring-')) throw new Error('Unexpected cleanup target')
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

describe('Host composition regressions', () => {
  it('reports a missing registered source as a failed refresh while retaining the old catalog', async () => {
    await withRuntime(async (runtime) => {
      const result = await runtime.catalogRefresh()
      expect(result.status).toBe('failed')
      expect(result.reason).toBeTruthy()
      expect(result.current.revision).toBe('empty-test')
      expect((await runtime.catalogRefresh({ sourceUrl: 'https://unregistered.invalid/catalog.json' })).status).toBe('failed')
    })
  })

  it('retains imported author provenance when the UI exports without replacement fields', async () => {
    await withRuntime(async (runtime) => {
      const draft = runtime.authorDraftSave({ title: 'Original author', summary: 'A draft', markdown: '# Guide', mediaIds: [] })
      const provenance = { repositoryUrl: 'https://github.com/example/example', commit: 'a'.repeat(40), license: 'MIT', licenseNotice: 'Original author notice' }
      runtime.authoring.export(draft.id, provenance)
      const transfer = runtime.authorExportDraft({ draftId: draft.id })
      expect(transfer.complete).toBe(true)
      expect(runtime.authoring.readProvenance(draft.id)).toEqual(provenance)
      runtime.authorExportDraft({ draftId: draft.id, notes: 'Editorial update' })
      expect(runtime.authoring.readProvenance(draft.id)).toMatchObject({ ...provenance, notes: 'Editorial update' })
    })
  })

  it('does not let an author read another draft image by knowing its ID', async () => {
    await withRuntime(async (runtime) => {
      const draft = runtime.authorDraftSave({ title: 'No media', summary: '', markdown: '', mediaIds: [] })
      const read = vi.spyOn(runtime.authoring.media, 'get')
      expect(() => runtime.authorMediaRead({ draftId: draft.id, mediaId: 'img_someone_else' })).toThrow('不属于当前草稿')
      expect(read).not.toHaveBeenCalled()
    })
  })
})

describe('frozen artifact source at the real adapter boundary', () => {
  it('passes the approved delivery and cancellation to the downloader even if the live catalog has changed', async () => {
    const download = vi.fn(async () => ({ localPath: 'synthetic-cache.tgz', verified: { size: 1 } }))
    const changed = { ...delivery, sources: [{ kind: 'https-artifact' as const, ref: 'https://unapproved.invalid/new.tgz', priority: 0 }] }
    const live = vi.fn(() => [changed])
    const adapter = new CatalogArtifactPort({ download } as unknown as ArtifactCache, live)
    const signal = new AbortController().signal
    await adapter.acquire({ requestId: 'one', pluginId: delivery.pluginId, packageName: delivery.packageName, version: delivery.version, artifactDigest: digest, sourceRef: 'frozen', delivery }, signal)
    expect(live).not.toHaveBeenCalled()
    expect(download).toHaveBeenCalledWith(delivery, expect.objectContaining({ signal }))
  })

  it('requires fresh preflight for old plans without frozen sources and rejects a different identity', async () => {
    const download = vi.fn()
    const adapter = new CatalogArtifactPort({ download } as unknown as ArtifactCache, () => [delivery])
    const request = { requestId: 'old', pluginId: delivery.pluginId, packageName: delivery.packageName, version: delivery.version, artifactDigest: digest, sourceRef: 'old-live-reference' }
    await expect(adapter.acquire(request)).rejects.toThrow('重新查看安装方案')
    await expect(adapter.acquire({ ...request, delivery: { ...delivery, version: '2.0.0' } })).rejects.toThrow('不一致')
    expect(download).not.toHaveBeenCalled()
  })
})
