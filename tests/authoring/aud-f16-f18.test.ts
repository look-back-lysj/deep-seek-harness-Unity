import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AuthorPackageService,
  ReadmeImporter,
  renderSafeMarkdown,
  rewriteRelativeLinks,
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
  try { return await action(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

describe('AUD-F16 README 新建与 revision 覆盖保护', () => {
  it('更新必须带用户看到的 revision，过期请求不能覆盖保存稿', async () => {
    await withTemp('eac-aud-f16-', async (root) => {
      const remote = {
        readJson: async (url: string) => url.endsWith('/commits/main') ? { sha: COMMIT } : { full_name: 'acme/widget', default_branch: 'main' },
        readBytes: async () => Buffer.from('# New README\n'),
      }
      const importer = new ReadmeImporter(root, { remote })
      const first = await importer.importReadme({ repositoryUrl: 'https://github.com/acme/widget' })
      const staleRevision = first.draft.revision
      importer.drafts.update({
        id: first.draft.id,
        expectedRevision: staleRevision,
        title: '手工修改',
        summary: '手工',
        markdown: '# Manual',
        mediaIds: [],
      })
      await expect(importer.importReadme({
        repositoryUrl: 'https://github.com/acme/widget',
        targetDraftId: first.draft.id,
        expectedRevision: staleRevision,
      } as never)).rejects.toMatchObject({ name: 'AuthorDraftConflictError' })
      expect(importer.drafts.get(first.draft.id).title).toBe('手工修改')
    })
  })
})

describe('AUD-F17 真实 ZIP 往返与 provenance/许可持久化', () => {
  it('导入、修改、再导出仍保留 provenance 与许可证', async () => {
    await withTemp('eac-aud-f17-a-', async (rootA) => {
      await withTemp('eac-aud-f17-b-', async (rootB) => {
        const source = new AuthorPackageService(rootA)
        const media = source.media.save(PNG, 'logo.png')
        const draft = source.drafts.create({
          id: 'zip-roundtrip',
          title: '往返',
          summary: '摘要',
          markdown: '# 往返\n\n![logo](media://img)',
          mediaIds: [media.id],
          sourceCommit: COMMIT,
          sourceUrl: 'https://github.com/acme/widget',
        })
        const archive = source.export(draft.id, {
          repositoryUrl: 'https://github.com/acme/widget',
          commit: COMMIT,
          license: 'MIT',
          licenseNotice: 'Copyright Example',
          notes: '保留署名',
        })
        const archivePath = join(rootA, 'roundtrip.zip')
        writeFileSync(archivePath, archive)
        if (process.env.EAC_7ZIP) execFileSync(process.env.EAC_7ZIP, ['t', archivePath], { stdio: 'pipe' })
        const target = new AuthorPackageService(rootB)
        const imported = target.import(archive, { targetDraftId: 'zip-roundtrip' })
        target.drafts.update({ ...imported.draft, expectedRevision: imported.draft.revision, markdown: '# 修改后' })
        const second = target.export('zip-roundtrip')
        const entries = new Map(Array.from((await import('../../packages/market-core/src/authoring/index.ts')).readZip(second), (entry) => [entry.path, entry.data]))
        const provenance = JSON.parse(Buffer.from(entries.get('provenance.json') ?? Buffer.alloc(0)).toString('utf8'))
        expect(provenance).toMatchObject({ repositoryUrl: 'https://github.com/acme/widget', commit: COMMIT, license: 'MIT', licenseNotice: 'Copyright Example' })
        expect(entries.has(`media/${media.id}.bin`)).toBe(true)
      })
    })
  })
})

describe('AUD-F18 media 与相对链接安全显示', () => {
  it('media 引用可由受控解析器显示，普通相对链接改写为固定 commit URL', () => {
    const rendered = renderSafeMarkdown('# X\n\n![logo](media://img_1)\n\n[guide](docs/guide.md)', {
      resolveMedia: () => 'https://cdn.example.test/img_1.png',
    } as never)
    expect(rendered.html).toContain('https://cdn.example.test/img_1.png')
    expect(rendered.html).not.toContain('media://img_1')
    expect(rewriteRelativeLinks('![logo](docs/logo.png)\n[guide](docs/guide.md)', {
      image: () => 'img_1',
      link: (path) => `https://github.com/acme/widget/blob/${COMMIT}/${path}`,
    }, [])).toContain(`https://github.com/acme/widget/blob/${COMMIT}/docs/guide.md`)
  })
})
