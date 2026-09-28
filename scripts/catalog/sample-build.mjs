/** 自建 fixture 专用重建脚本，不读取作者仓库、不联网、不安装依赖。 */
import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const files = JSON.parse(readFileSync(new URL('./fixture-files.json', import.meta.url), 'utf8'))
const blocks = []
for (const [path, value] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
  if (!/^(package\.json|cordis\.patch\.yml|lib\/index\.js)$/.test(path) || typeof value !== 'string') throw new Error('仅支持已知空 bundle 文件')
  const data = Buffer.from(value)
  const header = Buffer.alloc(512)
  header.write(`package/${path}`, 0, 100, 'utf8')
  for (const [offset, size, value] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, data.length], [136, 12, 0]]) header.write(value.toString(8).padStart(size - 1, '0') + '\0', offset, size, 'ascii')
  header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263)
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512))
}
const artifact = gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
writeFileSync(new URL('./rebuilt-fixture.tgz', import.meta.url), artifact, { flag: 'wx' })
