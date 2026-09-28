import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

export interface TgzFixtureEntry {
  readonly path: string
  readonly data: Uint8Array | string
  readonly type?: 'file' | 'symlink'
  readonly linkName?: string
}

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, '0') + '\0'
}

function header(entry: Required<Pick<TgzFixtureEntry, 'path' | 'type'>> & { readonly data: Buffer; readonly linkName: string }): Buffer {
  const block = Buffer.alloc(512)
  block.write(entry.path.slice(0, 100), 0, 'utf8')
  block.write(octal(0o644, 8), 100, 'ascii')
  block.write(octal(0, 8), 108, 'ascii')
  block.write(octal(0, 8), 116, 'ascii')
  block.write(octal(entry.data.length, 12), 124, 'ascii')
  block.write(octal(0, 12), 136, 'ascii')
  block.fill(0x20, 148, 156)
  block.write(entry.type === 'symlink' ? '2' : '0', 156, 'ascii')
  block.write(entry.linkName.slice(0, 100), 157, 'utf8')
  block.write('ustar\0', 257, 'ascii')
  block.write('00', 263, 'ascii')
  const checksum = block.reduce((sum, byte) => sum + byte, 0)
  block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  return block
}

export function createTgz(entries: readonly TgzFixtureEntry[]): Uint8Array {
  const blocks: Buffer[] = []
  for (const entry of entries) {
    const data = Buffer.from(entry.data)
    blocks.push(header({ path: entry.path, data, type: entry.type ?? 'file', linkName: entry.linkName ?? '' }))
    if (data.length > 0) {
      blocks.push(data)
      const padding = (512 - data.length % 512) % 512
      if (padding > 0) blocks.push(Buffer.alloc(padding))
    }
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

export function validTgz(name = '@test/alpha', version = '1.2.3'): Uint8Array {
  return createTgz([
    {
      path: 'package/package.json',
      data: JSON.stringify({ name, version, dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } }, null, 2),
    },
    { path: 'package/lib/index.js', data: 'export const fixture = true\n' },
    { path: 'package/cordis.patch.yml', data: 'insert: []\n' },
  ])
}

export function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}
