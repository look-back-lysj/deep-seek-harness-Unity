/**
 * Forensic replay, NOT a passing product test suite. These probes intentionally
 * assert the defective behavior observed at ea84b9f. After a fix, replace the
 * corresponding case with a proper regression test; do not restore the defect.
 * Only fake official services are supplied. The output directory is explicit.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const mode = process.argv[2] ?? 'main'
const selector = process.argv[3]
if (!['main', 'boundary'].includes(mode)) throw new Error('Use main or boundary, followed by an optional Pxx selector')
const supplied = process.env.MARKET_REVIEW_OUTPUT
if (!supplied || !isAbsolute(supplied)) throw new Error('Set MARKET_REVIEW_OUTPUT to a dedicated absolute test directory')
const output = resolve(supplied)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
mkdirSync(output, { recursive: true })
const buildDirectory = join(output, `build-${Date.now()}-${process.pid}`)
mkdirSync(buildDirectory)
const source = mode === 'main' ? 'probes.ts' : 'boundary-probes.ts'
const bundle = join(buildDirectory, 'probes.mjs')
await build({
  entryPoints: [fileURLToPath(new URL(source, import.meta.url))],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  banner: { js: "import { createRequire as reviewCreateRequire } from 'node:module'; const require = reviewCreateRequire(import.meta.url);" },
})
const result = spawnSync(process.execPath, [bundle, ...(selector ? [selector] : [])], {
  cwd: repoRoot,
  env: { ...process.env, MARKET_REVIEW_OUTPUT: output },
  stdio: 'inherit',
  timeout: 90_000,
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
