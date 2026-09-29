/** 只读固定组织仓对象；不 checkout、不更新 refs、不修改公共 schema 或生产记录。 */
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { evidenceSupportsVerification, validatePublicEvidence, validatePublicManifest, validatePublicPack, validatePublicPackLock } from '../../packages/market-core/src/catalog/public-format.ts'

const revision = '44178ab1360dcb8221a666e782391a11f5716074'
const repository = process.env.EAC_PROTOCOL_READONLY_REPO
// External reference checkout is optional; the normal test suite is portable.
const protocolIt = repository ? it : it.skip
const read = (path: string): Buffer => execFileSync('git', ['-C', repository!, 'show', `${revision}:mojobox/${path}`], { windowsHide: true })

protocolIt('固定 beta-pack 公共正反 fixture：npm 精确 Lock、Pack 分类、官方字段投影和 Evidence', () => {
  const pack = JSON.parse(read('fixtures/valid/pack.json').toString('utf8'))
  const components = pack.components.map((item: { id: string; version: string; required: boolean }) => ({ pluginId: item.id, version: item.version, required: item.required }))
  expect(() => validatePublicPack(read('fixtures/valid/pack.json'), pack.metadata.id, pack.metadata.version, components)).not.toThrow()
  expect(() => validatePublicPackLock(read('fixtures/valid/pack-lock.json'), pack.metadata.id, pack.metadata.version, components)).not.toThrow()
  for (const path of ['fixtures/invalid/pack-floating-version.json', 'fixtures/invalid/pack-invalid-category.json']) {
    const invalid = JSON.parse(read(path).toString('utf8'))
    expect(() => validatePublicPack(read(path), invalid.metadata.id, invalid.metadata.version, invalid.components.map((item: any) => ({ pluginId: item.id, version: item.version, required: item.required })))).toThrow()
  }
  const lock = JSON.parse(read('fixtures/invalid/pack-lock-floating-source.json').toString('utf8'))
  expect(() => validatePublicPackLock(read('fixtures/invalid/pack-lock-floating-source.json'), 'org.example.invalid-pack', '1.0.0', lock.components.map((item: any) => ({ pluginId: item.id, version: item.version, required: true })))).toThrow()
  for (const [path, valid] of [['fixtures/valid/plugin-official-package-metadata.json', true], ['fixtures/invalid/plugin-invalid-official-package-metadata.json', false]] as const) {
    const data = read(path), input = JSON.parse(data.toString('utf8'))
    if (valid) expect(() => validatePublicManifest(data, input)).not.toThrow()
    else expect(() => validatePublicManifest(data, input)).toThrow()
  }
  const evidence = read('fixtures/valid/evidence.json'), parsed = JSON.parse(evidence.toString('utf8'))
  const summary = validatePublicEvidence(evidence, parsed.subject, parsed.manifestDigest)
  expect(summary.level).toBe('Parsed')
  expect(evidenceSupportsVerification(summary, { id: 'any-host', dshVersion: '0.1.7-rc.2', runtime: 'node24' }, new Date())).toBe(false)
  const badEvidence = read('fixtures/invalid/evidence-negotiated-without-host.json'), bad = JSON.parse(badEvidence.toString('utf8'))
  expect(() => validatePublicEvidence(badEvidence, bad.subject, bad.manifestDigest)).toThrow()
})

protocolIt('固定生产候选里的 Parsed/pass 不升级为当前宿主验证', () => {
  const bytes = read('catalog/evidence/dev.eac.ui-skin-loader-1.1.0.parsed.json')
  const input = JSON.parse(bytes.toString('utf8'))
  const summary = validatePublicEvidence(bytes, input.subject, input.manifestDigest)
  expect(evidenceSupportsVerification(summary, { id: '@deepseek-ai/dsh-app-boot#desktop', dshVersion: '0.1.7-rc.2', runtime: 'node24' }, new Date('2026-09-28T00:00:00Z'))).toBe(false)
  const unpublished = JSON.parse(read('catalog/plugins/dev.eac.dsh-terminal.json').toString('utf8'))
  expect(unpublished['x-mojobox-maintenance'].artifactStatus).toBe('unpublished')
  expect(unpublished.artifact).toBeUndefined()
})
