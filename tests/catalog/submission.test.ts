import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createSamples } from '../../scripts/catalog/create-sample.ts'
import { validateAuthorSubmission, validateBuildRecipe, validateProductionCatalog } from '../../packages/market-core/src/catalog/index.ts'
import { hash } from '../../packages/market-core/src/catalog/input.ts'

it('两条发行路线校验实际无害 tgz 字节；团队 fixture 能在本地复建相同字节', async () => {
  const root = mkdtempSync(join(tmpdir(), 'submission-routes-'))
  createSamples(root)
  for (const route of ['author-release', 'team-build']) {
    const directory = join(root, route)
    const input = JSON.parse(readFileSync(join(directory, 'submission.json'), 'utf8'))
    await expect(validateAuthorSubmission(input, directory)).rejects.toThrow(/测试作者/)
    const result = await validateAuthorSubmission(input, directory, { allowTestFixture: true })
    expect(result.release.provenance.kind).toBe(route)
    expect(result.runtimeVerification).toBe('not-tested')
    expect(result.release.artifactDigest).toBe(hash(readFileSync(join(directory, 'plugin.tgz'))))
  }
  const team = join(root, 'team-build')
  execFileSync(process.execPath, [join(team, 'build-fixture.mjs')], { cwd: team, stdio: 'pipe', windowsHide: true })
  expect(hash(readFileSync(join(team, 'rebuilt-fixture.tgz')))).toBe(hash(readFileSync(join(team, 'plugin.tgz'))))
})

it('缺再分发依据、浮动源码、损坏锁文件和假的元数据文件表被拒', async () => {
  const root = mkdtempSync(join(tmpdir(), 'submission-invalid-'))
  createSamples(root)
  const team = join(root, 'team-build')
  const recipe = JSON.parse(readFileSync(join(team, 'build-recipe.json'), 'utf8'))
  expect(() => validateBuildRecipe({ ...recipe, commit: 'main' })).toThrow(/commit/)
  expect(() => validateBuildRecipe({ ...recipe, authorization: { ...recipe.authorization, redistribution: false } })).toThrow(/分发/)
  writeFileSync(join(team, 'fixture-lock.json'), 'changed')
  const input = JSON.parse(readFileSync(join(team, 'submission.json'), 'utf8'))
  await expect(validateAuthorSubmission(input, team, { allowTestFixture: true })).rejects.toThrow(/锁文件/)
})

it('正式目录生成入口拒绝 fixture 标记', () => {
  expect(() => validateProductionCatalog({ testOnly: true, schemaVersion: '2' })).toThrow(/fixture/)
})
