import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDshMarketBackend } from '../../packages/market-core/src/dsh.ts'
import { context, embedded, freshDirectory, identity, removeDirectory } from './helpers.ts'

describe('Agent Forge媒体通过后端API与耐久目录', () => {
  it('完整登记media经过读取、投影、合并和重开；不代理图片或升级为可安装', async () => {
    const directory = freshDirectory()
    const sourceRoot = join(directory, 'agent-forge-media')
    mkdirSync(join(sourceRoot, 'packages'), { recursive: true })
    const media = {
      icon: { url: 'https://images.example.test/icon.png', alt: '合成来源图标' },
      previews: [
        { url: 'https://images.example.test/dark.png', alt: '第一张预览', theme: 'dark' },
        { url: 'https://images.example.test/light.png', alt: '第二张预览', theme: 'light' },
      ],
    }
    const record = { schemaVersion: 2, id: 'dev.test.media', name: '@test/media', version: '1.2.3', type: 'plugin', description: '媒体合同合成测试',
      license: 'MIT', targets: [{ agentId: 'dsh', compatibilityStatus: 'known', agentVersionRange: '*' }],
      pluginDetails: { manifestPath: 'package.json' }, distributions: [{ id: 'archive', type: 'archive', url: 'https://example.test/media.tgz' }], media }
    const source = { schemaVersion: 2, sourceId: 'agent-forge:media:plugin', name: 'media-test', agentId: 'dsh', type: 'plugin',
      baseUrl: 'https://example.test/agent-forge/', index: 'index.json', revision: 'media-r1', generatedAt: '2026-10-01T00:00:00Z', description: '合成来源' }
    const index = { schemaVersion: 2, sourceId: source.sourceId, sourceManifest: 'source.json', agentId: 'dsh', type: 'plugin', revision: source.revision,
      generatedAt: source.generatedAt, packages: { '@test/media': { id: record.id, latest: record.version, versions: [record.version],
        path: 'packages/media.json', recordRevision: source.revision, media: { icon: media.icon, previews: [media.previews[0]] } } } }
    writeFileSync(join(sourceRoot, 'source.json'), JSON.stringify(source))
    writeFileSync(join(sourceRoot, 'index.json'), JSON.stringify(index))
    writeFileSync(join(sourceRoot, 'packages/media.json'), JSON.stringify(record))
    const fetchMedia = vi.fn(async () => { throw new Error('后端不得下载展示媒体') })
    const installBundle = vi.fn(async () => { throw new Error('元数据不得触发安装') })
    const manager = { listBundles: async () => [], listPlugins: async () => [], installBundle }
    const options = { embeddedCatalogBytes: Buffer.from(JSON.stringify(embedded)), catalogSources: [],
      agentForgeSources: [{ id: 'af-media-test', kind: 'agent-forge' as const, location: { mode: 'local-file' as const, value: sourceRoot },
        enabled: true, priority: 5, refreshPolicy: 'manual' as const }],
      agentForgeSourceOptions: { targetAgent: 'dsh', localRoots: [sourceRoot], fetch: fetchMedia as unknown as typeof fetch } }
    const backend = createDshMarketBackend(context(directory, manager), identity, join(directory, 'market'), options)
    try {
      await backend.taskList()
      const refreshed = await backend.agentForgeRefresh({ sourceId: 'af-media-test' })
      expect(refreshed.status).toBe('refreshed')
      const listing = backend.catalog().listings?.find(item => item.packageName === record.name)
      expect(listing?.media?.icon).toMatchObject({ alt: media.icon.alt, sourceUrl: media.icon.url })
      expect(listing?.media?.previews).toHaveLength(2)
      expect(listing?.media?.previews?.map(item => ({ sourceUrl: item.sourceUrl, alt: item.alt, theme: item.theme })))
        .toEqual(media.previews.map(item => ({ sourceUrl: item.url, alt: item.alt, theme: item.theme })))
      expect(backend.catalog().plugins).toEqual([])
      expect(listing).not.toHaveProperty('installability')
      expect(fetchMedia).not.toHaveBeenCalled()
      expect(installBundle).not.toHaveBeenCalled()
      const reopened = createDshMarketBackend(context(directory, manager), identity, join(directory, 'market'), options)
      await reopened.taskList()
      expect(JSON.parse(JSON.stringify(reopened.catalog().listings))).toEqual(JSON.parse(JSON.stringify(backend.catalog().listings)))
      expect(fetchMedia).not.toHaveBeenCalled()
      expect(installBundle).not.toHaveBeenCalled()
    } finally {
      await backend.taskList()
      removeDirectory(directory)
    }
  })
})
