import { describe, expect, it } from 'vitest'
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { packPackageFixture, readFixtureArchive } from '../../tools/desktop-acceptance/package-fixture.mjs'

function fixture() {
  const batch = mkdtempSync(join(tmpdir(), 'eac-desktop-package-fixture-'))
  const source = join(batch, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'desktop-hardlink-fixture', version: '1.0.0', files: ['mini', 'v4', 'lib'] }))
  return { batch, source, output: join(batch, 'output') }
}

function archiveEntries(bytes: Buffer) {
  const tar = gunzipSync(bytes)
  const entries: { path: string; type: string; bytes: Buffer }[] = []
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const text = (start: number, length: number) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '')
    const size = Number.parseInt(text(124, 12), 8)
    const prefix = text(345, 155)
    entries.push({ path: `${prefix ? `${prefix}/` : ''}${text(0, 100)}`, type: text(156, 1), bytes: tar.subarray(offset + 512, offset + 512 + size) })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

describe('isolated Desktop registry package fixtures', () => {
  it('packs real hardlinks as independent regular files without losing any bytes', () => {
    const setup = fixture()
    mkdirSync(join(setup.source, 'mini'))
    mkdirSync(join(setup.source, 'v4'))
    mkdirSync(join(setup.source, 'lib'))
    const manifestPath = join(setup.source, 'package.json')
    linkSync(manifestPath, join(setup.source, 'mini/package.json'))
    linkSync(manifestPath, join(setup.source, 'v4/package.json'))
    const binary = Buffer.from([0, 255, 128, 13, 10, 1])
    writeFileSync(join(setup.source, 'lib/binary.js'), binary)
    linkSync(join(setup.source, 'lib/binary.js'), join(setup.source, 'lib/binary-copy.js'))
    writeFileSync(join(setup.source, 'lib/empty.js'), '')
    writeFileSync(join(setup.source, 'excluded.txt'), 'npm files allowlist excludes this file')
    const before = lstatSync(manifestPath, { bigint: true })
    expect(before.nlink).toBe(3n)
    const packed = packPackageFixture(setup.source, setup.output)
    const archive = readFileSync(packed.path)
    const entries = archiveEntries(archive)
    expect(entries.every(entry => entry.type === '0' || entry.type === '')).toBe(true)
    expect(entries.some(entry => entry.type === '1')).toBe(false)
    expect(entries.map(entry => entry.path).sort()).toEqual([
      'package/package.json', 'package/mini/package.json', 'package/v4/package.json',
      'package/lib/binary.js', 'package/lib/binary-copy.js', 'package/lib/empty.js',
    ].sort())
    const inodes = new Set<bigint>()
    for (const entry of entries) {
      const path = entry.path.slice('package/'.length)
      expect(entry.bytes.equals(readFileSync(join(setup.source, path)))).toBe(true)
      const staged = lstatSync(join(setup.output, 'staging', path), { bigint: true })
      expect(staged.nlink).toBe(1n)
      expect(staged.ino).not.toBe(lstatSync(join(setup.source, path), { bigint: true }).ino)
      inodes.add(staged.ino)
    }
    expect(inodes.size).toBe(entries.length)
    expect(lstatSync(manifestPath, { bigint: true }).ino).toBe(before.ino)
    expect(lstatSync(manifestPath, { bigint: true }).nlink).toBe(before.nlink)
    expect(packed.manifest.name).toBe('desktop-hardlink-fixture')
    expect(readFixtureArchive(archive).files.get('lib/binary-copy.js')).toEqual(binary)
    expect(readFileSync(join(setup.output, 'empty-user-config'), 'utf8')).toBe('')
    expect(readFileSync(join(setup.output, 'empty-global-config'), 'utf8')).toBe('')
  }, 120_000)

  it('preserves npm PAX long paths and never runs package lifecycle scripts', () => {
    const setup = fixture()
    const manifest = JSON.parse(readFileSync(join(setup.source, 'package.json'), 'utf8'))
    manifest.scripts = { prepack: 'node -e "require(\'node:fs\').writeFileSync(\'lifecycle-ran\', \'unsafe\'); process.exit(1)"' }
    writeFileSync(join(setup.source, 'package.json'), JSON.stringify(manifest))
    mkdirSync(join(setup.source, 'lib'))
    const longPath = `lib/${'long-path-'.repeat(18)}.js`
    const content = Buffer.from('export const fixture = "中文内容"\n')
    writeFileSync(join(setup.source, longPath), content)
    const packed = packPackageFixture(setup.source, setup.output)
    const archive = readFileSync(packed.path)
    expect(archiveEntries(archive).some(entry => entry.type === 'x')).toBe(true)
    expect(readFixtureArchive(archive).files.get(longPath)).toEqual(content)
    expect(readdirSync(setup.source)).not.toContain('lifecycle-ran')
    expect(readdirSync(join(setup.output, 'staging'))).not.toContain('lifecycle-ran')
  }, 120_000)

  it.each(['zod', 'semver'])('packs the installed %s fixture without writing its pnpm source', name => {
    const anchor = name === 'zod' ? '../../packages/market/package.json' : '../../packages/market-core/package.json'
    const source = dirname(createRequire(new URL(anchor, import.meta.url)).resolve(`${name}/package.json`))
    const batch = mkdtempSync(join(tmpdir(), `eac-desktop-${name}-fixture-`))
    const original = readFileSync(join(source, 'package.json'))
    const before = lstatSync(join(source, 'package.json'), { bigint: true })
    const packed = packPackageFixture(source, join(batch, 'output'))
    const archive = readFixtureArchive(readFileSync(packed.path))
    expect(archive.manifest.name).toBe(name)
    for (const [path, bytes] of archive.files) expect(bytes.equals(readFileSync(join(source, path)))).toBe(true)
    if (name === 'zod') {
      for (const path of ['mini/package.json', 'v4/package.json']) {
        expect(archive.files.get(path)!.length).toBeGreaterThan(0)
        expect(() => JSON.parse(archive.files.get(path)!.toString('utf8'))).not.toThrow()
      }
    }
    expect(readFileSync(join(source, 'package.json'))).toEqual(original)
    expect(lstatSync(join(source, 'package.json'), { bigint: true }).ino).toBe(before.ino)
    expect(lstatSync(join(source, 'package.json'), { bigint: true }).nlink).toBe(before.nlink)
  }, 120_000)

  it('packs the existing noop plugin with the same verified staging path', () => {
    const source = dirname(createRequire(import.meta.url).resolve('../../tools/desktop-acceptance/fixture-plugin/package.json'))
    const batch = mkdtempSync(join(tmpdir(), 'eac-desktop-noop-fixture-'))
    const packed = packPackageFixture(source, join(batch, 'output'))
    const archive = readFixtureArchive(readFileSync(packed.path))
    expect(archive.manifest).toEqual(JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')))
    for (const [path, bytes] of archive.files) expect(bytes.equals(readFileSync(join(source, path)))).toBe(true)
  }, 120_000)

  it.each(['inside', 'outside'])('rejects %s directory links instead of traversing them', target => {
    const setup = fixture()
    const directory = join(target === 'inside' ? setup.source : setup.batch, 'linked-directory')
    mkdirSync(directory)
    writeFileSync(join(directory, 'sentinel.txt'), 'do not copy')
    symlinkSync(directory, join(setup.source, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => packPackageFixture(setup.source, setup.output)).toThrow(/symbolic link/)
    expect(readdirSync(setup.output).some(name => name.endsWith('.tgz'))).toBe(false)
    expect(readFileSync(join(directory, 'sentinel.txt'), 'utf8')).toBe('do not copy')
  })

  it('rejects linked roots and output ancestors, overlapping output, and existing output', () => {
    const setup = fixture()
    const linked = join(setup.batch, 'linked')
    symlinkSync(setup.source, linked, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => packPackageFixture(linked, setup.output)).toThrow(/symbolic links/)
    expect(() => packPackageFixture(setup.source, join(linked, 'output'))).toThrow(/symbolic links/)
    expect(() => packPackageFixture(setup.source, join(setup.source, 'output'))).toThrow(/separate/)
    expect(() => packPackageFixture(setup.source, setup.batch)).toThrow(/separate/)
    mkdirSync(setup.output)
    writeFileSync(join(setup.output, 'sentinel.txt'), 'preserve existing output')
    expect(() => packPackageFixture(setup.source, setup.output)).toThrow()
    expect(readFileSync(join(setup.output, 'sentinel.txt'), 'utf8')).toBe('preserve existing output')
  })

  it.each(['1', '2'])('rejects tar link type %s even when its header has size zero', type => {
    const header = Buffer.alloc(512)
    header.write('package/package.json')
    header.write('00000000000\0', 124)
    header.write(type, 156)
    header.write('package/mini/package.json', 157)
    header.fill(32, 148, 156)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148)
    expect(() => readFixtureArchive(gzipSync(Buffer.concat([header, Buffer.alloc(1024)])))).toThrow(/links are forbidden/)
  })

  it.each(['package/../escape.json', 'package//escape.json', 'package/C:/escape.json', 'outside/package.json'])('rejects escaping tar path %s', path => {
    const header = Buffer.alloc(512)
    header.write(path)
    header.write('00000000000\0', 124)
    header.write('0', 156)
    header.fill(32, 148, 156)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148)
    expect(() => readFixtureArchive(gzipSync(Buffer.concat([header, Buffer.alloc(1024)])))).toThrow(/Unsafe fixture path|escaped/)
  })
})
