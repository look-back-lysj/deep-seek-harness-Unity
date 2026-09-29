import { describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { ensureSameOrAbsent, isAllowedPackageFile, parseArgs, npmInvocation, prepareRelease, readPackageArchive, resolveCoreUrl, stagePackage, validateOutDir, validateSourceManifests } from '../../scripts/pack-release.mjs'

const CORE = '@dsh-eac/market-core'
const base = process.platform === 'win32' ? 'D:/eac-market-verify/split-release-unit' : join(tmpdir(), 'eac-split-release-unit')
mkdirSync(base, { recursive: true })
const batch = mkdtempSync(join(base, 'run-'))
const digest = 'a'.repeat(64)
const artifact = { filename: 'actual-core.tgz', sha256: digest }
const sourceFact = () => ({ head: '1'.repeat(40), dirty: true, status: ' M packages/market/src/index.ts' })

function write(path: string, value: string | Buffer) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, value)
}

function fixture() {
  const directory = mkdtempSync(join(batch, 'case-'))
  const root = join(directory, 'repo')
  const outDir = join(directory, 'output & %literal% (中文)')
  const core = join(root, 'packages', 'market-core')
  const adapter = join(root, 'packages', 'market')
  for (const [path, name, version] of [[core, CORE, '0.1.0'], [adapter, '@dsh-eac/market', '0.1.0-mvp.10']]) {
    write(join(path!, 'package.json'), JSON.stringify({ name, version, main: './lib/index.js', exports: { '.': './lib/index.js' }, dependencies: name === CORE ? {} : { [CORE]: 'workspace:0.1.0' }, files: ['lib'] }))
    write(join(path!, 'lib/index.js'), 'export const syntheticFixture = true\n')
    write(join(path!, 'README.md'), 'Synthetic unit fixture; not a published package.\n')
    write(join(path!, 'LICENSE'), 'Synthetic unit fixture\n')
  }
  write(join(adapter, 'data/index.json'), '{}')
  write(join(adapter, 'cordis.patch.yml'), 'plugins: []')
  write(join(adapter, 'dsh-plugin.json'), '{}')
  return { root, outDir, core, adapter, directory }
}

