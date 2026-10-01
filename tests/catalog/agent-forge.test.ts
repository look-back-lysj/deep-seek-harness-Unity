import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MarketCatalogSource } from '../../packages/market-core/src/contracts/types.ts'
import { readAgentForgeSource } from '../../packages/market-core/src/catalog/agent-forge.ts'

const source = {
  schemaVersion: 2,
  sourceId: 'agent-forge:test:plugin',
  name: 'Test source',
  agentId: 'dsh',
  type: 'plugin',
  baseUrl: 'https://example.com/catalog/',
  index: 'index.json',
  revision: 'r1',
  generatedAt: '2026-10-01T00:00:00Z',
  description: 'test',
} as const
const record = {
  schemaVersion: 2,
  id: 'dev.test.alpha',
  name: '@test/alpha',
  version: '1.2.3',
  type: 'plugin',
  description: 'alpha',
  license: 'MIT',
  targets: [{ agentId: 'dsh', compatibilityStatus: 'known', agentVersionRange: '*' }],
  pluginDetails: { manifestPath: 'package.json' },
  distributions: [{ id: 'archive', type: 'archive', url: 'https://example.com/alpha.tgz' }],
  dependencies: [{ id: 'dev.test.dep', optional: true }],
  _meta: { 'org.eac.market/test': { retained: true } },
} as const
const index = {
  schemaVersion: 2,
  sourceId: source.sourceId,
  sourceManifest: 'source.json',
  agentId: source.agentId,
  type: source.type,
  revision: source.revision,
  generatedAt: source.generatedAt,
  packages: { '@test/alpha': { latest: '1.2.3', versions: ['1.2.3'], path: 'packages/alpha.json', recordRevision: 'r1' } },
} as const

describe('Agent Forge v2 source reader', () => {
  it('读取受控本地目录并保留未知 _meta', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-agent-forge-'))
    try {
      writeFileSync(join(root, 'source.json'), JSON.stringify(source))
      writeFileSync(join(root, 'index.json'), JSON.stringify(index))
      mkdirSync(join(root, 'packages'), { recursive: true })
      writeFileSync(join(root, 'packages', 'alpha.json'), JSON.stringify(record))
      const config: MarketCatalogSource = { id: 'test', kind: 'agent-forge', location: { mode: 'local-file', value: root }, enabled: true, priority: 0, refreshPolicy: 'manual', expectedRevision: 'r1' }
      const result = await readAgentForgeSource(config, { localRoots: [root], targetAgent: 'dsh' })
      expect(result.sourceRevision).toBe('r1')
      expect(result.packages.get('@test/alpha')).toMatchObject({ _meta: { 'org.eac.market/test': { retained: true } } })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('拒绝 latest 不在 versions 中和目标 Agent 缺失', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eac-agent-forge-invalid-'))
    try {
      writeFileSync(join(root, 'source.json'), JSON.stringify(source))
      writeFileSync(join(root, 'index.json'), JSON.stringify({ ...index, packages: { '@test/alpha': { ...index.packages['@test/alpha'], latest: '9.9.9' } } }))
      mkdirSync(join(root, 'packages'), { recursive: true }); writeFileSync(join(root, 'packages', 'alpha.json'), JSON.stringify(record))
      const config: MarketCatalogSource = { id: 'test', kind: 'agent-forge', location: { mode: 'local-file', value: root }, enabled: true, priority: 0, refreshPolicy: 'manual' }
      await expect(readAgentForgeSource(config, { localRoots: [root], targetAgent: 'other' })).rejects.toMatchObject({ code: 'agent-forge/versions' })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
