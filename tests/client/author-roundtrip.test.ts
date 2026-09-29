import { tmpdir } from 'node:os'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AuthorPackageService } from '../../packages/market-core/src/authoring/package.ts'
import { TransferManager } from '../../packages/market-core/src/authoring/transfer.ts'
import { ReadmeImporter } from '../../packages/market-core/src/authoring/readme.ts'
import { uploadBytes, readTransfer, decodeBase64, sha256Hex } from '../../packages/market/src/client/transfer.ts'
import { draftInput } from '../../packages/market/src/client/AuthorWorkspace.tsx'
import type { MarketRemote } from '../../packages/market/src/client/model.ts'

const output = process.env.EAC_TEST_OUTPUT ?? join(tmpdir(), 'eac-market-tests')
mkdirSync(output, { recursive: true })
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))

describe('Client传输与真实作者库集成（隔离目录，非官方Desktop）', () => {
  it('新建重开→带revision传图片→导出实际ZIP→另一环境导入，不丢来源和媒体', async () => {
    const root = mkdtempSync(join(output, 'author-roundtrip-'))
    const service = new AuthorPackageService(join(root, 'profile-one'))
    const owner = 'client-test'
    const transfer = new TransferManager(join(root, 'transfers'), {
      finisher: async ({ path, request }) => {
        if (!request.targetId || !request.expectedRevision) throw new Error('missing draft binding')
        return service.attachMedia(request.targetId, request.expectedRevision, new Uint8Array(readFileSync(path)), request.filename).media.id
      },
    })
    const remote = {
      transferBegin: async (request) => transfer.begin(request, { ownerId: owner, ...(request.targetId ? { targetId: request.targetId } : {}) }),
      transferChunk: (request) => transfer.writeChunk(owner, request),
      transferRead: async (request) => transfer.readChunk(owner, request.transferId, request.sequence),
      transferDispose: async (request) => { transfer.dispose(owner, request.transferId); return true },
    } as MarketRemote
    let draft = service.drafts.create({ title: '合成作者资料', summary: '用于本地集成测试', markdown: '正文', mediaIds: [] }, { repositoryUrl: 'https://github.com/example/test-fixture', commit: 'a'.repeat(40), attribution: '合成署名', license: 'MIT' })
    const uploaded = await uploadBytes(remote, png, { purpose: 'draft-media', filename: 'test.png', mediaType: 'image/png', targetId: draft.id, expectedRevision: draft.revision })
    draft = service.drafts.get(draft.id)
    expect(draft.mediaIds).toContain(uploaded.resultId)
    draft = service.drafts.update({ ...draftInput(draft), id: draft.id, markdown: `正文\n\n![合成图片](media://${uploaded.resultId})` })
    const preview = service.readMedia(draft.id, uploaded.resultId!)
    expect(`sha256:${await sha256Hex(decodeBase64(preview.data))}`).toBe(preview.sha256)
    const exported = service.export(draft.id)
    const outgoing = transfer.stageOutbound(owner, { purpose: 'author-export', filename: 'presentation.eac-market-presentation.zip', mediaType: 'application/zip' }, exported)
    const received = await readTransfer(remote, outgoing)
    expect(received).toEqual(new Uint8Array(exported))
    writeFileSync(join(root, 'actual-presentation.zip'), received)
    const second = new AuthorPackageService(join(root, 'profile-two'))
    const imported = second.import(received)
    expect(imported.draft.markdown).toBe(draft.markdown)
    expect(imported.provenance.attribution).toBe('合成署名')
    expect(imported.provenance.commit).toBe('a'.repeat(40))
    expect(second.readMedia(imported.draft.id, draft.mediaIds[0]!).sha256).toBe(preview.sha256)
  })
  it('真实README库预览不覆盖，拒绝revision漂移，确认只应用预览时内容', async () => {
    const root = mkdtempSync(join(output, 'readme-preview-'))
    let text = '初次预览正文'
    const importer = new ReadmeImporter(root, { remote: {
      readJson: async (url) => url.includes('/commits/') ? { sha: 'b'.repeat(40) } : { full_name: 'example/test', default_branch: 'main', license: { spdx_id: 'MIT' } },
      readBytes: async () => new TextEncoder().encode(text),
    } })
    let original = importer.drafts.create({ title: '原稿', summary: '旧介绍', markdown: '不应消失的手写内容', mediaIds: [] })
    const preview = await importer.previewReadme({ repositoryUrl: 'https://github.com/example/test', targetDraftId: original.id, expectedRevision: original.revision })
    expect(importer.drafts.get(original.id).markdown).toBe('不应消失的手写内容')
    text = '浮动分支的新内容'
    original = importer.drafts.update({ ...draftInput(original), id: original.id, markdown: '另一窗口的新内容' })
    expect(() => importer.applyReadmePreview({ previewId: preview.previewId, expectedRevision: preview.before!.revision })).toThrow()
    const fresh = await importer.previewReadme({ repositoryUrl: 'https://github.com/example/test', targetDraftId: original.id, expectedRevision: original.revision })
    text = '确认时再次变化'
    const applied = importer.applyReadmePreview({ previewId: fresh.previewId, expectedRevision: original.revision })
    expect(applied.draft.markdown).toContain('浮动分支的新内容')
    expect(applied.draft.markdown).not.toContain('确认时再次变化')
  })
})
