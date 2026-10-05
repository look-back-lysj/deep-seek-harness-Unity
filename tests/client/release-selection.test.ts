import { describe, expect, it } from 'vitest'
import type { ReleaseOption, ReleaseOptionsResult } from '../../packages/market/src/types.ts'
import { appendReleasePage, chooseRelease, releaseIdentityKey, releaseListNotices, releaseOptionLabel, releaseSelectionContext, sameReleaseContext } from '../../packages/market/src/client/release-selection.ts'

function option(version: string, patch: Partial<ReleaseOption> = {}): ReleaseOption {
  return { identity: { pluginId: 'plugin', packageName: '@example/plugin', version, metadataDigest: `metadata:${version}`, artifactDigest: `artifact:${version}`, releaseId: `release:${version}` },
    compatibility: { status: 'compatible', declaredRanges: [] }, publication: 'active',
    artifact: { status: 'available', installability: 'bundle-installable' }, verification: 'verified', selectable: true,
    blockers: [], relation: 'upgrade', confirmationRequirements: ['ordinary-plan'], sources: [{ sourceId: 'forge', revision: 'source-1' }], ...patch }
}
function options(releases: readonly ReleaseOption[], patch: Partial<ReleaseOptionsResult> = {}): ReleaseOptionsResult {
  return { packageName: '@example/plugin', includePrerelease: false,
    context: { environmentId: 'env', hostRevision: 'host-1', catalogRevision: 'catalog-1', inventoryRevision: 'inventory-1', checkedAt: '2026-10-04T00:00:00Z', catalogStale: false },
    hostCore: { agentId: 'dsh', agentName: 'DeepSeek Harness', version: '0.1.0', status: 'known', hostRevision: 'host-1', source: 'official' },
    installed: { status: 'known', version: '1.0.0' }, coverage: { historyCoverage: 'complete', obtainedRecords: releases.length, evaluatedRecords: releases.length, totalKnownRecords: releases.length, reasons: [] },
    latestPublished: releases[0]?.identity ?? null, latestCompatible: releases[0]?.identity ?? null, latestPublishedCandidates: [], latestCompatibleCandidates: [],
    publishedAmbiguous: false, compatibleAmbiguous: false, releases, issues: [], pagination: { cursor: null, hasMore: false }, ...patch }
}

describe('只消费后端版本事实的选择', () => {
  it('按后端顺序选最高可选择适配升级，不按前端 semver 重排', () => {
    const first = option('custom-highest')
    expect(chooseRelease(options([option('99.0.0', { selectable: false }), first, option('20.0.0')]))).toBe(first)
  })
  it.each(['same', 'downgrade', 'unknown'] as const)('已安装时不自动选择 %s', relation => {
    expect(chooseRelease(options([option('9.0.0', { relation })]))).toBeUndefined()
  })
  it('首次安装可选关系 unknown，但核心适配未知不自动选', () => {
    const release = option('2.0.0', { relation: 'unknown' })
    expect(chooseRelease(options([release], { installed: { status: 'absent', version: null } }))).toBe(release)
    expect(chooseRelease(options([option('3.0.0', { compatibility: { status: 'unknown', declaredRanges: [] } })]))).toBeUndefined()
  })
  it('保留精确有效手选的旧版、同版与适配未知，不按显示版本混同身份', () => {
    const older = option('0.5.0', { relation: 'downgrade', compatibility: { status: 'unknown', declaredRanges: [] } })
    const same = option('1.0.0', { relation: 'same' })
    expect(chooseRelease(options([option('2.0.0'), older]), releaseIdentityKey(older.identity))).toBe(older)
    expect(chooseRelease(options([same]), releaseIdentityKey(same.identity))).toBe(same)
    expect(releaseIdentityKey(older.identity)).not.toBe(releaseIdentityKey({ ...older.identity, metadataDigest: 'changed' }))
    expect(releaseIdentityKey(older.identity)).not.toBe(releaseIdentityKey({ ...older.identity, releaseId: 'changed' }))
  })
  it('失效的手选不保留；目录 stale 与库存未知都不自动选', () => {
    const blocked = option('0.5.0', { selectable: false })
    const newer = option('2.0.0')
    expect(chooseRelease(options([newer, blocked]), releaseIdentityKey(blocked.identity))).toBe(newer)
    const list = options([newer])
    expect(chooseRelease({ ...list, context: { ...list.context, catalogStale: true } }, releaseIdentityKey(newer.identity))).toBeUndefined()
    expect(chooseRelease(options([newer], { installed: { status: 'unknown', version: null } }))).toBeUndefined()
    expect(chooseRelease({ ...list, hostCore: { ...list.hostCore, status: 'unknown', version: null } })).toBeUndefined()
  })
  it('精确转交 context、identity、sources，不丢失 provenance', () => {
    const release = option('2.0.0'); const list = options([release])
    expect(releaseSelectionContext(list, release)).toEqual({ context: list.context, identity: release.identity, sources: release.sources })
  })
})

