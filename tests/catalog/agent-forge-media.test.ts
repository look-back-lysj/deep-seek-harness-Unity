import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CatalogDisplayMedia, MarketCatalogSource } from '../../packages/market-core/src/contracts/types.ts'
import { projectAgentForgeCatalog, readAgentForgeSource } from '../../packages/market-core/src/catalog/agent-forge.ts'
import { createOfflinePack } from '../../packages/market-core/src/catalog/offline-pack.ts'
import { validateMarketIndex } from '../../packages/market-core/src/catalog/validate.ts'
import { describeOfflineArtifact } from '../../packages/market-core/src/delivery/offline-pack.ts'
import { digest, validTgz } from '../delivery/fixtures.ts'

const source = {
  schemaVersion: 2, sourceId: 'agent-forge:test:plugin', name: 'Media source', agentId: 'dsh', type: 'plugin',
  baseUrl: 'https://example.com/catalog/', index: 'index.json', revision: 'media-r1',
  generatedAt: '2026-10-05T00:00:00Z', description: 'Declared media references',
}
const record = {
  schemaVersion: 2, id: 'dev.test.alpha', name: '@test/alpha', version: '1.2.3', type: 'plugin',
  description: 'alpha', license: 'MIT',
  targets: [{ agentId: 'dsh', compatibilityStatus: 'unknown', agentVersionRange: null, compatibilityNote: '尚未验证' }],
  pluginDetails: { manifestPath: 'package.json' },
  distributions: [{ id: 'archive', type: 'archive', url: 'https://example.com/alpha.tgz' }],
  _meta: { 'org.eac.market/test': { retained: true } },
}
const icon = { url: 'https://cdn.example.org/icon.png', alt: '插件图标' }
const previews = [
  { url: 'https://CDN.Example.org:443/a/../dark.png?raw=%2f#preview', alt: ' 深色页面 ', theme: 'dark' },
  { url: 'https://cdn.example.org/light.png', alt: '浅色页面', theme: 'light' },
  { url: 'https://cdn.example.org/system.png', alt: '跟随系统页面', theme: 'system' },
  { url: 'https://cdn.example.org/neutral.png', alt: '未声明主题的页面' },
]
const media = { icon, previews }
const projectionOptions = { revision: 'media-projection-r1', generatedAt: source.generatedAt, sourceUrl: 'https://example.com/catalog/source.json' }

