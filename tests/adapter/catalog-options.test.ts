import { describe, expect, it } from 'vitest'
import { desktopCatalogSourceOptions } from '../../packages/market/src/catalog-options.ts'
import { CatalogSourceRegistry } from '../../packages/market-core/src/catalog/source.ts'
import { DEFAULT_CATALOG_SOURCES } from '../../packages/market-core/src/catalog/defaults.ts'

describe('Desktop 目录来源选项', () => {
  it.each([undefined, []])('未配置和 schema 默认空数组保留 Core 默认来源', sources => {
    const options = desktopCatalogSourceOptions(sources)
    expect(options).not.toHaveProperty('catalogSources')
    const registry = new CatalogSourceRegistry(options.catalogSources ?? DEFAULT_CATALOG_SOURCES)
    expect(registry.list().map(source => source.id)).toEqual(DEFAULT_CATALOG_SOURCES.map(source => source.id))
  })

  it('只转发维护者配置的来源及非空 fallback', () => {
    const options = desktopCatalogSourceOptions([{ id: 'custom', indexUrl: 'https://example.com/index.json', maintainer: 'test', fallbackId: '' }])
    expect(options.catalogSources).toEqual([{ id: 'custom', indexUrl: 'https://example.com/index.json', maintainer: 'test', trust: 'team-registered' }])
  })
})
