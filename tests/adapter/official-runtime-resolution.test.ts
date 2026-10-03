import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { OfficialHostPort } from '../../packages/market-core/src/adapters/dsh/host-port.ts'
import { readIncompatibleBundleEvidence } from '../../packages/market-core/src/adapters/dsh/incompatible-evidence.ts'

/**
 * Runtime-shape regression, NOT official Desktop acceptance.
 * Shapes were checked read-only against official Desktop 0.2.0-rc.1 app.asar:
 * - dsh-app-boot/lib/index.js:3691-3718: cordis:include + HostResolvedRootInclude;
 * - cordis-plugin-loader/lib/index.js:142-147,214-218: groups + builtins/internal;
 * - dsh-host-plugin-inventory/lib/index.js:124-132: skip options.group entries;
 * - dsh-app-boot/lib/index.js:3193-3205,3241+: packageOf owner shape;
 * - dsh-app-boot/lib/index.js:1884-1890: ModuleLoader resolveSync v1/v2.
 * The positive assertions intentionally require the correct production wiring:
 * before the controller's patch they FAIL instead of blessing the old fixture.
 */
const testRoot = fileURLToPath(new URL('./.runtime-resolution-tests/', import.meta.url))
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    const part = relative(testRoot, root)
    if (isAbsolute(part) || part.startsWith('..') || !part.startsWith('fixture-')) throw new Error('unsafe test cleanup')
    rmSync(root, { recursive: true, force: true })
  }
})

const rejected = [
  ['@dsh-eac/skin-whale-song', '1.1.0'],
  ['@dsh-eac/skin-deep-whale-day-night', '1.1.0'],
  ['@dsh-eac/skin-trading', '1.1.1-eac.dc22280.2'],
  ['@dsh-eac/ui-skin-loader', '1.1.0'],
] as const

