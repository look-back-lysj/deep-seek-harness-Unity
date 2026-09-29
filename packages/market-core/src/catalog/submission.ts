/**
 * 团队离线接收校验。读取已存在的本地文件核对字节，不联网、不运行作者命令、不发布。
 * 团队构建配方可审查；真正构建须在单独获准的临时 CI 环境执行。
 */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ReleaseRecord } from './model.ts'
import { parseRelease } from './releases.ts'
import { verifyTgzFile, type VerifiedTgz } from '../delivery/tgz.ts'
import { parseMetadata } from './metadata.ts'
import { validateMarketIndex } from './validate.ts'
import type { CatalogLimitOptions } from './model.ts'
import * as v from './input.ts'

export interface BuildRecipe {
  readonly schemaVersion: '1'
  readonly kind: 'TeamBuildRecipe'
  readonly repositoryUrl: string
  readonly commit: string
  readonly sourceSubdir: string
  readonly lockFile: string
  readonly lockDigest: string
  readonly authorization: { readonly basis: 'license' | 'permission'; readonly reference: string; readonly redistribution: true }
  readonly toolchain: readonly { readonly name: string; readonly version: string }[]
  readonly target: { readonly os: string; readonly arch: string }
  readonly steps: readonly { readonly executable: string; readonly args: readonly string[] }[]
  readonly allowedLifecycleScripts: readonly string[]
  readonly output: string
  readonly limits: { readonly timeoutSeconds: number; readonly memoryMiB: number; readonly diskMiB: number }
  readonly credentials: 'none'
}

export function validateBuildRecipe(input: unknown): BuildRecipe {
  const item = v.object(input, 'buildRecipe')
  if (item.schemaVersion !== '1' || item.kind !== 'TeamBuildRecipe' || item.credentials !== 'none') v.invalid('build-recipe', '配方必须使用独立 TeamBuildRecipe 且不带发布凭据')
  const commit = v.string(item.commit, 'commit', 40)
  if (!/^[a-f0-9]{40}$/.test(commit)) v.invalid('fixed-source-required', '构建源码必须固定完整 commit')
  const authorization = v.object(item.authorization, 'authorization')
  if (!['license', 'permission'].includes(String(authorization.basis)) || authorization.redistribution !== true) v.invalid('authorization-required', '构建配方必须有再分发依据')
  const tools = v.array(item.toolchain, 'toolchain', 16).map(value => {
    const tool = v.object(value, 'tool')
    return { name: v.string(tool.name, 'tool.name', 100), version: v.exactVersion(tool.version, 'tool.version') }
  })
  if (!tools.length || new Set(tools.map(tool => tool.name)).size !== tools.length) v.invalid('build-toolchain', '构建工具链为空或重复')
  const steps = v.array(item.steps, 'steps', 64).map(value => {
    const step = v.object(value, 'step')
    const executable = v.string(step.executable, 'step.executable', 100)
    if (!tools.some(tool => tool.name === executable)) v.invalid('build-executable', '构建命令必须使用已登记精确版本的工具')
    const args = v.array(step.args, 'step.args', 128).map(arg => v.string(arg, 'step.arg', 4096))
    return { executable, args }
  })
  if (!steps.length) v.invalid('build-steps', '构建配方缺少步骤')
  const target = v.object(item.target, 'target')
  if (!['win32', 'linux', 'darwin'].includes(String(target.os)) || !['x64', 'arm64'].includes(String(target.arch))) v.invalid('build-target', '构建目标无效')
  const limits = v.object(item.limits, 'limits')
  return {
    schemaVersion: '1', kind: 'TeamBuildRecipe', repositoryUrl: v.httpsUrl(item.repositoryUrl, 'repositoryUrl'), commit,
    sourceSubdir: item.sourceSubdir === '.' ? '.' : v.relativeFile(item.sourceSubdir, 'sourceSubdir'),
    lockFile: v.relativeFile(item.lockFile, 'lockFile'), lockDigest: v.digest(item.lockDigest, 'lockDigest'),
    authorization: { basis: authorization.basis as 'license' | 'permission', reference: v.string(authorization.reference, 'authorization.reference'), redistribution: true },
    toolchain: tools, target: { os: String(target.os), arch: String(target.arch) }, steps,
    allowedLifecycleScripts: v.array(item.allowedLifecycleScripts, 'allowedLifecycleScripts', 128).map(value => v.string(value, 'lifecycleScript', 214)),
    output: v.relativeFile(item.output, 'output'), limits: { timeoutSeconds: v.integer(limits.timeoutSeconds, 'timeoutSeconds', 1, 3600), memoryMiB: v.integer(limits.memoryMiB, 'memoryMiB', 128, 65536), diskMiB: v.integer(limits.diskMiB, 'diskMiB', 128, 131072) }, credentials: 'none',
  }
}

function readLocal(root: string, path: unknown, field: string, max = 8 * 1024 * 1024): { path: string; bytes: Buffer } {
  const localPath = realpathSync(resolve(root, v.relativeFile(path, field)))
  const rel = relative(realpathSync(root), localPath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) v.invalid('submission-path', `${field} 越出提交目录`)
  if (!statSync(localPath).isFile() || statSync(localPath).size > max) v.invalid('submission-size', `${field} 非普通文件或体积超限`)
  return { path: localPath, bytes: readFileSync(localPath) }
}

export interface SubmissionValidation {
  readonly status: 'validated-local-materials'
  readonly release: ReleaseRecord
  readonly artifact: VerifiedTgz
  readonly publication: 'not-published'
  readonly runtimeVerification: 'not-tested'
  readonly warnings: readonly string[]
}

