import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareRelease, readPackageArchive } from '../../scripts/pack-release.mjs'
import { packPackageFixture, readFixtureArchive } from './package-fixture.mjs'

const output = resolve(process.argv[2] ?? '')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const records = new Map()
let base
const requests = []
const resume = process.argv.includes('--serve-existing')
const previous = resume ? JSON.parse(readFileSync(join(output, 'registry.json'), 'utf8')) : undefined
if (resume && (!previous.testOnly || !previous.packageManagerSecurityUnchanged)) throw new Error('Expected a recorded immutable test Registry')
const server = createServer((request, response) => {
  if (request.headers.host !== new URL(base).host) { response.statusCode = 404; response.end(); return }
  const path = decodeURIComponent(new URL(request.url, base).pathname)
  requests.push({ path, at: new Date().toISOString() })
  writeFileSync(join(output, resume ? 'registry-resume-requests.json' : 'registry-requests.json'), JSON.stringify(requests, null, 2))
  const name = path.slice(1)
  const record = records.get(name)
  if (record) {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ name, 'dist-tags': { latest: record.manifest.version }, versions: { [record.manifest.version]: {
      ...record.manifest, dist: { tarball: `${base}/artifacts/${record.digest}/${record.filename}`, integrity: `sha512-${createHash('sha512').update(record.bytes).digest('base64')}` },
    } } }))
    return
  }
  const artifact = [...records.values()].find(record => path === `/artifacts/${record.digest}/${record.filename}`)
  if (artifact) { response.setHeader('content-type', 'application/octet-stream'); response.end(artifact.bytes); return }
  response.statusCode = 404; response.end('No unregistered packages are served')
})
const port = resume ? Number(new URL(previous.base).port) : 0
await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done) })
base = `http://127.0.0.1:${server.address().port}`
try {
  const prepared = resume ? undefined : prepareRelease({ outDir: output, registryCore: true })
  function register(path, knownManifest) {
    const bytes = readFileSync(path)
    const manifest = knownManifest ?? readPackageArchive(bytes).manifest
    records.set(manifest.name, { manifest, bytes, filename: path.split(/[\\/]/).at(-1), digest: createHash('sha256').update(bytes).digest('hex') })
  }
  if (resume) {
    const candidates = [output, ...['zod-fixture', 'semver-fixture', 'noop-fixture'].map(name => join(output, name))].flatMap(directory => readdirSync(directory).filter(name => name.endsWith('.tgz')).map(name => join(directory, name)))
    for (const expected of previous.packages) {
      const path = candidates.find(path => createHash('sha256').update(readFileSync(path)).digest('hex') === expected.sha256)
      if (!path) throw new Error('Recorded Registry artifact is missing or changed')
      register(path, readFixtureArchive(readFileSync(path)).manifest)
      const record = records.get(expected.name)
      if (!record || record.manifest.version !== expected.version) throw new Error('Recorded Registry identity differs')
    }
    console.log(JSON.stringify({ testOnly: true, resumed: true, base, packages: previous.packages.map(({ name, version, sha256 }) => ({ name, version, sha256 })) }, null, 2))
  } else {
    for (const artifact of prepared.release.packages) register(join(output, artifact.filename))
    for (const [name, anchor] of [['zod', 'packages/market/package.json'], ['semver', 'packages/market-core/package.json']]) {
      const source = dirname(createRequire(join(root, anchor)).resolve(`${name}/package.json`))
      const destination = join(output, `${name}-fixture`)
      const fixture = packPackageFixture(source, destination)
      register(fixture.path, fixture.manifest)
    }
    const fixtureSource = join(root, 'tools/desktop-acceptance/fixture-plugin')
    const fixtureDestination = join(output, 'noop-fixture')
    const fixture = packPackageFixture(fixtureSource, fixtureDestination)
    register(fixture.path, fixture.manifest)
    const report = { testOnly: true, base, packageManagerSecurityUnchanged: true, source: prepared.release.source,
      packages: [...records.values()].map(record => ({ name: record.manifest.name, version: record.manifest.version, sha256: record.digest,
        url: `${base}/artifacts/${record.digest}/${record.filename}` })),
    }
    writeFileSync(join(output, 'registry.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  }
} catch (error) { server.close(); throw error }
