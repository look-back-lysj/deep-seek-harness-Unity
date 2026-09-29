import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { checkSubmissionPr } from '../../scripts/catalog/check-submission-pr.mjs'
import { createSamples } from '../../scripts/catalog/create-sample.ts'
import { releaseIdFor } from '../../packages/market-core/src/catalog/releases.ts'
import { validateAuthorSubmission } from '../../packages/market-core/src/catalog/submission.ts'
import { hash } from '../../packages/market-core/src/catalog/input.ts'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'eac-submission-pr-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true })
  git('init', '-q'); git('config', 'core.autocrlf', 'false'); git('config', 'user.name', 'Submission tests'); git('config', 'user.email', 'tests@example.invalid')
  writeFileSync(join(repo, 'README.md'), 'trusted baseline\n'); git('add', 'README.md'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'base')
  const base = git('rev-parse', 'HEAD').trim()
  const fixtureRoot = join(root, 'fixtures'); createSamples(fixtureRoot)
  const source = join(fixtureRoot, 'author-release')
  const folder = 'catalog-source/submissions/testing.author-release/1.0.0'
  const directory = join(repo, folder); mkdirSync(directory, { recursive: true })
  for (const name of ['submission.json', 'release.json', 'metadata.json', 'presentation.json', 'README.md', 'LICENSE']) copyFileSync(join(source, name), join(directory, name))
  const writeJson = (name: string, data: unknown) => writeFileSync(join(directory, name), JSON.stringify(data, null, 2) + '\n')
  const release = JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8'))
  release.pluginId = 'testing.author-release'
  release.provenance.repositoryUrl = 'https://github.com/eac-test/empty-bundle'
  release.provenance.commit = 'a'.repeat(40)
  release.provenance.releaseUrl = 'https://github.com/eac-test/empty-bundle/releases/tag/v1.0.0'
  release.releaseId = releaseIdFor(release); writeJson('release.json', release)
  const submission = JSON.parse(readFileSync(join(directory, 'submission.json'), 'utf8'))
  submission.testOnly = false; delete submission.buildRecipe; delete submission.lockFile
  writeJson('submission.json', submission)
  writeJson('download.json', { schemaVersion: '1', artifactUrls: ['https://github.com/eac-test/empty-bundle/releases/download/v1.0.0/plugin.tgz'] })
  writeFileSync(join(directory, 'verification.md'), 'Synthetic test only; no runtime or author approval claimed.\n')
  const stage = () => git('add', '--', folder)
  stage()
  return { root, repo, git, base, folder, directory, source, release, submission, stage, writeJson }
}

it('投稿检查支持暂存区与确切PR提交，忽略未暂存编辑，不要求把tgz提交Git', () => {
  const f = setup()
  expect(checkSubmissionPr({ cwd: f.repo, base: f.base })).toMatchObject({ status: 'checked-pr-materials', files: 8, publication: 'not-published' })
  writeFileSync(join(f.repo, 'README.md'), 'unstaged unrelated work')
  expect(checkSubmissionPr({ cwd: f.repo, base: f.base }).files).toBe(8)
  f.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'submission')
  expect(checkSubmissionPr({ cwd: f.repo, base: f.base, head: 'HEAD' }).status).toBe('checked-pr-materials')
}, 15000)

it('拒绝漏交元数据；检查真实暂存集合而非仅磁盘文件', () => {
  const f = setup(); f.git('reset', '-q', '--', `${f.folder}/metadata.json`)
  expect(() => checkSubmissionPr({ cwd: f.repo, base: f.base })).toThrow(/缺少必交材料/)
})

it.each(['modify', 'delete', 'rename'])('拒绝投稿夹外%s，包括删除和重命名', action => {
  const f = setup()
  if (action === 'modify') { writeFileSync(join(f.repo, 'README.md'), 'changed'); f.git('add', 'README.md') }
  if (action === 'delete') f.git('rm', '-q', 'README.md')
  if (action === 'rename') f.git('mv', 'README.md', 'OTHER.md')
  expect(() => checkSubmissionPr({ cwd: f.repo, base: f.base })).toThrow(/拒绝修改|越出投稿/)
})

it('拒绝第二个插件、越权文件和伪装成普通文档的Git符号链接', () => {
  for (const scenario of ['second', 'script', 'link']) {
    const f = setup()
    if (scenario === 'second') { const dir = join(f.repo, 'catalog-source/submissions/another/1.0.0'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'README.md'), 'another'); f.git('add', 'catalog-source/submissions/another') }
    if (scenario === 'script') { writeFileSync(join(f.directory, 'build.mjs'), 'throw Error()'); f.stage() }
    if (scenario === 'link') { const sha = f.git('hash-object', '-w', '--stdin'); /* no stdin bytes: harmless empty symlink target */ f.git('update-index', '--cacheinfo', `120000,${sha.trim()},${f.folder}/README.md`) }
    expect(() => checkSubmissionPr({ cwd: f.repo, base: f.base })).toThrow(/一个PR|不允许/)
  }
}, 15000)

