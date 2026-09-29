/** Merge-ready v2 additions, retaining the existing original skin history verbatim. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { validateMarketIndex } from '../../packages/market-core/src/catalog/validate.ts'

const root = resolve(process.argv[2] ?? 'D:/eac-market-verify/distribution-20260928/inventory-v3')
const basePath = resolve(process.argv[3] ?? 'D:/eac-market/releases/eac-skins-1.1.0/market-index.json')
const index = JSON.parse(readFileSync(join(root, 'market-index.candidate.json'), 'utf8'))
const base = JSON.parse(readFileSync(basePath, 'utf8'))
validateMarketIndex(base)
validateMarketIndex(index)
const baseKeys = new Set(base.plugins.map((p: any) => `${p.id}@${p.version}`))
const baseReleaseIds = new Set(base.releases.map((r: any) => r.releaseId))
const plugins = index.plugins.filter((p: any) => !baseKeys.has(`${p.id}@${p.version}`))
const presentationIds = new Set(plugins.map((p: any) => p.presentationId))
const releases = index.releases.filter((r: any) => !baseReleaseIds.has(r.releaseId))
const releaseIds = new Set(releases.map((r: any) => r.releaseId))
const requiredWithdrawnReleaseIds = base.releases.filter((r: any) =>
  ['@dsh-eac/skin-miku', '@dsh-eac/skin-trading'].includes(r.packageName) && r.version === '1.1.0').map((r: any) => r.releaseId)
assert.equal(requiredWithdrawnReleaseIds.length, 2)
for (const id of requiredWithdrawnReleaseIds) {
  const statuses = base.releaseStatuses.filter((s: any) => s.releaseId === id).sort((a: any, b: any) => a.sequence - b.sequence)
  assert.equal(statuses.at(-1)?.status, 'withdrawn', 'Known-bad originals must remain withdrawn')
}
const fragment = {
  schemaVersion: '2', kind: 'EacInventoryCatalogFragment', sourceCommit: 'dc22280beb9d0a6338d1e02d99f5e5346f72f4f0',
  plugins,
  presentations: index.presentations.filter((p: any) => presentationIds.has(p.id)),
  releases,
  releaseStatuses: index.releaseStatuses.filter((s: any) => releaseIds.has(s.releaseId)),
  deliveries: index.deliveries.filter((d: any) => !baseKeys.has(`${d.pluginId}@${d.version}`)),
  listings: index.listings ?? [],
  merge: {
    preserveBasePlugins: true, preserveBaseReleases: true, preserveBaseReleaseStatuses: true,
    requiredWithdrawnReleaseIds,
    rules: ['按 id@version 合并 plugins；按 releaseId 合并 releases；状态按 releaseId+sequence 合并，禁止同序号换字节。',
      '原 14 款皮肤体系记录不在本 fragment 中重复；miku/trading 新版本作为独立发行追加。',
      '三个 cache Delivery 仅指本地证据文件。在线源必须由主控逐个核对实际上传文件、大小、摘要后生成，不能猜 Gitee 下载 URL。',
      'listings 使用主控新增的只展示契约；缺少真实元数据或制品的条目不能进入安装计划。'],
    listingOnlyInput: 'listing-only.json', artifactLedger: 'artifacts.json', runtimeVerification: 'not-tested', publishedByThisWorker: false,
  },
}
const merged = { ...base, revision: 'local-eac-inventory-merged-dc22280beb9d', generatedAt: index.generatedAt,
  publication: { sourceId: 'local-eac-inventory-merged', sequence: 1 },
  plugins: [...base.plugins, ...fragment.plugins], presentations: [...base.presentations, ...fragment.presentations],
  releases: [...base.releases, ...fragment.releases], releaseStatuses: [...base.releaseStatuses, ...fragment.releaseStatuses],
  deliveries: [...base.deliveries, ...fragment.deliveries],
  listings: [...(base.listings ?? []), ...fragment.listings],
}
const validated = validateMarketIndex(merged)
assert.equal(validated.snapshot.plugins.filter((p: any) => p.packageName === '@dsh-eac/skin-trading' && p.version === '1.1.0')[0]?.installability, 'hard-blocked')
assert.equal(validated.snapshot.plugins.filter((p: any) => p.packageName === '@dsh-eac/skin-miku' && p.version === '1.1.0')[0]?.installability, 'hard-blocked')
for (const [name, value] of Object.entries({ 'catalog-fragment.json': fragment, 'merged-with-original-skins.validation-candidate.json': merged,
  'fragment-validation.json': { status: 'passed-v2-merge', fragmentPlugins: plugins.length, fragmentReleases: releases.length,
    fragmentPresentations: fragment.presentations.length, fragmentReleaseStatuses: fragment.releaseStatuses.length,
    fragmentDeliveries: fragment.deliveries.length, fragmentListings: fragment.listings.length, mergedPlugins: validated.snapshot.plugins.length,
    oldSkinsRemainWithdrawn: 2, unchangedOriginalSkinRecordsExcludedFromFragment: 14,
    installableAdditions: plugins.filter((p: any) => p.installability === 'bundle-installable').map((p: any) => ({ packageName: p.packageName, version: p.version, artifactDigest: p.artifactDigest })),
    runtimeVerification: 'not-tested', publication: 'not-published' } })) {
  const path = join(root, name)
  const bytes = JSON.stringify(value, null, 2) + '\n'
  if (existsSync(path)) assert.equal(readFileSync(path, 'utf8'), bytes, 'Do not replace different fragment evidence')
  else writeFileSync(path, bytes, { flag: 'wx' })
}
console.log(JSON.stringify({ fragment: join(root, 'catalog-fragment.json'), plugins: plugins.length, releases: releases.length,
  presentations: fragment.presentations.length, releaseStatuses: fragment.releaseStatuses.length,
  deliveries: fragment.deliveries.length, mergedPlugins: validated.snapshot.plugins.length, status: 'passed-v2-merge' }))
