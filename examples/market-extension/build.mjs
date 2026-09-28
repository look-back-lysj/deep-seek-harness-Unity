/** Standalone fixture only. Never invokes the workspace build or npm install. */
import { build } from 'esbuild'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const here = dirname(fileURLToPath(import.meta.url))
const output = 'D:/eac-market-verify/implementation-20260928/E-extension'
const stage = join(output, 'bundle-stage', 'package')
await mkdir(join(stage, 'lib'), { recursive: true })
const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'))
await build({ entryPoints: [join(here, 'src/index.ts')], outfile: join(stage, 'lib/index.js'), bundle: true, format: 'esm', platform: 'node', target: 'node24', logLevel: 'warning' })
const client = await build({ entryPoints: [join(here, 'src/client.tsx')], outfile: join(stage, 'lib/client.js'), bundle: true, format: 'cjs', platform: 'browser', target: 'es2023', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], metafile: true, define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => { var module = { exports: {} };` },
  footer: { js: 'return module.exports; } });' }, logLevel: 'warning',
})
const externals = Object.values(client.metafile.outputs).flatMap((row) => row.imports).filter((row) => row.external).map((row) => row.path)
if (externals.some((name) => !['react', 'react/jsx-runtime'].includes(name))) throw new Error('Unexpected runtime dependency in independent fixture')
for (const name of ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE']) await copyFile(join(here, name), join(stage, name))
const tgz = resolve(output, 'dsh-eac-market-extension-example-0.1.0-test.1.tgz')
const tar = spawnSync('tar', ['-czf', tgz, '-C', dirname(stage), 'package/package.json', 'package/cordis.patch.yml', 'package/README.md', 'package/LICENSE', 'package/lib/index.js', 'package/lib/client.js'], { windowsHide: true, encoding: 'utf8' })
if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`)
const bytes = await readFile(tgz)
const report = { evidence: 'local standalone example build; official Desktop install still pending', name: pkg.name, version: pkg.version, tgz, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), externalImports: externals, inputs: Object.keys(client.metafile.inputs) }
await writeFile(join(output, 'example-package.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
