import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CatalogRepository,
  CatalogSourceRegistry,
  CatalogValidationError,
  validateMarketIndex,
} from '../../packages/market-core/src/catalog/index.ts'

const fixtureDir = fileURLToPath(new URL('../catalog/fixtures/', import.meta.url))
const fixture = JSON.parse(readFileSync(join(fixtureDir, 'valid-market-index.json'), 'utf8')) as any
const clone = <T>(value: T): T => structuredClone(value)
const digestPath = (revision: string) => join('revisions', `${createHash('sha256').update(revision).digest('hex')}.json`)

describe('AUD-F14 目录来源配置与失败回退', () => {
  it('只接受维护者登记来源，未登记地址不能被当作团队目录', async () => {
    const registry = new CatalogSourceRegistry([{
      id: 'team-main',
      indexUrl: 'https://catalog.example.test/index.json',
      maintainer: 'EAC content team',
      trust: 'team-registered',
    }])
    expect(() => registry.reader({ sourceUrl: 'https://evil.example.test/index.json' })).toThrow(/未登记|登记列表/)
    const reader = registry.reader({ sourceUrl: 'https://catalog.example.test/index.json' })
    expect(typeof reader).toBe('function')
  })

  it('刷新失败保留旧快照和旧 Lock，并说明是来源失败还是缓存回退', async () => {
    const root = join(tmpdir(), `eac-aud-f14-${Date.now()}-${Math.random()}`)
    mkdirSync(root, { recursive: true })
    try {
      const repository = new CatalogRepository(fixture, root)
      const result = await repository.refreshWithSource({
        read: async () => { throw new Error('controlled endpoint unavailable') },
        source: { id: 'team-main', indexUrl: 'https://catalog.example.test/index.json' },
      })
      expect(result.status).toBe('failed')
      expect(result.current.snapshot.revision).toBe('test-revision-1')
      expect(result.current.snapshot.stale).toBe(true)
      expect(result.reason).toContain('team-main')
      expect(repository.lockBytes('dev.test.pack', '1.0.0')).toBeDefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('AUD-F15 原子快照与 Lock 一致切换', () => {
  it('写入 revision 失败时不把新 Lock 暴露给旧快照', async () => {
    const root = join(tmpdir(), `eac-aud-f15-${Date.now()}-${Math.random()}`)
    mkdirSync(join(root, 'catalog', digestPath('test-revision-2')), { recursive: true })
    try {
      const repository = new CatalogRepository(fixture, join(root, 'catalog'))
      const revision2 = clone(fixture)
      revision2.revision = 'test-revision-2'
      revision2.packs[0].lock.contentBase64 = Buffer.from(JSON.stringify({
        $schema: 'https://mojobox.dev/schemas/pack-lock-v1alpha1.json',
        apiVersion: 'packs.mojobox.dev/v1alpha1',
        kind: 'PackLock',
        pack: 'dev.test.pack@1.0.0',
        components: [{
          id: 'dev.test.alpha',
          version: '1.2.3',
          source: 'npm:@test/alpha@1.2.3',
          manifest: 'catalog/plugins/dev.test.alpha.json',
          manifestDigest: revision2.plugins[0].manifestDigest,
          artifactDigest: revision2.plugins[0].artifactDigest,
        }],
      })).toString('base64')
      revision2.packs[0].lockDigest = `sha256:${createHash('sha256').update(Buffer.from(revision2.packs[0].lock.contentBase64, 'base64')).digest('hex')}`
      revision2.packs[0].execution.lockDigest = revision2.packs[0].lockDigest
      const result = await repository.refresh(async () => JSON.stringify(revision2))
      expect(result.status).toBe('failed')
      expect(result.current.snapshot.revision).toBe('test-revision-1')
      const lock = repository.lockBytes('dev.test.pack', '1.0.0')
      expect(lock).toBeDefined()
      expect(createHash('sha256').update(lock ?? Buffer.alloc(0)).digest('hex')).toBe(fixture.packs[0].lockDigest.slice('sha256:'.length))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

const evidenceRaw = (overrides: Record<string, unknown> = {}) => {
  const value = {
    '$schema': 'https://mojobox.dev/schemas/evidence-v1alpha1.json',
    apiVersion: 'evidence.mojobox.dev/v1alpha1',
    kind: 'Evidence',
    subject: { id: 'dev.test.alpha', version: '1.2.3', artifactDigest: `sha256:${'a'.repeat(64)}` },
    manifestDigest: fixture.plugins[0].manifestDigest,
    specifications: { dshStdRevision: '1234567890abcdef1234567890abcdef12345678' },
    suite: { id: 'suite', version: '1.0.0', digest: `sha256:${'b'.repeat(64)}` },
    issuer: 'isolated-test',
    hostDescriptorDigest: `sha256:${'c'.repeat(64)}`,
    host: { id: 'host-test', name: 'Test Host', version: '1.0.0', adapterVersion: '1.0.0', dshVersion: '0.1.7-rc.2', runtime: 'node24' },
    evidenceLevel: 'Tested', result: 'pass', checks: [{ id: 'install', result: 'pass' }],
    testedAt: '2026-09-27T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z', revoked: false,
    ...overrides,
  }
  const bytes = Buffer.from(JSON.stringify(value), 'utf8')
  return { contentBase64: bytes.toString('base64'), sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
}

describe('AUD-F19 公共格式与 Evidence 绑定', () => {
  it('拒绝不符合固定 Mojobox Manifest/PackLock 格式的原字节', () => {
    const invalidManifest = clone(fixture)
    invalidManifest.plugins[0].manifest.contentBase64 = Buffer.from(JSON.stringify({
      id: 'dev.test.alpha',
      version: '1.2.3',
    })).toString('base64')
    invalidManifest.plugins[0].manifest.sha256 = `sha256:${createHash('sha256').update(Buffer.from(invalidManifest.plugins[0].manifest.contentBase64, 'base64')).digest('hex')}`
    invalidManifest.plugins[0].manifestDigest = invalidManifest.plugins[0].manifest.sha256
    expect(() => validateMarketIndex(invalidManifest)).toThrow(CatalogValidationError)

    const invalidLock = clone(fixture)
    const lock = JSON.parse(Buffer.from(invalidLock.packs[0].lock.contentBase64, 'base64').toString('utf8'))
    delete lock.$schema
    invalidLock.packs[0].lock.contentBase64 = Buffer.from(JSON.stringify(lock)).toString('base64')
    invalidLock.packs[0].lock.sha256 = `sha256:${createHash('sha256').update(Buffer.from(invalidLock.packs[0].lock.contentBase64, 'base64')).digest('hex')}`
    invalidLock.packs[0].lockDigest = invalidLock.packs[0].lock.sha256
    invalidLock.packs[0].execution.lockDigest = invalidLock.packs[0].lockDigest
    expect(() => validateMarketIndex(invalidLock)).toThrow(CatalogValidationError)
  })

  it('有效运行 Evidence 可以支持 verified，且严格绑定当前宿主', () => {
    const verified = clone(fixture)
    verified.plugins[0].verification = 'verified'
    verified.plugins[0].evidence = [evidenceRaw()]
    expect(() => validateMarketIndex(verified, {
      now: new Date('2026-09-28T00:00:00.000Z'),
      host: { id: 'host-test', dshVersion: '0.1.7-rc.2', runtime: 'node24' },
    })).not.toThrow()
    expect(() => validateMarketIndex(verified, {
      now: new Date('2026-09-28T00:00:00.000Z'),
      host: { id: 'host-other', dshVersion: '0.1.7-rc.2', runtime: 'node24' },
    })).toThrow(/Evidence/)
  })

  it('verified 必须绑定当前版本、制品、Manifest、宿主与未过期运行 Evidence', () => {
    const verified = clone(fixture)
    verified.plugins[0].verification = 'verified'
    expect(() => validateMarketIndex(verified, {
      now: new Date('2026-09-28T00:00:00.000Z'),
      host: { id: 'host-test', dshVersion: '0.1.7-rc.2', runtime: 'node24' },
    })).toThrow(/Evidence/)
    const expired = clone(fixture)
    expired.plugins[0].verification = 'verified'
    expired.plugins[0].evidence = [evidenceRaw({ expiresAt: '2026-09-27T00:00:00.000Z' })]
    expect(() => validateMarketIndex(expired, {
      now: new Date('2026-09-28T00:00:00.000Z'),
      host: { id: 'host-test', dshVersion: '0.1.7-rc.2', runtime: 'node24' },
    })).toThrow(/Evidence/)
    const wrongSubject = clone(fixture)
    wrongSubject.plugins[0].evidence = [evidenceRaw({ subject: { id: 'dev.test.alpha', version: '1.2.4', artifactDigest: `sha256:${'a'.repeat(64)}` } })]
    expect(() => validateMarketIndex(wrongSubject)).toThrow(/Evidence/)
  })
})
