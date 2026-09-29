import type { CatalogSourceIdentity } from './source.ts'

/** Public read-only distribution endpoint. No account or token is required.
 * Keep catalogId stable across mirror moves and retain lifecycle history. */
export const DEFAULT_CATALOG_SOURCES: readonly CatalogSourceIdentity[] = Object.freeze([
  Object.freeze({
    id: 'eac-gitee',
    catalogId: 'local-eac-skins',
    indexUrl: 'https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror/raw/master/catalog/index.json',
    maintainer: 'look-back-lysj / flowing-shadows-like-scenes',
    trust: 'team-registered' as const,
    fallbackId: 'eac-github',
  }),
  Object.freeze({
    id: 'eac-github', catalogId: 'local-eac-skins',
    indexUrl: 'https://api.github.com/repos/look-back-lysj/deep-seek-harness-Unity/contents/catalog/index.json?ref=distribution',
    maintainer: 'look-back-lysj', trust: 'team-registered' as const,
    format: 'github-raw' as const,
  }),
])
