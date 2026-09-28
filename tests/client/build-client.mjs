import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const outfile = join(here, 'build', 'client.js')
await mkdir(dirname(outfile), { recursive: true })

const banner = `window.__ModuleLoader__.load({\n  id: "@dsh-eac/market",\n  factory: (require) => {\n    var module = { exports: {} };\n`
const footer = `\n    return module.exports;\n  },\n});\n`

await esbuild.build({
  entryPoints: [join(root, 'packages', 'market', 'src', 'client', 'index.ts')],
  outfile,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2023',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/*'],
  alias: { '@dsh-eac/market/remote': join(root, 'packages', 'market', 'typert.remote-client.js') },
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: banner },
  footer: { js: footer },
  logLevel: 'warning',
})
console.log(outfile)
