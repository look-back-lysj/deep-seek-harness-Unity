/** 从真实 tgz 生成投稿需要的字节资料；不解压执行、不联网、不安装，也不填写授权或运行结论。 */
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { verifyTgzFile, DEFAULT_TGZ_LIMITS } from '../../packages/market-core/src/delivery/tgz.ts'
import { releaseIdFor } from '../../packages/market-core/src/catalog/releases.ts'

try {
  const [filename, pluginId, packageName, version, output, ...extra] = process.argv.slice(2)
  if (!filename || !pluginId || !packageName || !version || !output || extra.length) throw new Error('用法：node scripts/catalog/describe-artifact.ts <tgz> <pluginId> <packageName> <精确版本> <不存在的输出目录>')
  const path = resolve(filename)
  const stat = statSync(path)
  if (!stat.isFile() || stat.size > DEFAULT_TGZ_LIMITS.maxCompressedBytes) throw new Error('必须是大小不超过200 MiB的真实tgz文件')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  const artifactDigest = `sha256:${hash.digest('hex')}`
  const verified = await verifyTgzFile(path, { artifactDigest, packageName, version, requireBundle: true })
  const packageBytes = Buffer.from(verified.packageJson, 'utf8')
  const metadataDigest = `sha256:${createHash('sha256').update(packageBytes).digest('hex')}`
  const identity = { pluginId, packageName, version, artifactDigest }
  const fields = { schemaVersion: '1', ...identity, releaseId: releaseIdFor(identity), metadataDigest, size: verified.size }
  const metadata = { kind: 'official-bundle', packageJson: { contentBase64: packageBytes.toString('base64'), sha256: metadataDigest }, files: verified.files }
  const directory = resolve(output)
  // 整个输出目录必须不存在，避免覆盖作者已有资料或把上次结果误当本次结果。
  mkdirSync(directory)
  for (const [name, value] of [['release-fields.json', fields], ['metadata.json', metadata]] as const) {
    writeFileSync(resolve(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  }
  console.log(JSON.stringify({ status: 'described-artifact', output: directory, artifactDigest, runtimeVerification: 'not-tested', publication: 'not-published' }))
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', reason: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
}
