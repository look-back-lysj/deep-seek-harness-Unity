import { describe, expect, it } from 'vitest'
import { CatalogSourceRegistry } from '../../packages/market-core/src/catalog/source.ts'
import { DEFAULT_CATALOG_SOURCES } from '../../packages/market-core/src/catalog/defaults.ts'
import { desktopHttpsFetch } from '../../packages/market-core/src/delivery/https-reader.ts'

describe('公开目录故障切换', () => {
  it('Gitee451时读取已登记GitHub原字节，保留同一目录身份，不使用登录凭据', async () => {
    const calls: Array<{ url: string; headers: Headers }> = []
    const json = '{"schemaVersion":"2","revision":"synthetic-fallback"}\n'
    const registry = new CatalogSourceRegistry(DEFAULT_CATALOG_SOURCES, {
      security: { lookup: async () => ['93.184.216.34'] },
      fetch: (async (input, init) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers) })
        return calls.length === 1 ? new Response('restricted', { status: 451 }) : new Response(json)
      }) as typeof fetch,
    })
    const read = await registry.connection().readResult!()
    expect(Buffer.from(read.bytes).toString()).toBe(json)
    expect(read.source.id).toBe('eac-github')
    expect(read.source.catalogId).toBe('local-eac-skins')
    expect(read.fallbackUsed).toBe(true)
    expect(calls[1]?.headers.get('accept')).toBe('application/vnd.github.raw+json')
    expect(calls.every(c => !c.headers.has('authorization'))).toBe(true)
  })
  it('备用源仍绑定确切地址，不允许借格式声明改变信任域', async () => {
    expect(() => new CatalogSourceRegistry([{ ...DEFAULT_CATALOG_SOURCES[1]!, indexUrl: 'https://arbitrary.test/file' }])).toThrow(/官方API/)
    const registry = new CatalogSourceRegistry([DEFAULT_CATALOG_SOURCES[1]!], {
      security: { lookup: async () => ['93.184.216.34'] },
      fetch: (async () => new Response(null, { status: 302, headers: {location:'https://elsewhere.test/index.json'} })) as typeof fetch,
    })
    await expect(registry.connection().read()).rejects.toMatchObject({code:'catalog/source-redirect-not-registered'})
  })
  it('桌面传输不允许降级HTTP或携带非GET写操作', async () => {
    await expect(desktopHttpsFetch('http://localhost')).rejects.toThrow(/HTTPS GET/)
    await expect(desktopHttpsFetch('https://example.test', {method:'POST'})).rejects.toThrow(/HTTPS GET/)
  })
})
