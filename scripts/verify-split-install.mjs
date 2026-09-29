/** Opt-in official-runtime smoke. Serves only local, already-built artifacts;
 * never reads a daily profile, downloads upstream packages, or publishes.
 * Usage: node scripts/verify-split-install.mjs <runtime-root> <fresh-output>
 */
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { prepareRelease, resolveNpmCli, npmInvocation, validateOutDir } from './pack-release.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [runtimeInput, outputInput] = process.argv.slice(2)
if (!runtimeInput || !outputInput) throw new Error('Provide an official extracted runtime root and a fresh external output directory')
const runtime = realpathSync(runtimeInput)
const output = validateOutDir(outputInput, root)
if (existsSync(output)) throw new Error('Smoke output must be fresh; preserve earlier evidence')
mkdirSync(output, { recursive: true })
const cli = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
if (!existsSync(cli)) throw new Error('Official dsh CLI missing in runtime')
const release = prepareRelease({ outDir: join(output, 'packages'), registryCore: true })
const zodDir = dirname(createRequire(join(root, 'packages/market/package.json')).resolve('zod/package.json'))
const zodPack = join(output, 'zod-fixture')
mkdirSync(zodPack)
const zodStage = join(output, 'zod-source')
cpSync(zodDir, zodStage, { recursive: true })
writeFileSync(join(zodPack, 'empty-user-config'), '')
writeFileSync(join(zodPack, 'empty-global-config'), '')
const invocation = npmInvocation(resolveNpmCli(), zodStage, zodPack)
const packed = spawnSync(invocation.command, invocation.args, invocation.options)
if (packed.status !== 0) throw new Error(`Local zod fixture packing failed: ${packed.stderr}`)
const zodManifest = JSON.parse(readFileSync(join(zodDir, 'package.json'), 'utf8'))
const zodFile = readdirSync(zodPack).find(name => name.endsWith('.tgz'))
const zodBytes = readFileSync(join(zodPack, zodFile))
const core = release.release.packages.find(item => item.name === '@dsh-eac/market-core')
const adapter = release.release.packages.find(item => item.name === '@dsh-eac/market')
const coreBytes = readFileSync(join(release.outDir, core.filename))
const requests = []
let base
const metadata = (name, version, bytes, tarPath) => ({ name, 'dist-tags': { latest: version }, versions: {
  [version]: { name, version, dist: { tarball: `${base}${tarPath}`, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` } },
} })
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, base).pathname)
  requests.push(path)
  if (path === '/@dsh-eac/market-core' || path === '/zod') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(path === '/zod' ? metadata('zod', zodManifest.version, zodBytes, '/artifacts/zod.tgz')
      : metadata(core.name, core.version, coreBytes, `/artifacts/${core.sha256}/core.tgz`)))
  } else if (path === `/artifacts/${core.sha256}/core.tgz`) res.end(coreBytes)
  else if (path === '/artifacts/zod.tgz') res.end(zodBytes)
  else { res.statusCode = 404; res.end('Fixture registry has no external packages') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
base = `http://127.0.0.1:${server.address().port}`
const testHome = join(output, 'dsh-home')
const installArgs = [cli, 'plugin', '--profile', 'web', 'add', join(release.outDir, adapter.filename),
  '--registry', base, '--store-dir', join(output, 'store'), '--ignore-scripts', '--reporter=append-only',
  '--fetch-retries=0', '--fetch-timeout=10000']
const env = { ...process.env, DSH_HOME: testHome, npm_config_registry: base,
  npm_config_update_notifier: 'false' }
let log = ''
let result
try {
  const child = spawn(process.execPath, installArgs, { cwd: output, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const timeout = setTimeout(() => child.kill(), 90_000)
  child.stdout.on('data', chunk => { log += chunk; process.stdout.write(chunk) })
  child.stderr.on('data', chunk => { log += chunk; process.stderr.write(chunk) })
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
  clearTimeout(timeout)
  if (code !== 0) throw new Error(`Official installation exited ${code}`)
  const profile = join(testHome, 'profiles/web')
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  if (Object.keys(manifest.dependencies).some(name => name !== adapter.name)) throw new Error('Smoke explicitly installed more than the desktop adapter')
  const appRequire = createRequire(join(profile, 'node_modules', adapter.name, 'package.json'))
  const installed = JSON.parse(readFileSync(appRequire.resolve(`${core.name}/package.json`), 'utf8'))
  if (installed.version !== core.version) throw new Error('Resolved core version differs')
  if (!requests.includes(`/artifacts/${core.sha256}/core.tgz`)) throw new Error('Core was not fetched from the fixture registry')
  const api = await import(pathToFileURL(appRequire.resolve(core.name)).href)
  if (api.CORE_VERSION !== core.version) throw new Error('Published core root cannot be imported')
  result = { status: 'passed', evidence: 'official DSH CLI package installation against local fixture registry, empty store',
    officialVersion: JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8')).version,
    adapter: adapter.version, core: installed.version, profile, requests, release: release.release }
} catch (error) { result = { status: 'failed', error: String(error), requests }; process.exitCode = 1 }
finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  writeFileSync(join(output, 'install.log'), log)
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2))
}
console.log(JSON.stringify({ status: result.status, output, error: result.error }))
