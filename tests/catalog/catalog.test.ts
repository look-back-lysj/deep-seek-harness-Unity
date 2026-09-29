import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CatalogRepository,
  CatalogValidationError,
  isCompletePackExecution,
  validateMarketIndex,
} from '../../packages/market-core/src/catalog/index.ts'

const fixtureDir = fileURLToPath(new URL('./fixtures/', import.meta.url))
const readFixture = (name: string): unknown => JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'))

describe('catalog fixtures 与跨对象绑定', () => {
  it('接受正向 fixture，且 Manifest 原字节摘要不因投影改变', () => {
    const result = validateMarketIndex(readFixture('valid-market-index.json'))
    expect(result.snapshot.revision).toBe('test-revision-1')
    expect(result.snapshot.plugins[0]?.artifactDigest).toBe(`sha256:${'a'.repeat(64)}`)
    expect(result.manifestBytes.has('dev.test.alpha@1.2.3:manifest')).toBe(true)
    expect(result.snapshot).not.toHaveProperty('packExecutions')
  })

  it.each([
    ['invalid-manifest-digest.json', 'catalog/digest-mismatch'],
    ['invalid-lock-digest.json', 'catalog/lock-digest-mismatch'],
    ['invalid-execution-binding.json', 'catalog/execution-lock-mismatch'],
    ['invalid-delivery-digest.json', 'catalog/delivery-digest-mismatch'],
  ])('拒绝反向 fixture %s', (name, code) => {
    try {
      validateMarketIndex(readFixture(name))
      throw new Error('expected validation failure')
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogValidationError)
      expect((error as CatalogValidationError).code).toBe(code)
    }
  })

  it('只有 complete 且关系有效才可视为完整执行资料', () => {
    const valid = readFixture('valid-market-index.json') as { packs: { execution: unknown }[] }
    const execution = valid.packs[0]?.execution as never
    expect(isCompletePackExecution(execution)).toBe(true)
    expect(isCompletePackExecution({ ...execution, coverage: 'unknown' })).toBe(false)
  })
})

describe('CatalogRepository 原子刷新与旧缓存兜底', () => {
  it('在线刷新失败保留旧快照，成功后损坏 current 会回退 previous', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-catalog-test-'))
    try {
      const embedded = readFixture('valid-market-index.json')
      const repository = new CatalogRepository(embedded, join(root, 'catalog'))
      await expect(repository.refresh(async () => JSON.stringify(embedded))).resolves.toMatchObject({ status: 'refreshed' })
      await expect(repository.refresh(async () => JSON.stringify(readFixture('invalid-execution-binding.json')))).resolves.toMatchObject({
        status: 'failed',
        current: { snapshot: { revision: 'test-revision-1' } },
      })
      const revision2 = structuredClone(embedded) as { revision: string }
      revision2.revision = 'test-revision-2'
      await expect(repository.refresh(async () => JSON.stringify(revision2))).resolves.toMatchObject({
        status: 'refreshed',
        current: { snapshot: { revision: 'test-revision-2', origin: 'online' } },
      })
      writeFileSync(join(root, 'catalog', 'current.json'), '{ broken', 'utf8')
      const fallback = new CatalogRepository(embedded, join(root, 'catalog'))
      expect(fallback.load()).toMatchObject({
        source: 'cache',
        cacheUsable: true,
        snapshot: { revision: 'test-revision-1', origin: 'cache', stale: true },
      })
    } finally {
      expect(root.startsWith(tmpdir())).toBe(true)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('超过目录读取上限时失败但不改变当前快照', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-catalog-limit-'))
    try {
      const embedded = readFixture('valid-market-index.json')
      const repository = new CatalogRepository(embedded, join(root, 'catalog'), { maxDocumentBytes: 32 })
      const result = await repository.refresh(async () => JSON.stringify(embedded))
      expect(result.status).toBe('failed')
      expect(result.current.snapshot.revision).toBe('test-revision-1')
    } finally {
      expect(root.startsWith(tmpdir())).toBe(true)
      rmSync(root, { recursive: true, force: true })
    }
  })
})
