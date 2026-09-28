import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageDir = join(root, 'packages', 'market')
const libDir = join(packageDir, 'lib')

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

await rm(libDir, { recursive: true, force: true })
await mkdir(libDir, { recursive: true })

// Generate strict Host/Client/Remote descriptors before tsc and bundling. The
// generator validates package exports and files from the source manifest.
const generator = new WorkspaceTypertGenerator(root)
// Host first so the generated `./remote` module exists while the Client face
// is analyzed. The two faces otherwise form a type-resolution cycle.
for (const artifact of generator.generate(['@dsh-eac/market'], ['host'])) {
  const output = join(artifact.packageRoot, 'lib')
  await mkdir(output, { recursive: true })
  await writeFile(join(output, `typert.${artifact.face}.js`), artifact.js)
  await writeFile(join(output, `typert.${artifact.face}.d.ts`), artifact.dts)
  if (artifact.remote !== undefined) {
    await writeFile(join(output, 'typert.remote-client.js'), artifact.remote.js)
    await writeFile(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
    await writeFile(join(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
  }
}
for (const artifact of generator.generate(['@dsh-eac/market'], ['client'])) {
  const output = artifact.packageRoot
  await writeFile(join(output, `typert.${artifact.face}.js`), artifact.js)
  await writeFile(join(output, `typert.${artifact.face}.d.ts`), artifact.dts)
}

run(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b', 'tsconfig.host.json', 'tsconfig.client.json'])

await esbuild.build({
  entryPoints: [join(packageDir, 'src', 'index.ts')],
  outfile: join(libDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  external: ['@deepseek-ai/*'],
  logLevel: 'warning',
})

const banner = `window.__ModuleLoader__.load({\n  id: "@dsh-eac/market",\n  factory: (require) => {\n    var module = { exports: {} };\n`
const footer = `\n    return module.exports;\n  },\n});\n`
await esbuild.build({
  entryPoints: [join(packageDir, 'src', 'client', 'index.ts')],
  outfile: join(libDir, 'client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2023',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: banner },
  footer: { js: footer },
  logLevel: 'warning',
})

console.log('built market Host, Client, and Typert artifacts')