async function readFixture(
  value: Record<string, unknown> = { ...record, media },
  summary?: unknown,
  mode: 'local-file' | 'offline-pack' = 'local-file',
) {
  const root = mkdtempSync(join(tmpdir(), 'eac-agent-forge-media-'))
  const fetchMock = vi.fn(async () => { throw new Error('媒体引用不得触发请求') })
  const artifactBytes = validTgz(record.name, record.version)
  const artifact = describeOfflineArtifact(artifactBytes, 'alpha.tgz')
  const packageRecord = mode === 'offline-pack'
    ? { ...value, distributions: [{ ...record.distributions[0], checksum: { sha256: artifact.digest.slice(7) } }] }
    : value
  const recordBytes = Buffer.from(` \r\n${JSON.stringify(packageRecord, null, 4)}\r\n`, 'utf8')
  const index = {
    schemaVersion: 2, sourceId: source.sourceId, sourceManifest: 'source.json', agentId: source.agentId,
    type: source.type, revision: source.revision, generatedAt: source.generatedAt,
    packages: {
      [record.name]: {
        latest: record.version, versions: [record.version], path: 'packages/alpha.json',
        ...(summary === undefined ? {} : { media: summary }),
      },
    },
  }
  try {
    let location: MarketCatalogSource['location']
    if (mode === 'offline-pack') {
      const archive = createOfflinePack({
        manifest: {
          schemaVersion: '1', packId: 'media-fixture', sourceRevision: source.revision, targetAgent: 'dsh',
          packages: [{ pluginId: record.id, packageName: record.name, version: record.version, artifactDigest: artifact.digest, optional: true }],
          artifacts: [artifact],
        },
        sourceBytes: Buffer.from(JSON.stringify(source)), indexBytes: Buffer.from(JSON.stringify(index)),
        packageRecords: new Map([['packages/alpha.json', recordBytes]]), artifacts: new Map([[artifact.digest, artifactBytes]]),
      })
      const path = join(root, 'media.eacpack')
      writeFileSync(path, archive)
      location = { mode, value: path }
    } else {
      writeFileSync(join(root, 'source.json'), JSON.stringify(source))
      writeFileSync(join(root, 'index.json'), JSON.stringify(index))
      mkdirSync(join(root, 'packages'))
      writeFileSync(join(root, 'packages', 'alpha.json'), recordBytes)
      location = { mode, value: root }
    }
    const config: MarketCatalogSource = { id: 'media-test', kind: 'agent-forge', location, enabled: true, priority: 0, refreshPolicy: 'manual' }
    const catalog = await readAgentForgeSource(config, { localRoots: [root], targetAgent: 'dsh', fetch: fetchMock })
    return { catalog, recordBytes, fetchMock, artifact }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function declaredMedia(value: unknown): CatalogDisplayMedia {
  expect(value).toBeDefined()
  return value as CatalogDisplayMedia
}

const invalidMedia: readonly [string, unknown][] = [
  ['null', null], ['字符串', 'image'], ['数组', []], ['空对象', {}],
  ['未知媒体字段', { icon, poster: icon }], ['只有未知字段', { screenshots: previews }],
  ['null 图标', { icon: null }], ['数组图标', { icon: [] }], ['图标缺 URL', { icon: { alt: '图标' } }],
  ['图标缺 alt', { icon: { url: icon.url } }], ['图标不接受 theme', { icon: { ...icon, theme: 'dark' } }],
  ['图标未知字段', { icon: { ...icon, width: 100 } }],
  ['非数组预览', { previews: icon }], ['null 预览', { previews: null }], ['空预览', { previews: [] }],
  ['null 预览项', { previews: [null] }], ['预览缺 URL', { previews: [{ alt: '预览' }] }],
  ['预览缺 alt', { previews: [{ url: icon.url }] }], ['预览未知字段', { previews: [{ ...icon, id: 'native-id' }] }],
  ['空主题', { previews: [{ ...icon, theme: '' }] }], ['空白主题', { previews: [{ ...icon, theme: ' dark ' }] }],
  ['非法主题', { previews: [{ ...icon, theme: 'auto' }] }], ['大小写主题', { previews: [{ ...icon, theme: 'Dark' }] }],
  ['null 主题', { previews: [{ ...icon, theme: null }] }], ['非字符串主题', { previews: [{ ...icon, theme: 1 }] }],
]
const invalidUrls = [
  '', '/icon.png', '//cdn.example.org/icon.png', 'http://cdn.example.org/icon.png',
  'data:image/png;base64,AA==', 'file:///icon.png', 'javascript:alert(1)', 'blob:https://example.com/id',
  'https://user:secret@cdn.example.org/icon.png', 'https://user@cdn.example.org/icon.png',
  'https://@cdn.example.org/icon.png', 'https:///icon.png', 'https://',
  'https://cdn.example.org:bad/icon.png', 'https://[not-an-ip]/icon.png',
  ' https://cdn.example.org/icon.png', 'https://cdn.example.org/icon.png ',
  'https://cdn.example.org/icon.png\n', 'https://cdn.example.org/icon.png\r',
  'https://cdn.example.org/icon\n.png', 'https://cdn.example.org/icon\t.png',
  'https://cdn.example.org/icon\u0000.png', 'https://cdn.example.org/icon\u007f.png',
  'https://cdn.example.org\\icon.png', 'https://cdn.example.org/<icon>.png',
  'https://cdn.example.org/"icon".png', 'https://cdn.example.org/{icon}.png',
  'https://cdn.example.org/icon|.png', 'https://cdn.example.org/icon^.png', 'https://cdn.example.org/icon`.png',
  `https://cdn.example.org/${'a'.repeat(4096)}`,
]

describe('Agent Forge 声明媒体校验', () => {
  describe.each(['package', 'index'] as const)('%s 原始 media', location => {
    it.each(invalidMedia)('拒绝%s', async (_label, value) => {
      const result = location === 'package' ? readFixture({ ...record, media: value }) : readFixture(record, value)
      await expect(result).rejects.toMatchObject({ code: 'agent-forge/invalid-media' })
    })

    it.each(invalidUrls)('拒绝非法地址 %s', async url => {
      const value = { icon: { url, alt: '图标' } }
      const result = location === 'package' ? readFixture({ ...record, media: value }) : readFixture(record, value)
      await expect(result).rejects.toMatchObject({ code: 'agent-forge/invalid-media' })
    })

    it.each(['', ' \t\r\n\u3000', 'a'.repeat(501), null, 123])('拒绝非法 alt %s', async alt => {
      const value = { previews: [{ url: icon.url, alt }] }
      const result = location === 'package' ? readFixture({ ...record, media: value }) : readFixture(record, value)
      await expect(result).rejects.toMatchObject({ code: 'agent-forge/invalid-media' })
    })

    it('接受字符上限并保留非 ASCII 文本', async () => {
      const urlPrefix = 'https://cdn.example.org/'
      const value = { icon: { url: `${urlPrefix}${'a'.repeat(4096 - urlPrefix.length)}`, alt: '🌙'.repeat(500) } }
      const result = location === 'package' ? readFixture({ ...record, media: value }) : readFixture(record, value)
      const { catalog } = await result
      expect(catalog.packages.get(record.name)?.media ?? (catalog.index.packages as Record<string, { media: unknown }>)[record.name]?.media).toEqual(value)
    })
  })

  it('完整记录接受十二张有序预览，拒绝十三张', async () => {
    const gallery = Array.from({ length: 12 }, (_, index) => ({ url: `https://cdn.example.org/${index}.png`, alt: `页面 ${index}` }))
    const { catalog } = await readFixture({ ...record, media: { previews: gallery } })
    expect(catalog.packages.get(record.name)?.media).toEqual({ previews: gallery })
    await expect(readFixture({ ...record, media: { previews: [...gallery, icon] } })).rejects.toMatchObject({ code: 'agent-forge/invalid-media' })
  })

  it('索引摘要至多一张预览，即使完整记录合法也拒绝两张', async () => {
    await expect(readFixture({ ...record, media }, { icon, previews: previews.slice(0, 2) })).rejects.toMatchObject({ code: 'agent-forge/invalid-media' })
    const { catalog } = await readFixture({ ...record, media }, { icon, previews: previews.slice(0, 1) })
    expect(catalog.packages.get(record.name)?.media).toEqual(media)
  })

  it('拒绝同值预览，包括字段顺序不同的重复对象', async () => {
    const first = previews[0]!
    await expect(readFixture({ ...record, media: { previews: [first, { theme: first.theme, alt: first.alt, url: first.url }] } })).rejects.toMatchObject({ code: 'agent-forge/invalid-media' })
  })

  it('同 URL 的不同描述或主题不是 schema uniqueItems 重复，不丢弃', async () => {
    const gallery = [{ ...icon, theme: 'dark' }, { ...icon, theme: 'light' }, { ...icon, alt: '另一个声明' }, icon]
    const { catalog } = await readFixture({ ...record, media: { previews: gallery } })
    const projected = declaredMedia(projectAgentForgeCatalog(catalog, projectionOptions).listings?.[0]?.media)
    expect(projected.previews).toHaveLength(4)
    expect(new Set(projected.previews?.map(item => item.id)).size).toBe(4)
  })
})

describe('Agent Forge 完整记录媒体投影', () => {
  it.each(['local-file', 'offline-pack'] as const)('%s 元数据 listing 保留完整画廊、原字节及未知状态', async mode => {
    const { catalog, recordBytes, fetchMock } = await readFixture({ ...record, media }, { icon, previews: previews.slice(0, 1) }, mode)
    const document = projectAgentForgeCatalog(catalog, projectionOptions)
    const listing = document.listings?.[0]
    const projected = declaredMedia(listing?.media)
    expect(catalog.origin).toBe(mode)
    expect(projected.icon).toMatchObject({ sourceUrl: icon.url, alt: icon.alt })
    expect(projected.icon).not.toHaveProperty('theme')
    expect(projected.previews?.map(({ sourceUrl, alt, theme }) => ({ url: sourceUrl, alt, ...(theme === undefined ? {} : { theme }) }))).toEqual(previews)
    expect(projected.previews?.[3]).not.toHaveProperty('theme')
    expect(document.plugins).toEqual([])
    expect(document.deliveries).toEqual([])
    expect(document.presentations).toEqual([])
    expect(listing?.agentForgeMetadata?.document).toEqual({ contentBase64: recordBytes.toString('base64'), sha256: digest(recordBytes) })
    expect(digest(Buffer.from(JSON.stringify(JSON.parse(recordBytes.toString('utf8')))))).not.toBe(digest(recordBytes))
    const validated = validateMarketIndex(document).snapshot.listings?.[0]
    expect(validated?.hostRequirements?.declarations[0]).toMatchObject({ agentId: 'dsh', range: null, origin: 'agent-forge-target' })
    expect(validated?.media).toEqual(projected)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('可执行离线包以完整 previews 填 screenshots 和 presentation，不拿 icon 充数', async () => {
    const { catalog, recordBytes, fetchMock, artifact } = await readFixture({ ...record, media }, { icon, previews: previews.slice(0, 1) }, 'offline-pack')
    const document = projectAgentForgeCatalog(catalog, {
      ...projectionOptions,
      offlineArtifacts: [{
        pluginId: record.id, packageName: record.name, version: record.version, artifactDigest: artifact.digest, size: artifact.size,
        packageJson: JSON.stringify({ name: record.name, version: record.version, dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } }),
        files: ['package.json', 'lib/index.js', 'cordis.patch.yml'],
      }],
    })
    const plugin = document.plugins[0]
    const projected = declaredMedia(plugin?.media)
    expect(projected.previews).toHaveLength(previews.length)
    expect(plugin?.screenshots).toEqual(projected.previews)
    expect(document.presentations[0]?.media).toEqual(projected.previews)
    expect(plugin?.screenshots.map(item => item.sourceUrl)).not.toContain(icon.url)
    expect(plugin).toMatchObject({ verification: 'unknown', capabilityTier: 'unclassified', distribution: 'external', installability: 'bundle-installable', license: record.license })
    expect(plugin?.agentForgeMetadata?.document).toEqual({ contentBase64: recordBytes.toString('base64'), sha256: digest(recordBytes) })
    const validated = validateMarketIndex(document).snapshot
    expect(validated.plugins[0]?.media).toEqual(projected)
    expect(validated.plugins[0]?.screenshots).toEqual(projected.previews)
    expect(validated.presentations[0]?.media).toEqual(projected.previews)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('图片 id 跨 revision 和预览排序稳定，icon 与同 URL 预览保持区分', async () => {
    const first = await readFixture({ ...record, media: { icon, previews: [icon, ...previews] } })
    const second = await readFixture({ ...record, media: { icon, previews: [...previews].reverse().concat(icon) } })
    const initial = declaredMedia(projectAgentForgeCatalog(first.catalog, projectionOptions).listings?.[0]?.media)
    const later = declaredMedia(projectAgentForgeCatalog(second.catalog, { ...projectionOptions, revision: 'media-projection-r2' }).listings?.[0]?.media)
    expect(initial.icon).toEqual(later.icon)
    expect(initial.icon?.id).not.toBe(initial.previews?.[0]?.id)
    expect(initial.previews).toEqual([...(later.previews ?? [])].reverse())
    expect(initial.previews?.every(item => item.id.length <= 200)).toBe(true)
  })

  it.each([undefined, { icon }])('旧可执行记录与仅图标记录不虚构 screenshots 或 presentation 图片', async value => {
    const { catalog, artifact } = await readFixture({ ...record, ...(value === undefined ? {} : { media: value }) }, undefined, 'offline-pack')
    const document = projectAgentForgeCatalog(catalog, {
      ...projectionOptions,
      offlineArtifacts: [{
        pluginId: record.id, packageName: record.name, version: record.version, artifactDigest: artifact.digest, size: artifact.size,
        packageJson: JSON.stringify({ name: record.name, version: record.version, dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } }),
        files: ['package.json', 'lib/index.js', 'cordis.patch.yml'],
      }],
    })
    expect(document.plugins[0]?.screenshots).toEqual([])
    expect(document.presentations[0]?.media).toEqual([])
    if (value === undefined) {
      expect(document.plugins[0]).not.toHaveProperty('media')
    } else {
      expect(document.plugins[0]?.media?.icon).toMatchObject({ sourceUrl: icon.url, alt: icon.alt })
      expect(document.plugins[0]?.media).not.toHaveProperty('previews')
    }
  })

  it('合法但不同的 index 摘要不能替代完整记录', async () => {
    const { catalog } = await readFixture({ ...record, media }, { icon: { url: 'https://cdn.example.org/stale.png', alt: '旧图标' }, previews: [icon] })
    const projected = declaredMedia(projectAgentForgeCatalog(catalog, projectionOptions).listings?.[0]?.media)
    expect(projected.icon?.sourceUrl).toBe(icon.url)
    expect(projected.previews?.map(item => item.sourceUrl)).toEqual(previews.map(item => item.url))
  })

  it.each(['local-file', 'offline-pack'] as const)('%s 旧记录即使索引有摘要也不凭空补 media', async mode => {
    const { catalog } = await readFixture(record, { icon, previews: previews.slice(0, 1) }, mode)
    const document = projectAgentForgeCatalog(catalog, projectionOptions)
    expect(document.listings?.[0]).not.toHaveProperty('media')
    expect(catalog.packages.get(record.name)).not.toHaveProperty('media')
  })

  it.each([{ icon }, { previews }])('可选媒体分支不生成缺失的 icon/previews', async value => {
    const { catalog } = await readFixture({ ...record, media: value })
    const projected = declaredMedia(projectAgentForgeCatalog(catalog, projectionOptions).listings?.[0]?.media)
    expect(Object.keys(projected)).toEqual(Object.keys(value))
  })

  it.each(['package', 'index'] as const)('offline-pack 同样拒绝非法 %s media', async location => {
    const invalid = { icon: { ...icon, url: 'http://cdn.example.org/icon.png' } }
    const result = location === 'package' ? readFixture({ ...record, media: invalid }, undefined, 'offline-pack') : readFixture(record, invalid, 'offline-pack')
    await expect(result).rejects.toMatchObject({ code: 'agent-forge/invalid-media' })
  })
})
