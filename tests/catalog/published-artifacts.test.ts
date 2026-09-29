import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateMarketIndex } from '../../packages/market-core/src/catalog/validate.ts'
import { validatePackageMetadata } from '../../packages/market-core/src/catalog/public-format.ts'
import { prepareAcceptance } from '../../packages/market-core/src/catalog/lifecycle.ts'
import { createHash } from 'node:crypto'

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const index = () => read('../../packages/market/data/index.json')
describe('从作者发行补通真实下载', () => {
  it('每个恢复条目有固定发行和作者下载源，已知不兼容项继续阻止', () => {
    const document = index()
    const snapshot = validateMarketIndex(document).snapshot
    const records = read('../../catalog-source/published-20260928/recovered-records.json')
    for (const record of records) {
      const plugin = snapshot.plugins.find(p => p.packageName === record.packageName && p.version === record.version)!
      expect(plugin?.artifactDigest).toBe(record.artifactDigest)
      const delivery = snapshot.deliveries.find(d => d.packageName === record.packageName && d.version === record.version)!
      expect(delivery.sources.some(s => s.kind === 'registry-tarball' && s.ref.startsWith('https://registry.npmjs.org/'))).toBe(true)
      if (record.mirrored) expect(delivery.sources.some(s => /gitee\.com\/.+\/raw\/[a-f0-9]{40}\//.test(s.ref))).toBe(true)
      if (record.blockers.length) expect(plugin.installability).toBe('hard-blocked')
      else expect(plugin.installability).toBe('bundle-installable')
    }
    expect(snapshot.plugins.filter(p => p.installability === 'bundle-installable').length).toBeGreaterThan(15)
  })
  it('新增作者包不改已有冻结发行/撤回历史', () => {
    const old = read('../../catalog-source/distribution/predecessor-index.json')
    const next = index()
    const digest = (d: unknown) => 'sha256:' + createHash('sha256').update(JSON.stringify(d)).digest('hex')
    expect(() => prepareAcceptance(validateMarketIndex(next), digest(next), prepareAcceptance(validateMarketIndex(old), digest(old)))).not.toThrow()
  })
  it('官方真实多版本peer范围可保留，公共协议的100字节限制保持不变', () => {
    const document = index()
    const agent = document.plugins.find((p: any) => p.packageName === 'dsh-find-plugin')
    const metadata = JSON.parse(Buffer.from(agent.metadata.packageJson.contentBase64, 'base64').toString())
    expect(metadata.peerDependencies['@deepseek-ai/dsh-tools'].length).toBeGreaterThan(100)
    expect(() => validateMarketIndex(document)).not.toThrow()
    expect(() => validatePackageMetadata({peerDependencies:metadata.peerDependencies},'public')).toThrow()
  })
})
