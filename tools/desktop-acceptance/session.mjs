import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const batch = resolve(process.argv[2] ?? '')
const app = 'G:/Deepseek Harness Desktop/DeepSeek Harness.exe'
const resume = process.argv.includes('--resume')
if (!batch.startsWith('D:\\eac-market-verify\\desktop-') || existsSync(batch) && !resume) throw new Error('Expected a fresh isolated official Desktop batch')
if (resume) {
  const previous = JSON.parse(readFileSync(join(batch, 'session.json'), 'utf8'))
  if (!previous.testOnly || previous.batch !== batch || previous.executable !== app) throw new Error('Cannot resume an unverified Desktop batch')
}
if (!existsSync(app)) throw new Error('Official Desktop executable is missing')
if (process.argv.includes('--loopback')) {
  if (resume) throw new Error('Loopback preparation only accepts a fresh batch')
  const profile = join(batch, 'harness', 'profiles', 'desktop')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n', { flag: 'wx' })
}
const archive = join(resolve(app, '..'), 'resources', 'app.asar')
const descriptor = openSync(archive, 'r')
const header = Buffer.alloc(16)
readSync(descriptor, header, 0, header.length, 0)
const bytes = Buffer.alloc(header.readUInt32LE(12))
readSync(descriptor, bytes, 0, bytes.length, 16)
const tree = JSON.parse(bytes.toString('utf8'))
const entry = tree.files['package.json']
const metadata = Buffer.alloc(entry.size)
readSync(descriptor, metadata, 0, metadata.length, 8 + header.readUInt32LE(4) + Number(entry.offset))
closeSync(descriptor)
const manifest = JSON.parse(metadata)
if (manifest.name !== '@deepseek-ai/dsh-desktop') throw new Error('Not the official Desktop package')
async function unusedPort() {
  const server = createServer()
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const port = server.address().port
  await new Promise(done => server.close(done))
  return port
}
const port = await unusedPort()
const inspectPort = await unusedPort()
mkdirSync(batch, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE'))
env.DSH_HOME = join(batch, 'harness')
env.DSH_DESKTOP_HOST_INSPECT_PORT = String(inspectPort)
env.npm_config_store_dir = join(batch, 'store')
const args = [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${join(batch, 'electron')}`]
const child = spawn(app, args, { env, cwd: batch, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const fact = { testOnly: true, officialDesktopVersion: manifest.version, officialBuild: manifest.dshBuildCommit, officialBuildDirty: manifest.dshBuildDirty,
  executable: app, batch, harnessHome: env.DSH_HOME, userData: join(batch, 'electron'), cdpPort: port, inspectPort, pid: child.pid, startedAt: new Date().toISOString() }
writeFileSync(join(batch, 'session.json'), JSON.stringify(fact, null, 2))
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => appendFileSync(join(batch, 'desktop-process.log'), chunk))
child.on('error', error => { appendFileSync(join(batch, 'desktop-process.log'), String(error)); process.exitCode = 1 })
child.on('exit', (code, signal) => { writeFileSync(join(batch, 'exit.json'), JSON.stringify({ code, signal, at: new Date().toISOString() })); console.log(`Official isolated Desktop exited ${code}/${signal}`) })
console.log(JSON.stringify(fact, null, 2))
