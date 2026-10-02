import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createZip } from '../../packages/market-core/src/authoring/zip.ts'
import { createOfflinePack, readOfflinePack, readOfflinePackFile } from '../../packages/market-core/src/catalog/offline-pack.ts'
import { describeOfflineArtifact, materializeOfflineArtifacts } from '../../packages/market-core/src/delivery/offline-pack.ts'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { readAgentForgeSource } from '../../packages/market-core/src/catalog/agent-forge.ts'
import type { MarketCatalogSource } from '../../packages/market-core/src/contracts/types.ts'
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

  it('读取磁盘离线包前按压缩体积上限拒绝超大文件', () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-offline-file-limit-'))
    try {
      const path = join(root, 'oversized.eacpack')
      writeFileSync(path, Buffer.alloc(2))
      expect(() => readOfflinePackFile(path, { maxCompressedBytes: 1 })).toThrowError(expect.objectContaining({ code: 'offline-pack/archive-too-large' }))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('拒绝缓存摘要目录经 symlink/junction 越界', () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-offline-cache-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'eac-offline-cache-outside-'))
    try {
      try { symlinkSync(outside, join(root, 'sha256'), 'junction') }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error }
      const contents = readOfflinePack(createOfflinePack({ manifest, sourceBytes: Buffer.from(JSON.stringify(source)), indexBytes: Buffer.from(JSON.stringify(index)), packageRecords: new Map([['packages/alpha.json', Buffer.from(JSON.stringify(record))]]), artifacts: new Map([[artifact.digest, bytes]]) }))
      expect(() => materializeOfflineArtifacts(contents, root)).toThrowError(expect.objectContaining({ code: 'offline-artifact/cache-path-escape' }))
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) }
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



  it('拒绝 manifest/source/index/包 targets 的 targetAgent 不一致', () => {
    const wrongSource = { ...source, agentId: 'other' }
    const archive = createZip([
      { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
      { path: 'agent-forge/source.json', data: Buffer.from(JSON.stringify(wrongSource)) },
      { path: 'agent-forge/index.json', data: Buffer.from(JSON.stringify({ ...index, agentId: 'other' })) },
      { path: 'agent-forge/packages/alpha.json', data: Buffer.from(JSON.stringify(record)) },
      { path: artifact.relativePath, data: bytes },
    ])
    expect(() => readOfflinePack(archive)).toThrowError(expect.objectContaining({ code: 'offline-pack/target-agent-mismatch' }))
  })

  it('通过 Agent Forge source 读取离线包时核对宿主目标', async () => {
    const archive = createOfflinePack({ manifest, sourceBytes: Buffer.from(JSON.stringify(source)), indexBytes: Buffer.from(JSON.stringify(index)), packageRecords: new Map([['packages/alpha.json', Buffer.from(JSON.stringify(record))]]), artifacts: new Map([[artifact.digest, bytes]]) })
    const root = mkdtempSync(join(tmpdir(), 'eac-offline-target-'))
    try {
      const path = join(root, 'pack.eacpack')
      writeFileSync(path, archive)
      const config: MarketCatalogSource = { id: 'offline', kind: 'agent-forge', location: { mode: 'offline-pack', value: path }, enabled: true, priority: 0, refreshPolicy: 'manual' }
      await expect(readAgentForgeSource(config, { localRoots: [root], targetAgent: 'other' })).rejects.toMatchObject({ code: 'agent-forge/agent-target-mismatch' })
      await expect(readAgentForgeSource(config, { localRoots: [root], targetAgent: 'dsh' })).resolves.toMatchObject({ sourceRevision: 'r1' })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('拒绝 package targetAgent 和声明制品摘要与 manifest 不一致', () => {
    const wrongTarget = { ...record, targets: [{ agentId: 'other', compatibilityStatus: 'known', agentVersionRange: '*' }] }
    const createWith = (packageRecord: unknown) => createOfflinePack({ manifest, sourceBytes: Buffer.from(JSON.stringify(source)), indexBytes: Buffer.from(JSON.stringify(index)), packageRecords: new Map([['packages/alpha.json', Buffer.from(JSON.stringify(packageRecord))]]), artifacts: new Map([[artifact.digest, bytes]]) })
    expect(() => createWith(wrongTarget)).toThrowError(expect.objectContaining({ code: 'offline-pack/package-target-agent-mismatch' }))
    const wrongDigest = { ...record, distributions: [{ ...record.distributions[0], checksum: { sha256: '0'.repeat(64) } }] }
    expect(() => createWith(wrongDigest)).toThrowError(expect.objectContaining({ code: 'offline-pack/package-artifact-mismatch' }))
  })

  it('拒绝索引 key 和对应 package name/version/id 不一致', () => {
    const wrongIndex = { ...index, packages: { '@test/wrong': { ...index.packages['@test/alpha'], id: 'different-id' } } }
    expect(() => createOfflinePack({ manifest, sourceBytes: Buffer.from(JSON.stringify(source)), indexBytes: Buffer.from(JSON.stringify(wrongIndex)), packageRecords: new Map([['packages/alpha.json', Buffer.from(JSON.stringify(record))]]), artifacts: new Map([[artifact.digest, bytes]]) })).toThrow()
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
