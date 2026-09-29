import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
/** Real receipt/dependency/cache files with a synthetic official manager, never a real profile. */
import { mkdirSync, mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'
import { OfficialHostPort } from '../../packages/market-core/src/adapters/dsh/host-port.ts'
import type { HostInstallRequest } from '../../packages/market-core/src/core/ports.ts'
import { createPlanBundle } from '../../packages/market-core/src/core/planner.ts'

const output = process.env.EAC_TEST_OUTPUT ?? join(tmpdir(), 'eac-market-tests')
mkdirSync(output, { recursive: true })
async function fixture(restartRequired = false) {
  const root = mkdtempSync(join(output, 'receipt-'))
  const cache = join(root, 'test-artifact.tgz')
  const bytes = Buffer.from('explicit synthetic artifact bytes; not an actual distributable package')
  await writeFile(cache, bytes)
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }))
  let installed = false
  let enabled = true
  const manager = {
    listBundles: async () => installed ? [{ name: 'test-package', version: '1.0.0', installed: true, enabled, removable: true, rows: [{ rowId: 'row', moduleName: 'test-package', entryId: 'old-active' }] }] : [],
    listPlugins: async () => installed ? [{ entryId: 'old-active', moduleName: 'test-package', enabled, fiberPhase: 'active' }] : [],
    installBundle: vi.fn(async (path: string, options: { enabled: boolean }) => {
      installed = true; enabled = options.enabled
      await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { 'test-package': 'file:' + path }, dsh: { profile: { bundles: enabled ? ['test-package'] : [] } } }))
      return { application: restartRequired ? 'restart-required' : 'applied', changed: true, bundle: 'test-package', target: 'test-package', stage: 'install' }
    }),
    waitForInstall: vi.fn(async () => null),
  }
  const context = { profileContext: { dir: root }, get: (key: string) => key === 'pluginManager' ? manager : undefined } as never
  const request: HostInstallRequest = { requestId: 'request-test', enabled: true, artifact: {
    pluginId: 'p0', packageName: 'test-package', version: '1.0.0', artifactDigest: createHash('sha256').update(bytes).digest('hex'), localRef: cache, size: bytes.length,
  } }
  return { root, cache, manager, context, request, port: new OfficialHostPort(context, 'env-test') }
}

describe('REV-02/03/05 recoverable official ownership', () => {
  it('restores ownership after service recreation and allows update plans without proven:true', async () => {
    const f = await fixture()
    expect((await f.port.install(f.request)).kind).toBe('applied')
    const fresh = new OfficialHostPort(f.context, 'env-test')
    const state = await fresh.readState()
    expect(state.inventory.items[0]?.source).toBe('market-cache-file')
    expect(state.sessionRevision).toBe((await f.port.readState()).sessionRevision)
    const prepared = await createPlanBundle({ environmentId: 'env-test', hostFingerprint: 'test', catalogRevision: 'test', now: new Date(), inventory: state.inventory.items,
      marketManagedPackageNames: state.inventory.items.filter(item => item.source === 'market-cache-file').map(item => item.packageName),
      plugins: [{ pluginId: 'p0', packageName: 'test-package', version: '2.0.0', artifactDigest: 'a'.repeat(64), installable: true, requiresRestart: true, verification: 'verified' }],
      selections: [{ pluginId: 'p0', packageName: 'test-package', targetVersion: '2.0.0', targetDigest: 'a'.repeat(64), enabledIntent: true, tryUnverified: false }] })
    expect(prepared.bundle?.plan.items[0]?.action).toBe('upgrade')
    expect((await fresh.install(f.request)).kind).toBe('applied')
    expect(f.manager.installBundle).toHaveBeenCalledTimes(1)
  })

  it.each(['cache', 'reference'] as const)('revokes source proof when %s changes', async change => {
    const f = await fixture()
    await f.port.install(f.request)
    if (change === 'cache') {
      const bytes = await readFile(f.cache); bytes[0] = bytes[0]! ^ 1; await writeFile(f.cache, bytes)
    } else await writeFile(join(f.root, 'package.json'), JSON.stringify({ dependencies: { 'test-package': 'link:../local-fork' } }))
    const state = await new OfficialHostPort(f.context, 'env-test').readState()
    expect(state.inventory.items[0]?.source).toBe('unknown')
  })

  it('refuses changed bytes before calling the official installer', async () => {
    const f = await fixture()
    await writeFile(f.cache, 'tampered')
    expect(await f.port.install(f.request)).toMatchObject({ kind: 'failed', changed: false, errorCode: 'artifact/integrity' })
    expect(f.manager.installBundle).not.toHaveBeenCalled()
  })

  it('does not treat missing old official request as success or replay authorization', async () => {
    const f = await fixture()
    f.manager.installBundle.mockImplementation(async () => { throw new Error('connection lost after dispatch') })
    expect((await f.port.install(f.request)).kind).toBe('unknown')
    const fresh = new OfficialHostPort(f.context, 'env-test')
    expect(await fresh.reconcileInstall(f.request.requestId)).toBeUndefined()
    expect((await fresh.install(f.request)).kind).toBe('unknown')
    expect(f.manager.installBundle).toHaveBeenCalledTimes(1)
  })

  it('keeps restart evidence across service reload and changes identity only in a different Host process', async () => {
    const f = await fixture(true)
    expect(await f.port.install(f.request)).toMatchObject({ kind: 'applied', restartRequired: true })
    const sameProcess = await new OfficialHostPort(f.context, 'env-test').readState()
    expect(sameProcess.inventory.items[0]?.restartRequired).toBe(true)
    const script = join(f.root, 'isolated-host-restart.cjs')
    await build({ stdin: { resolveDir: fileURLToPath(new URL('../../', import.meta.url)), contents: `
      import { OfficialHostPort } from './packages/market-core/src/adapters/dsh/host-port.ts';
      const manager = { async listBundles() { return [{ name:'test-package', version:'1.0.0', installed:true, enabled:true, removable:true, rows: [{rowId:'new-row',moduleName:'test-package',entryId:'new-active'}] }] },
        async listPlugins() { return [{entryId:'new-active',moduleName:'test-package',enabled:true,fiberPhase:'active'}] } };
      const port = new OfficialHostPort({profileContext:{dir:${JSON.stringify(f.root)}},get:()=>manager}, 'env-test');
      port.readState().then(state=>process.stdout.write(JSON.stringify(state)));`, loader: 'ts' }, outfile: script, bundle: true, platform: 'node', format: 'cjs' })
    const child = spawnSync(process.execPath, [script], { cwd: f.root, encoding: 'utf8', timeout: 10000 })
    expect(child.status).toBe(0)
    const restarted = JSON.parse(child.stdout)
    expect(restarted.sessionRevision).not.toBe(sameProcess.sessionRevision)
    expect(restarted.inventory.items[0]).toMatchObject({ source: 'market-cache-file', restartRequired: false })
  })

  it('marks malformed run records and failed critical inventory reads unsafe', async () => {
    const f = await fixture()
    f.manager.listBundles = async () => { throw new Error('synthetic unavailable inventory') }
    expect((await f.port.readState()).activity.stable).toBe(false)
    f.manager.listBundles = async () => []
    mkdirSync(join(f.root, '.plugin-manager'))
    await writeFile(join(f.root, '.plugin-manager', 'run.json'), '{"pid":"invalid","grouped":false}')
    expect((await f.port.readState()).activity).toMatchObject({ stable: false, unknownSharedImpact: true })
  })
})
