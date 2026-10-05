import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { MarketIndexDocument, ReleaseRecord } from '../../packages/market-core/src/catalog/model.ts'
import { rawRecord } from '../../packages/market-core/src/catalog/public-format.ts'
import { releaseIdFor } from '../../packages/market-core/src/catalog/releases.ts'
import type { HostCoreSnapshot, PlanSelection, TaskState } from '../../packages/market-core/src/contracts/types.ts'
import { MarketRuntime } from '../../packages/market-core/src/host/market-runtime.ts'
import { context, freshDirectory, identity, removeDirectory } from '../core-api/helpers.ts'

export function releaseDocument(count = 1, range: string | undefined = '^1.0.0'): MarketIndexDocument {
  const base = JSON.parse(readFileSync(new URL('../catalog/fixtures/valid-market-index.json', import.meta.url), 'utf8')) as MarketIndexDocument
  const { manifest: _manifest, manifestDigest: _manifestDigest, ...original } = base.plugins[0]!
  const releases: ReleaseRecord[] = []
  const plugins = Array.from({ length: count }, (_, index) => {
    const plugin = { ...original, id: index === 0 ? original.id : original.id + '.second', packageName: index === 0 ? original.packageName : 'release-context-second' }
    const metadata = rawRecord(Buffer.from(JSON.stringify({ name: plugin.packageName, version: '1.0.0',
      ...(range === undefined ? {} : { engines: { dsh: range } }), dsh: { bundle: { patch: './cordis.patch.yml' } } })))
    const record = { schemaVersion: '1' as const, pluginId: plugin.id, packageName: plugin.packageName, version: '1.0.0', artifactDigest: plugin.artifactDigest!, metadataDigest: metadata.sha256, size: 509,
      publishedAt: '2026-10-01T00:00:00Z', provenance: { kind: 'author-release' as const, repositoryUrl: 'https://example.invalid/test', commit: '1'.repeat(40), releaseUrl: 'https://example.invalid/test/release', license: 'MIT', authorization: { basis: 'license' as const, reference: 'TEST LICENSE', redistribution: true as const } },
    }
    const releaseId = releaseIdFor(record)
    releases.push({ ...record, releaseId })
    return { ...plugin, version: '1.0.0', verification: 'unverified' as const, releaseId,
      metadata: { kind: 'official-bundle' as const, packageJson: metadata, files: ['package.json', 'cordis.patch.yml'] } }
  })
  return { ...base, schemaVersion: '2', revision: 'release-context-r1', publication: { sourceId: 'release-context-source', sequence: 1 }, packs: [], plugins, releases,
    releaseStatuses: releases.map(release => ({ releaseId: release.releaseId, sequence: 1, status: 'active', effectiveAt: '2026-10-01T00:00:00Z', reason: 'synthetic only' })),
    deliveries: plugins.map(plugin => ({ pluginId: plugin.id, packageName: plugin.packageName, version: plugin.version, artifactDigest: plugin.artifactDigest!, sources: [{ kind: 'https-artifact', ref: 'https://example.invalid/test/fixture.tgz', priority: 0, size: 509 }] })),
  }
}

export async function releaseFixture(run: (fixture: {
  runtime: MarketRuntime
  directory: string
  selections: readonly PlanSelection[]
  installed: Map<string, { name: string; version: string; installed: boolean; enabled: boolean; removable: boolean; rows: never[]; overrides: never[] }>
  setVersion: (version: string | null) => void
  officialWrites: ReturnType<typeof vi.fn>
}) => Promise<void>, count = 1, range: string | undefined = '^1.0.0'): Promise<void> {
  const directory = freshDirectory()
  let version: string | null = '1.0.0'
  const installed = new Map<string, { name: string; version: string; installed: boolean; enabled: boolean; removable: boolean; rows: never[]; overrides: never[] }>()
  const officialWrites = vi.fn()
  const manager = { listBundles: async () => [...installed.values()], listPlugins: async () => [], install: officialWrites, removeBundle: officialWrites, setBundleEnabled: officialWrites }
  const document = releaseDocument(count, range)
  const hostCore = (): HostCoreSnapshot => ({ agentId: 'dsh', agentName: 'DSH', status: version === null ? 'unknown' : 'known', version,
    source: 'synthetic-runtime', versionScheme: 'semver', hostRevision: createHash('sha256').update(String(version)).digest('hex') })
  const runtime = new MarketRuntime(context(directory, manager), identity, join(directory, 'market'), { embeddedCatalog: document, catalogSources: [], readHostCore: hostCore })
  const selections = runtime.catalogView().plugins.map(plugin => ({ pluginId: plugin.id, packageName: plugin.packageName, targetVersion: plugin.version, targetDigest: plugin.artifactDigest!, enabledIntent: true, tryUnverified: true }))
  try {
    await runtime.taskList()
    const refreshed = await runtime.catalog.refresh(async () => Buffer.from(JSON.stringify(document)))
    if (refreshed.status !== 'refreshed') throw new Error(JSON.stringify(refreshed))
    await run({ runtime, directory, selections, installed, setVersion: next => { version = next }, officialWrites })
  }
  finally { await runtime.taskList(); vi.restoreAllMocks(); removeDirectory(directory) }
}

export async function settledTask(runtime: MarketRuntime, taskId: string): Promise<TaskState> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const task = await runtime.taskGet({ taskId })
    if (['completed', 'failed', 'needs-attention', 'partial', 'cancelled'].includes(task.status)) return task
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('synthetic task did not settle')
}
