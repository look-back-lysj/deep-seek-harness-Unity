import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoots = [
  join(root, 'packages', 'market', 'src'),
  join(root, 'packages', 'market-core', 'src'),
  join(root, 'tests'),
  join(root, 'scripts'),
]
const forbiddenSecret = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:rpcSecret|secret)\s*[:=]\s*['"][A-Za-z0-9_-]{16,})/iu
const problems = []

async function walk(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await walk(path))
    else if (/\.(?:ts|tsx|mjs|json|md)$/u.test(entry.name)) result.push(path)
  }
  return result
}

for (const sourceRoot of sourceRoots) {
  for (const file of await walk(sourceRoot)) {
    const text = await readFile(file, 'utf8')
    const relativePath = relative(root, file).replaceAll('\\', '/')
    if (relativePath === 'scripts/lint.mjs') continue
    if (forbiddenSecret.test(text)) problems.push(`${relativePath}: possible secret`)
    const isClient = relativePath.startsWith('packages/market/src/client/')
    const isCore = relativePath.startsWith('packages/market-core/src/core/')
    const isCorePackage = relativePath.startsWith('packages/market-core/src/')
    if (isCorePackage && /(?:from\s*|import\s*\()['"](?:react(?:\/[^'"]*)?|react-dom(?:\/[^'"]*)?|@dsh-eac\/market(?:\/[^'"]*)?)['"]/u.test(text)) {
      problems.push(`${relativePath}: core cannot depend on its desktop adapter or React`)
    }
    if (isClient && /from ['"](?:\.\.\/)+(?:host|adapters|catalog|delivery|persistence|authoring)\//u.test(text)) {
      problems.push(`${relativePath}: Client imports backend implementation`)
    }
    if ((isClient || isCore) && /from ['"](?:node:)?fs(?:\/promises)?['"]/u.test(text)) {
      problems.push(`${relativePath}: filesystem import outside Host-side module`)
    }
    if (/TODO|FIXME|not implemented/ui.test(text) && !relativePath.endsWith('.md')) {
      problems.push(`${relativePath}: unfinished marker`)
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('PASS lint: secrets, unfinished markers, and Client/core filesystem boundaries')
