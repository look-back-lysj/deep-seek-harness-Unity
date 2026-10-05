import type { ReleaseIdentity, ReleaseOption, ReleaseOptionsContext, ReleaseOptionsResult, ReleaseSelectionContext } from '../types.ts'

export function releaseIdentityKey(identity: ReleaseIdentity): string {
  return JSON.stringify([identity.pluginId, identity.packageName, identity.version, identity.metadataDigest ?? null, identity.artifactDigest ?? null, identity.releaseId ?? null])
}

export function sameReleaseContext(left: ReleaseOptionsContext, right: ReleaseOptionsContext): boolean {
  return left.environmentId === right.environmentId && left.hostRevision === right.hostRevision
    && left.catalogRevision === right.catalogRevision && left.inventoryRevision === right.inventoryRevision
    && left.catalogStale === right.catalogStale
}

export function appendReleasePage(current: ReleaseOptionsResult, page: ReleaseOptionsResult): ReleaseOptionsResult {
  if (current.packageName !== page.packageName || current.includePrerelease !== page.includePrerelease || !sameReleaseContext(current.context, page.context)) {
    throw new Error('版本列表上下文已变化，请重新读取首屏；旧预检已失效。')
  }
  if (page.pagination.hasMore && (!page.pagination.cursor || page.pagination.cursor === current.pagination.cursor)) {
    throw new Error('版本列表分页位置无效，请重新读取首屏。')
  }
  const releases = new Map(current.releases.map(option => [releaseIdentityKey(option.identity), option]))
  for (const option of page.releases) {
    const key = releaseIdentityKey(option.identity)
    const previous = releases.get(key)
    if (previous && JSON.stringify(previous) !== JSON.stringify(option)) throw new Error('同一版本的事实已变化，请重新读取首屏。')
    releases.set(key, option)
  }
  return { ...page, releases: [...releases.values()] }
}

export function chooseRelease(options: ReleaseOptionsResult, manualKey?: string): ReleaseOption | undefined {
  if (options.context.catalogStale) return undefined
  const manual = manualKey === undefined ? undefined : options.releases.find(option => releaseIdentityKey(option.identity) === manualKey && option.selectable)
  if (manual) return manual
  if (options.installed.status === 'unknown' || options.hostCore.status !== 'known') return undefined
  return options.releases.find(option => option.selectable && option.compatibility.status === 'compatible'
    && (options.installed.status === 'absent' || option.relation === 'upgrade'))
}

export function releaseSelectionContext(options: ReleaseOptionsResult, option: ReleaseOption): ReleaseSelectionContext {
  return { context: options.context, identity: option.identity, sources: option.sources }
}

export function releaseOptionLabel(option: ReleaseOption): string {
  const relation = option.relation === 'upgrade' ? '升级' : option.relation === 'same' ? '当前版本' : option.relation === 'downgrade' ? '降级，需再次确认' : '与当前版本的关系未知'
  const compatibility = option.compatibility.status === 'compatible' ? '核心适配' : option.compatibility.status === 'unknown' ? '核心适配未知'
    : option.compatibility.status === 'conflict' ? '版本元数据冲突' : '核心不适配'
  const artifact = option.artifact.status === 'available' ? '' : option.artifact.status === 'missing' ? ' · 缺少制品' : option.artifact.status === 'blocked' ? ' · 制品被阻止' : ' · 制品状态未知'
  return `${option.identity.version} · ${relation} · ${compatibility}${artifact}${option.selectable ? '' : ' · 不可选择'}`
}

export function releaseListNotices(options: ReleaseOptionsResult): readonly string[] {
  const notices: string[] = []
  if (options.context.catalogStale) notices.push('目录列表已过时，不能用于新的预检，请刷新版本列表。')
  if (options.hostCore.status !== 'known') notices.push('当前核心版本未知；不能判断新包的核心要求，也不会自动选择版本。')
  const latest = options.latestPublished === null ? undefined : options.releases.find(option => releaseIdentityKey(option.identity) === releaseIdentityKey(options.latestPublished!))
  if (latest?.compatibility.reason === 'core-too-old' && latest.compatibility.status === 'incompatible') notices.push(`${options.hostCore.agentName}核心版本过旧：当前核心 ${options.hostCore.version ?? '未知'}；最新包 ${latest.identity.version}；要求范围 ${latest.compatibility.declaredRanges.length > 0 ? latest.compatibility.declaredRanges.join('、') : '未提供'}。`)
  if (options.latestPublished && !latest) notices.push(`最新包 ${options.latestPublished.version} 的记录尚未在已读取页面中；请继续加载，不能从当前页推断其核心适配或制品状态。`)
  if (options.installed.status === 'unknown') notices.push('已安装版本尚未核实，不能自动选择升级版本。')
  if (options.publishedAmbiguous || options.compatibleAmbiguous || options.issues.length > 0) notices.push('版本或来源存在冲突；冲突条目不可作为确定的最新版本。')
  if (options.coverage.historyCoverage !== 'complete') notices.push('版本历史不完整；这里只展示后端已取得的记录，不代表全部历史或全网最新版本。')
  if (options.releases.some(option => option.compatibility.status === 'unknown')) notices.push('部分版本的核心适配未知；手动选择仍须由后端预检，不会跳过制品和身份校验。')
  if (options.releases.some(option => option.artifact.status !== 'available')) notices.push('部分版本缺少可用制品或制品状态未知，无法选择的条目已禁用。')
  return notices
}