it('拒绝错误版本身份、未提交图片和浮动下载地址', () => {
  for (const scenario of ['identity', 'media', 'url']) {
    const f = setup()
    if (scenario === 'identity') { f.release.pluginId = 'wrong.id'; f.release.releaseId = releaseIdFor(f.release); f.writeJson('release.json', f.release) }
    if (scenario === 'media') { const p = JSON.parse(readFileSync(join(f.directory, 'presentation.json'), 'utf8')); p.media.push({ path: 'media/missing.png', sha256: `sha256:${'a'.repeat(64)}`, alt: 'test', attribution: 'test' }); f.writeJson('presentation.json', p) }
    if (scenario === 'url') f.writeJson('download.json', { schemaVersion: '1', artifactUrls: ['https://github.com/a/b/raw/main/plugin.tgz'] })
    f.stage()
    expect(() => checkSubmissionPr({ cwd: f.repo, base: f.base })).toThrow(/身份不一致|未提交文件|浮动版本/)
  }
}, 15000)

it('正式发布过的目录不能以旧基线检查冒充新投稿', () => {
  const f = setup(); f.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'accepted')
  const accepted = f.git('rev-parse', 'HEAD').trim()
  writeFileSync(join(f.directory, 'README.md'), 'changed published material'); f.stage()
  expect(() => checkSubmissionPr({ cwd: f.repo, base: accepted })).toThrow(/拒绝修改/)
})

it('团队构建也能完成材料检查和原有制品校验，缺真实锁文件则拒绝', async () => {
  const f = setup(); const team = join(f.root, 'fixtures', 'team-build')
  for (const name of ['release.json', 'metadata.json', 'presentation.json', 'README.md', 'LICENSE', 'build-recipe.json']) copyFileSync(join(team, name), join(f.directory, name))
  copyFileSync(join(team, 'fixture-lock.json'), join(f.directory, 'pnpm-lock.yaml'))
  const recipe = JSON.parse(readFileSync(join(f.directory, 'build-recipe.json'), 'utf8'))
  recipe.repositoryUrl = 'https://github.com/eac-test/empty-bundle'; recipe.commit = 'a'.repeat(40); recipe.lockFile = 'pnpm-lock.yaml'
  f.writeJson('build-recipe.json', recipe)
  const release = JSON.parse(readFileSync(join(f.directory, 'release.json'), 'utf8'))
  release.pluginId = f.release.pluginId; release.releaseId = releaseIdFor(release)
  Object.assign(release.provenance, { repositoryUrl: recipe.repositoryUrl, commit: recipe.commit, recipeDigest: hash(readFileSync(join(f.directory, 'build-recipe.json'))) })
  f.writeJson('release.json', release)
  const submission = { ...f.submission, route: 'team-build', buildRecipe: 'build-recipe.json', lockFile: 'pnpm-lock.yaml' }
  f.writeJson('submission.json', submission); f.stage()
  expect(checkSubmissionPr({ cwd: f.repo, base: f.base }).files).toBe(10)
  copyFileSync(join(team, 'plugin.tgz'), join(f.directory, 'plugin.tgz'))
  expect((await validateAuthorSubmission(submission, f.directory)).status).toBe('validated-local-materials')
  f.git('reset', '-q', '--', `${f.folder}/pnpm-lock.yaml`)
  expect(() => checkSubmissionPr({ cwd: f.repo, base: f.base })).toThrow(/未提交文件/)
}, 15000)

it('真实tgz生成的元数据与原字节一致，并能继续走原有完整投稿校验', async () => {
  const f = setup(); const output = join(f.root, 'described')
  const result = execFileSync(process.execPath, [resolve('scripts/catalog/describe-artifact.ts'), join(f.source, 'plugin.tgz'), f.release.pluginId, f.release.packageName, f.release.version, output], { encoding: 'utf8', windowsHide: true })
  expect(JSON.parse(result)).toMatchObject({ status: 'described-artifact', artifactDigest: f.release.artifactDigest })
  const described = JSON.parse(readFileSync(join(output, 'metadata.json'), 'utf8'))
  const original = JSON.parse(readFileSync(join(f.directory, 'metadata.json'), 'utf8'))
  expect(described.packageJson).toEqual(original.packageJson)
  expect([...described.files].sort()).toEqual([...original.files].sort())
  copyFileSync(join(output, 'metadata.json'), join(f.directory, 'metadata.json'))
  copyFileSync(join(f.source, 'plugin.tgz'), join(f.directory, 'plugin.tgz'))
  expect((await validateAuthorSubmission(f.submission, f.directory)).status).toBe('validated-local-materials')
  expect(() => execFileSync(process.execPath, [resolve('scripts/catalog/describe-artifact.ts'), join(f.source, 'plugin.tgz'), f.release.pluginId, 'wrong-package', f.release.version, join(f.root, 'wrong')], { stdio: 'pipe', windowsHide: true })).toThrow()
})
