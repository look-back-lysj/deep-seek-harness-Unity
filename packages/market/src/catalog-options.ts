import type { DshMarketBackendOptions } from '@dsh-eac/market-core/dsh'

interface DesktopCatalogSource {
  readonly id: string
  readonly indexUrl: string
  readonly maintainer: string
  readonly fallbackId?: string
}

export function desktopCatalogSourceOptions(sources: readonly DesktopCatalogSource[] | undefined): Pick<DshMarketBackendOptions, 'catalogSources'> {
  if (sources === undefined || sources.length === 0) return {}
  return {
    catalogSources: sources.map(source => ({
      id: source.id, indexUrl: source.indexUrl, maintainer: source.maintainer, trust: 'team-registered',
      ...(source.fallbackId ? { fallbackId: source.fallbackId } : {}),
    })),
  }
}