type Owner = { name: string; version: string; dir: string; manifestPath: string; manifest: Record<string, unknown> }
function owner(directory: string): Owner {
  const manifestPath = join(directory, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  return { name: String(manifest.name), version: String(manifest.version), dir: directory, manifestPath, manifest }
}

function fixture(options: { builtins?: boolean; runtimeModule?: boolean; internalVersion?: 'v1' | 'v2' } = {}) {
  mkdirSync(testRoot, { recursive: true })
  const root = mkdtempSync(join(testRoot, 'fixture-'))
  roots.push(root)
  const profile = join(root, 'profile')
  const installation = join(root, 'installation')
  const installAnchor = join(installation, 'package.json')
  mkdirSync(installation, { recursive: true })
  mkdirSync(profile, { recursive: true })
  writeFileSync(installAnchor, JSON.stringify({ name: 'official-host-fixture', version: '0.2.0-rc.1' }))
  const dependencies: Record<string, string> = {}
  const dirs = new Map<string, string>()
  for (const [name, version] of rejected) {
    const directory = join(profile, 'node_modules', name)
    dirs.set(name, directory)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version, main: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } }, peerDependencies: { '@deepseek-ai/dsh': '0.1.7-rc.2' } }))
    writeFileSync(join(directory, 'index.js'), 'throw new Error("REJECTED PLUGIN MUST NEVER EXECUTE")')
    dependencies[name] = 'file:D:/synthetic-cache/' + name.split('/').pop() + '.tgz'
  }
  const manifest = { dependencies, dsh: { profile: { bundles: rejected.map(([name]) => name) } } }
  writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(profile, 'cordis.yml'), 'not valid configuration: do not parse or execute')
  writeFileSync(join(profile, 'cordis.patch.yml'), 'not valid configuration: do not parse or execute')
  const profileBefore = readFileSync(join(profile, 'package.json'))
  const runtimeDir = join(root, 'runtime-resolution', 'runtime-owner')
  mkdirSync(runtimeDir, { recursive: true })
  writeFileSync(join(runtimeDir, 'package.json'), JSON.stringify({ name: 'runtime-owner', version: '2.0.0', main: './index.js' }))
  writeFileSync(join(runtimeDir, 'index.js'), 'throw new Error("RUNTIME MODULE MUST NEVER EXECUTE")')
  let selectedOwner = runtimeDir
  const parentURL = pathToFileURL(profile + '/').href
  const treeImport = vi.fn(() => { throw new Error('tree.import must not run during evidence collection') })
  const tree = { ctx: { baseUrl: parentURL }, import: treeImport }
  class HostResolvedRootInclude {}
  class OfficialGroup {}
  const include = { id: 'include', options: { id: 'include', name: 'cordis:include' }, parent: { tree: { ctx: { baseUrl: pathToFileURL(installAnchor).href } } }, fiber: { runtime: { callback: HostResolvedRootInclude } } }
  const group = { id: 'include/group', options: { id: 'group', name: 'cordis:group', group: true }, parent: { tree }, fiber: { runtime: { callback: OfficialGroup } } }
  const runtimeEntry = { id: 'include/runtime-module', options: { id: 'runtime-module', name: 'runtime-alias' }, parent: { tree } }
  const entries = options.builtins === false ? [] : [include, group]
  if (options.runtimeModule) entries.push(runtimeEntry as unknown as typeof include)
  const version = options.internalVersion ?? 'v2'
  const runtimeImport = vi.fn(() => { throw new Error('internal.import must not execute during diagnosis') })
  const resolveV1 = vi.fn((specifier: string, base: string, attributes: unknown) => {
    if (specifier !== runtimeEntry.options.name || base !== parentURL || !attributes || typeof attributes !== 'object') throw new Error('incorrect official v1 resolveSync signature')
    return { url: pathToFileURL(join(selectedOwner, 'index.js')).href, format: 'module' }
  })
  const resolveV2 = vi.fn((base: string, request: { specifier: string; attributes: unknown }) => {
    if (base !== parentURL || request?.specifier !== runtimeEntry.options.name || !request.attributes) throw new Error('incorrect official v2 resolveSync signature')
    return { url: pathToFileURL(join(selectedOwner, 'index.js')).href, format: 'module' }
  })
  const resolveSync = version === 'v1' ? resolveV1 : resolveV2
  const internal = { version, resolveSync, import: runtimeImport }
  const packageOf = vi.fn((name: string, base: string): Owner | undefined => {
    if (name !== runtimeEntry.options.name || base !== parentURL) return undefined
    // Emulate the trusted service's CURRENT runtime owner, not CJS guesses.
    const resolved = version === 'v1' ? resolveV1(name, base, {}) : resolveV2(base, { specifier: name, attributes: {} })
    if (fileURLToPath(resolved.url) !== join(selectedOwner, 'index.js')) throw new Error('inconsistent runtime mapping')
    return owner(selectedOwner)
  })
  const packages = { packageOf }
  const loader = { entries: () => entries, builtins: { include: HostResolvedRootInclude, group: OfficialGroup }, internal }
  const manager = {
    listBundles: vi.fn(async () => rejected.map(([name, itemVersion]) => ({
      name, installed: true, enabled: true, removable: true, optional: false,
      error: { code: 'incompatible-version', incompatible: [{ name, version: itemVersion, runtimeVersion: '0.2.0-rc.1', peers: { '@deepseek-ai/dsh': '0.1.7-rc.2' } }] },
      rows: [], overrides: [],
    }))),
    listPlugins: vi.fn(async () => entries.filter(entry => !('group' in entry.options && entry.options.group)).map(entry => ({ entryId: entry.id, moduleName: entry.options.name, enabled: true, fiberPhase: 'active' }))),
    installBundle: vi.fn(() => { throw new Error('must never install') }),
    setBundleEnabled: vi.fn(() => { throw new Error('must never enable old bundles') }),
    removeBundle: vi.fn(() => { throw new Error('must never remove old bundles') }),
  }
  const ctx = {
    profileContext: { dir: profile, name: 'official-runtime-fixture', installAnchor, startedBundles: rejected.map(([name]) => name), overlays: [] },
    loader, get: (name: string) => name === 'loader' ? loader : name === 'pluginPackages' ? packages : name === 'pluginManager' ? manager : undefined,
  } as unknown as ConstructorParameters<typeof OfficialHostPort>[0]
  const port = new OfficialHostPort(ctx, 'runtime-fixture', { hostVersion: '0.2.0-rc.1', profileName: 'official-runtime-fixture' })
  return { root, profile, installAnchor, profileBefore, manifest, dirs, runtimeDir, include, group, runtimeEntry, entries, loader, ctx, packages, manager, port, packageOf, resolveSync,
    setOwner: (directory: string) => { selectedOwner = directory },
    expectUntouched: () => {
      expect(readFileSync(join(profile, 'package.json'))).toEqual(profileBefore)
      expect(existsSync(join(profile, 'compatibility.json'))).toBe(false)
      expect(runtimeImport).not.toHaveBeenCalled()
      expect(treeImport).not.toHaveBeenCalled()
      expect(manager.installBundle).not.toHaveBeenCalled()
      expect(manager.setBundleEnabled).not.toHaveBeenCalled()
      expect(manager.removeBundle).not.toHaveBeenCalled()
    },
  }
}

