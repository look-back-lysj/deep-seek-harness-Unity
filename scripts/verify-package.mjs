import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageDir = join(root, 'packages', 'market')
const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
const required = [
  'lib/index.js', 'lib/client.js', 'lib/types/contracts/types.js', 'lib/types/contracts/types.d.ts',
  'lib/typert.host.js', 'lib/typert.host.d.ts',
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
