import type {
  CatalogDiscovery,
  CatalogDiscoveryCard,
  CatalogPlugin,
  CatalogRecommendation,
  CatalogSnapshot,
} from '../contracts/types.ts'

type DiscoveryPlacement = 'featured' | 'recommended-skin' | 'top-plugin' | 'top-skill'

/**
 * 将目录事实投影成发现页需要的四个分区。
 *
 * 这里不自行计算“高分”：只有目录明确提供 source=score 且带评分时才进入高分分区。
 * 海报优先使用声明的首张预览，再使用旧截图或 Presentation 媒体；都没有时
 * poster 保持缺省，客户端按 title+summary 渲染固定尺寸的默认卡片。
 */
export function buildCatalogDiscovery(snapshot: Pick<CatalogSnapshot, 'plugins' | 'presentations' | 'recommendations'>): CatalogDiscovery {
  const plugins = new Map(snapshot.plugins.map(plugin => [`${plugin.id}@${plugin.version}`, plugin]))
  const presentations = new Map(snapshot.presentations.map(presentation => [presentation.id, presentation]))

  const card = (recommendation: CatalogRecommendation): CatalogDiscoveryCard | undefined => {
    const plugin = plugins.get(`${recommendation.pluginId}@${recommendation.version ?? ''}`)
      ?? [...plugins.values()].find(item => item.id === recommendation.pluginId)
    if (!plugin) return undefined
    const presentation = presentations.get(plugin.presentationId)
    const poster = plugin.media?.previews?.[0] ?? plugin.screenshots[0] ?? presentation?.media[0]
    return {
      pluginId: plugin.id,
      version: plugin.version,
      title: plugin.name,
      summary: plugin.summary,
      reason: recommendation.reason,
      source: recommendation.source ?? 'curated',
      order: recommendation.order,
      ...(recommendation.score === undefined ? {} : { score: recommendation.score }),
      ...(poster === undefined ? {} : { poster }),
    }
  }

  const byPlacement = (placement: DiscoveryPlacement): readonly CatalogDiscoveryCard[] =>
    (snapshot.recommendations ?? [])
      .filter(item => item.placement === placement)
      .map(item => {
        const plugin = plugins.get(`${item.pluginId}@${item.version ?? ''}`) ?? [...plugins.values()].find(candidate => candidate.id === item.pluginId)
        if (placement === 'recommended-skin' && plugin?.kind !== 'skin') return undefined
        if (placement === 'top-skill' && plugin?.kind !== 'skill') return undefined
        if (placement === 'top-plugin' && (plugin?.kind === 'skill' || plugin?.kind === 'skin')) return undefined
        return card(item)
      })
      .filter((item): item is CatalogDiscoveryCard => item !== undefined)
      .sort((a, b) => a.order - b.order || a.pluginId.localeCompare(b.pluginId))

  const highScore = (placement: 'top-plugin' | 'top-skill'): readonly CatalogDiscoveryCard[] =>
    byPlacement(placement)
      .filter(item => item.source === 'score' && item.score !== undefined)
      .sort((a, b) => (b.score?.value ?? -1) - (a.score?.value ?? -1) || a.order - b.order || a.pluginId.localeCompare(b.pluginId))

  const highScorePlugins = highScore('top-plugin')
  const highScoreSkills = highScore('top-skill')
  return {
    featured: byPlacement('featured'),
    recommendedSkins: byPlacement('recommended-skin'),
    ...(highScorePlugins.length ? { highScorePlugins } : {}),
    ...(highScoreSkills.length ? { highScoreSkills } : {}),
  }
}

/** 仅供生命周期投影使用，保持推荐分区与当前插件集合一致。 */
export function filterCatalogDiscovery(discovery: CatalogDiscovery | undefined, plugins: readonly CatalogPlugin[]): CatalogDiscovery | undefined {
  if (!discovery) return undefined
  const available = new Set(plugins.map(plugin => `${plugin.id}@${plugin.version}`))
  const filter = (items: readonly CatalogDiscoveryCard[] | undefined): readonly CatalogDiscoveryCard[] | undefined => {
    if (!items) return undefined
    const result = items.filter(item => available.has(`${item.pluginId}@${item.version}`))
    return result.length ? result : undefined
  }
  const featured = filter(discovery.featured) ?? []
  const recommendedSkins = filter(discovery.recommendedSkins) ?? []
  const highScorePlugins = filter(discovery.highScorePlugins)
  const highScoreSkills = filter(discovery.highScoreSkills)
  return {
    featured,
    recommendedSkins,
    ...(highScorePlugins ? { highScorePlugins } : {}),
    ...(highScoreSkills ? { highScoreSkills } : {}),
  }
}