async function expectBlocked(port: OfficialHostPort) {
  const state = await port.readState()
  expect(state.activity).toMatchObject({ stable: false, unknownSharedImpact: true })
  expect(state.inventory.unknownItems.length).toBeGreaterThan(0)
  return state
}

describe('official Cordis runtime-resolution regression (correct wiring assertions)', () => {
  it('accepts registered include/group identities without treating system entries as npm packages', async () => {
    const f = fixture()
    expect(f.loader.entries().some(entry => entry.options.name === 'cordis:include')).toBe(true)
    expect((await f.manager.listPlugins()).some(entry => entry.moduleName === 'cordis:group')).toBe(false)
    const proof = await readIncompatibleBundleEvidence(f.ctx, rejected[0][0])
    expect(proof).toMatchObject({ packageName: rejected[0][0], version: rejected[0][1], sharedImpact: 'none' })
    const state = await f.port.readState()
    expect(state.inventory.unknownItems).toEqual([])
    expect(state.activity.stable).toBe(true)
    expect(state.inventory.items.map(item => item.version)).toEqual(rejected.map(([, version]) => version))
    expect(state.inventory.items.every(item => item.readOnlyReason !== undefined && !item.removable && item.source === 'unknown')).toBe(true)
    expect(f.packageOf.mock.calls.some(([name]) => name.startsWith('cordis:'))).toBe(false)
    f.expectUntouched()
  })

  it('uses a package.json FILE installation anchor while rejected bundles remain enabled selections', async () => {
    const f = fixture({ builtins: false })
    expect(statSync(f.installAnchor).isFile()).toBe(true)
    expect(f.manifest.dsh.profile.bundles).toEqual(rejected.map(([name]) => name))
    const state = await f.port.readState()
    expect(state.inventory.unknownItems).toEqual([])
    expect(state.inventory.items.every(item => item.bundleEnabled === true && item.rows.length === 0)).toBe(true)
    f.expectUntouched()
  })

  it.each(['v1', 'v2'] as const)('uses official runtime owner with %s resolver mapping, not configuration-directory CJS lookup', async version => {
    const f = fixture({ builtins: false, runtimeModule: true, internalVersion: version })
    expect(() => createRequire(join(f.profile, 'package.json')).resolve(f.runtimeEntry.options.name)).toThrow()
    const proof = await readIncompatibleBundleEvidence(f.ctx, rejected[0][0])
    expect(proof.sharedImpact).toBe('none')
    expect(f.packageOf).toHaveBeenCalledWith(f.runtimeEntry.options.name, f.runtimeEntry.parent.tree.ctx.baseUrl)
    expect(f.resolveSync).toHaveBeenCalled()
    expect((await f.port.readState()).inventory.unknownItems).toEqual([])
    f.expectUntouched()
  })

  it('blocks when CJS sees an unrelated package but trusted runtime owner is the rejected bundle', async () => {
    const f = fixture({ builtins: false, runtimeModule: true })
    const visible = join(f.profile, 'node_modules', f.runtimeEntry.options.name)
    mkdirSync(visible, { recursive: true })
    writeFileSync(join(visible, 'package.json'), JSON.stringify({ name: 'cjs-shadow', version: '1.0.0', main: './index.js' }))
    writeFileSync(join(visible, 'index.js'), 'throw new Error("must not execute shadow")')
    expect(createRequire(join(f.profile, 'package.json')).resolve(f.runtimeEntry.options.name)).toBe(join(visible, 'index.js'))
    f.setOwner(f.dirs.get(rejected[0][0])!)
    await expectBlocked(f.port)
    f.expectUntouched()
  })

  it('accepts trusted runtime mapping even if an unrelated CJS shadow points into the rejected package', async () => {
    const f = fixture({ builtins: false, runtimeModule: true })
    const shadow = join(f.profile, 'node_modules', f.runtimeEntry.options.name)
    mkdirSync(shadow, { recursive: true })
    writeFileSync(join(shadow, 'package.json'), JSON.stringify({ name: 'cjs-shadow', version: '1.0.0', main: '../@dsh-eac/skin-whale-song/index.js' }))
    expect(createRequire(join(f.profile, 'package.json')).resolve(f.runtimeEntry.options.name)).toBe(join(f.dirs.get(rejected[0][0])!, 'index.js'))
    const proof = await readIncompatibleBundleEvidence(f.ctx, rejected[0][0])
    expect(proof.sharedImpact).toBe('none')
    expect((await f.port.readState()).inventory.unknownItems).toEqual([])
    f.expectUntouched()
  })

  it.each(['unknown-builtin', 'callback-mismatch', 'callback-unavailable'] as const)('does not ignore %s merely because its name starts with cordis:', async scenario => {
    const f = fixture()
    if (scenario === 'unknown-builtin') f.include.options.name = 'cordis:unregistered-plugin'
    if (scenario === 'callback-mismatch') f.include.fiber.runtime.callback = class UntrustedInclude {}
    if (scenario === 'callback-unavailable') Reflect.deleteProperty(f.include.fiber.runtime, 'callback')
    await expectBlocked(f.port)
    f.expectUntouched()
  })

  it('keeps missing runtime owner blocking even if an ordinary CJS package happens to resolve', async () => {
    const f = fixture({ builtins: false, runtimeModule: true })
    const visible = join(f.profile, 'node_modules', f.runtimeEntry.options.name)
    mkdirSync(visible, { recursive: true })
    writeFileSync(join(visible, 'package.json'), JSON.stringify({ name: 'cjs-only', version: '1.0.0', main: './index.js' }))
    writeFileSync(join(visible, 'index.js'), 'throw new Error("must not execute")')
    f.packageOf.mockReturnValue(undefined)
    await expectBlocked(f.port)
    f.expectUntouched()
  })

  it('keeps changed runtime owner blocking during the independent repeated evidence reads', async () => {
    const f = fixture({ builtins: false, runtimeModule: true })
    f.packageOf.mockImplementationOnce(() => owner(f.runtimeDir)).mockImplementation(() => owner(f.dirs.get(rejected[0][0])!))
    await expectBlocked(f.port)
    f.expectUntouched()
  })

  it('keeps owner/manifest identity contradictions blocking', async () => {
    const f = fixture({ builtins: false, runtimeModule: true })
    f.packageOf.mockImplementation(() => ({ ...owner(f.runtimeDir), name: 'contradicts-actual-manifest' }))
    await expectBlocked(f.port)
    f.expectUntouched()
  })
})
