import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MarketBackend } from '../../packages/market-core/src/api.ts'
import { createDshMarketBackend, type DshMarketBackendOptions } from '../../packages/market-core/src/dsh.ts'

// 仅在本 worker 的测试目录创建合成 profile，不读取真实 profile 或凭据。
export const testRoot = fileURLToPath(new URL('./.runtime-tests/', import.meta.url))
export function freshDirectory(): string {
  mkdirSync(testRoot, { recursive: true })
  return mkdtempSync(join(testRoot, 'core-api-'))
}
export function removeDirectory(path: string): void {
  const rel = relative(testRoot, path)
  if (isAbsolute(rel) || rel.startsWith('..') || !rel.startsWith('core-api-')) throw new Error('拒绝清理测试范围外目录')
  rmSync(path, { recursive: true, force: true })
}

export const identity = { environmentId: 'test-core-api', hostVersion: '0.1.7-rc.2', profileName: 'synthetic-test' }
export const embedded = {
  schemaVersion: '2', revision: 'core-api-synthetic-1', generatedAt: '2026-09-29T00:00:00.000Z',
  publication: { sourceId: 'synthetic-core-api', sequence: 1 },
  plugins: [], packs: [], presentations: [], deliveries: [], releases: [], releaseStatuses: [], collections: [], recommendations: [],
}

export function context(root: string, manager?: unknown): Parameters<typeof createDshMarketBackend>[0] {
  return {
    profileContext: { dir: join(root, 'profile'), name: identity.profileName },
    get: (key: string) => key === 'pluginManager' ? manager : undefined,
  } as unknown as Parameters<typeof createDshMarketBackend>[0]
}

export async function withBackend(run: (backend: MarketBackend, directory: string) => Promise<void>, options: DshMarketBackendOptions = { embeddedCatalogBytes: Buffer.from(JSON.stringify(embedded, null, 2) + '\n'), catalogSources: [] }): Promise<void> {
  const directory = freshDirectory()
  const backend = createDshMarketBackend(context(directory), identity, join(directory, 'market'), options)
  try { await run(backend, directory) }
  finally { await backend.taskList(); removeDirectory(directory) }
}
