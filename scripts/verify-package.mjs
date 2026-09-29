import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageDir = join(root, 'packages', 'market')
const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
const required = [
  'lib/index.js', 'lib/client.js', 'lib/types/types.js', 'lib/types/types.d.ts',
  'lib/typert.host.js', 'lib/typert.host.d.ts',
  'lib/typert.client.js', 'lib/typert.client.d.ts',
  'lib/typert.remote-client.js', 'lib/typert.remote-client.d.ts',
  'data/index.json', 'cordis.patch.yml', 'dsh-plugin.json', 'LICENSE',
]
for (const relative of required) {
  await stat(join(packageDir, relative))
}
const exportPaths = Object.values(manifest.exports).flatMap((value) => typeof value === 'string' ? [value] : Object.values(value))
for (const path of exportPaths) {
  if (typeof path === 'string' && path.startsWith('./lib/')) await stat(join(packageDir, path.slice(2)))
}
const remote = await readFile(join(packageDir, 'lib/typert.remote-client.js'), 'utf8')
if (!remote.includes('TYPERT_REMOTE') || !remote.includes('eacMarket')) throw new Error('generated Remote contribution is missing')
const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm'
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm pack --dry-run --json'] : ['pack', '--dry-run', '--json']
const pack = spawnSync(command, args, { cwd: packageDir, encoding: 'utf8', shell: false })
if (pack.status !== 0) throw new Error(pack.stderr || 'npm pack dry-run failed')
const parsed = JSON.parse(pack.stdout)
const files = new Set(parsed[0].files.map((entry) => entry.path))
for (const relative of required) if (!files.has(relative)) throw new Error(`npm pack omitted ${relative}`)
const remoteModule = await import(new URL(`../packages/market/lib/typert.remote-client.js?verify=${Date.now()}`, import.meta.url));
const runtimeRemote = remoteModule.TYPERT_REMOTE;
if (!runtimeRemote || !Array.isArray(runtimeRemote.descriptors) || runtimeRemote.descriptors.length < 1) throw new Error(`runtime Remote has no descriptors`);
for (const descriptor of runtimeRemote.descriptors) {
  if (descriptor.service !== `eacMarket` || typeof descriptor.method !== `string` || typeof descriptor.result?.create !== `function`) throw new Error(`runtime Remote descriptor is not executable`);
  const codec = descriptor.result.create();
  if (typeof codec?.safeParse !== `function`) throw new Error(`runtime result codec is not a schema`);
}
console.log(`PASS package files=${files.size}, runtime Remote descriptors=${runtimeRemote.descriptors.length}, result schemas validated`)

// An independent dependency must remain external to the Host bundle. Verify
// the actual build graph rather than relying on source folder names.
const coreDir = join(root, 'packages', 'market-core')
const core = JSON.parse(await readFile(join(coreDir, 'package.json'), 'utf8'))
if (manifest.dependencies['@dsh-eac/market-core'] !== `workspace:${core.version}`) throw new Error('adapter must pin the verified core workspace version')
if (core.dsh !== undefined || core.dependencies?.['@dsh-eac/market'] !== undefined || core.peerDependencies?.react !== undefined) throw new Error('core must remain a headless dependency, not a desktop plugin')
for (const value of Object.values(core.exports)) {
  for (const target of typeof value === 'string' ? [value] : Object.values(value)) await stat(join(coreDir, target))
}
const compat = await import(new URL('../packages/market-core/lib/compatibility.js', import.meta.url))
if (compat.CORE_VERSION !== core.version) throw new Error('core runtime version differs from manifest')
const versionSource = await readFile(join(packageDir, 'src/version.ts'), 'utf8')
if (!versionSource.includes(`ADAPTER_VERSION = '${manifest.version}'`)) throw new Error('adapter runtime version differs from manifest')
const graph = JSON.parse(await readFile(join(root, '.verify/split-build.json'), 'utf8'))
if (Object.keys(graph.host.inputs).some(path => path.replaceAll('\\', '/').includes('packages/market-core/'))) throw new Error('core was inlined into desktop Host')
if (!Object.values(graph.host.outputs).some(output => output.imports.some(item => item.external && item.path === '@dsh-eac/market-core/dsh'))) throw new Error('desktop Host does not consume the independent core')
if (Object.keys(graph.client.inputs).some(path => /market-core\/(?:src|lib\/types)\/(?:host|adapters|delivery|persistence|authoring)\//u.test(path.replaceAll('\\', '/')))) throw new Error('Node backend implementation leaked into browser bundle')
const clientOutput = Object.values(graph.client.outputs)
if (clientOutput.some(output => output.imports.some(item => item.path.startsWith('node:')))) throw new Error('browser bundle imports Node builtins')
for (const subpath of ['index', 'contracts', 'compatibility', 'semver']) await import(new URL(`../packages/market-core/lib/${subpath}.js`, import.meta.url))
if (!runtimeRemote.descriptors.some(item => item.method === 'clientConnect')) throw new Error('connection handshake missing from generated Remote')
console.log(`PASS split packages: ${core.name}@${core.version}, external Host dependency, browser-safe contracts, legacy exports`)
