import { describe, expect, it } from 'vitest'
import { CatalogSourceRegistry, isRegisteredCatalogRedirect } from '../../packages/market/src/catalog/source.ts'
import { DEFAULT_CATALOG_SOURCES } from '../../packages/market/src/catalog/defaults.ts'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { validateProductionCatalog, CatalogRepository, validateMarketIndex } from '../../packages/market/src/catalog/index.ts'

describe('公开目录来源', () => {
  it('随包目录覆盖完整清点，并只给已有制品的条目提供固定公开下载地址', () => {
    const input = JSON.parse(readFileSync(new URL('../../packages/market/data/index.json', import.meta.url), 'utf8'))
    const inventory = JSON.parse(readFileSync(new URL('../../catalog-source/eac-inventory/inventory.json', import.meta.url), 'utf8'))
    const catalog = validateProductionCatalog(input).snapshot
    expect(new Set([...catalog.plugins, ...catalog.listings ?? []].map(p => p.packageName))).toEqual(new Set(inventory.plugins.map((p: any) => p.packageName)))
    expect(catalog.deliveries.length).toBeGreaterThan(0)
    for (const delivery of catalog.deliveries) expect(delivery.sources.every(s => s.kind === 'https-artifact' && /\/raw\/[a-f0-9]{40}\//.test(s.ref) || /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f0-9]{40}\//.test(s.ref))).toBe(true)
    for (const name of ['@deepseek-ai/dsh-terminal', '@deepseek-ai/dsh-plugin-manager']) expect(catalog.plugins.find(p => p.packageName === name)?.installability).toBe('hard-blocked')
    expect(catalog.plugins.filter(p => p.kind === 'skin')).toHaveLength(13)
  })
  it('真实历史seq2升级到随包公开目录后，旧版皮肤撤回仍保留', async () => {
    const old = JSON.parse(readFileSync(new URL('../../catalog-source/distribution/predecessor-index.json', import.meta.url), 'utf8'))
    const nextBytes = readFileSync(new URL('../../packages/market/data/index.json', import.meta.url))
    const next = JSON.parse(nextBytes.toString('utf8'))
    const root = mkdtempSync(join(tmpdir(), 'eac-public-upgrade-'))
    const before = new CatalogRepository(old, root)
    expect((await before.refresh(async () => JSON.stringify(old))).status).toBe('refreshed')
    const repo = new CatalogRepository(next, root, {}, nextBytes)
    expect((await repo.refresh(async () => nextBytes)).status).toBe('refreshed')
    for (const plugin of old.plugins.filter((p: any) => /skin-(miku|trading)$/.test(p.packageName))) expect(() => repo.assertReleaseActive(plugin.id, plugin.version, plugin.artifactDigest)).toThrow()
    expect((await repo.refresh(async () => JSON.stringify(old))).status).toBe('failed')
  })
  it('皮肤ID严格遵循加载器公约，单字符有效，大写和连续分隔无效', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../packages/market/data/index.json', import.meta.url), 'utf8'))
    const plugin = fixture.plugins.find((p: any) => p.packageName === '@dsh-eac/skin-aurora')
    const metadata = JSON.parse(Buffer.from(plugin.metadata.packageJson.contentBase64, 'base64').toString('utf8'))
    for (const id of ['a', '0', 'dsh-eac.skin.aurora', 'Bad_ID', 'bad..id', 'bad_id']) {
      const changed = structuredClone(fixture)
      const target = changed.plugins.find((p: any) => p.id === plugin.id)
      metadata.dsh.skin.id = id
      const bytes = Buffer.from(JSON.stringify(metadata))
      target.metadata.packageJson = { contentBase64: bytes.toString('base64'), sha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex') }
      changed.releases.find((r: any) => r.releaseId === target.releaseId).metadataDigest = target.metadata.packageJson.sha256
      if (['a', '0', 'dsh-eac.skin.aurora'].includes(id)) expect(() => validateMarketIndex(changed)).not.toThrow()
      else expect(() => validateMarketIndex(changed)).toThrow(/皮肤声明/)
    }
  })
  it('只接受登记 Gitee 文件的官方内容域跳转，不放宽到任意仓库或私网', async () => {
    const source = DEFAULT_CATALOG_SOURCES[0]!
    const target = new URL(source.indexUrl.replace('gitee.com', 'raw.giteeusercontent.com'))
    target.search = '?metadata=opaque&signature=signed'
    expect(isRegisteredCatalogRedirect(source.indexUrl, target)).toBe(true)
    for (const url of [target.href.replace('/flowing-shadows-like-scenes/', '/someone-else/'), target.href.replace('raw.giteeusercontent.com', 'evil.org'), target.href + '&redirect=http://localhost/', target.href.replace('https:', 'http:')]) {
      expect(isRegisteredCatalogRedirect(source.indexUrl, new URL(url))).toBe(false)
    }
    const calls: string[] = []
    const registry = new CatalogSourceRegistry(DEFAULT_CATALOG_SOURCES, {
      security: { lookup: async () => ['93.184.216.34'] },
      fetch: (async url => {
        calls.push(String(url))
        return calls.length === 1 ? new Response(null, { status: 302, headers: { location: target.href } }) : new Response('{"catalog":true}')
      }) as typeof fetch,
    })
    expect(new TextDecoder().decode(await registry.connection().read())).toBe('{"catalog":true}')
    expect(calls).toEqual([source.indexUrl, target.href])
  })
})
