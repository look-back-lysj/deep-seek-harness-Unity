/** 市场团队审核事实，不属于官方 dsh 或 Mojobox Evidence。作者声明须先经团队复核。 */
import type { CatalogManagementEvidence } from '../contracts/types.ts'
import * as v from './input.ts'

export function parseManagementEvidence(value: unknown, artifactDigest: string | undefined, now: Date): CatalogManagementEvidence {
  const item = v.object(value, 'managementEvidence')
  const keys = ['reviewId', 'artifactDigest', 'reviewedBy', 'reviewedAt', 'stateless', 'removePreservesExternalData', 'downgradeFrom', 'explanation']
  if (Object.keys(item).some(key => !keys.includes(key)) || keys.some(key => item[key] === undefined)) v.invalid('management-evidence-shape', '管理证据字段缺失或含未识别字段')
  const digest = v.digest(item.artifactDigest, 'managementEvidence.artifactDigest')
  if (artifactDigest === undefined || digest !== artifactDigest) v.invalid('management-evidence-binding', '管理证据必须绑定当前插件的精确制品摘要')
  const reviewedAt = v.timestamp(item.reviewedAt, 'managementEvidence.reviewedAt')
  if (Date.parse(reviewedAt) > now.getTime()) v.invalid('management-evidence-date', '管理审核时间不能在未来')
  const downgradeFrom = v.array(item.downgradeFrom, 'managementEvidence.downgradeFrom', 128).map(version => v.exactVersion(version, 'downgradeFrom[]'))
  if (new Set(downgradeFrom).size !== downgradeFrom.length) v.invalid('management-evidence-versions', '已审核降级来源版本不能重复')
  return {
    reviewId: v.string(item.reviewId, 'managementEvidence.reviewId', 200), artifactDigest: digest,
    reviewedBy: v.string(item.reviewedBy, 'managementEvidence.reviewedBy', 200), reviewedAt,
    stateless: v.boolean(item.stateless, 'managementEvidence.stateless'),
    removePreservesExternalData: v.boolean(item.removePreservesExternalData, 'managementEvidence.removePreservesExternalData'),
    downgradeFrom, explanation: v.string(item.explanation, 'managementEvidence.explanation', 8192),
  }
}