export async function validateAuthorSubmission(input: unknown, root: string, options: { readonly allowTestFixture?: boolean } = {}): Promise<SubmissionValidation> {
  const item = v.object(input, 'submission')
  if (item.schemaVersion !== '1' || item.kind !== 'AuthorSubmission') v.invalid('submission-kind', '必须是 AuthorSubmission 作者资料')
  if (item.testOnly === true && !options.allowTestFixture) v.invalid('fixture-forbidden', '测试作者资料禁止进入正式生成入口')
  const author = v.object(item.author, 'author')
  v.string(author.name, 'author.name', 200)
  v.string(author.contact, 'author.contact', 1000)
  const releaseInput = readLocal(root, item.release, 'release')
  const release = parseRelease(v.json(releaseInput.bytes, 'release'))
  if (release.provenance.kind !== item.route) v.invalid('submission-route', '作者路线与发行来源不一致')
  if (item.testOnly !== true && /(?:\.invalid|\.test|example\.(?:com|org|net))/i.test(JSON.stringify(release))) v.invalid('placeholder-url', '占位 URL 不能进入正式资料')
  const license = readLocal(root, item.licenseFile, 'licenseFile')
  v.string(license.bytes.toString('utf8'), 'licenseNotice', 128 * 1024)
  const presentationInput = readLocal(root, item.presentation, 'presentation')
  const presentation = v.object(v.json(presentationInput.bytes, 'presentation'), 'presentation')
  for (const key of ['title', 'summary', 'audience', 'usageEntry', 'setup', 'limitations', 'support', 'attribution']) v.string(presentation[key], `presentation.${key}`)
  const markdown = readLocal(root, presentation.readme, 'presentation.readme')
  v.string(markdown.bytes.toString('utf8'), 'README', 512 * 1024)
  for (const entry of v.array(presentation.media, 'presentation.media', 128)) {
    const media = v.object(entry, 'media')
    const file = readLocal(root, media.path, 'media.path')
    if (v.hash(file.bytes) !== v.digest(media.sha256, 'media.sha256')) v.invalid('media-digest', '介绍媒体摘要不符')
    v.string(media.alt, 'media.alt')
    v.string(media.attribution, 'media.attribution')
  }
  const artifact = readLocal(root, item.artifact, 'artifact', 200 * 1024 * 1024)
  const verified = await verifyTgzFile(artifact.path, { ...release, requireBundle: true })
  if (verified.size !== release.size) v.invalid('artifact-size', '制品体积与发行记录不符')
  const metadataInput = readLocal(root, item.metadata, 'metadata')
  const metadata = parseMetadata(v.json(metadataInput.bytes, 'metadata'), { id: release.pluginId, packageName: release.packageName, version: release.version, artifactDigest: release.artifactDigest, installability: 'bundle-installable' } as import('../contracts/types.ts').CatalogPlugin)
  const metadataDigest = metadata.kind === 'official-bundle' ? metadata.packageJson.sha256 : metadata.manifest.sha256
  if (metadataDigest !== release.metadataDigest) v.invalid('metadata-release', '元数据摘要与发行不符')
  if (metadata.kind === 'official-bundle' && (v.hash(verified.packageJson) !== metadataDigest || JSON.stringify([...metadata.files].sort()) !== JSON.stringify([...verified.files].sort()))) v.invalid('metadata-artifact', '官方元数据或文件表不是实际 tgz 内容')
  if (release.provenance.kind === 'team-build') {
    const recipeInput = readLocal(root, item.buildRecipe, 'buildRecipe')
    const recipe = validateBuildRecipe(v.json(recipeInput.bytes, 'buildRecipe'))
    const lock = readLocal(root, item.lockFile, 'lockFile')
    const provenance = release.provenance
    if (v.hash(recipeInput.bytes) !== provenance.recipeDigest || v.hash(lock.bytes) !== provenance.lockDigest || recipe.lockDigest !== provenance.lockDigest || recipe.repositoryUrl !== provenance.repositoryUrl || recipe.commit !== provenance.commit || recipe.sourceSubdir !== provenance.sourceSubdir || JSON.stringify(recipe.toolchain) !== JSON.stringify(provenance.toolchain) || JSON.stringify(recipe.target) !== JSON.stringify(provenance.target) || JSON.stringify(recipe.authorization) !== JSON.stringify(provenance.authorization)) v.invalid('build-binding', '团队构建的固定源码、锁文件、配方或工具链未绑定同一发行')
  }
  return { status: 'validated-local-materials', release, artifact: verified, publication: 'not-published', runtimeVerification: 'not-tested', warnings: ['仅核对本地材料和字节；作者身份、再分发依据与实际宿主运行需团队审查', '未访问下载地址，未验证线上双源可达性'] }
}

export function validateProductionCatalog(input: unknown, options: CatalogLimitOptions = {}) {
  const item = v.object(input, 'catalog')
  if (item.testOnly === true || item.schemaVersion !== '2') v.invalid('production-input', '正式目录必须是非 fixture 的 v2')
  const text = JSON.stringify(input)
  if (/https?:\/\/[^"\s]*(?:\.invalid|\.test|example\.(?:com|org|net))|fixture-plugin|dev\.test\./i.test(text)) v.invalid('fixture-forbidden', '测试名称或占位 URL 不能进入正式目录')
  const validated = validateMarketIndex(input, options)
  for (const delivery of validated.snapshot.deliveries) for (const source of delivery.sources) {
    if (!['registry-tarball', 'https-artifact'].includes(source.kind)) v.invalid('production-source', '正式目录不接受本机路径或测试缓存来源')
    v.httpsUrl(source.ref, 'source.ref')
    if (/\/releases\/latest(?:\/|$)|\/(?:main|master)\//i.test(source.ref)) v.invalid('floating-source', '正式制品来源不能指向浮动分支或 latest')
  }
  return validated
}
