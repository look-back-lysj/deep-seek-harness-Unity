/**
 * 投稿专用的只读变更检查：比较可信基线与暂存区/指定提交。
 * 不读取或执行投稿脚本、不联网、不下载制品；通过不等于许可、身份或运行已审核。
 * 审核他人PR时应从可信main调用本脚本，不能执行投稿者修改的检查工具。
 */
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseRelease } from '../../packages/market-core/src/catalog/releases.ts'
import { parseMetadata } from '../../packages/market-core/src/catalog/metadata.ts'
import { validateBuildRecipe } from '../../packages/market-core/src/catalog/submission.ts'

const FIXED = new Set(['submission.json', 'release.json', 'metadata.json', 'presentation.json', 'README.md', 'LICENSE', 'NOTICE', 'download.json', 'verification.md', 'build-recipe.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock'])
const REQUIRED = ['submission.json', 'release.json', 'metadata.json', 'presentation.json', 'README.md', 'LICENSE', 'download.json', 'verification.md']
const check = (condition, message) => { if (!condition) throw new Error(message) }

export function checkSubmissionPr({ cwd = process.cwd(), base, head } = {}) {
  check(base, '必须传 --base <可信main提交或引用>，不自动猜基线')
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true })
  const commit = ref => git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim()
  const baseSha = commit(base)
  const headSha = commit(head ?? 'HEAD')
  const common = git('merge-base', baseSha, headSha).trim()
  const changed = git('diff', '--name-status', '-z', '--no-renames', ...(head ? [common, headSha] : ['--cached', common]), '--').split('\0').filter(Boolean)
  check(changed.length > 0 && changed.length % 2 === 0, '没有待检查的投稿变更；先暂存，或传 --head')
  const paths = []
  let folder
  for (let index = 0; index < changed.length; index += 2) {
    const [status, path] = changed.slice(index, index + 2)
    check(status === 'A', `投稿仅可新增版本目录，拒绝修改/删除/重命名：${path}`)
    const match = /^catalog-source\/submissions\/([a-z0-9][a-z0-9._-]{0,119})\/([0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?)\/(.+)$/.exec(path)
    check(match, `越出投稿目录或目录名无效：${path}`)
    const current = `catalog-source/submissions/${match[1]}/${match[2]}/`
    check(!folder || folder === current, '一个PR只能提交一个插件的一个版本')
    folder = current
    const name = match[3]
    check(FIXED.has(name) || /^media\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:png|jpg|jpeg|gif|webp)$/.test(name), `不允许的投稿文件：${path}`)
    paths.push(path)
  }
  check(git('ls-tree', '-r', '--name-only', baseSha, '--', folder).trim() === '', '目标版本目录已经进入main；请用新版本，不能覆盖已接收资料')
  const entries = head ? git('ls-tree', '-r', '-z', headSha, '--', folder) : git('ls-files', '--stage', '-z', '--', folder)
  const files = new Map()
  for (const line of entries.split('\0').filter(Boolean)) {
    const [info, path] = line.split('\t')
    const fields = info.split(' ')
    check(fields[0] === '100644' && (head || fields[2] === '0'), `不允许链接、子模块、可执行文件或冲突文件：${path}`)
    files.set(path.slice(folder.length), head ? fields[2] : fields[1])
  }
  for (const name of REQUIRED) check(files.has(name), `缺少必交材料：${name}`)
  const cache = new Map()
  const read = name => {
    if (cache.has(name)) return cache.get(name)
    check(files.has(name), `引用了未提交文件：${name}`)
    const size = Number(git('cat-file', '-s', files.get(name)).trim())
    const limit = name === 'LICENSE' ? 128 * 1024 : name === 'README.md' ? 512 * 1024 : (name.startsWith('media/') ? 8 : 2) * 1024 * 1024
    check(size > 0 && size <= limit, `文件为空或超限：${name}`)
    const content = git('cat-file', 'blob', files.get(name))
    cache.set(name, content)
    return content
  }
  const json = name => JSON.parse(read(name))
  const submission = json('submission.json')
  check(submission.schemaVersion === '1' && submission.kind === 'AuthorSubmission' && submission.testOnly === false, '必须是正式AuthorSubmission，testOnly必须为false')
  check(['author-release', 'team-build'].includes(submission.route), '发行路线无效')
  check(submission.author?.name?.trim() && submission.author?.contact?.trim(), '缺少作者名称或公开联系入口')
  for (const [key, value] of Object.entries({ release: 'release.json', artifact: 'plugin.tgz', metadata: 'metadata.json', presentation: 'presentation.json', licenseFile: 'LICENSE' })) check(submission[key] === value, `submission.${key}必须为${value}`)
  const release = parseRelease(json('release.json'))
  check(folder === `catalog-source/submissions/${release.pluginId}/${release.version}/`, '目录ID/版本与发行身份不一致')
  check(release.provenance.kind === submission.route && !/^0+$/.test(release.provenance.commit), '发行路线不一致或源码commit为占位值')
  check(!/(?:\.invalid|\.test|example\.(?:com|org|net))/i.test(JSON.stringify(release)), '发行记录包含占位地址')
  const metadata = parseMetadata(json('metadata.json'), { id: release.pluginId, packageName: release.packageName, version: release.version, artifactDigest: release.artifactDigest, installability: 'bundle-installable' })
  const digest = metadata.kind === 'official-bundle' ? metadata.packageJson.sha256 : metadata.manifest.sha256
  check(digest === release.metadataDigest, '元数据与发行摘要不一致')
  const presentation = json('presentation.json')
  for (const key of ['title', 'summary', 'audience', 'usageEntry', 'setup', 'limitations', 'support', 'attribution']) check(typeof presentation[key] === 'string' && presentation[key].trim(), `介绍缺少${key}`)
  check(presentation.readme === 'README.md' && Array.isArray(presentation.media), '介绍必须引用README.md和media数组')
  const referenced = new Set(REQUIRED)
  if (files.has('NOTICE')) referenced.add('NOTICE')
  for (const media of presentation.media) {
    check(/^media\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:png|jpg|jpeg|gif|webp)$/.test(media.path), '媒体路径无效')
    check(typeof media.alt === 'string' && media.alt.trim() && typeof media.attribution === 'string' && media.attribution.trim(), '媒体缺少替代文字/来源')
    check(!referenced.has(media.path), '媒体重复引用')
    referenced.add(media.path)
  }
  const download = json('download.json')
  check(download.schemaVersion === '1' && Array.isArray(download.artifactUrls) && download.artifactUrls.length >= 1 && download.artifactUrls.length <= 8, '缺少1至8个正式制品下载地址')
  check(Object.keys(download).every(key => ['schemaVersion', 'artifactUrls'].includes(key)), 'download.json包含未定义字段')
  for (const value of download.artifactUrls) {
    const url = new URL(value)
    check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && /\.(?:tgz|tar\.gz)$/.test(url.pathname), '下载地址须为不带凭据/查询参数的HTTPS tgz原始文件地址')
    check(!/\/(?:main|master|latest)(?:\/|$)/i.test(url.pathname) && !/(?:^|\.)(?:localhost|local|test|invalid)$/.test(url.hostname) && !/^\[|^[\d.]+$/.test(url.hostname), '下载地址不能使用浮动版本、本地地址或IP')
  }
  if (submission.route === 'team-build') {
    check(submission.buildRecipe === 'build-recipe.json', '团队构建必须引用build-recipe.json')
    const recipe = validateBuildRecipe(json('build-recipe.json'))
    check(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock'].includes(submission.lockFile) && recipe.lockFile === submission.lockFile, '锁文件引用不一致或不受支持')
    referenced.add('build-recipe.json'); referenced.add(submission.lockFile)
  } else {
    check(submission.buildRecipe === undefined && submission.lockFile === undefined, '作者发行路线请删除不用的buildRecipe/lockFile字段')
  }
  for (const name of referenced) read(name)
  for (const name of files.keys()) check(referenced.has(name), `多交或未引用文件：${name}`)
  return { status: 'checked-pr-materials', base: baseSha, comparedFrom: common, head: head ?? 'staged', folder, files: files.size, artifactVerification: 'run-validate-submission-separately', publication: 'not-published', runtimeVerification: 'not-tested' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    check(args.length >= 2 && args.length <= 4, '用法：node scripts/catalog/check-submission-pr.mjs --base <main引用> [--head <PR提交>]')
    const options = {}
    for (let i = 0; i < args.length; i += 2) {
      check(['--base', '--head'].includes(args[i]) && args[i + 1] && options[args[i].slice(2)] === undefined, '参数无效或重复')
      options[args[i].slice(2)] = args[i + 1]
    }
    console.log(JSON.stringify(checkSubmissionPr(options), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', reason: error instanceof Error ? error.message : String(error) }))
    process.exitCode = 1
  }
}
