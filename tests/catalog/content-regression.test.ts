import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CatalogRepository, CatalogSourceRegistry, validateMarketIndex } from '../../packages/market/src/catalog/index.ts'

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/valid-market-index.json', import.meta.url), 'utf8'))

describe('内容字段与快照回归', () => {
  it('目录登记不可被外部数组篡改；重定向到未登记 HTTPS 地址仍拒绝', async () => {
    const definition = { id: 'trusted-source', indexUrl: 'https://catalog.example.test/index.json', maintainer: 'synthetic', trust: 'team-registered' as const }
    const requests: string[] = []
    const registry = new CatalogSourceRegistry([definition], { security: { lookup: async () => ['93.184.216.34'] }, fetch: (async url => { requests.push(String(url)); return new Response(null, { status: 302, headers: { location: 'https://unregistered.example.test/index.json' } }) }) as typeof fetch })
    definition.indexUrl = 'https://replacement.example.test/index.json'
    ;(registry.list()[0] as any).indexUrl = definition.indexUrl
    await expect(registry.connection().read()).rejects.toMatchObject({ code: 'catalog/source-redirect-not-registered' })
    expect(requests).toEqual(['https://catalog.example.test/index.json'])
  })
  it('管理证据只按精确字节投影；缺失不推导，非法/浮动/未来/未知字段全部拒绝', () => {
    const input = fixture()
    expect(validateMarketIndex(input).snapshot.plugins[0]).not.toHaveProperty('managementEvidence')
    const evidence = { reviewId: 'synthetic-test-review', artifactDigest: input.plugins[0].artifactDigest, reviewedBy: 'test reviewer', reviewedAt: '2026-09-27T00:00:00Z', stateless: true, removePreservesExternalData: true, downgradeFrom: ['1.3.0', '2.0.0-rc.1'], explanation: '仅合成无状态包的测试报告' }
    input.plugins[0].managementEvidence = evidence
    expect(validateMarketIndex(input).snapshot.plugins[0]?.managementEvidence).toMatchObject({ ...evidence, reviewedAt: '2026-09-27T00:00:00.000Z' })
    for (const changed of [{ artifactDigest: `sha256:${'f'.repeat(64)}` }, { stateless: 'true' }, { downgradeFrom: ['latest'] }, { downgradeFrom: ['1.3.0', '1.3.0'] }, { reviewedAt: '2099-01-01T00:00:00Z' }, { approved: true }]) {
      input.plugins[0].managementEvidence = { ...evidence, ...changed }
      expect(() => validateMarketIndex(input)).toThrow()
    }
  })
  it('发布时间与独立人工推荐真正投影给 Client', () => {
    const input = fixture()
    input.plugins[0].releasedAt = '2026-09-01T10:00:00.000Z'
    input.recommendations = [{ pluginId: input.plugins[0].id, placement: 'featured', order: 0, reason: '合成测试推荐理由' }]
    const result = validateMarketIndex(input).snapshot
    expect(result.plugins[0]?.releasedAt).toBe(input.plugins[0].releasedAt)
    expect(result.recommendations).toEqual(input.recommendations)
  })

  it('拒绝不可能日期与孤立推荐引用', () => {
    const input = fixture()
    input.plugins[0].releasedAt = '2026-02-30T00:00:00Z'
    expect(() => validateMarketIndex(input)).toThrow()
    delete input.plugins[0].releasedAt
    input.recommendations = [{ pluginId: 'dev.test.missing', placement: 'featured', order: 0, reason: '不存在' }]
    expect(() => validateMarketIndex(input)).toThrow()
  })

  it('已提交 revision 不允许换字节；失败后重启仍读到原目录', async () => {
    const input = fixture()
    const root = mkdtempSync(join(tmpdir(), 'content-immutable-'))
    const repository = new CatalogRepository(input, root)
    expect((await repository.refresh(async () => JSON.stringify(input))).status).toBe('refreshed')
    const changed = fixture()
    changed.plugins[0].summary = '偷偷替换同一个修订'
    expect((await repository.refresh(async () => JSON.stringify(changed))).status).toBe('failed')
    expect(new CatalogRepository(input, root).load().snapshot.plugins[0]?.summary).toBe(input.plugins[0].summary)
  })
})
