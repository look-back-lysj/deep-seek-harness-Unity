/**
 * Verify the market manifest against the official DSH plugin peer gate.
 * This tool only reads the market manifest and imports the official evaluator; it never writes profile state.
 */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const runtimeVersions = ['0.1.7-rc.2', '0.2.0-rc.1', '0.3.0-unknown']
const packageRoot = resolve(fileURLToPath(new URL('../packages/market/', import.meta.url)))
const marketManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))

function usage() {
  return [
    'Usage:',
    '  node scripts/verify-official-compat.mjs --official-app-boot <path>',
    '  node scripts/verify-official-compat.mjs --official-dsh-root <path>',
    '  EAC_OFFICIAL_DSH_ROOT=<path> node scripts/verify-official-compat.mjs',
    '',
    'The path may point to an installed @deepseek-ai/dsh-app-boot package or a DSH root containing it.',
  ].join('\n')
}

function parseArgs(argv) {
  let input
  let source = 'command line'
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--help' || value === '-h') {
      console.log(usage())
      process.exit(0)
    }
    if (value === '--official-app-boot' || value === '--official-dsh-root') {
      input = argv[index + 1]
      if (!input) throw new Error(`${value} requires a path`)
      index += 1
      continue
    }
    if (value.startsWith('--')) throw new Error(`Unknown option: ${value}\n${usage()}`)
    if (input) throw new Error(`Unexpected extra path: ${value}`)
    input = value
  }
  if (!input && process.env.EAC_OFFICIAL_DSH_ROOT) {
    input = process.env.EAC_OFFICIAL_DSH_ROOT
    source = 'EAC_OFFICIAL_DSH_ROOT'
  }
  return { input, source }
}

async function readPackageManifest(directory) {
  try {
    return JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return undefined
    throw error
  }
}

async function resolveAppBootRoot(input) {
  const root = resolve(input)
  const candidates = [
    root,
    join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot'),
    join(root, 'packages', 'boot', 'app-boot'),
    join(root, 'resources', 'app.asar.unpacked', 'node_modules', '@deepseek-ai', 'dsh-app-boot'),
    join(root, 'resources', 'app', 'node_modules', '@deepseek-ai', 'dsh-app-boot'),
  ]
  for (const candidate of candidates) {
    const manifest = await readPackageManifest(candidate)
    if (manifest?.name === '@deepseek-ai/dsh-app-boot') return candidate
  }
  throw new Error(
    `Official @deepseek-ai/dsh-app-boot package was not found below ${root}. `
    + 'Pass its package directory or the containing DSH root explicitly.',
  )
}

const { input, source } = parseArgs(process.argv.slice(2))
if (!input) {
  console.log('SKIP official compatibility verification (not PASS): no official DSH path was provided.')
  console.log('Set EAC_OFFICIAL_DSH_ROOT or pass --official-app-boot <path>.')
  process.exit(0)
}

const appBootRoot = await resolveAppBootRoot(input)
const appBootManifest = await readPackageManifest(appBootRoot)
const appBootModule = await import(pathToFileURL(join(appBootRoot, 'lib', 'index.js')).href)
if (typeof appBootModule.evaluatePluginCompatibility !== 'function') {
  throw new Error(`Official package ${appBootRoot} does not export evaluatePluginCompatibility`)
}

console.log(`Official app-boot: ${String(appBootManifest?.version)} at ${appBootRoot} (${source})`)
for (const runtimeVersion of runtimeVersions) {
  const result = appBootModule.evaluatePluginCompatibility(marketManifest, {}, runtimeVersion)
  if (result !== undefined) {
    throw new Error(`FAIL official peer gate for runtime ${runtimeVersion}: ${JSON.stringify(result)}`)
  }
  console.log(`PASS official peer gate runtime=${runtimeVersion} result=undefined`)
}
console.log('PASS official compatibility peer gate only; this does not prove unknown future DSH APIs are runtime-compatible.')