// Synthetic tar writer: no pnpm process, installation, build, profile, or network in this suite.
function tar(entries: [string, Buffer | string, string?][]) {
  const blocks: Buffer[] = []
  for (const [name, value, type = '0'] of entries) {
    const content = Buffer.from(value)
    const header = Buffer.alloc(512)
    header.write(name, 0, 100)
    header.write('0000644\0', 100)
    header.write('0000000\0', 108)
    header.write('0000000\0', 116)
    header.write(content.length.toString(8).padStart(11, '0') + '\0', 124)
    header.write('00000000000\0', 136)
    header.fill(32, 148, 156)
    header.write(type, 156)
    header.write('ustar\0', 257)
    header.write('00', 263)
    const sum = header.reduce((total, byte) => total + byte, 0)
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}

function syntheticPack(stage: string, destination: string) {
  const entries: [string, Buffer | string][] = []
  const walk = (path = '') => {
    for (const entry of readdirSync(join(stage, path), { withFileTypes: true })) {
      const next = path ? `${path}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(next)
      else entries.push([`package/${next}`, readFileSync(join(stage, next))])
    }
  }
  walk()
  const manifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'))
  // The stub deliberately does NOT convert workspace:. Separate rejection tests cover that gate.
  write(join(destination, manifest.name === CORE ? 'npm-returned-core.tgz' : 'npm-returned-adapter.tgz'), tar(entries))
}

describe('发行方式与固定 core URL', () => {
  it('版本升级无需修改发行器，仍要求两个源包精确配对', () => {
    const core = { name: CORE, version: '1.2.3' }
    const adapter = { name: '@dsh-eac/market', version: '2.0.0-rc.1', dependencies: { [CORE]: 'workspace:1.2.3' } }
    expect(() => validateSourceManifests(core, adapter)).not.toThrow()
    expect(() => validateSourceManifests(core, { ...adapter, dependencies: { [CORE]: 'workspace:^1.2.3' } })).toThrow()
    expect(() => validateSourceManifests({ ...core, version: '01.2.3' }, adapter)).toThrow()
  })
  it('缺少选择、混用方式、测试冒充 production、未知参数均拒绝', () => {
    for (const flags of [[], ['--production'], ['--registry-core', '--core-url', 'https://example.invalid/a'], ['--test-core-url', 'http://127.0.0.1:9000/a', '--production'], ['--registry-core', '--registry-core'], ['--registry-core', '--publish'], ['--registry-core=true']]) {
      expect(() => parseArgs(['--out-dir', 'D:/unit-output', ...flags])).toThrow()
    }
    expect(() => parseArgs(['--registry-core'])).toThrow(/out-dir/)
    expect(parseArgs(['--out-dir=D:/space & chars', '--registry-core'])).toMatchObject({ registryCore: true, outDir: 'D:/space & chars' })
  })

  it('模板绑定真实摘要，保留查询中的 shell 字符为 URL 数据', () => {
    const url = resolveCoreUrl('https://example.invalid/sha256/{sha256}/{filename}?literal=a&b=$(&c=%25', artifact)
    expect(url).toContain(`/sha256/${digest}/actual-core.tgz`)
    expect(url).toContain('literal=a&b=$(')
    expect(resolveCoreUrl(`https://example.invalid/${digest}/core.tgz`, artifact)).toContain(digest)
  })

  it.each([
    `http://example.invalid/${digest}/core.tgz`,
    `https://example.invalid/${'b'.repeat(64)}/core.tgz`,
    `https://example.invalid/core.tgz?sha256=${digest}`,
    `https://example.invalid/${digest}0/core.tgz`,
    `https://example.invalid/latest/${digest}/core.tgz`,
    `https://example.invalid/%6daster/${digest}/core.tgz`,
    `https://example.invalid/${digest}/core.tgz?ref=main`,
    `https://user:password@example.invalid/${digest}/core.tgz`,
    `https://example.invalid/${digest}/core.tgz#hash`,
    `https://127.0.0.1/${digest}/core.tgz`,
    `https://example.invalid/{unknown}/${digest}/core.tgz`,
  ])('拒绝非固定正式 URL：%s', (url) => expect(() => resolveCoreUrl(url, artifact)).toThrow())

  it('测试 URL 仅允许带端口的 loopback，仍须包含真实指纹', () => {
    expect(resolveCoreUrl('http://127.0.0.1:9876/{sha256}/{filename}', artifact, true)).toContain(digest)
    expect(resolveCoreUrl('http://[::1]:9876/{sha256}/{filename}', artifact, true)).toContain(digest)
    for (const host of ['localhost:9876', '127.0.0.1.evil.invalid:9876', '192.168.1.1:9876', 'example.invalid:9876', '127.0.0.1']) {
      expect(() => resolveCoreUrl(`http://${host}/{sha256}/{filename}`, artifact, true)).toThrow()
    }
    expect(() => resolveCoreUrl('http://127.0.0.1:9876/latest/core.tgz', artifact, true)).toThrow()
  })
})

