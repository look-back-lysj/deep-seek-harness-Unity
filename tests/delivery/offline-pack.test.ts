import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createZip } from '../../packages/market-core/src/authoring/zip.ts'
import { createOfflinePack, readOfflinePack } from '../../packages/market-core/src/catalog/offline-pack.ts'
import { describeOfflineArtifact, materializeOfflineArtifacts } from '../../packages/market-core/src/delivery/offline-pack.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const source = { schemaVersion: 2, sourceId: 'agent-forge:test:plugin', name: 'Offline', agentId: 'dsh', type: 'plugin', baseUrl: 'https://example.com/catalog/', index: 'index.json', revision: 'r1', generatedAt: '2026-10-01T00:00:00Z', description: 'test' }
const bytes = Buffer.from('verified test artifact')
const artifact = describeOfflineArtifact(bytes, 'alpha.tgz')
const record = { schemaVersion: 2, id: 'dev.test.alpha', name: '@test/alpha', version: '1.2.3', type: 'plugin', description: 'alpha', license: 'MIT', targets: [{ agentId: 'dsh', compatibilityStatus: 'known', agentVersionRange: '*' }], pluginDetails: { manifestPath: 'package.json' }, distributions: [{ id: 'archive', type: 'archive', url: 'https://example.com/alpha.tgz', checksum: { sha256: artifact.digest.slice(7) } }] }
const index = { schemaVersion: 2, sourceId: source.sourceId, sourceManifest: 'source.json', agentId: 'dsh', type: 'plugin', revision: 'r1', generatedAt: source.generatedAt, packages: { '@test/alpha': { latest: '1.2.3', versions: ['1.2.3'], path: 'packages/alpha.json' } } }
const manifest = { schemaVersion: '1' as const, packId: 'offline-test', sourceRevision: 'r1', targetAgent: 'dsh', packages: [{ pluginId: 'dev.test.alpha', packageName: '@test/alpha', version: '1.2.3', artifactDigest: artifact.digest, optional: true as const }], artifacts: [artifact] }

describe('Agent Forge .eacpack', () => {
  it('校验 manifest、元数据、制品摘要并写入内容寻址缓存', () => {
    const archive = createOfflinePack({ manifest, sourceBytes: Buffer.from(JSON.stringify(source)), indexBytes: Buffer.from(JSON.stringify(index)), packageRecords: new Map([['packages/alpha.json', Buffer.from(JSON.stringify(record))]]), artifacts: new Map([[artifact.digest, bytes]]) })
    const contents = readOfflinePack(archive)
    expect(contents.manifest.packId).toBe('offline-test')
    const root = mkdtempSync(join(tmpdir(), 'eac-offline-artifact-'))
    try {
      const materialized = materializeOfflineArtifacts(contents, root)
      expect(materialized[0]?.digest).toBe(artifact.digest)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('摘要不符时阻断进入可执行状态', () => {
    const bad = Buffer.from('x'.repeat(bytes.length))
    const archive = createZip([
      { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
      { path: 'agent-forge/source.json', data: Buffer.from(JSON.stringify(source)) },
      { path: 'agent-forge/index.json', data: Buffer.from(JSON.stringify(index)) },
      { path: 'agent-forge/packages/alpha.json', data: Buffer.from(JSON.stringify(record)) },
      { path: artifact.relativePath, data: bad },
    ])
    expect(() => readOfflinePack(archive)).toThrowError(/摘要不符/)
    expect(`sha256:${createHash('sha256').update(bad).digest('hex')}`).not.toBe(artifact.digest)
  })

  it('dependency 未随包提供时阻断', () => {
    const dependent = { ...record, dependencies: [{ id: 'dev.missing.dependency' }] }
    const archive = createZip([
      { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
      { path: 'agent-forge/source.json', data: Buffer.from(JSON.stringify(source)) },
      { path: 'agent-forge/index.json', data: Buffer.from(JSON.stringify(index)) },
      { path: 'agent-forge/packages/alpha.json', data: Buffer.from(JSON.stringify(dependent)) },
      { path: artifact.relativePath, data: bytes },
    ])
    try {
      readOfflinePack(archive)
      throw new Error('expected dependency validation failure')
    } catch (error) {
      expect(error).toMatchObject({ code: 'offline-pack/dependency-missing' })
    }
  })
})
