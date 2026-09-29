/**
 * Stage an explicitly selected local catalog and exact archives for manual UI
 * installation. This script never edits profile dependencies, enables plugins,
 * or executes package code. All packages are verified before the catalog moves.
 */
import { copyFileSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateMarketIndex } from '../../packages/market-core/src/catalog/validate.ts'
import { CatalogRepository } from '../../packages/market-core/src/catalog/store.ts'
import { verifyTgzFile } from '../../packages/market-core/src/delivery/tgz.ts'

const [catalogDirectory, profileDirectory, backupDirectory] = process.argv.slice(2)
if (!catalogDirectory || !profileDirectory || !backupDirectory || ![catalogDirectory, profileDirectory, backupDirectory].every(isAbsolute)) {
  throw new Error('用法：node --experimental-transform-types scripts/catalog/stage-local-catalog.ts <绝对目录> <明确profile目录> <新的备份目录>')
}
const sourceRoot = realpathSync(catalogDirectory)
const profile = realpathSync(profileDirectory)
if (!existsSync(join(profile, 'package.json'))) throw new Error('明确指定的 profile 没有 package.json，拒绝猜测目录')
const catalogBytes = readFileSync(join(sourceRoot, 'market-index.json'))
const document: unknown = JSON.parse(catalogBytes.toString('utf8'))
const validated = validateMarketIndex(document)
const ledger = JSON.parse(readFileSync(join(sourceRoot, 'artifacts.json'), 'utf8')) as {
  artifacts: readonly { filename: string; name: string; version: string; bytes: number; sha256: string }[]
}
if (ledger.artifacts.length !== validated.snapshot.deliveries.length) throw new Error('发行文件清单与目录数量不一致')
const verified: { from: string; to: string; name: string; digest: string }[] = []
const cacheRoot = join(profile, 'eac-market', 'artifacts', 'sha256')
for (const artifact of ledger.artifacts) {
  if (!/^[a-z0-9][a-z0-9._-]*\.tgz$/.test(artifact.filename) || !/^[0-9a-f]{64}$/.test(artifact.sha256)) throw new Error('发行文件名或摘要无效')
  const path = realpathSync(join(sourceRoot, 'artifacts', artifact.filename))
  const rel = relative(sourceRoot, path)
  if (!rel || isAbsolute(rel) || rel.startsWith('..')) throw new Error('发行文件越过明确选择的目录')
  const digest = `sha256:${artifact.sha256}`
  const delivery = validated.snapshot.deliveries.find(item => item.packageName === artifact.name && item.version === artifact.version && item.artifactDigest === digest)
  if (!delivery || delivery.sources.length !== 1 || delivery.sources[0]?.kind !== 'cache' || delivery.sources[0].ref !== digest) throw new Error('本地导入只接受绑定同摘要的 cache 来源')
  const parsed = await verifyTgzFile(path, { packageName: artifact.name, version: artifact.version, artifactDigest: digest, requireBundle: true })
  if (parsed.size !== artifact.bytes) throw new Error('文件体积不一致')
  const plugin = validated.snapshot.plugins.find(item => item.packageName === artifact.name && item.version === artifact.version)!
  const metadata = validated.metadataBytes.get(`${plugin.id}@${plugin.version}`)
  if (!metadata || !Buffer.from(metadata).equals(Buffer.from(parsed.packageJson))) throw new Error('目录不是此发行包的原始 package.json')
  const target = join(cacheRoot, artifact.sha256 + '.tgz')
  if (existsSync(target)) await verifyTgzFile(target, { packageName: artifact.name, version: artifact.version, artifactDigest: digest, requireBundle: true })
  verified.push({ from: path, to: target, name: artifact.name, digest })
}
const beforeDependencies = readFileSync(join(profile, 'package.json'))
const catalogPath = join(profile, 'eac-market', 'catalog')
const backup = resolve(backupDirectory)
if (existsSync(backup)) throw new Error('备份目录已存在，拒绝覆盖历史')
mkdirSync(backup, { recursive: true })
for (const filename of ['current.json', 'acceptance.json', 'latest-acceptance.json']) {
  const source = join(catalogPath, filename)
  if (existsSync(source) && statSync(source).isFile()) copyFileSync(source, join(backup, filename), constants.COPYFILE_EXCL)
}
mkdirSync(cacheRoot, { recursive: true })
for (const artifact of verified) if (!existsSync(artifact.to)) copyFileSync(artifact.from, artifact.to, constants.COPYFILE_EXCL)
const embedded = JSON.parse(readFileSync(fileURLToPath(new URL('../../packages/market/data/index.json', import.meta.url)), 'utf8'))
const repository = new CatalogRepository(embedded, catalogPath)
const result = await repository.refresh(async () => catalogBytes)
if (result.status !== 'refreshed') throw new Error(result.reason ?? '本地目录导入失败，已保留旧目录')
if (!beforeDependencies.equals(readFileSync(join(profile, 'package.json')))) throw new Error('profile依赖在准备过程中被其他程序修改，请核对')
const report = { status: 'staged-for-manual-install', catalogRevision: result.current.snapshot.revision, count: verified.length,
  installedByThisScript: false, packages: verified.map(item => ({ name: item.name, digest: item.digest })) }
writeFileSync(join(backup, 'stage-result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify(report))
