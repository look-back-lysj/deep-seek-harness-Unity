import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AuthorDraftConflictError,
  AuthorDraftStore,
  AuthorPackageService,
  MarkdownSecurityError,
  MediaStore,
  ReadmeImporter,
  ZipSecurityError,
  createZip,
  readZip,
  renderSafeMarkdown,
} from '../../packages/market-core/src/authoring/index.ts'

const PNG = (() => {
  const bytes = Buffer.alloc(45)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(1, 16)
  bytes.writeUInt32BE(1, 20)
  bytes.set([8, 6, 0, 0, 0], 24)
  bytes.writeUInt32BE(0, 29)
  bytes.writeUInt32BE(0, 33)
  bytes.write('IEND', 37, 'ascii')
  bytes.writeUInt32BE(0, 41)
  return bytes
})()
const COMMIT = '1234567890abcdef1234567890abcdef12345678'

async function withTemp<T>(prefix: string, action: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), prefix))
  try {
    return await action(root)
  } finally {
    expect(root.startsWith(tmpdir())).toBe(true)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('草稿 revision 与安全 Markdown', () => {
  it('旧 revision 更新被拒绝，不覆盖新内容', async () => {
    await withTemp('eac-author-draft-', async (root) => {
      const now = () => new Date('2026-09-27T00:00:00.000Z')
      const drafts = new AuthorDraftStore(root, { now, idFactory: () => 'draft-one' })
      const first = drafts.create({ title: '第一版', summary: 'a', markdown: '# A', mediaIds: [] })
      const second = drafts.update({ id: first.id, expectedRevision: first.revision, title: '第二版', summary: 'b', markdown: '# B', mediaIds: [] })
      expect(drafts.get(first.id).title).toBe('第二版')
      expect(() => drafts.update({
        id: first.id,
        expectedRevision: first.revision,
        title: '过期覆盖',
        summary: 'c',
        markdown: '# C',
        mediaIds: [],
      })).toThrow(AuthorDraftConflictError)
      expect(drafts.get(first.id)).toMatchObject({ title: '第二版', revision: second.revision })
    })
  })

  it('原始脚本、事件属性和 javascript URL 不会变成活动 HTML', () => {
    const result = renderSafeMarkdown([
      '<script>alert(1)</script>',
      '[点我](javascript:alert(1))',
      '![x](media://img_bad "onerror=alert(1)")',
      '<img src=x onerror=alert(1)>',
    ].join('\n'))
    expect(result.html).not.toContain('<script>')
    expect(result.html).not.toContain('<img src=x')
    expect(result.html).not.toContain('href="javascript:')
    expect(result.warnings.some((item) => item.includes('链接协议已禁用'))).toBe(true)
  })

  it('超过正文上限直接拒绝', () => {
    expect(() => renderSafeMarkdown('abcd', { maxBytes: 3 })).toThrow(MarkdownSecurityError)
  })
})

describe('README 固定 commit 导入', () => {
  it('模拟公开 GitHub Reader 时只请求解析出的完整 commit，并改写相对图片', async () => {
    await withTemp('eac-author-readme-', async (root) => {
      const requests: string[] = []
      const remote = {
        readJson: async (url: string) => {
          requests.push(url)
          if (url.endsWith('/repos/acme/widget')) return { full_name: 'acme/widget', default_branch: 'main', license: { spdx_id: 'MIT' } }
          if (url.endsWith('/commits/main')) return { sha: COMMIT }
          throw new Error(`unexpected json url ${url}`)
        },
        readBytes: async (url: string) => {
          requests.push(url)
          if (url === `https://raw.githubusercontent.com/acme/widget/${COMMIT}/README.md`) {
            return Buffer.from('# Widget\n\n说明。\n\n![logo](docs/logo.png)\n')
          }
          if (url === `https://raw.githubusercontent.com/acme/widget/${COMMIT}/docs/logo.png`) return PNG
          throw new Error(`unexpected bytes url ${url}`)
        },
      }
      const importer = new ReadmeImporter(root, { remote, now: () => new Date('2026-09-27T01:02:03.000Z') })
      const result = await importer.importReadme({ repositoryUrl: 'https://github.com/acme/widget', branch: 'main', path: 'README.md' })
      expect(result.commit).toBe(COMMIT)
      expect(result.draft.sourceCommit).toBe(COMMIT)
      expect(result.draft.markdown).toContain('media://img_')
      expect(result.draft.markdown).not.toContain('](docs/logo.png)')
      expect(result.draft.markdown).toContain('许可证线索：MIT')
      expect(requests.filter((url) => url.includes('/raw.githubusercontent.com/')).every((url) => url.includes(COMMIT))).toBe(true)
    })
  })

  it('相对媒体失败时保留正文并产生 warning，不伪造媒体成功', async () => {
    await withTemp('eac-author-readme-fail-', async (root) => {
      const remote = {
        readJson: async (url: string) => url.endsWith('/commits/main') ? { sha: COMMIT } : { full_name: 'acme/widget', default_branch: 'main' },
        readBytes: async (url: string) => {
          if (url.endsWith('/README.md')) return Buffer.from('# W\n\n![missing](missing.png)\n')
          throw new Error('network unavailable')
        },
      }
      const importer = new ReadmeImporter(root, { remote })
      const result = await importer.importReadme({ repositoryUrl: 'https://github.com/acme/widget' })
      expect(result.draft.markdown).toContain('media://blocked')
      expect(result.mediaWarnings.some((item) => item.includes('相对图片导入失败'))).toBe(true)
    })
  })
})

describe('作者资料 ZIP 往返与恶意归档', () => {
  it('导出导入往返保留正文、来源、许可线索和媒体', async () => {
    await withTemp('eac-author-package-a-', async (rootA) => {
      await withTemp('eac-author-package-b-', async (rootB) => {
        const source = new AuthorPackageService(rootA)
        const media = source.media.save(PNG, 'logo.png')
        const draft = source.drafts.create({
          id: 'roundtrip',
          title: '往返草稿',
          summary: '摘要',
          markdown: '# 标题\n\n![logo](media://x)',
          mediaIds: [media.id],
          sourceCommit: COMMIT,
          sourceUrl: 'https://github.com/acme/widget',
        })
        const archive = source.export(draft.id, { license: 'MIT', commit: COMMIT, repositoryUrl: 'https://github.com/acme/widget' })
        const target = new AuthorPackageService(rootB)
        const imported = target.import(archive, { targetDraftId: draft.id })
        expect(imported.draft).toMatchObject({
          id: 'roundtrip',
          title: '往返草稿',
          summary: '摘要',
          sourceCommit: COMMIT,
          sourceUrl: 'https://github.com/acme/widget',
          mediaIds: [media.id],
        })
        expect(imported.provenance).toMatchObject({ license: 'MIT', commit: COMMIT })
        expect(target.media.get(media.id).bytes).toEqual(PNG)
      })
    })
  })

  it('拒绝路径穿越、符号链接、大小写碰撞和压缩炸弹', async () => {
    const patchName = (zip: Uint8Array, from: string, to: string): Uint8Array => {
      const bytes = Buffer.from(zip)
      let cursor = 0
      while ((cursor = bytes.indexOf(Buffer.from(from), cursor)) >= 0) {
        bytes.write(to, cursor, 'utf8')
        cursor += to.length
      }
      return bytes
    }
    const traversal = patchName(createZip([{ path: 'A.bin', data: Buffer.from('x') }]), 'A.bin', '../x')
    expect(() => readZip(traversal)).toThrow(ZipSecurityError)

    const symlinkBytes = Buffer.from(createZip([{ path: 'A.bin', data: Buffer.from('x') }]))
    const central = symlinkBytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    symlinkBytes.writeUInt32LE((0o120777 << 16) >>> 0, central + 38)
    expect(() => readZip(symlinkBytes)).toThrow(/符号链接/)

    const collisionBytes = Buffer.from(createZip([
      { path: 'A.bin', data: Buffer.from('a') },
      { path: 'B.bin', data: Buffer.from('b') },
    ]))
    const secondLocal = collisionBytes.indexOf(Buffer.from('B.bin'))
    collisionBytes.write('a.bin', secondLocal, 'utf8')
    const secondCentral = collisionBytes.indexOf(Buffer.from('B.bin'), secondLocal + 5)
    collisionBytes.write('a.bin', secondCentral, 'utf8')
    expect(() => readZip(collisionBytes)).toThrow(/大小写碰撞/)

    const bomb = createZip([{ path: 'A.bin', data: Buffer.alloc(20_000) }])
    expect(() => readZip(bomb, { maxCompressionRatio: 2 })).toThrow(/压缩比/)
  })

  it('图片只接受有限位图，SVG 被拒绝', async () => {
    await withTemp('eac-author-media-', async (root) => {
      const media = new MediaStore(root)
      expect(media.save(PNG, '../../logo.png').filename).toBe('.._.._logo.png')
      expect(() => media.save(Buffer.from('<svg onload="alert(1)"></svg>'), 'x.svg')).toThrow(/只允许/)
    })
  })
})
