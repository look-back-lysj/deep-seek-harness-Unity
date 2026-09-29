import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CORE = '@dsh-eac/market-core'
const FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']
const TOP = ['package.json', 'README', 'README.md', 'README.txt', 'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'lib', 'data', 'cordis.patch.yml', 'dsh-plugin.json']
const json = (value) => `${JSON.stringify(value, null, 2)}\n`
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const fail = (message) => { throw new Error(message) }

export function isExactSemver(value) {
  if (typeof value !== 'string' || value.length > 256) return false
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value)
  return Boolean(match && match.slice(1, 4).every((part) => Number.isSafeInteger(Number(part))) && (!match[4] || match[4].split('.').every((part) => !/^\d+$/.test(part) || /^(0|[1-9]\d*)$/.test(part))))
}

const hostPeer = (field, name, spec) => field === 'peerDependencies' && /^@deepseek-ai\/dsh-[a-z0-9-]+$/.test(name) && spec === 'workspace:*'

function validateDependencies(manifest) {
  for (const field of FIELDS) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (hostPeer(field, name, spec)) continue
      if (typeof spec !== 'string' || /(?:workspace:|catalog:|file:|link:|portal:)/i.test(spec) || /^(?:\.{0,2}[\\/]|[a-z]:[\\/])/i.test(spec)) fail(`不允许的本地依赖声明：${field}.${name}`)
    }
  }
}

export function validateSourceManifests(core, adapter) {
  if (core.name !== CORE || adapter.name !== '@dsh-eac/market' || !isExactSemver(core.version) || !isExactSemver(adapter.version) || core.private || adapter.private) fail('源码包名、SemVer 或 private 状态无效')
  if (adapter.dependencies?.[CORE] !== `workspace:${core.version}` || adapter.optionalDependencies?.[CORE] !== undefined) fail('adapter 必须精确依赖 workspace:<源码 core 版本>，且不能被 optionalDependencies 覆盖')
}

export function parseArgs(args) {
  const options = {}
  const flags = new Map([['--out-dir', 'outDir'], ['--core-url', 'coreUrl'], ['--test-core-url', 'testCoreUrl'], ['--registry-core', 'registryCore'], ['--production', 'production']])
  for (let i = 0; i < args.length; i++) {
    const [flag, ...inline] = args[i].split('=')
    const key = flags.get(flag)
    if (!key || key in options) fail(`未知或重复参数：${flag}`)
    if (key === 'registryCore' || key === 'production') {
      if (inline.length) fail(`${flag} 不接受参数值`)
      options[key] = true
    } else {
      const value = inline.length ? inline.join('=') : args[++i]
      if (!value || value.startsWith('--')) fail(`${flag} 缺少参数值`)
      options[key] = value
    }
  }
  if (!options.outDir) fail('必须指定 --out-dir，例如 D:/eac-market-verify/split-release')
  if ([options.coreUrl, options.testCoreUrl, options.registryCore].filter(Boolean).length !== 1) {
    fail('必须且只能选择 --core-url、--registry-core、--test-core-url 中的一项')
  }
  if (options.testCoreUrl && options.production) fail('--test-core-url 禁止与 --production 混用')
  return options
}

export function resolveCoreUrl(template, artifact, testOnly = false) {
  if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) fail('core SHA256 必须来自实际包字节')
  const value = template.replaceAll('{sha256}', artifact.sha256).replaceAll('{filename}', artifact.filename)
  if (/[{}\s\\]/u.test(value)) fail('URL 有未知模板、空白或反斜杠')
  const url = new URL(value)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (testOnly ? url.protocol !== 'http:' || !loopback || !url.port : url.protocol !== 'https:' || loopback || url.hostname === 'localhost') {
    fail(testOnly ? '测试 URL 只允许带端口的 http://127.0.0.1 或 http://[::1]' : '正式 core URL 必须为非 loopback 的 HTTPS 链接')
  }
  if (url.username || url.password || url.hash) fail('core URL 不允许用户名、密码或片段')
  const path = decodeURIComponent(url.pathname)
  const digest = new RegExp(`(?:^|[^a-f0-9])${artifact.sha256}(?:$|[^a-f0-9])`, 'i')
  if (!digest.test(path)) fail('core URL 路径必须包含生成 core 包的真实 SHA256，不能只放在查询参数里')
  if (/(?:^|[\/._?=&-])(?:latest|master|main|head|current|stable|nightly)(?:$|[\/._?=&-])/i.test(`${path}${decodeURIComponent(url.search)}`)) {
    fail('core URL 不允许 latest/master/main 等动态地址')
  }
  return url.href
}

