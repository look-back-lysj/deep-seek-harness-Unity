/** 分层内容文件 → 已校验的不可覆盖目录文件。不执行构建，不修改公共原始文档。 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateProductionCatalog, validateMarketIndex } from '../../packages/market-core/src/catalog/index.ts'
import * as v from '../../packages/market-core/src/catalog/input.ts'

export function assembleCatalog(input: unknown, root: string, allowTestFixture = false): unknown {
  const assembly = v.object(input, 'assembly')
  if (assembly.kind !== 'CatalogAssembly' || assembly.schemaVersion !== '1') v.invalid('assembly-kind', '目录组装输入必须是 CatalogAssembly')
  if (assembly.testOnly === true && !allowTestFixture) v.invalid('fixture-forbidden', '测试组装输入禁止进入正式生成入口')
  const document: Record<string, unknown> = { schemaVersion: '2', revision: assembly.revision, generatedAt: assembly.generatedAt, publication: assembly.publication, ...(assembly.testOnly === true ? { testOnly: true } : {}) }
  const rootPath = realpathSync(root)
  for (const group of ['plugins', 'releases', 'releaseStatuses', 'presentations', 'deliveries', 'recommendations', 'collections', 'packs']) {
    document[group] = v.array(assembly[group] ?? [], `assembly.${group}`, 10000).map(value => {
      const path = realpathSync(resolve(rootPath, v.relativeFile(value, `assembly.${group}.path`)))
      const rel = relative(rootPath, path)
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) v.invalid('assembly-path', '内容文件路径越界')
      const bytes = readFileSync(path)
      if (bytes.byteLength > 2 * 1024 * 1024) v.invalid('assembly-size', '内容文件超限')
      return v.json(bytes, path)
    })
  }
  if (assembly.testOnly === true && allowTestFixture) validateMarketIndex(document)
  else validateProductionCatalog(document)
  return document
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [filename, output, ...args] = process.argv.slice(2)
    if (!filename || !output) throw new Error('用法：node scripts/catalog/assemble.ts <assembly.json> <新输出文件> [--allow-test-fixture]')
    const result = assembleCatalog(JSON.parse(readFileSync(resolve(filename), 'utf8')), dirname(resolve(filename)), args.includes('--allow-test-fixture'))
    const bytes = JSON.stringify(result, null, 2) + '\n'
    writeFileSync(resolve(output), bytes, { flag: 'wx' })
    console.log(JSON.stringify({ status: 'generated-local-index', sha256: v.hash(bytes), publication: 'not-published' }))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
