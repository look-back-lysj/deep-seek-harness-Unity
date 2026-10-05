import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { npmInvocation, resolveNpmCli } from '../../scripts/pack-release.mjs'

function inside(root, path) {
  const tail = relative(root, path)
  return tail === '' || (!isAbsolute(tail) && tail !== '..' && !tail.startsWith(`..${sep}`))
}

function safePath(path) {
  if (!path || /[\\:\u0000-\u001f]/u.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe fixture path: ${path}`)
  }
  return path
}

function requireDirectory(path) {
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink() || relative(path, realpathSync(path)) !== '') {
    throw new Error(`Fixture directory must not contain symbolic links: ${path}`)
  }
}

function stageFiles(source, staging) {
  const files = new Map()
  function copy(directory, tail = '') {
    for (const name of readdirSync(directory).sort()) {
      const path = safePath(tail ? `${tail}/${name}` : name)
      const from = join(source, path)
      const to = join(staging, path)
      const info = lstatSync(from)
      if (info.isSymbolicLink() || !inside(source, realpathSync(from)) || !inside(staging, to)) {
        throw new Error(`Fixture contains a symbolic link or escaped path: ${path}`)
      }
      if (info.isDirectory()) {
        mkdirSync(to)
        copy(from, path)
      } else if (info.isFile()) {
        const bytes = readFileSync(from)
        writeFileSync(to, bytes, { flag: 'wx', mode: info.mode & 0o777 })
        files.set(path, bytes)
      } else {
        throw new Error(`Fixture requires regular files: ${path}`)
      }
    }
  }
  copy(source)
  return files
}

export function readFixtureArchive(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 })
  const files = new Map()
  let pax = {}
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const text = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '')
    const octal = (start, length) => Number.parseInt(text(start, length).trim(), 8)
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
    if (checksum !== octal(148, 8)) throw new Error('Fixture tar checksum mismatch')
    const size = octal(124, 12)
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + Math.ceil(size / 512) * 512 > tar.length) {
      throw new Error('Invalid fixture tar size')
    }
    const content = tar.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    const type = text(156, 1)
    if (type === 'x') {
      pax = {}
      for (let start = 0; start < content.length;) {
        const space = content.indexOf(32, start)
        const length = Number(content.subarray(start, space).toString('utf8'))
        if (space < start || !Number.isSafeInteger(length) || length <= space - start + 1 || start + length > content.length || content[start + length - 1] !== 10) {
          throw new Error('Invalid fixture PAX record')
        }
        const record = content.subarray(space + 1, start + length - 1).toString('utf8')
        const equal = record.indexOf('=')
        if (equal < 1) throw new Error('Invalid fixture PAX field')
        pax[record.slice(0, equal)] = record.slice(equal + 1)
        start += length
      }
      continue
    }
    if ((type !== '' && type !== '0') || pax.linkpath !== undefined || text(157, 100) !== '') {
      throw new Error('Fixture tar requires regular files; links are forbidden')
    }
    if (pax.size !== undefined && Number(pax.size) !== size) throw new Error('Fixture PAX size mismatch')
    const prefix = text(345, 155)
    const name = pax.path ?? `${prefix ? `${prefix}/` : ''}${text(0, 100)}`
    pax = {}
    if (!name.startsWith('package/')) throw new Error(`Fixture tar escaped package/: ${name}`)
    const path = safePath(name.slice(8))
    if (files.has(path)) throw new Error(`Duplicate fixture tar path: ${path}`)
    files.set(path, content)
  }
  if (!files.has('package.json')) throw new Error('Fixture tar lacks package.json')
  return { files, manifest: JSON.parse(files.get('package.json').toString('utf8')) }
}

export function packPackageFixture(sourcePath, destinationPath) {
  const source = resolve(sourcePath)
  const destination = resolve(destinationPath)
  requireDirectory(source)
  requireDirectory(dirname(destination))
  if (inside(source, destination) || inside(destination, source)) throw new Error('Fixture output must be separate from its source')
  mkdirSync(destination)
  const staging = join(destination, 'staging')
  mkdirSync(staging)
  const expected = stageFiles(source, staging)
  if (!expected.has('package.json')) throw new Error('Fixture source lacks package.json')
  JSON.parse(expected.get('package.json').toString('utf8'))
  writeFileSync(join(destination, 'empty-user-config'), '', { flag: 'wx' })
  writeFileSync(join(destination, 'empty-global-config'), '', { flag: 'wx' })
  const invocation = npmInvocation(resolveNpmCli(), staging, destination)
  const packed = spawnSync(invocation.command, invocation.args, invocation.options)
  writeFileSync(join(destination, 'npm.log'), `${packed.stdout ?? ''}\n${packed.stderr ?? ''}`, { flag: 'wx' })
  if (packed.error || packed.status !== 0) throw new Error(`Fixture npm pack failed: ${packed.error?.message ?? packed.stderr}`)
  const results = JSON.parse(packed.stdout)
  const archives = readdirSync(destination).filter(name => name.endsWith('.tgz'))
  if (!Array.isArray(results) || results.length !== 1 || archives.length !== 1 || results[0].filename !== archives[0] || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]*\.tgz$/.test(archives[0])) {
    throw new Error('Fixture npm pack must produce exactly one matching tgz')
  }
  const path = join(destination, archives[0])
  if (!lstatSync(path).isFile()) throw new Error('Fixture tgz must be a regular file')
  const archive = readFixtureArchive(readFileSync(path))
  const listed = results[0].files
  if (!Array.isArray(listed) || listed.length !== archive.files.size || new Set(listed.map(file => file.path)).size !== listed.length) {
    throw new Error('Fixture tar file set differs from npm pack')
  }
  for (const file of listed) {
    const name = safePath(file.path)
    const bytes = archive.files.get(name)
    if (!bytes || !expected.has(name) || bytes.length !== file.size || !bytes.equals(expected.get(name))) {
      throw new Error(`Fixture tar content differs from source: ${name}`)
    }
  }
  return { path, manifest: archive.manifest }
}
