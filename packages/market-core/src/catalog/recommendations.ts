import type { CatalogPlugin, CatalogRecommendation, CatalogScore } from '../contracts/types.ts'
import * as v from './input.ts'

/** 暂存在 B 私有投影类型；主控给 wire 加同名可选字段即可保持跨层范围。 */
export type RecommendationProjection = CatalogRecommendation & { readonly version?: string }

const PLACEMENTS = ['featured', 'recommended-skin', 'top-plugin', 'top-skill', 'category', 'guide'] as const

/** 人工推荐独立于 distribution；只投影仍生效且确实存在的内容。 */
export function parseRecommendations(value: unknown, plugins: readonly CatalogPlugin[], now: Date, strict: boolean): readonly RecommendationProjection[] {
  if (value === undefined) return []
  const seen = new Set<string>()
  return v.array(value, 'recommendations', 10000).flatMap(value => {
    const item = v.object(value, 'recommendation')
    const pluginId = v.string(item.pluginId, 'recommendation.pluginId', 200)
    if (!PLACEMENTS.includes(String(item.placement) as typeof PLACEMENTS[number])) v.invalid('recommendation-placement', '推荐位置无效')
    const version = item.version === undefined ? undefined : v.exactVersion(item.version, 'recommendation.version')
    const matches = plugins.filter(plugin => plugin.id === pluginId && (version === undefined || plugin.version === version))
    if (!matches.length) v.invalid('recommendation-target', '推荐引用了不存在的插件版本')
    const key = `${pluginId}@${version ?? '*'}:${String(item.placement)}`
    if (seen.has(key)) v.invalid('recommendation-duplicate', '同一位置的插件推荐重复')
    seen.add(key)
    if (strict) {
      v.string(item.id, 'recommendation.id', 200)
      v.string(item.curator, 'recommendation.curator', 200)
      if (version === undefined) v.invalid('recommendation-version', 'v2 推荐必须绑定精确版本')
      v.timestamp(item.effectiveAt, 'recommendation.effectiveAt')
      v.boolean(item.withdrawn, 'recommendation.withdrawn')
    }
    const effectiveAt = item.effectiveAt === undefined ? undefined : v.timestamp(item.effectiveAt, 'effectiveAt')
    const expiresAt = item.expiresAt === undefined ? undefined : v.timestamp(item.expiresAt, 'expiresAt')
    if (effectiveAt && expiresAt && expiresAt <= effectiveAt) v.invalid('recommendation-period', '推荐过期时间必须晚于生效时间')
    const source = item.source === undefined ? undefined : item.source
    if (source !== undefined && source !== 'curated' && source !== 'score') v.invalid('recommendation-source', '推荐来源无效')
    let score: CatalogScore | undefined
    if (item.score !== undefined) {
      const scoreRecord = v.object(item.score, 'recommendation.score')
      const value = typeof scoreRecord.value === 'number' && Number.isFinite(scoreRecord.value) ? scoreRecord.value : v.invalid('recommendation-score', '评分必须是有限数字')
      if (value < 0 || value > 5) v.invalid('recommendation-score', '评分必须在 0..5')
      if (scoreRecord.scale !== 5) v.invalid('recommendation-score', '评分 scale 必须是 5')
      score = {
        value,
        scale: 5,
        source: v.string(scoreRecord.source, 'recommendation.score.source', 200),
        ...(scoreRecord.measuredAt === undefined ? {} : { measuredAt: v.timestamp(scoreRecord.measuredAt, 'recommendation.score.measuredAt') }),
      }
    }
    if (source === 'score' && score === undefined) v.invalid('recommendation-score-missing', '评分推荐必须提供可解释的评分来源')
    const record: RecommendationProjection = {
      pluginId, placement: item.placement as CatalogRecommendation['placement'], order: v.integer(item.order, 'recommendation.order', 0, 100000), reason: v.string(item.reason, 'recommendation.reason'),
      ...(source === undefined ? {} : { source }),
      ...(score === undefined ? {} : { score }),
      ...(version === undefined ? {} : { version }),
      ...(item.evidence === undefined ? {} : { evidence: v.string(item.evidence, 'recommendation.evidence') }),
    }
    if (item.withdrawn === true || effectiveAt && Date.parse(effectiveAt) > now.getTime() || expiresAt && Date.parse(expiresAt) <= now.getTime() || matches.every(plugin => plugin.installability === 'hard-blocked')) return []
    return [record]
  }).sort((a, b) => a.order - b.order || a.pluginId.localeCompare(b.pluginId))
}
