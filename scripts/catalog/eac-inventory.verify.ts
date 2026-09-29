/** Targeted static validation only: never import or execute package payloads. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { validateMarketIndex } from '../../packages/market-core/src/catalog/validate.ts'
import { parseRelease } from '../../packages/market-core/src/catalog/releases.ts'
import { validateBuildRecipe } from '../../packages/market-core/src/catalog/submission.ts'
import { verifyTgzFile } from '../../packages/market-core/src/delivery/tgz.ts'
import { compareVersions } from '../../packages/market-core/src/core/semver.ts'

const root = resolve(process.argv[2] ?? 'D:/eac-market-verify/distribution-20260928/inventory-v3')
const read = (name: string): any => JSON.parse(readFileSync(join(root, name), 'utf8'))
const hash = (bytes: Uint8Array | string): string => 'sha256:' + createHash('sha256').update(bytes).digest('hex')
const inventory = read('inventory.json')
const index = read('market-index.candidate.json')
const ledger = read('artifacts.json')
const report: any = { kind: 'EacInventoryStaticValidation', network: false, packageCodeExecuted: false,
  runtimeVerification: 'not-tested', checks: [], artifacts: [], errors: [] }

try {
  const validated = validateMarketIndex(index)
  assert.equal(validated.snapshot.listings?.length ?? 0, read('listing-only.json').plugins.length)
  report.checks.push({ check: 'market-index-v2', status: 'pass', plugins: validated.snapshot.plugins.length, listings: validated.snapshot.listings?.length ?? 0 })
} catch (error: any) {
  report.errors.push({ check: 'market-index-v2', code: error.code, message: error.message })
}
assert.equal(new Set(inventory.plugins.map((item: any) => item.packageName)).size, inventory.plugins.length)
assert.equal(inventory.plugins.length, inventory.summary.totalNamedPackages)
assert.equal(inventory.plugins.filter((item: any) => item.catalogProjection.target === 'listing-only').length, read('listing-only.json').plugins.length)
for (const artifact of ledger.artifacts) {
  try {
    const expected = { packageName: artifact.packageName, version: artifact.version,
      artifactDigest: artifact.sha256, requireBundle: artifact.packageName !== '@dsh-eac/ui-skin-manager' }
    const verified = await verifyTgzFile(join(root, artifact.path), expected)
    assert.equal(verified.size, artifact.bytes)
    assert.equal(hash(verified.packageJson), artifact.metadataDigest)
    assert.equal(verified.packageJson, Buffer.from(artifact.metadata.packageJson.contentBase64, 'base64').toString('utf8'))
    assert.deepEqual([...verified.files].sort(), [...artifact.metadata.files].sort())
    const release = index.releases.find((r: any) => r.releaseId === artifact.releaseId)
    if (release) {
      parseRelease(release)
      assert.equal(release.artifactDigest, artifact.sha256)
      assert.equal(release.metadataDigest, artifact.metadataDigest)
    }
    report.artifacts.push({ packageName: artifact.packageName, version: artifact.version, sha256: artifact.sha256,
      files: verified.files.length, bundlePatch: verified.bundlePatch ?? null, status: 'pass' })
  } catch (error: any) {
    report.errors.push({ check: 'tgz', packageName: artifact.packageName, version: artifact.version, message: error.message })
  }
}
for (const { path, lockPath, recipe } of read('recipe-index.json')) {
  validateBuildRecipe(recipe)
  assert.equal(recipe.lockDigest, hash(readFileSync(join(root, lockPath))))
  const release = index.releases.find((r: any) => r.provenance.recipeDigest === hash(readFileSync(join(root, path))))
  assert.ok(release, 'Recipe digest must bind a real release')
}
for (const name of ['@deepseek-ai/dsh-plugin-manager', '@deepseek-ai/dsh-terminal']) {
  const item = inventory.plugins.find((item: any) => item.packageName === name)
  assert.equal(item.official.sameNameInSource, true)
  assert.equal(item.official.bundledByOfficialDependencyGraph, true)
  assert.equal(item.install.canInstall, false)
  assert.equal(item.install.state, 'hard-blocked')
}
for (const name of ['@dsh-eac/skin-miku', '@dsh-eac/skin-trading']) {
  const old = ledger.artifacts.find((a: any) => a.packageName === name && a.version === '1.1.0')
  const derived = ledger.artifacts.find((a: any) => a.packageName === name && a.kind === 'derived-built-repack')
  assert.ok(old && derived)
  assert.equal(old.installCandidate, false)
  assert.equal(derived.installCandidate, true)
  assert.ok(compareVersions(derived.version, old.version) > 0, 'Derived repair must upgrade the bad original')
  assert.ok(compareVersions(derived.version, '1.1.1-eac.dc22280.1') > 0, 'Runtime repair must supersede the broken .1 derivative')
  assert.notEqual(old.sha256, derived.sha256)
  assert.ok(derived.metadata.files.includes('UPSTREAM-PACKAGE.json'))
  assert.ok(derived.metadata.files.includes('EAC-DERIVATION.json'))
  assert.equal(index.releaseStatuses.find((s: any) => s.releaseId === old.releaseId)?.status, 'withdrawn')
  assert.ok(!index.deliveries.some((d: any) => d.packageName === name && d.version === '1.1.0'))
}
for (const item of inventory.plugins) {
  assert.equal(item.install.runtimeVerification, 'not-tested')
  if (item.license.canRedistribute === false) assert.equal(item.install.canInstall, false)
  if (item.catalogProjection.target === 'listing-only') assert.equal(item.install.canInstall, false)
}
report.checks.push({ check: 'coverage-and-gates', status: 'pass', namedPackages: inventory.plugins.length,
  missingMetadataListings: read('listing-only.json').plugins.length, nameCollisionsBlocked: 2, oldSkinsWithdrawn: 2,
  buildRecipes: read('recipe-index.json').length })
report.status = report.errors.length ? 'failed' : 'passed-static-materials-only'
const output = join(root, 'validation.json')
const bytes = JSON.stringify(report, null, 2) + '\n'
if (existsSync(output)) assert.equal(readFileSync(output, 'utf8'), bytes, 'Do not overwrite a different validation run')
else writeFileSync(output, bytes, { flag: 'wx' })
console.log(JSON.stringify(report, null, 2))
if (report.errors.length) process.exitCode = 1