describe('staging 边界与安全调用', () => {
  it('禁止仓内、仓库父目录及 junction 绕过', () => {
    const f = fixture()
    for (const path of [f.root, f.core, join(f.core, 'lib/release'), f.directory]) expect(() => validateOutDir(path, f.root)).toThrow(/仓库/)
    expect(validateOutDir(f.outDir, f.root)).toBe(f.outDir)
    const link = join(f.directory, 'alias')
    symlinkSync(f.root, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => validateOutDir(join(link, 'lib/output'), f.root)).toThrow(/仓库/)
  })

  it('仅复制所需文件，官方宿主 workspace peer 保持原样而本地core精确固定', () => {
    const f = fixture()
    const manifest = JSON.parse(readFileSync(join(f.adapter, 'package.json'), 'utf8'))
    manifest.peerDependencies = { '@deepseek-ai/dsh-app-boot': 'workspace:*' }
    write(join(f.adapter, 'package.json'), JSON.stringify(manifest))
    const original = readFileSync(join(f.adapter, 'package.json'))
    write(join(f.adapter, 'node_modules/@example/host/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version: '0.2.0' }))
    for (const file of ['.env', '.npmrc', 'src/index.ts', 'lib/.env', 'lib/credentials.json', 'lib/secrets/private.json', 'lib/node_modules/pkg/index.js', 'data/private.json']) write(join(f.adapter, file), 'excluded synthetic data')
    const staging = join(f.directory, 'staging')
    const result = stagePackage(f.adapter, staging, '0.1.0')
    expect(result.peerDependencies['@deepseek-ai/dsh-app-boot']).toBe('workspace:*')
    expect(result.dependencies[CORE]).toBe('0.1.0')
    expect(readFileSync(join(f.adapter, 'package.json'))).toEqual(original)
    for (const path of ['node_modules', '.npmrc', '.env', 'src', 'lib/credentials.json', 'lib/secrets', 'lib/node_modules', 'data/private.json']) expect(existsSync(join(staging, path))).toBe(false)
    expect(existsSync(join(staging, 'data/index.json'))).toBe(true)
  })

  it('缺少 workspace 版本、构建入口、危险 publishConfig 都失败', () => {
    for (const change of ['workspace', 'entry', 'publishConfig']) {
      const f = fixture()
      const manifest = JSON.parse(readFileSync(join(f.core, 'package.json'), 'utf8'))
      if (change === 'workspace') manifest.peerDependencies = { '@missing/host': 'workspace:*' }
      if (change === 'entry') manifest.main = './lib/not-built.js'
      if (change === 'publishConfig') manifest.publishConfig = { directory: '../outside' }
      write(join(f.core, 'package.json'), JSON.stringify(manifest))
      expect(() => stagePackage(f.core, join(f.directory, 'stage'))).toThrow()
    }
  })

  it('Node 直接运行 npm JS，用户路径不成为 shell 命令', () => {
    const destination = 'D:/space & x/%VAR%/$(inert)'
    const invocation = npmInvocation('D:/npm space/npm-cli.js', 'D:/stage & text', destination)
    expect(invocation.command).toBe(process.execPath)
    expect(invocation.args[0]).toBe('D:/npm space/npm-cli.js')
    expect(invocation.args.at(-1)).toBe(destination)
    expect(invocation.options).toMatchObject({ shell: false, cwd: 'D:/stage & text', windowsHide: true })
    expect(invocation.args).toContain('--ignore-scripts')
    expect(invocation.args).toContain('--offline')
  })
})

describe('合成小包的发行准备与失败保护', () => {
  it('先 core 再 adapter，真实字节生成摘要，使用实际输出文件名且不改源 manifest', () => {
    const f = fixture()
    const original = readFileSync(join(f.adapter, 'package.json'))
    const stages: string[] = []
    const result = prepareRelease({ outDir: f.outDir, coreUrl: 'https://example.invalid/{sha256}/{filename}' }, {
      root: f.root, sourceState: sourceFact,
      pack: (stage: string, destination: string) => { stages.push(stage); syntheticPack(stage, destination) },
    })
    expect(stages[0]).toMatch(/[\\/]core$/)
    expect(stages[1]).toMatch(/[\\/]adapter$/)
    const [core, adapter] = result.release.packages
    const coreBytes = readFileSync(join(f.outDir, core.filename))
    expect(core).toMatchObject({ name: CORE, filename: 'npm-returned-core.tgz', size: coreBytes.length, sha256: createHash('sha256').update(coreBytes).digest('hex') })
    const packedAdapter = readPackageArchive(readFileSync(join(f.outDir, adapter.filename))).manifest
    expect(packedAdapter.dependencies[CORE]).toBe(`https://example.invalid/${core.sha256}/${core.filename}`)
    expect(readFileSync(join(f.adapter, 'package.json'))).toEqual(original)
    expect(JSON.parse(readFileSync(join(f.outDir, 'release.json'), 'utf8'))).toEqual(result.release)
    expect(result.release).toMatchObject({ published: false, remoteVerified: false, mode: 'production-candidate', source: sourceFact() })
    expect(existsSync(join(result.workDir, 'adapter/package.json'))).toBe(true)
    // Identical artifacts and metadata can be prepared again; no replacement is needed.
    expect(() => prepareRelease({ outDir: f.outDir, coreUrl: 'https://example.invalid/{sha256}/{filename}' }, { root: f.root, sourceState: sourceFact, pack: syntheticPack })).not.toThrow()
  })

  it.each(['registry-core', 'test-core-url'])('%s 元数据如实标记，依赖写入最终包', (mode) => {
    const f = fixture()
    const options = mode === 'registry-core' ? { registryCore: true } : { testCoreUrl: 'http://127.0.0.1:9876/{sha256}/{filename}' }
    const { release } = prepareRelease({ outDir: f.outDir, ...options }, { root: f.root, sourceState: sourceFact, pack: syntheticPack })
    const manifest = readPackageArchive(readFileSync(join(f.outDir, release.packages[1].filename))).manifest
    expect(manifest.dependencies[CORE]).toBe(release.dependency.specifier)
    expect(release).toMatchObject({ testOnly: mode === 'test-core-url', published: false, remoteVerified: false })
    expect(release.dependency.mode).toBe(mode)
    if (mode === 'registry-core') expect(release.dependency.specifier).toBe('0.1.0')
    else expect(release.mode).toBe('test-only')
  })

  it('不同字节的 tgz 或 release.json 均拒绝，且预检不会提前写出另一个包', () => {
    for (const filename of ['npm-returned-adapter.tgz', 'release.json']) {
      const f = fixture()
      write(join(f.outDir, filename), 'existing different bytes')
      expect(() => prepareRelease({ outDir: f.outDir, registryCore: true }, { root: f.root, sourceState: sourceFact, pack: syntheticPack })).toThrow(/拒绝覆盖/)
      expect(readFileSync(join(f.outDir, filename), 'utf8')).toBe('existing different bytes')
      expect(existsSync(join(f.outDir, 'npm-returned-core.tgz'))).toBe(false)
      expect(readdirSync(f.outDir).some((name) => name.startsWith('.prepare-'))).toBe(true)
    }
  })

  it('零制品、残留 workspace、本地 file 依赖、打包异常均不能生成发行报告', () => {
    for (const mode of ['none', 'workspace', 'file', 'throw']) {
      const f = fixture()
      const pack = (stage: string, destination: string) => {
        if (mode === 'none') return
        if (mode === 'throw') throw new Error('synthetic pack failed')
        const manifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'))
        manifest.dependencies = { bad: mode === 'file' ? 'file:../local' : 'workspace:0.1.0' }
        write(join(stage, 'package.json'), JSON.stringify(manifest))
        syntheticPack(stage, destination)
      }
      expect(() => prepareRelease({ outDir: f.outDir, registryCore: true }, { root: f.root, sourceState: sourceFact, pack })).toThrow(/诊断现场已保留/)
      expect(existsSync(join(f.outDir, 'release.json'))).toBe(false)
    }
  })

  it('Git 状态变化时停止，测试专用选项不能绕过程序接口冒充生产', () => {
    const f = fixture()
    let read = 0
    expect(() => prepareRelease({ outDir: f.outDir, registryCore: true }, { root: f.root, pack: syntheticPack, sourceState: () => ({ ...sourceFact(), dirty: read++ > 0 }) })).toThrow(/状态发生变化/)
    expect(existsSync(join(f.outDir, 'release.json'))).toBe(false)
    expect(() => prepareRelease({ outDir: f.outDir, testCoreUrl: 'http://127.0.0.1:1234/{sha256}/{filename}', production: true }, { root: f.root })).toThrow(/无效发行参数/)
  })

  it('已有同字节文件可复用，符号链接不可作为产物', () => {
    const f = fixture()
    const first = join(f.directory, 'first')
    write(first, 'same')
    expect(ensureSameOrAbsent(first, Buffer.from('same'))).toBe(true)
    expect(ensureSameOrAbsent(join(f.directory, 'missing'), Buffer.from('same'))).toBe(false)
    const junction = join(f.directory, 'linked-directory')
    symlinkSync(f.root, junction, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => ensureSameOrAbsent(junction, Buffer.from('same'))).toThrow(/普通文件/)
  })
})

describe('实际包内容检查 helper', () => {
  it('拒绝目录穿越、隐藏文件、node_modules、链接和重复 manifest', () => {
    for (const path of ['lib/../../escape.js', 'lib/.env', 'lib/node_modules/a.js', 'lib/secrets.json', '.npmrc']) expect(isAllowedPackageFile(path)).toBe(false)
    for (const entry of [['package/../outside', '{}'], ['package/.npmrc', '{}'], ['package/lib/link.js', '', '2'], ['package/package.json', '{}']] as [string, string, string?][]) {
      expect(() => readPackageArchive(tar([['package/package.json', '{}'], entry]))).toThrow()
    }
  })

  it('支持 pnpm 对长文件名使用的 PAX 记录', () => {
    const path = `package/lib/${'long-'.repeat(25)}index.js`
    const record = `path=${path}\n`
    let length = Buffer.byteLength(record) + 3
    while (length !== Buffer.byteLength(`${length} ${record}`)) length = Buffer.byteLength(`${length} ${record}`)
    const bytes = tar([['package/package.json', '{}'], ['PaxHeader', `${length} ${record}`, 'x'], ['short-name', 'export const fixture = true']])
    expect(readPackageArchive(bytes).files.has(path.slice(8))).toBe(true)
  })
})