describe('版本分页上下文', () => {
  it('checkedAt 不是 revision，更新读取时间可合并并保留后端顺序', () => {
    const first = options([option('3.0.0')], { pagination: { cursor: 'page2', hasMore: true } })
    const page = options([option('2.0.0')]); const later = { ...page, context: { ...page.context, checkedAt: '2026-10-04T01:00:00Z' } }
    expect(sameReleaseContext(first.context, later.context)).toBe(true)
    expect(appendReleasePage(first, later).releases.map(release => release.identity.version)).toEqual(['3.0.0', '2.0.0'])
  })
  it.each(['environmentId', 'hostRevision', 'catalogRevision', 'inventoryRevision', 'catalogStale'] as const)('拒绝跨 %s 合并', field => {
    const first = options([option('3.0.0')]); const page = options([option('2.0.0')])
    const context = { ...page.context, [field]: field === 'catalogStale' ? true : 'changed' }
    expect(() => appendReleasePage(first, { ...page, context })).toThrow('上下文已变化')
  })
  it('包名和通道切换不能拼接', () => {
    const first = options([option('3.0.0')])
    expect(() => appendReleasePage(first, options([], { packageName: '@example/other' }))).toThrow('上下文')
    expect(() => appendReleasePage(first, options([], { includePrerelease: true }))).toThrow('上下文')
  })
  it('拒绝循环或缺失 cursor；重复身份只能保留相同事实', () => {
    const release = option('3.0.0'); const first = options([release], { pagination: { cursor: 'same', hasMore: true } })
    expect(() => appendReleasePage(first, options([], { pagination: { cursor: 'same', hasMore: true } }))).toThrow('分页位置')
    expect(() => appendReleasePage(first, options([], { pagination: { cursor: null, hasMore: true } }))).toThrow('分页位置')
    expect(appendReleasePage(first, options([release])).releases).toHaveLength(1)
    expect(() => appendReleasePage(first, options([{ ...release, selectable: false }]))).toThrow('事实已变化')
  })
})

describe('版本事实说明', () => {
  it('只有明确 latest core-too-old 才显示 Agent 核心版本过旧', () => {
    const old = option('3.0.0', { compatibility: { status: 'incompatible', reason: 'core-too-old', declaredRanges: ['>=0.2'] }, selectable: false })
    expect(releaseListNotices(options([old])).join(' ')).toContain('DeepSeek Harness核心版本过旧')
    expect(releaseListNotices(options([old])).join(' ')).toContain('当前核心 0.1.0；最新包 3.0.0；要求范围 >=0.2')
    for (const reason of ['core-too-new', 'core-range-mismatch', 'core-version-unknown', 'metadata-conflict'] as const) {
      expect(releaseListNotices(options([{ ...old, compatibility: { ...old.compatibility, reason } }])).join(' ')).not.toContain('核心版本过旧')
    }
    expect(releaseListNotices(options([old], { latestPublished: null })).join(' ')).not.toContain('核心版本过旧')
  })
  it('旧历史条目过旧不能当作最新包核心要求', () => {
    const latest = option('3.0.0'); const older = option('2.0.0', { compatibility: { status: 'incompatible', reason: 'core-too-old', declaredRanges: [] } })
    expect(releaseListNotices(options([latest, older])).join(' ')).not.toContain('核心版本过旧')
  })
  it('最新身份未在当前页不推断不存在或 core-too-old，加载后才展示明确事实', () => {
    const latest = option('3.0.0', { compatibility: { status: 'incompatible', reason: 'core-too-old', declaredRanges: ['>=0.2'] }, selectable: false })
    const first = options([option('2.0.0')], { latestPublished: latest.identity, pagination: { cursor: 'next', hasMore: true } })
    expect(releaseListNotices(first).join(' ')).toContain('最新包 3.0.0 的记录尚未在已读取页面中')
    expect(releaseListNotices(first).join(' ')).not.toContain('核心版本过旧')
    expect(releaseListNotices(appendReleasePage(first, options([latest]))).join(' ')).toContain('当前核心 0.1.0；最新包 3.0.0；要求范围 >=0.2')
  })
  it('unknown、冲突、缺制品、历史不全与 stale 都如实提示', () => {
    const release = option('3.0.0', { compatibility: { status: 'unknown', declaredRanges: [] }, artifact: { status: 'missing', installability: 'missing-artifact' }, selectable: false })
    const list = options([release], { compatibleAmbiguous: true, installed: { status: 'unknown', version: null },
      coverage: { historyCoverage: 'latest-only', obtainedRecords: 1, evaluatedRecords: 1, totalKnownRecords: null, reasons: [] } })
    const text = releaseListNotices({ ...list, context: { ...list.context, catalogStale: true }, hostCore: { ...list.hostCore, status: 'unknown', version: null } }).join(' ')
    for (const message of ['列表已过时', '核心版本未知', '已安装版本尚未核实', '冲突', '历史不完整', '核心适配未知', '制品']) expect(text).toContain(message)
    expect(releaseOptionLabel(release)).toContain('缺少制品')
    expect(releaseOptionLabel(release)).toContain('不可选择')
  })
})
