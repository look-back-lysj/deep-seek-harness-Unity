import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isAbsolute, join, relative } from 'node:path'
import { OfficialHostPort } from '../../packages/market-core/src/adapters/dsh/host-port.ts'
import { readIncompatibleBundleEvidence } from '../../packages/market-core/src/adapters/dsh/incompatible-evidence.ts'
import { MarketRuntime } from '../../packages/market-core/src/host/market-runtime.ts'

// All file I/O is confined to freshly-created synthetic profiles under this
// worker's test directory. Never read/write the user's real profile or plugins.
const testRoot = fileURLToPath(new URL('./.inventory-tests/', import.meta.url))
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    const rel = relative(testRoot, root)
    if (isAbsolute(rel) || rel.startsWith('..') || !rel.startsWith('fixture-')) throw new Error('unsafe test cleanup')
    rmSync(root, { recursive: true, force: true })
  }
})

function fixture() {
  mkdirSync(testRoot, { recursive: true })
  const root = mkdtempSync(join(testRoot, 'fixture-'))
  roots.push(root)
  const profile = join(root, 'profile')
  const installation = join(root, 'installation')
  const packageName = '@test/old-skin'
  const directory = join(profile, 'node_modules', packageName)
  const runtimeDir = join(installation, 'node_modules', 'test-runtime-root')
  mkdirSync(directory, { recursive: true })
  mkdirSync(runtimeDir, { recursive: true })
  const installAnchor = join(installation, 'package.json')
  writeFileSync(installAnchor, JSON.stringify({ name: 'test-installation', version: '0.2.0-rc.1' }))
  const profileManifest = { dependencies: { [packageName]: 'file:D:/synthetic/old-skin.tgz' }, dsh: { profile: { bundles: [packageName] } } }
  writeFileSync(join(profile, 'package.json'), JSON.stringify(profileManifest))
  const installedManifest = {
    name: packageName, version: '1.1.0', main: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } },
    peerDependencies: { '@deepseek-ai/dsh': '0.1.7-rc.2' },
  }
  writeFileSync(join(directory, 'package.json'), JSON.stringify(installedManifest))
  writeFileSync(join(directory, 'index.js'), 'throw new Error("REJECTED PLUGIN MUST NOT EXECUTE")')
  writeFileSync(join(runtimeDir, 'package.json'), JSON.stringify({ name: 'test-runtime-root', version: '1.0.0', main: './index.js' }))
  writeFileSync(join(runtimeDir, 'index.js'), 'throw new Error("RUNTIME PLUGIN MUST NOT EXECUTE")')
  // Deliberately invalid: inventory diagnosis must not parse profile configuration.
  writeFileSync(join(profile, 'cordis.yml'), 'must not be read as configuration')
  writeFileSync(join(profile, 'cordis.patch.yml'), 'must not be read as configuration')
  const bundle = {
    name: packageName, enabled: true, installed: true, optional: false, removable: true,
    error: { code: 'incompatible-version', incompatible: [{ name: packageName, version: '1.1.0', runtimeVersion: '0.2.0-rc.1', peers: { '@deepseek-ai/dsh': '0.1.7-rc.2' } }] },
    rows: [], overrides: [],
  }
  const manager = {
    listBundles: vi.fn(async () => [bundle]),
    listPlugins: vi.fn(async () => [{ entryId: 'runtime-entry', moduleName: 'test-runtime-root', enabled: true, fiberPhase: 'active' }]),
    installBundle: vi.fn(async () => { throw new Error('must not install') }),
    setBundleEnabled: vi.fn(async () => { throw new Error('must not enable old plugin') }),
    removeBundle: vi.fn(async () => { throw new Error('must not delete old plugin') }),
  }
  // Official 0.2.0-rc.1 shape: the root is a cordis:include builtin;
  // Loader.entries() includes nested groups, whereas listPlugins skips them.
  // Sources: installed app.asar app-boot/lib/index.js:3691-3718;
  // cordis-plugin-loader/lib/index.js:142-147,214-218;
  // dsh-host-plugin-inventory/lib/index.js:124-132.
  class HostResolvedRootInclude {}
  class BuiltinGroup {}
  const baseUrl = pathToFileURL(profile + '/').href
  const tree = { ctx: { baseUrl }, import: vi.fn(() => { throw new Error('never import runtime plugins') }) }
  const loaderEntry = { id: 'include/runtime-entry', options: { id: 'runtime-entry', name: 'test-runtime-root' }, parent: { tree } }
  const rootInclude = { id: 'include', options: { id: 'include', name: 'cordis:include' },
    parent: { tree: { ctx: { baseUrl: pathToFileURL(installAnchor).href } } }, fiber: { runtime: { callback: HostResolvedRootInclude } } }
  const groupEntry = { id: 'include/group', options: { id: 'group', name: 'cordis:group', group: true }, parent: { tree }, fiber: { runtime: { callback: BuiltinGroup } } }
  const internal = {
    version: 'v2' as const,
    resolveSync: vi.fn((parentURL: string, request: { specifier: string; attributes: Record<string, unknown> }) => {
      if (!parentURL.startsWith('file:') || typeof request?.specifier !== 'string') throw new Error('wrong official v2 resolver signature')
      if (request.specifier !== loaderEntry.options.name) throw new Error('unknown runtime module')
      // Node ESM interception can select a runtime package which ordinary CJS
      // lookup from the profile directory cannot see. No module is imported.
      const filename = request.specifier === 'test-runtime-root' ? join(runtimeDir, 'index.js') : join(directory, 'index.js')
      return { url: pathToFileURL(filename).href, format: 'module' }
    }),
    import: vi.fn(() => { throw new Error('never execute runtime plugins') }),
  }
  const pluginPackages = {
    // Official PluginPackages.packageOf result shape: name/version/dir/
    // manifestPath/manifest. An alias is not necessarily the owner's name.
    packageOf: vi.fn((name: string, parentURL: string) => {
      if (!parentURL.startsWith('file:')) return undefined
      if (name !== loaderEntry.options.name) return undefined
      const ownerDir = name === 'test-runtime-root' ? runtimeDir : directory
      const manifestPath = join(ownerDir, 'package.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name: string; version: string }
      return { name: manifest.name, version: manifest.version, dir: ownerDir, manifestPath, manifest }
    }),
  }
  const loader = { entries: () => [rootInclude, groupEntry, loaderEntry], builtins: { include: HostResolvedRootInclude, group: BuiltinGroup }, internal }
  manager.listPlugins.mockImplementation(async () => [
    { entryId: 'include', moduleName: 'cordis:include', enabled: true, fiberPhase: 'active' },
    { entryId: loaderEntry.id, moduleName: loaderEntry.options.name, enabled: true, fiberPhase: 'active' },
  ])
  const ctx = {
    profileContext: { dir: profile, name: 'isolated-host', installAnchor, startedBundles: [packageName], overlays: [] },
    loader,
    get: (key: string) => key === 'pluginManager' ? manager : key === 'loader' ? loader : key === 'pluginPackages' ? pluginPackages : undefined,
  } as unknown as ConstructorParameters<typeof OfficialHostPort>[0]
  const identity = { hostVersion: '0.2.0-rc.1', profileName: 'isolated-host' }
  const port = new OfficialHostPort(ctx, 'test-environment', identity)
  return { root, profile, directory, installAnchor, internal, tree, pluginPackages, packageName, installedManifest, profileManifest, manager, loaderEntry, ctx, port, identity }
}

