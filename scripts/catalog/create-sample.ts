/** 仅生成自己拥有的无害本地 fixture。输入为空，不取作者源码、不联网、不执行构建工具。 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { hash } from '../../packages/market/src/catalog/input.ts'
import { releaseIdFor } from '../../packages/market/src/catalog/releases.ts'

function tgz(files: Readonly<Record<string, string>>): Uint8Array {
  const blocks: Buffer[] = []
  for (const [path, value] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const data = Buffer.from(value)
    const header = Buffer.alloc(512)
    header.write(`package/${path}`, 0, 100, 'utf8')
    for (const [offset, size, value] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, data.length], [136, 12, 0]]) header.write(value!.toString(8).padStart(size! - 1, '0') + '\0', offset!, size!, 'ascii')
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263)
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}

export function createSamples(output: string): void {
  for (const route of ['author-release', 'team-build'] as const) {
    const root = resolve(output, route)
    mkdirSync(root, { recursive: true })
    const packageName = `@eac-test/${route}-fixture`
    const metadata = JSON.stringify({ name: packageName, version: '1.0.0', type: 'module', exports: { '.': './lib/index.js' }, dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } }, null, 2)
    const files = { 'package.json': metadata, 'cordis.patch.yml': 'insert: []\n', 'lib/index.js': 'export const TEST_ONLY = true\n' }
    const artifact = tgz(files)
    const write = (name: string, value: string | Uint8Array) => writeFileSync(join(root, name), value, { flag: 'wx' })
    const writeJson = (name: string, value: unknown) => write(name, JSON.stringify(value, null, 2) + '\n')
    const authorization = { basis: 'license', reference: 'LICENSE — 自建合成测试文件，仅本地验收', redistribution: true }
    const toolchain = [{ name: 'node', version: process.versions.node }]
    const lock = '{"testOnly":true,"dependencies":{}}\n'
    const recipe = { schemaVersion: '1', kind: 'TeamBuildRecipe', repositoryUrl: 'https://example.invalid/eac/test-only', commit: '0'.repeat(40), sourceSubdir: '.', lockFile: 'fixture-lock.json', lockDigest: hash(lock), authorization, toolchain, target: { os: process.platform, arch: process.arch }, steps: [{ executable: 'node', args: ['build-fixture.mjs'] }], allowedLifecycleScripts: [], output: 'rebuilt-fixture.tgz', limits: { timeoutSeconds: 60, memoryMiB: 128, diskMiB: 128 }, credentials: 'none' }
    const recipeText = JSON.stringify(recipe, null, 2) + '\n'
    const releaseBase = { schemaVersion: '1', pluginId: `dev.test.${route}`, packageName, version: '1.0.0', artifactDigest: hash(artifact), metadataDigest: hash(metadata), size: artifact.byteLength, publishedAt: '2026-09-28T00:00:00.000Z' }
    const common = { repositoryUrl: recipe.repositoryUrl, commit: recipe.commit, license: 'MIT (self-authored test fixture)', authorization }
    const provenance = route === 'author-release' ? { ...common, kind: route, releaseUrl: 'https://example.invalid/eac/test-only/releases/1.0.0' } : { ...common, kind: route, sourceSubdir: '.', lockDigest: hash(lock), recipeDigest: hash(recipeText), toolchain, target: recipe.target, buildRun: 'local-synthetic-fixture-not-ci' }
    write('plugin.tgz', artifact)
    const release = { ...releaseBase, releaseId: releaseIdFor(releaseBase), provenance }
    const packageMetadata = { kind: 'official-bundle', packageJson: { contentBase64: Buffer.from(metadata).toString('base64'), sha256: hash(metadata) }, files: Object.keys(files) }
    writeJson('release.json', release)
    writeJson('metadata.json', packageMetadata)
    writeJson('presentation.json', { title: '仅用于本地测试的无害包', summary: '空 bundle；不会注册服务或执行任何业务', audience: '开发验收', usageEntry: '无业务入口，仅检验元数据与字节', setup: '无', limitations: '不是正式作者包，不代表运行兼容', support: '本地测试', attribution: '本项目自建合成 fixture', readme: 'README.md', media: [] })
    write('README.md', '# 无害测试包\n\n只用于本地验收，不得发布进生产目录。\n')
    write('LICENSE', 'MIT License\nCopyright (c) 2026 EAC Market test fixture contributors\nPermission is hereby granted, free of charge, to use, copy, modify and distribute this self-authored test fixture, provided this notice is included. THE SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTY OF ANY KIND.\n')
    write('fixture-lock.json', lock)
    write('build-recipe.json', recipeText)
    // 该脚本只重建上面已知的空 bundle，禁止覆盖已存在的发行文件。
    write('build-fixture.mjs', readFileSync(new URL('./sample-build.mjs', import.meta.url)))
    writeJson('fixture-files.json', files)
    writeJson('management-evidence.test.json', { testOnly: true, report: '本文件只声明合成审核范围，不是正式作者或真实宿主运行报告', managementEvidence: { reviewId: `synthetic-${route}-static-review`, artifactDigest: hash(artifact), reviewedBy: 'test-only content worker', reviewedAt: '2026-09-28T00:00:00.000Z', stateless: true, removePreservesExternalData: true, downgradeFrom: ['1.1.0'], explanation: '仅用于合成测试：空 insert 列表、无依赖或生命周期脚本、不访问外部数据。downgradeFrom 是测试分支输入，不表示已实际安装该版本。' } })
    writeJson('submission.json', { schemaVersion: '1', kind: 'AuthorSubmission', testOnly: true, route, author: { name: '明确合成的测试作者', contact: 'local-test-only' }, release: 'release.json', artifact: 'plugin.tgz', metadata: 'metadata.json', presentation: 'presentation.json', licenseFile: 'LICENSE', buildRecipe: 'build-recipe.json', lockFile: 'fixture-lock.json' })
    writeJson('catalog-plugin.json', { id: release.pluginId, name: '自建空 bundle 测试条目', packageName, version: release.version, summary: '不注册业务功能，仅用于本地验证', author: '明确合成的测试作者', distribution: 'unclassified', capabilityTier: 'test-only', verification: 'unverified', installability: 'bundle-installable', artifactDigest: release.artifactDigest, releaseId: release.releaseId, metadata: packageMetadata, presentationId: 'fixture-intro', categories: ['test-only'], screenshots: [], enabledPolicy: 'default-off', requiresRestart: false, requiresSetup: false, largeExternalResource: false })
    writeJson('catalog-presentation.json', { id: 'fixture-intro', revision: 'fixture-1', title: '本地测试', summary: '不是正式内容', markdown: '# 合成空 bundle\n仅测试使用。', media: [] })
    writeJson('catalog-delivery.json', { pluginId: release.pluginId, packageName, version: release.version, artifactDigest: release.artifactDigest, sources: [{ kind: 'local-file', ref: join(root, 'plugin.tgz'), priority: 0, size: release.size }] })
    writeJson('catalog-status.json', { releaseId: release.releaseId, sequence: 1, status: 'active', effectiveAt: '2026-09-28T00:00:00Z', reason: '合成测试记录，不是已发布事实' })
    writeJson('catalog-assembly.json', { schemaVersion: '1', kind: 'CatalogAssembly', testOnly: true, revision: `fixture-${route}-1`, generatedAt: '2026-09-28T00:00:00Z', publication: { sourceId: 'synthetic-content', sequence: 1 }, plugins: ['catalog-plugin.json'], releases: ['release.json'], releaseStatuses: ['catalog-status.json'], presentations: ['catalog-presentation.json'], deliveries: ['catalog-delivery.json'], recommendations: [], collections: [], packs: [] })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = process.argv[2]
  if (!output) throw new Error('必须明确提供新输出目录；不会在工程或用户 profile 自动建样例')
  createSamples(output)
  console.log(JSON.stringify({ status: 'test-fixtures-created', output: resolve(output), production: false }))
}
