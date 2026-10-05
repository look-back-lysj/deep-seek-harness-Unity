import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { prepareRelease } from '../../scripts/pack-release.mjs'

const batch = resolve(process.argv[2] ?? '')
const output = resolve(process.argv[3] ?? join(batch, 'packages'))
const session = JSON.parse(readFileSync(join(batch, 'session.json'), 'utf8'))
if (!session.testOnly || session.batch !== batch) throw new Error('Expected isolated Desktop batch')
let prepared
const server = createServer((request, response) => {
  if (request.headers.host !== `127.0.0.1:${server.address().port}` || !prepared) { response.statusCode = 404; response.end(); return }
  const path = new URL(request.url, `http://${request.headers.host}`).pathname
  const artifact = prepared.release.packages.find(artifact => path === `/artifacts/${artifact.sha256}/${artifact.filename}`)
  if (!artifact) { response.statusCode = 404; response.end('Only immutable test artifacts are served'); return }
  response.setHeader('content-type', 'application/octet-stream')
  response.end(readFileSync(join(prepared.outDir, artifact.filename)))
})
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
const base = `http://127.0.0.1:${server.address().port}`
try {
  prepared = prepareRelease({ outDir: output, testCoreUrl: `${base}/artifacts/{sha256}/{filename}` })
  const report = { testOnly: true, base, source: prepared.release.source, packages: prepared.release.packages.map(artifact => ({ ...artifact, url: `${base}/artifacts/${artifact.sha256}/${artifact.filename}` })) }
  writeFileSync(join(output, 'artifacts.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) { server.close(); throw error }
