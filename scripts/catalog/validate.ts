/** 离线内容 CLI：不下载、不构建作者项目、不改 profile。Node 24 原生运行 TS。 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { validateAuthorSubmission, validateBuildRecipe, validateProductionCatalog } from '../../packages/market-core/src/catalog/index.ts'

const [command, filename, ...args] = process.argv.slice(2)
try {
  if (!filename || !command) throw new Error('用法：node scripts/catalog/validate.ts submission|recipe|catalog <JSON文件> [--allow-test-fixture] [--output <已存在目录下的文件>]')
  const path = resolve(filename)
  const raw = readFileSync(path)
  if (raw.length > 8 * 1024 * 1024) throw new Error('输入体积超限')
  const input: unknown = JSON.parse(raw.toString('utf8'))
  let result: unknown
  if (command === 'submission') {
    const verified = await validateAuthorSubmission(input, dirname(path), { allowTestFixture: args.includes('--allow-test-fixture') })
    result = { status: verified.status, releaseId: verified.release.releaseId, artifactDigest: verified.artifact.artifactDigest, route: verified.release.provenance.kind, size: verified.artifact.size, publication: verified.publication, runtimeVerification: verified.runtimeVerification, warnings: verified.warnings }
  } else if (command === 'recipe') result = validateBuildRecipe(input)
  else if (command === 'catalog') {
    const verified = validateProductionCatalog(input)
    result = { status: 'validated-catalog', revision: verified.snapshot.revision, plugins: verified.snapshot.plugins.length, collections: verified.collections.length }
    const output = args.indexOf('--output')
    if (output >= 0) {
      if (!args[output + 1]) throw new Error('--output 缺少路径')
      // 原字节输出：不重排公共 Manifest/Lock，也不改写既有修订。
      writeFileSync(resolve(args[output + 1]!), raw, { flag: 'wx' })
    }
  } else throw new Error('未知命令')
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', code: (error as { code?: string }).code ?? 'catalog-cli/failed', reason: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
}
