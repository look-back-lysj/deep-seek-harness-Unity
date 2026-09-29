import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { AuthorPackageService, ReadmeImporter, readZip } from '../../packages/market-core/src/authoring/index.ts'

it('Host 传空 provenance 对象导出不会抹掉上次保存的许可与署名', () => {
  const service = new AuthorPackageService(mkdtempSync(join(tmpdir(), 'author-provenance-')))
  const draft = service.drafts.create({ title: '本地无害草稿', summary: '', markdown: 'text', mediaIds: [] })
  service.export(draft.id, { license: 'MIT', attribution: '合成作者', licenseNotice: '保留署名' })
  const entries = readZip(service.export(draft.id, {}))
  const provenance = JSON.parse(Buffer.from(entries.find(entry => entry.path === 'provenance.json')!.data).toString('utf8'))
  expect(provenance).toMatchObject({ license: 'MIT', attribution: '合成作者', licenseNotice: '保留署名' })
  expect(service.drafts.get(draft.id).revision).toBe(draft.revision)
})

it('README 预览不覆盖；确认绑定同一 commit，已改 revision 或重复确认被拒', async () => {
  const root = mkdtempSync(join(tmpdir(), 'author-preview-'))
  let readCount = 0
  const importer = new ReadmeImporter(root, { remote: {
    readJson: async url => url.includes('/commits/') ? { sha: '1'.repeat(40) } : { full_name: 'test/repository', default_branch: 'main', license: { spdx_id: 'MIT' } },
    readBytes: async () => { readCount++; return Buffer.from('# 候选 README\n\n正文') },
  } })
  const current = importer.drafts.create({ id: 'existing', title: '旧', summary: '', markdown: '旧正文', mediaIds: [], pluginId: 'dev.test.alpha', pluginVersion: '1.0.0' }, { license: 'MIT', attribution: '合成署名' })
  const preview = await importer.previewReadme({ repositoryUrl: 'https://github.com/test/repository', targetDraftId: current.id, expectedRevision: current.revision })
  expect(importer.drafts.get(current.id).markdown).toBe('旧正文')
  expect(preview.before?.revision).toBe(current.revision)
  const applied = importer.applyReadmePreview({ previewId: preview.previewId, expectedRevision: current.revision })
  expect(readCount).toBe(1)
  expect(applied.draft).toMatchObject({ pluginId: current.pluginId, pluginVersion: '1.0.0', sourceCommit: '1'.repeat(40) })
  expect(() => importer.applyReadmePreview({ previewId: preview.previewId, expectedRevision: current.revision })).toThrow(/过期/)
  const next = await importer.previewReadme({ repositoryUrl: 'https://github.com/test/repository', targetDraftId: current.id, expectedRevision: applied.draft.revision })
  importer.drafts.update({ ...applied.draft, expectedRevision: applied.draft.revision, title: '手工保存' })
  expect(() => importer.applyReadmePreview({ previewId: next.previewId, expectedRevision: applied.draft.revision })).toThrow(/revision/)
  expect(new AuthorPackageService(root).readProvenance(current.id)).toMatchObject({ license: 'MIT', attribution: '合成署名', commit: '1'.repeat(40) })
})

it('两环境完整草稿/媒体/ZIP往返，越权媒体与过期媒体上传零正文写入', () => {
  const source = new AuthorPackageService(mkdtempSync(join(tmpdir(), 'author-e2e-a-')))
  const target = new AuthorPackageService(mkdtempSync(join(tmpdir(), 'author-e2e-b-')))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvZkAAAAASUVORK5CYII=', 'base64')
  const draft = source.drafts.create({ id: 'roundtrip', title: '图片往返', summary: '', markdown: '# 正文', mediaIds: [] })
  const attached = source.attachMedia(draft.id, draft.revision, png, 'pixel.png')
  expect(() => source.attachMedia(draft.id, draft.revision, png, 'old.png')).toThrow(/revision/)
  const view = source.readMedia(draft.id, attached.media.id)
  expect(Buffer.from(view.data, 'base64')).toEqual(png)
  expect(view).not.toHaveProperty('path')
  const unrelated = source.drafts.create({ title: '无图片', summary: '', markdown: '', mediaIds: [] })
  expect(() => source.readMedia(unrelated.id, attached.media.id)).toThrow(/没有引用/)
  const archive = source.export(draft.id, { license: 'MIT', attribution: '自建测试图' })
  const imported = target.import(archive)
  expect(target.drafts.list()).toHaveLength(1)
  expect(target.drafts.get(imported.draft.id).mediaIds).toEqual([attached.media.id])
  expect(target.readMedia(imported.draft.id, attached.media.id).data).toBe(view.data)
  const again = source.import(target.export(imported.draft.id, {}))
  expect(again.provenance).toMatchObject({ license: 'MIT', attribution: '自建测试图' })
})

it('同一时钟同样正文的重复保存仍递进 revision，不让过期保存再次通过', () => {
  const service = new AuthorPackageService(mkdtempSync(join(tmpdir(), 'author-revision-')), { draft: { now: () => new Date('2026-09-28T00:00:00Z') } })
  const draft = service.drafts.create({ title: '同内容', summary: '', markdown: '', mediaIds: [] })
  const next = service.drafts.update({ ...draft, expectedRevision: draft.revision })
  expect(next.revision).not.toBe(draft.revision)
  expect(() => service.drafts.update({ ...draft, expectedRevision: draft.revision })).toThrow(/revision/)
})
