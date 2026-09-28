/**
 * v2 本地发布接受记录。原子建立一条不可覆盖的记录就是提交点；current 只是快捷指针。
 * 撤回历史与最高发布序号随记录保存，因此旧镜像和 previous 缓存不能复活已知撤回。
 * 无签名、清空本地历史或离线期间的新撤回不在此保证范围。
 */
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { CatalogSnapshot } from '../contracts/types.ts'
import type { CatalogPublication, ReleaseRecord, ReleaseStatusRecord, ValidatedCatalog } from './model.ts'
import { hash, invalid, object } from './input.ts'

export interface CatalogAcceptance {
  readonly schemaVersion: '1'
  readonly publication: CatalogPublication
  readonly revision: string
  readonly digest: string
  readonly storedAt: string
  readonly releases: Readonly<Record<string, { readonly digest: string; readonly record: ReleaseRecord }>>
  readonly statuses: Readonly<Record<string, ReleaseStatusRecord>>
}

export function latestAcceptance(cacheDir: string): CatalogAcceptance | undefined {
  const root = join(cacheDir, 'acceptances')
  if (!existsSync(root)) return undefined
  const names = readdirSync(root).filter(name => /^\d{16}\.json$/.test(name)).sort().reverse()
  const name = names[0]
  if (!name) return undefined
  // 最高记录损坏不能默默忽略并接受旧目录，调用方须阻断安装并报告。
  const bytes = readFileSync(join(root, name))
  if (bytes.byteLength > 32 * 1024 * 1024) invalid('acceptance-corrupt', '接受记录体积超限')
  const value = object(JSON.parse(bytes.toString('utf8')), 'acceptance') as unknown as CatalogAcceptance
  if (value.schemaVersion !== '1' || !value.publication || !Number.isSafeInteger(value.publication.sequence) || value.publication.sequence < 1 || value.publication.sequence !== Number(name.slice(0, 16)) || typeof value.publication.sourceId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.digest) || typeof value.revision !== 'string' || !value.statuses || !value.releases) invalid('acceptance-corrupt', '最高目录接受记录结构无效')
  for (const [id, release] of Object.entries(value.releases)) if (release.record.releaseId !== id || hash(JSON.stringify(release.record)) !== release.digest) invalid('acceptance-corrupt', '冻结发行历史损坏')
  for (const [id, status] of Object.entries(value.statuses)) if (status.releaseId !== id || !value.releases[id] || !Number.isSafeInteger(status.sequence) || !['active', 'withdrawn'].includes(status.status)) invalid('acceptance-corrupt', '撤回历史损坏')
  return value
}

export function prepareAcceptance(validated: ValidatedCatalog, digest: string, previous?: CatalogAcceptance): CatalogAcceptance {
  const publication = validated.publication
  if (!publication) invalid('publication-required', '缺少 v2 发布身份')
  if (previous && previous.publication.sourceId !== publication.sourceId) invalid('source-lineage', '目录来源身份与本地接受历史不同')
  if (previous && publication.sequence <= previous.publication.sequence) {
    if (publication.sequence === previous.publication.sequence && previous.digest === digest) return previous
    invalid('publication-rollback', '拒绝旧发布序号或同序号不同字节的镜像')
  }
  const releases = { ...previous?.releases }
  const statuses = { ...previous?.statuses }
  for (const release of validated.releases) {
    const digest = hash(JSON.stringify(release))
    if (releases[release.releaseId] && releases[release.releaseId]?.digest !== digest) invalid('release-mutated', '冻结的发行记录被修改；新构建应登记新的制品摘要')
    releases[release.releaseId] = { digest, record: release }
  }
  for (const status of validated.releaseStatuses.slice().sort((a, b) => a.sequence - b.sequence)) {
    const old = statuses[status.releaseId]
    if (old && status.sequence < old.sequence) continue // 完整历史可重传，但不能覆盖最新状态。
    if (old && status.sequence === old.sequence && JSON.stringify(old) !== JSON.stringify(status)) invalid('status-mutated', '同一生命周期序号不能改变状态')
    statuses[status.releaseId] = status
  }
  return { schemaVersion: '1', publication, revision: validated.snapshot.revision, digest, storedAt: new Date().toISOString(), releases, statuses }
}

/** The shipped catalog is trusted history too. Preserve the newer publication
 * identity, but merge release/status ledgers even when that publication omitted
 * events from the bundle. Never rewrite a previously committed acceptance. */
export function mergeAcceptanceFloor(floor: CatalogAcceptance, known?: CatalogAcceptance): CatalogAcceptance {
  if (!known) return floor
  if (floor.publication.sourceId !== known.publication.sourceId) invalid('source-lineage', '随包目录与本地接受历史的来源身份不同')
  if (floor.publication.sequence === known.publication.sequence && (floor.digest !== known.digest || floor.revision !== known.revision)) invalid('publication-conflict', '随包目录与同序号接受历史不一致')
  const newest = known.publication.sequence >= floor.publication.sequence ? known : floor
  const releases = { ...known.releases }
  const statuses = { ...known.statuses }
  for (const [id, release] of Object.entries(floor.releases)) {
    if (releases[id] && releases[id]?.digest !== release.digest) invalid('release-mutated', '随包目录与冻结发行记录不一致')
    releases[id] = release
  }
  for (const [id, status] of Object.entries(floor.statuses)) {
    const old = statuses[id]
    if (old && old.sequence === status.sequence && JSON.stringify(old) !== JSON.stringify(status)) invalid('status-mutated', '随包目录与同序号生命周期状态不一致')
    if (!old || status.sequence > old.sequence) statuses[id] = status
  }
  return { ...newest, releases, statuses }
}

export function commitAcceptance(cacheDir: string, acceptance: CatalogAcceptance): void {
  const root = join(cacheDir, 'acceptances')
  mkdirSync(root, { recursive: true })
  const path = join(root, `${String(acceptance.publication.sequence).padStart(16, '0')}.json`)
  if (existsSync(path)) {
    const current = latestAcceptance(cacheDir)
    if (current?.digest === acceptance.digest && current.publication.sourceId === acceptance.publication.sourceId) return
    invalid('publication-conflict', '同序号已有其他提交')
  }
  const temporary = join(root, `${randomUUID()}.tmp`)
  writeFileSync(temporary, JSON.stringify(acceptance), { flag: 'wx' })
  try { linkSync(temporary, path) } finally { unlinkSync(temporary) }
}

export function applyKnownLifecycle(snapshot: CatalogSnapshot, acceptance?: CatalogAcceptance): CatalogSnapshot {
  if (!acceptance) return snapshot
  const withdrawn = new Set(Object.entries(acceptance.statuses).filter(([, status]) => status.status === 'withdrawn').map(([id]) => {
    const release = acceptance.releases[id]?.record
    return release ? `${release.pluginId}@${release.version}:${release.artifactDigest}` : ''
  }))
  const plugins = snapshot.plugins.map(plugin => withdrawn.has(`${plugin.id}@${plugin.version}:${plugin.artifactDigest}`) ? { ...plugin, installability: 'hard-blocked' as const } : plugin)
  const available = new Set(plugins.filter(plugin => plugin.installability !== 'hard-blocked').map(plugin => plugin.id))
  return { ...snapshot, plugins, recommendations: snapshot.recommendations?.filter(item => available.has(item.pluginId)) ?? [] }
}