const inside = (parent, child) => {
  const path = relative(parent, child)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

// Resolve existing ancestors too: a junction must not disguise an output inside the checkout.
export function validateOutDir(outDir, root = ROOT) {
  const requested = resolve(outDir)
  let ancestor = requested
  const tail = []
  while (!existsSync(ancestor)) {
    tail.unshift(relative(dirname(ancestor), ancestor))
    const next = dirname(ancestor)
    if (next === ancestor) fail('输出目录没有可用的父目录')
    ancestor = next
  }
  const actual = resolve(realpathSync(ancestor), ...tail)
  const repo = realpathSync(root)
  if (inside(repo, actual) || inside(actual, repo)) fail('--out-dir 必须在仓库外，且不能是仓库的父目录')
  return actual
}

export function isAllowedPackageFile(path) {
  const parts = path.split('/')
  if (parts.some((part) => !part || part.startsWith('.') || /^(?:node_modules|secrets?|credentials?)(?:[._-]|$)/i.test(part))) return false
  if (parts.length === 1) return TOP.includes(path) && path !== 'lib' && path !== 'data'
  if (path === 'data/index.json') return true
  return parts[0] === 'lib' && /(?:\.[cm]?js|\.d\.[cm]?ts|\.map|\.css|\.json)$/i.test(path)
}

function requireFile(path) {
  if (!lstatSync(path).isFile()) fail(`必须为普通文件，不允许符号链接：${path}`)
}

function copyAllowed(source, target, path) {
  const from = join(source, path)
  const info = lstatSync(from)
  if (info.isSymbolicLink()) fail(`staging 不接受符号链接：${from}`)
  if (info.isDirectory()) {
    if (path.split('/').some((part) => part.startsWith('.') || /^(?:node_modules|secrets?|credentials?)(?:[._-]|$)/i.test(part))) return
    for (const entry of readdirSync(from).sort()) copyAllowed(source, target, `${path}/${entry}`)
  } else if (isAllowedPackageFile(path)) {
    requireFile(from)
    mkdirSync(dirname(join(target, path)), { recursive: true })
    copyFileSync(from, join(target, path), constants.COPYFILE_EXCL)
  }
}

function requiredPaths(manifest) {
  const paths = new Set(['package.json', manifest.main, manifest.types, manifest.dsh?.bundle?.patch].filter(Boolean))
  function collect(value) {
    if (typeof value === 'string') paths.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(manifest.exports)
  collect(manifest.bin)
  if (manifest.name === '@dsh-eac/market') ['data/index.json', 'cordis.patch.yml', 'dsh-plugin.json'].forEach((path) => paths.add(path))
  return [...paths].map((path) => {
    const normalized = path.replace(/^\.\//, '')
    if (!isAllowedPackageFile(normalized)) fail(`未支持的包入口（请显式审核允许清单）：${path}`)
    return normalized
  })
}

export function stagePackage(source, target, coreDependency) {
  if (lstatSync(source).isSymbolicLink()) fail(`包目录不能是符号链接：${source}`)
  mkdirSync(target, { recursive: true })
  for (const path of TOP) if (existsSync(join(source, path))) copyAllowed(source, target, path)
  const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  // No publish-time directory/manifest overrides or bundled node_modules can bypass the staging boundary.
  if (manifest.publishConfig || manifest.bundledDependencies || manifest.bundleDependencies) fail('请先审核 publishConfig/bundledDependencies；本发行脚本不接受隐式打包覆盖')
  if (coreDependency !== undefined) manifest.dependencies[CORE] = coreDependency
  validateDependencies(manifest)
  // Only the local core dependency changes. DSH workspace:* peers follow the host contract.
  writeFileSync(join(target, 'package.json'), json(manifest))
  for (const path of requiredPaths(manifest)) requireFile(join(target, path))
  return manifest
}

export function resolveNpmCli(env = process.env) {
  const candidates = [env.EAC_NPM_CLI, env.npm_execpath]
  for (const directory of [dirname(process.execPath), ...(env.PATH ?? env.Path ?? '').split(delimiter)]) {
    if (!directory) continue
    candidates.push(join(directory, 'npm'), join(directory, 'npm-cli.js'), join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(directory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  }
  for (const candidate of candidates.filter(Boolean)) {
    if (!existsSync(candidate)) continue
    const path = realpathSync(candidate)
    if (/(?:^|[\\/])npm-cli\.js$/.test(path) && lstatSync(path).isFile()) return path
  }
  fail('未找到已安装的 npm JS 入口；可用 EAC_NPM_CLI 指向本机 npm-cli.js。本脚本不会下载 npm')
}

export function npmInvocation(cli, staging, destination) {
  return {
    command: process.execPath,
    args: [cli, 'pack', '--ignore-scripts', '--offline', '--workspaces=false', '--audit=false', '--fund=false', '--update-notifier=false', '--json', '--cache', join(destination, '.npm-cache'), '--userconfig', join(destination, 'empty-user-config'), '--globalconfig', join(destination, 'empty-global-config'), '--pack-destination', destination],
    options: { cwd: staging, encoding: 'utf8', shell: false, windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
  }
}

function packWithNpm(staging, destination) {
  writeFileSync(join(destination, 'empty-user-config'), '', { flag: 'wx' })
  writeFileSync(join(destination, 'empty-global-config'), '', { flag: 'wx' })
  const { command, args, options } = npmInvocation(resolveNpmCli(), staging, destination)
  const result = spawnSync(command, args, options)
  writeFileSync(join(destination, 'npm.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  if (result.error || result.status !== 0) fail(`npm pack 失败；查看 ${join(destination, 'npm.log')}：${result.error?.message ?? result.status}`)
}

// Small, read-only reader for npm's ustar/PAX output. Never extract archive paths to disk.
export function readPackageArchive(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 })
  const files = new Map()
  let pax = {}
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const str = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '')
    const octal = (start, length) => Number.parseInt(str(start, length).trim(), 8)
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
    if (checksum !== octal(148, 8)) fail('tar 校验和错误')
    const size = octal(124, 12)
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) fail('tar 文件长度无效')
    const content = tar.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    const type = str(156, 1)
    if (type === 'x') {
      pax = {}
      for (let start = 0; start < content.length;) {
        const space = content.indexOf(32, start)
        const length = Number(content.subarray(start, space).toString())
        if (space < start || !Number.isSafeInteger(length) || length <= space - start + 1 || start + length > content.length) fail('PAX 记录长度无效')
        const record = content.subarray(space + 1, start + length - 1).toString('utf8')
        const equal = record.indexOf('=')
        if (equal < 1) fail('PAX 记录无效')
        pax[record.slice(0, equal)] = record.slice(equal + 1)
        start += length
      }
      continue
    }
    const prefix = str(345, 155)
    const name = pax.path ?? `${prefix ? `${prefix}/` : ''}${str(0, 100)}`
    pax = {}
    if (type !== '' && type !== '0') fail(`tar 不允许非普通文件：${name}`)
    if (!name.startsWith('package/') || !isAllowedPackageFile(name.slice(8)) || name.includes('\\') || files.has(name.slice(8))) fail(`tar 包含不允许或重复的文件：${name}`)
    files.set(name.slice(8), content)
  }
  if (!files.has('package.json')) fail('tar 缺少 package.json')
  return { files, manifest: JSON.parse(files.get('package.json').toString('utf8')) }
}

function inspectPacked(directory, expected, coreDependency) {
  const names = readdirSync(directory).filter((name) => name.endsWith('.tgz'))
  if (names.length !== 1) fail('npm pack 必须实际生成且只生成一个 tgz')
  const filename = names[0]
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*\.tgz$/.test(filename)) fail('npm 生成了不支持的 tgz 文件名')
  const path = join(directory, filename)
  requireFile(path)
  const bytes = readFileSync(path)
  const { files, manifest } = readPackageArchive(bytes)
  if (manifest.name !== expected.name || manifest.version !== expected.version || manifest.private) fail('包内 name/version/private 与预期不符')
  validateDependencies(manifest)
  for (const [name, spec] of Object.entries(expected.peerDependencies ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh-') && manifest.peerDependencies?.[name] !== spec) fail(`包内官方 DSH peer 被改写：${name}，预期 ${spec}`)
  }
  if (coreDependency !== undefined && manifest.dependencies?.[CORE] !== coreDependency) fail('adapter 包内的 core 依赖与选定发布方式不符')
  for (const entry of requiredPaths(manifest)) if (!files.has(entry)) fail(`包内缺少声明入口：${entry}`)
  return { name: manifest.name, version: manifest.version, filename, size: bytes.length, sha256: sha256(bytes), path }
}

export function readSourceState(root) {
  const git = (args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 })
    if (result.error || result.status !== 0) fail('无法读取 Git 源码事实，拒绝生成 release.json')
    return result.stdout.trimEnd()
  }
  const head = git(['rev-parse', 'HEAD'])
  if (!/^[a-f0-9]{40,64}$/.test(head)) fail('Git HEAD 无效')
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'])
  return { head, dirty: status.length > 0, status }
}

export function ensureSameOrAbsent(destination, bytes) {
  try {
    requireFile(destination)
    if (!readFileSync(destination).equals(bytes)) fail(`同名文件字节不同，拒绝覆盖：${destination}`)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

// Injection is only for synthetic unit tests; the CLI always uses real Git and real npm pack.
export function prepareRelease(options, { root = ROOT, pack = packWithNpm, sourceState = readSourceState } = {}) {
  if (!options.outDir || [options.coreUrl, options.registryCore, options.testCoreUrl].filter(Boolean).length !== 1 || options.testCoreUrl && options.production) fail('无效发行参数；必须显式选择一种依赖方式')
  root = realpathSync(root)
  const outDir = validateOutDir(options.outDir, root)
  mkdirSync(outDir, { recursive: true })
  const workDir = mkdtempSync(join(outDir, '.prepare-'))
  try {
    const before = sourceState(root)
    const sources = [join(root, 'packages', 'market-core'), join(root, 'packages', 'market')]
    const originals = sources.map((source) => {
      requireFile(join(source, 'package.json'))
      return readFileSync(join(source, 'package.json'))
    })
    const [core, adapter] = originals.map((bytes) => JSON.parse(bytes.toString()))
    validateSourceManifests(core, adapter)
    const build = (index, dependency) => {
      const staging = join(workDir, index === 0 ? 'core' : 'adapter')
      const destination = `${staging}-pack`
      const manifest = stagePackage(sources[index], staging, dependency)
      mkdirSync(destination)
      pack(staging, destination)
      return inspectPacked(destination, manifest, dependency)
    }
    const coreArtifact = build(0)
    const testOnly = Boolean(options.testCoreUrl)
    const coreDependency = options.registryCore ? core.version : resolveCoreUrl(options.coreUrl ?? options.testCoreUrl, coreArtifact, testOnly)
    const adapterArtifact = build(1, coreDependency)
    for (let i = 0; i < sources.length; i++) if (!readFileSync(join(sources[i], 'package.json')).equals(originals[i])) fail('打包期间源 manifest 发生变化，请主控冻结 writer 后重试')
    const source = sourceState(root)
    if (json(before) !== json(source)) fail('打包期间 HEAD/dirty 状态发生变化，请冻结 writer 后重试')
    const artifacts = [coreArtifact, adapterArtifact]
    const release = {
      schemaVersion: 1,
      status: 'local-prepared',
      mode: testOnly ? 'test-only' : 'production-candidate',
      testOnly,
      published: false,
      remoteVerified: false,
      packer: 'npm pack --ignore-scripts --offline',
      dependency: { mode: testOnly ? 'test-core-url' : options.registryCore ? 'registry-core' : 'core-url', name: CORE, specifier: coreDependency },
      source,
      packages: artifacts.map(({ path, ...artifact }) => artifact),
    }
    const report = join(workDir, 'release.json')
    writeFileSync(report, json(release), { flag: 'wx' })
    const outputs = [...artifacts.map((artifact) => ({ from: artifact.path, to: join(outDir, artifact.filename) })), { from: report, to: join(outDir, 'release.json') }]
    // Preflight the whole set; write the completion report last. Never replace existing bytes.
    for (const { from, to } of outputs) ensureSameOrAbsent(to, readFileSync(from))
    for (const { from, to } of outputs) {
      try { copyFileSync(from, to, constants.COPYFILE_EXCL) } catch (error) {
        if (error.code !== 'EEXIST') throw error
        ensureSameOrAbsent(to, readFileSync(from))
      }
    }
    return { release, outDir, workDir }
  } catch (error) {
    throw new Error(`${error.message}\n诊断现场已保留：${workDir}`, { cause: error })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--help') {
      console.log('node scripts/pack-release.mjs --out-dir D:/eac-market-verify/<批次> (--core-url <HTTPS/{sha256}/{filename}> | --registry-core | --test-core-url <http://127.0.0.1:端口/{sha256}/{filename}>) [--production]\n仅准备本地包；不构建、不安装、不上传、不证明远端已发布。')
    } else {
      const result = prepareRelease(parseArgs(process.argv.slice(2)))
      console.log(`本地准备完成（${result.release.mode}）：${result.outDir}\n诊断现场：${result.workDir}\n未上传，未验证远端发布；请主控核验后再按授权分发。`)
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
