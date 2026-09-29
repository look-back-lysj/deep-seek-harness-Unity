/** Offline publication preparation. Inputs are reviewed materials and an upload
 * receipt, not arbitrary download URLs. It never uploads, installs or runs code. */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateProductionCatalog, validateMarketIndex } from '../../packages/market-core/src/catalog/index.ts'
import { prepareAcceptance } from '../../packages/market-core/src/catalog/lifecycle.ts'
import { createHash } from 'node:crypto'

const [oldFilename, candidateFilename, listingsFilename, uploadsFilename, output] = process.argv.slice(2)
if (!oldFilename || !candidateFilename || !listingsFilename || !uploadsFilename || !output) throw new Error('用法：node scripts/catalog/prepare-distribution.ts <旧目录> <清点目录> <资料不全清单> <上传回执> <输出>')
const read = (path: string): any => JSON.parse(readFileSync(resolve(path), 'utf8'))
const previous = read(oldFilename)
const candidate = read(candidateFilename)
const uploads = read(uploadsFilename) as Array<{ name: string; version: string; sha256: string; bytes: number; filename: string; path: string; commit: string }>
const ledger = new Map(uploads.map(item => [`sha256:${item.sha256.replace(/^sha256:/, '')}`, item]))
const base = 'https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror/raw/'
const result = structuredClone(candidate)
const previousValidated = validateMarketIndex(previous)
if (!previousValidated.publication) throw new Error('旧目录缺少 v2 发布身份，不能推测迁移序号')
const sequence = previous.publication.sequence + 1
if (!Number.isSafeInteger(sequence)) throw new Error('发布序号溢出')
result.revision = `eac-distribution-${candidate.generatedAt.slice(0, 10).replaceAll('-', '')}-${sequence}`
result.publication = { sourceId: previous.publication.sourceId, sequence }
result.generatedAt = candidate.generatedAt
// Old releases and status events are immutable. Preserve even withdrawn
// artifacts that have disappeared from the browse projection.
const releases = new Map<string, any>(previous.releases.map((r: any) => [r.releaseId, r]))
for (const release of candidate.releases) if (!releases.has(release.releaseId)) releases.set(release.releaseId, release)
result.releases = [...releases.values()]
const statuses = new Map<string, any>(previous.releaseStatuses.map((s: any) => [`${s.releaseId}:${s.sequence}`, s]))
for (const status of candidate.releaseStatuses) if (!statuses.has(`${status.releaseId}:${status.sequence}`)) statuses.set(`${status.releaseId}:${status.sequence}`, status)
result.releaseStatuses = [...statuses.values()]
const oldPlugins = new Map(previous.plugins.map((p: any) => [`${p.id}@${p.version}`, p]))
result.plugins = candidate.plugins.map((plugin: any) => {
  const old: any = oldPlugins.get(`${plugin.id}@${plugin.version}`)
  return old ? { ...old, summary: plugin.summary, installability: plugin.installability, license: plugin.license } : plugin
})
result.presentations = result.plugins.map((plugin: any) => ({
  id: plugin.presentationId, revision: `distribution-${sequence}`, title: plugin.name, summary: plugin.summary,
  markdown: `# ${plugin.name}\n\n${plugin.summary}\n\n## 安装与使用\n\n${plugin.capabilityTier === 'appearance' ? '先安装并启用 EAC 皮肤管理器，再按需安装皮肤。安装仅登记候选外观；在皮肤中心选择后才切换。可恢复官方默认外观。' : '使用市场预检，核对版本与启用意图后，由官方 DSH 插件管理器执行。'}\n\n${plugin.installability === 'bundle-installable' ? '已核验包身份、摘要和来源；此目录不将静态核验等同业务功能验证。未完成兼容验证的条目需要明确勾选尝试安装。' : '当前材料不足或依赖旧 EAC 接口，不开放安装。请按下方来源与清点说明补齐。'}\n\n## 许可与来源\n\n${plugin.license ?? '尚未核实许可，不能再分发。'}\n\n${/NC/.test(plugin.license ?? '') ? '**含非商业许可素材，商业用途不能直接采用本包；请阅读原许可并向权利人取得所需授权。**\n\n' : ''}原始 LICENSE、NOTICE 和第三方声明保留在包内。\n\n[查看固定源码与作者资料](${plugin.sourceUrl})\n`,
  media: [], ...(plugin.sourceUrl ? { sourceUrl: plugin.sourceUrl } : {}),
}))
result.deliveries = []
for (const plugin of result.plugins) {
  if (plugin.installability !== 'bundle-installable') continue
  const uploaded = ledger.get(plugin.artifactDigest)
  if (!uploaded || uploaded.name !== plugin.packageName || uploaded.version !== plugin.version || !/^[a-f0-9]{40}$/.test(uploaded.commit)) throw new Error('可安装项缺少匹配的上传回执：' + plugin.packageName)
  const release = releases.get(plugin.releaseId)
  const sources: any[] = [{ kind: 'https-artifact', ref: base + uploaded.commit + '/' + uploaded.path, priority: 0, size: uploaded.bytes }]
  if (release.provenance.kind === 'author-release' && release.provenance.repositoryUrl === 'https://github.com/DSH-EAC/dsh-ui-skin-loader') {
    sources.push({ kind: 'https-artifact', ref: 'https://raw.githubusercontent.com/DSH-EAC/dsh-ui-skin-loader/' + release.provenance.commit + '/.verify/pkgs-v1.1.0-final/' + uploaded.filename, priority: 1, size: uploaded.bytes })
  }
  result.deliveries.push({ pluginId: plugin.id, packageName: plugin.packageName, version: plugin.version, artifactDigest: plugin.artifactDigest, sources })
}
result.listings = read(listingsFilename).plugins.map((item: any) => ({
  id: item.id, name: item.function, packageName: item.packageName, summary: item.function,
  reason: item.install.reasons.join('；'),
  sourceUrl: 'https://github.com/DSH-EAC/DSH-Desktop-EAC/tree/' + item.source.commit + '/' + item.source.path,
  ...(item.version ? { requestedVersion: item.version } : {}),
}))
result.recommendations = [] // Only independent, recorded editorial decisions may add recommendations.
const checked = validateProductionCatalog(result)
const hash = (data: unknown): string => 'sha256:' + createHash('sha256').update(JSON.stringify(data)).digest('hex')
prepareAcceptance(checked, hash(result), prepareAcceptance(previousValidated, hash(previous)))
writeFileSync(resolve(output), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ plugins: result.plugins.length, listings: result.listings.length, deliveries: result.deliveries.length, publication: result.publication }))