async function expectBlocked(port: OfficialHostPort) {
  const state = await port.readState()
  expect(state.activity).toMatchObject({ stable: false, unknownSharedImpact: true })
  return state
}

describe('Host-local evidence for official incompatible bundle inventory', () => {
  it('reads actual installed metadata through Host anchors without executing code or reading profile configuration', async () => {
    const f = fixture()
    const before = readFileSync(join(f.profile, 'package.json'))
    expect(statSync(f.installAnchor).isFile()).toBe(true)
    expect(f.profileManifest.dsh.profile.bundles).toContain(f.packageName)
    const evidence = await readIncompatibleBundleEvidence(f.ctx, f.packageName)
    expect(evidence).toMatchObject({ packageName: f.packageName, version: '1.1.0', sharedImpact: 'none', peers: { '@deepseek-ai/dsh': '0.1.7-rc.2' } })
    const state = await f.port.readState()
    expect(state.inventory.unknownItems).toEqual([])
    expect(state.activity).toMatchObject({ stable: true, unknownSharedImpact: false })
    expect(state.inventory.items.find(item => item.packageName === f.packageName)).toMatchObject({ version: '1.1.0', readOnlyReason: 'unknown', removable: false, source: 'unknown', rows: [] })
    expect(readFileSync(join(f.profile, 'package.json'))).toEqual(before)
    expect(existsSync(join(f.profile, 'compatibility.json'))).toBe(false)
    expect(f.manager.installBundle).not.toHaveBeenCalled()
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
    expect(f.manager.removeBundle).not.toHaveBeenCalled()
    expect(f.internal.import).not.toHaveBeenCalled()
    expect(f.tree.import).not.toHaveBeenCalled()
  })

  it.each(['wrong-version', 'wrong-name', 'wrong-peers', 'malformed-json', 'missing-manifest', 'missing-dependency', 'approval-present', 'unknown-loader', 'oversized-manifest', 'invalid-bundle-patch'])('keeps %s blocking', async kind => {
    const f = fixture()
    const manifest = join(f.directory, 'package.json')
    if (kind === 'wrong-version') writeFileSync(manifest, JSON.stringify({ ...f.installedManifest, version: '2.0.0' }))
    if (kind === 'wrong-name') writeFileSync(manifest, JSON.stringify({ ...f.installedManifest, name: '@test/other' }))
    if (kind === 'wrong-peers') writeFileSync(manifest, JSON.stringify({ ...f.installedManifest, peerDependencies: { '@deepseek-ai/dsh': '*' } }))
    if (kind === 'malformed-json') writeFileSync(manifest, '{broken')
    if (kind === 'missing-manifest') rmSync(manifest)
    if (kind === 'missing-dependency') writeFileSync(join(f.profile, 'package.json'), JSON.stringify({ dependencies: {} }))
    if (kind === 'approval-present') writeFileSync(join(f.profile, 'compatibility.json'), 'contents deliberately not inspected')
    if (kind === 'oversized-manifest') writeFileSync(manifest, ' '.repeat(1024 * 1024 + 1))
    if (kind === 'invalid-bundle-patch') writeFileSync(manifest, JSON.stringify({ ...f.installedManifest, dsh: { bundle: { patch: [] } } }))
    if (kind === 'unknown-loader') f.loaderEntry.parent.tree.ctx.baseUrl = 'https://invalid.test/runtime'
    const state = await expectBlocked(f.port)
    expect(state.inventory.unknownItems).toContain('bundle-version:' + f.packageName)
  })

  it('uses installation-first resolution rather than trusting a same-name shadow profile copy', async () => {
    const f = fixture()
    const shadow = join(f.root, 'installation', 'node_modules', f.packageName)
    mkdirSync(shadow, { recursive: true })
    writeFileSync(join(shadow, 'package.json'), JSON.stringify({ ...f.installedManifest, version: '9.0.0' }))
    writeFileSync(join(shadow, 'index.js'), 'throw new Error("must not execute")')
    await expectBlocked(f.port)
  })

  it('keeps live rejected package code as unknown shared impact even when the module has an alias', async () => {
    const f = fixture()
    // A valid installed alias pointing at the SAME rejected package entry file.
    const aliasDir = join(f.profile, 'node_modules', 'aliased-old-skin')
    mkdirSync(aliasDir, { recursive: true })
    writeFileSync(join(aliasDir, 'package.json'), JSON.stringify({ name: 'aliased-old-skin', version: '1.0.0', main: '../@test/old-skin/index.js' }))
    f.loaderEntry.options.name = 'aliased-old-skin'
    f.loaderEntry.parent.tree.ctx.baseUrl = pathToFileURL(join(f.profile, 'package.json')).href
    const proof = await readIncompatibleBundleEvidence(f.ctx, f.packageName)
    expect(proof.sharedImpact).toBe('unknown')
    await expectBlocked(f.port)
  })

  it('preserves running official package-process and unreadable run-record barriers', async () => {
    const f = fixture()
    const markerDir = join(f.profile, '.plugin-manager')
    mkdirSync(markerDir)
    writeFileSync(join(markerDir, 'run.json'), JSON.stringify({ pid: process.pid, grouped: false }))
    const active = await expectBlocked(f.port)
    expect(active.inventory.unknownItems).toEqual([])
    expect(active.activity.reason).toContain('still active')
    writeFileSync(join(markerDir, 'run.json'), '{invalid')
    expect((await expectBlocked(f.port)).activity.reason).toContain('unreadable')
  })

  it('preserves in-flight Host requests without forcing stable after identity recovery', async () => {
    const f = fixture()
    const active = (f.port as unknown as { active: Set<string> }).active
    active.add('synthetic-in-flight')
    const state = await expectBlocked(f.port)
    expect(state.inventory.unknownItems).toEqual([])
    expect(state.activeRequests).toEqual(['synthetic-in-flight'])
  })

  it('allows an unrelated installable target through actual Runtime.planCreate while old bundle remains protected', async () => {
    const f = fixture()
    const catalogBytes = readFileSync(fileURLToPath(new URL('../../packages/market/data/index.json', import.meta.url)))
    const runtime = new MarketRuntime(f.ctx, { ...f.identity, environmentId: 'test-environment' }, join(f.root, 'market'), {
      embeddedCatalogBytes: catalogBytes, catalogSources: [],
    })
    const target = runtime.catalogView().plugins.find(item => item.packageName === 'dsh-better-sidebar')
    expect(target?.installability).toBe('bundle-installable')
    if (!target?.artifactDigest) throw new Error('test catalog target missing')
    const request = { selections: [{ pluginId: target.id, packageName: target.packageName, targetVersion: target.version, targetDigest: target.artifactDigest, enabledIntent: true, tryUnverified: true }] }
    expect((await runtime.planCreate(request, 'isolated-caller')).status).toBe('ready')
    expect(f.manager.installBundle).not.toHaveBeenCalled()
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled()
    expect(f.manager.removeBundle).not.toHaveBeenCalled()
    // Native-like policy: an unrelated old bundle identity change is advisory
    // for this target. It must not turn a clean target plan into a global block.
    writeFileSync(join(f.directory, 'package.json'), JSON.stringify({ ...f.installedManifest, version: '2.0.0' }))
    expect(await runtime.planCreate(request, 'isolated-caller')).toMatchObject({ status: 'ready' })
    await runtime.taskList()
  })
})
