import { createHash } from 'node:crypto'
import * as storage from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AuthorDraftConflictError, AuthorDraftValidationError, AuthorPackageError, AuthorPackageService, MediaValidationError, ZipSecurityError, createZip, readZip } from '../../packages/market-core/src/authoring/index.ts'
import { parseAuthorJson, parseAuthorUrl, withAuthorStorageError } from '../../packages/market-core/src/authoring/errors.ts'
import { MarketRuntime } from '../../packages/market-core/src/host/market-runtime.ts'

vi.mock('node:fs', async (original) => ({ ...await original<typeof import('node:fs')>() }))

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64')
const INPUT = { id: 'draft-one', title: 'first', summary: '', markdown: '# body', mediaIds: [] }

function withStore(action: (service: AuthorPackageService, root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'author-redaction-sensitive-profile-'))
  try {
    action(new AuthorPackageService(root, { draft: { now: () => new Date('2026-10-03T00:00:00Z') } }), root)
  } finally {
    const location = relative(tmpdir(), root)
    if (location.startsWith('..') || isAbsolute(location) || !location.startsWith('author-redaction-sensitive-profile-')) throw new Error('测试目录越界')
    rmSync(root, { recursive: true, force: true })
  }
}

function expectSafe(action: () => unknown, root: string, code: string): void {
  let failure: unknown
  try { action() } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(Error)
  expect(failure).toMatchObject({ code })
  const error = failure as Error
  const output = `${String(error)}\n${error.stack}\n${JSON.stringify(error, Object.getOwnPropertyNames(error))}`
  expect(output).not.toContain(root)
  expect(output).not.toContain(root.replaceAll('\\', '/'))
  expect(output).not.toContain('author-redaction-sensitive-profile-')
  expect(output).not.toMatch(/ENOENT|EISDIR|ENOTDIR|EACCES|EPERM|ENOSPC|EIO|ERR_INVALID_URL/)
  expect(error).not.toHaveProperty('path')
  expect(error).not.toHaveProperty('cause')
  expect(error.stack).toBeUndefined()
}

function archiveWith(service: AuthorPackageService, path: string, contents: string): Uint8Array {
  const entries = readZip(service.export(INPUT.id)).filter((entry) => entry.path !== 'checksums.json')
    .map((entry) => entry.path === path ? { path, data: Buffer.from(contents) } : entry)
  const checksums = { schemaVersion: '1', algorithm: 'sha256', files: Object.fromEntries(entries.map((entry) => [entry.path, `sha256:${createHash('sha256').update(entry.data).digest('hex')}`])) }
  return createZip([...entries, { path: 'checksums.json', data: Buffer.from(JSON.stringify(checksums)) }])
}

describe('作者存储错误边界脱敏', () => {
  it('不存在草稿的读取、删除、媒体读取、provenance 和导出不泄露路径', () => {
    withStore((service, root) => {
      for (const action of [
        () => service.drafts.get('unowned-draft'),
        () => service.readProvenance('unowned-draft'),
        () => service.drafts.delete('unowned-draft', 'old-revision'),
        () => service.readMedia('unowned-draft', 'img_missing'),
        () => service.export('unowned-draft'),
      ]) expectSafe(action, root, 'draft/not-found')
      expect(service.drafts.list()).toEqual([])
    })
  })

  it('实际 Runtime 作者方法的窄边界不启动 Host，也不透传 ENOENT', () => {
    withStore((service, root) => {
      const runtime = Object.assign(Object.create(MarketRuntime.prototype) as MarketRuntime, { authoring: service })
      expectSafe(() => runtime.authorMediaRead({ draftId: 'unowned-draft', mediaId: 'img_missing' }), root, 'draft/not-found')
      expectSafe(() => runtime.authorDraftGet('unowned-draft'), root, 'draft/not-found')
      expectSafe(() => runtime.authorDraftDelete({ id: 'unowned-draft', expectedRevision: 'old-revision' }), root, 'draft/not-found')
      expectSafe(() => runtime.authorExportDraft({ draftId: 'unowned-draft' }), root, 'draft/not-found')
    })
  })

  it.each(['json', 'null', 'array', 'directory'] as const)('草稿损坏 %s 不泄露内容，也不伪造空列表', (damage) => {
    withStore((service, root) => {
      service.drafts.create(INPUT)
      const path = join(root, 'drafts', INPUT.id, 'draft.json')
      if (damage === 'directory') { rmSync(path); mkdirSync(path) }
      else writeFileSync(path, damage === 'json' ? `{"sensitive":"${root.replaceAll('\\', '/')}" invalid}` : damage === 'null' ? 'null' : '[]')
      const code = damage === 'directory' ? 'draft/storage-error' : 'draft/corrupt'
      for (const action of [() => service.drafts.get(INPUT.id), () => service.readProvenance(INPUT.id), () => service.export(INPUT.id), () => service.drafts.list()]) expectSafe(action, root, code)
    })
  })

  it.each(['metadata', 'bytes'] as const)('媒体缺失 %s 在读取、预览、导出与重复保存中保持 not-found', (missing) => {
    withStore((service, root) => {
      const media = service.media.save(PNG, 'image.png')
      service.drafts.create({ ...INPUT, mediaIds: [media.id] })
      const archive = service.export(INPUT.id)
      rmSync(join(root, 'media', `${media.id}.${missing === 'metadata' ? 'json' : 'bin'}`))
      const runtime = Object.assign(Object.create(MarketRuntime.prototype) as MarketRuntime, { authoring: service })
      for (const action of [
        () => service.media.get(media.id),
        () => service.readMedia(INPUT.id, media.id),
        () => service.export(INPUT.id),
        () => runtime.authorMediaRead({ draftId: INPUT.id, mediaId: media.id }),
        ...(missing === 'bytes' ? [() => service.media.save(PNG, 'again.png'), () => service.import(archive)] : []),
      ]) expectSafe(action, root, 'media/not-found')
    })
  })

  it.each(['json', 'null', 'array', 'object', 'invalid-size', 'directory'] as const)('媒体元数据损坏 %s 不泄露解析内容或伪造列表', (damage) => {
    withStore((service, root) => {
      const media = service.media.save(PNG, 'image.png')
      service.drafts.create({ ...INPUT, mediaIds: [media.id] })
      const archive = service.export(INPUT.id)
      const path = join(root, 'media', `${media.id}.json`)
      if (damage === 'directory') { rmSync(path); mkdirSync(path) }
      else writeFileSync(path, damage === 'json' ? `{"sensitive":"${root.replaceAll('\\', '/')}" invalid}` : damage === 'null' ? 'null' : damage === 'array' ? '[]' : damage === 'invalid-size' ? JSON.stringify({ ...media, size: 'sensitive' }) : '{}')
      for (const action of [
        () => service.media.get(media.id),
        () => service.media.list(),
        () => service.media.save(PNG, 'again.png'),
        () => service.readMedia(INPUT.id, media.id),
        () => service.export(INPUT.id),
        () => service.import(archive),
      ]) expectSafe(action, root, damage === 'directory' ? 'media/storage-error' : 'media/corrupt')
    })
  })

  it('媒体二进制读取失败不透传磁盘错误', () => {
    withStore((service, root) => {
      const media = service.media.save(PNG, 'image.png')
      service.drafts.create({ ...INPUT, mediaIds: [media.id] })
      const path = join(root, 'media', `${media.id}.bin`)
      rmSync(path)
      mkdirSync(path)
      expectSafe(() => service.readMedia(INPUT.id, media.id), root, 'media/storage-error')
      expectSafe(() => service.export(INPUT.id), root, 'media/storage-error')
    })
  })

  it.each(['json', 'null', 'array', 'directory'] as const)('旧 provenance 损坏 %s 不回退为空署名', (damage) => {
    withStore((service, root) => {
      service.drafts.create(INPUT)
      expect(service.readProvenance(INPUT.id)).toEqual({})
      const path = join(root, 'provenance', `${INPUT.id}.json`)
      if (damage === 'directory') mkdirSync(path)
      else writeFileSync(path, damage === 'json' ? `{"sensitive":"${root.replaceAll('\\', '/')}" invalid}` : damage === 'null' ? 'null' : '[]')
      const code = damage === 'directory' ? 'author-package/storage-error' : damage === 'json' ? 'author-package/invalid-json' : 'author-package/invalid-provenance'
      expectSafe(() => service.readProvenance(INPUT.id), root, code)
      expectSafe(() => service.export(INPUT.id), root, code)
    })
  })

  it.each(['repositoryUrl', 'licenseUrl'] as const)('provenance %s 非法 URL 在所有入口均为 domain 错误', (field) => {
    withStore((service, root) => {
      const value = `invalid-sensitive:${root} invalid`
      service.drafts.create(INPUT)
      const archive = archiveWith(service, 'provenance.json', JSON.stringify({ [field]: value }))
      expectSafe(() => service.export(INPUT.id, { [field]: value }), root, 'author-package/invalid-source')
      expectSafe(() => service.import(archive), root, 'author-package/invalid-source')
      const validArchive = service.export(INPUT.id)
      expectSafe(() => service.import(validArchive, { defaultProvenance: { [field]: value } }), root, 'author-package/invalid-source')
      writeFileSync(join(root, 'provenance', `${INPUT.id}.json`), JSON.stringify({ [field]: value }))
      expectSafe(() => service.readProvenance(INPUT.id), root, 'author-package/invalid-source')
      expectSafe(() => service.export(INPUT.id), root, 'author-package/invalid-source')
      service.drafts.setProvenance(INPUT.id, { [field]: value })
      expectSafe(() => service.readProvenance(INPUT.id), root, 'author-package/invalid-source')
    })
  })

  it.each(['invalid', 'null', 'object', 'credential', 'protocol'] as const)('资料包 sourceUrl %s 不透传 URL 输入', (kind) => {
    withStore((service, root) => {
      service.drafts.create(INPUT)
      const entries = readZip(service.export(INPUT.id))
      const presentation = JSON.parse(Buffer.from(entries.find((entry) => entry.path === 'presentation.json')!.data).toString('utf8'))
      const sourceUrl = kind === 'null' ? null : kind === 'object' ? { sensitive: root } : kind === 'credential' ? 'https://secret:password@example.test' : kind === 'protocol' ? `file://${root}` : `${root} invalid`
      const archive = archiveWith(service, 'presentation.json', JSON.stringify({ ...presentation, sourceUrl }))
      expectSafe(() => service.import(archive), root, 'author-package/invalid-source')
      expect(service.drafts.list()).toHaveLength(1)
    })
  })

  it.each(['presentation.json', 'provenance.json', 'checksums.json'] as const)('资料包 %s JSON 损坏不透传原文', (path) => {
    withStore((service, root) => {
      service.drafts.create(INPUT)
      const malformed = `{"sensitive":"${root.replaceAll('\\', '/')}" invalid}`
      const archive = path === 'checksums.json'
        ? createZip(readZip(service.export(INPUT.id)).map((entry) => entry.path === path ? { path, data: Buffer.from(malformed) } : entry))
        : archiveWith(service, path, malformed)
      expectSafe(() => service.import(archive), root, 'author-package/invalid-json')
    })
  })

  it.each(['draft', 'media', 'provenance'] as const)('%s 初始化失败被脱敏', (phase) => {
    withStore((_service, root) => {
      const original = storage.mkdirSync
      const target = join(root, phase === 'draft' ? 'drafts' : phase)
      const spy = vi.spyOn(storage, 'mkdirSync').mockImplementation((path, options) => {
        if (resolve(String(path)) === target) throw Object.assign(new Error(`EACCES ${root}`), { code: 'EACCES', path: target })
        return original(path, options as never)
      })
      try {
        expectSafe(() => new AuthorPackageService(root), root, phase === 'draft' ? 'draft/storage-error' : phase === 'media' ? 'media/storage-error' : 'author-package/storage-error')
      } finally { spy.mockRestore() }
    })
  })

  it.each(['temporary', 'rename', 'metadata'] as const)('媒体 %s 写入失败被脱敏且不伪造成功', (phase) => {
    withStore((service, root) => {
      const original = storage.writeFileSync
      const spy = phase === 'rename'
        ? vi.spyOn(storage, 'renameSync').mockImplementationOnce(() => { throw Object.assign(new Error(`EPERM ${root}`), { code: 'EPERM', path: root }) })
        : vi.spyOn(storage, 'writeFileSync').mockImplementation((path, data, options) => {
          if (phase === 'temporary' || String(path).endsWith('.json')) throw Object.assign(new Error(`ENOSPC ${root}`), { code: 'ENOSPC', path: root })
          return original(path, data, options)
        })
      try { expectSafe(() => service.media.save(PNG, 'image.png'), root, 'media/storage-error') }
      finally { spy.mockRestore() }
      expect(service.media.list()).toEqual([])
    })
  })

  it.each(['draft', 'media'] as const)('%s 列表磁盘错误不能被吞成空列表', (kind) => {
    withStore((service, root) => {
      const spy = vi.spyOn(storage, 'readdirSync').mockImplementationOnce(() => { throw Object.assign(new Error(`EIO ${root}`), { code: 'EIO', path: root }) })
      try { expectSafe(() => kind === 'draft' ? service.drafts.list() : service.media.list(), root, `${kind}/storage-error`) }
      finally { spy.mockRestore() }
    })
  })

  it.each(['write', 'rename', 'delete', 'mkdir'] as const)('草稿 %s 原生存储错误仍在原窄边界脱敏', (phase) => {
    withStore((service, root) => {
      const draft = service.drafts.create(INPUT)
      const method = phase === 'write' ? 'writeFileSync' : phase === 'rename' ? 'renameSync' : phase === 'delete' ? 'rmSync' : 'mkdirSync'
      const spy = vi.spyOn(storage, method).mockImplementationOnce(() => { throw Object.assign(new Error(`EACCES ${root}`), { code: 'EACCES', path: root }) })
      try {
        expectSafe(() => phase === 'delete'
          ? service.drafts.delete(INPUT.id, draft.revision)
          : phase === 'mkdir'
            ? service.drafts.create({ ...INPUT, id: 'other' })
            : service.drafts.update({ ...draft, expectedRevision: draft.revision, title: 'changed' }), root, 'draft/storage-error')
      } finally { spy.mockRestore() }
      expect(service.drafts.get(INPUT.id)).toEqual(draft)
    })
  })

  it('旧 provenance 在存在检查后被删除不伪造空资料', () => {
    withStore((service, root) => {
      service.drafts.create(INPUT)
      writeFileSync(join(root, 'provenance', `${INPUT.id}.json`), '{}')
      const original = storage.readFileSync
      const spy = vi.spyOn(storage, 'readFileSync').mockImplementation((path, options) => {
        if (String(path).includes('provenance')) throw Object.assign(new Error(`ENOENT ${root}`), { code: 'ENOENT', path: root })
        return original(path, options as never)
      })
      try { expectSafe(() => service.readProvenance(INPUT.id), root, 'author-package/storage-error') }
      finally { spy.mockRestore() }
    })
  })

  it('validation、ownership、digest、数量与 revision 冲突保持原语义', () => {
    withStore((service, root) => {
      const draft = service.drafts.create(INPUT)
      expectSafe(() => service.drafts.create({ ...INPUT, id: '../outside' }), root, 'draft/invalid-id')
      expectSafe(() => service.drafts.create({ ...INPUT, id: 'other', sourceUrl: `${root} invalid` }), root, 'draft/invalid-source-url')
      expectSafe(() => service.media.get('../outside'), root, 'media/invalid-id')
      expectSafe(() => service.media.save(Buffer.alloc(0), 'empty'), root, 'media/size')
      expectSafe(() => service.media.save(Buffer.from('<svg/>'), 'bad.svg'), root, 'media/type')
      expectSafe(() => service.readMedia(INPUT.id, 'img_missing'), root, 'author-package/media-not-owned')
      const media = service.media.save(PNG, 'image.png')
      writeFileSync(join(root, 'media', `${media.id}.json`), JSON.stringify({ ...media, sha256: 'sha256:wrong' }))
      expectSafe(() => service.media.get(media.id), root, 'media/digest-mismatch')
      const limited = new AuthorPackageService(root, { media: { maxFiles: 1 } })
      const otherImage = Buffer.from(PNG)
      otherImage[otherImage.length - 1] = 0
      expectSafe(() => limited.media.save(otherImage, 'other.png'), root, 'media/total-limit')
      const archive = archiveWith(service, 'provenance.json', '{}')
      for (const action of [
        () => service.drafts.create(INPUT),
        () => service.drafts.update({ ...draft, expectedRevision: 'stale' }),
        () => service.drafts.delete(INPUT.id, 'stale'),
        () => service.attachMedia(INPUT.id, 'stale', PNG, 'image.png'),
        () => service.import(archive, { targetDraftId: INPUT.id, expectedRevision: 'stale' }),
      ]) {
        try { action(); expect.fail('必须拒绝 revision 冲突') }
        catch (error) {
          expect(error).toBeInstanceOf(AuthorDraftConflictError)
          expect(error).toMatchObject({ actualRevision: draft.revision })
          expect((error as Error).stack).toBeUndefined()
        }
      }
      expect(service.drafts.get(INPUT.id)).toEqual(draft)
    })
  })

  it('存储与解析 helper 不吞业务异常，也不改异常身份', () => {
    const failures = [
      new AuthorDraftValidationError('draft/invalid-field', '业务验证'),
      new AuthorDraftConflictError('old', 'new'),
      new MediaValidationError('media/type', '业务验证'),
      new AuthorPackageError('author-package/media-not-owned', '归属错误'),
      new ZipSecurityError('zip/path', '安全拒绝'),
      new Error('非存储程序错误'),
      Object.assign(new Error('带业务 code'), { code: 'business/rejected' }),
      Object.assign(new TypeError('参数类型错误'), { code: 'ERR_INVALID_ARG_TYPE' }),
    ]
    const expectIdentity = (action: () => unknown, failure: Error): void => {
      let caught: unknown
      try { action() } catch (error) { caught = error }
      expect(caught).toBe(failure)
    }
    const unrelatedUrlError = Object.assign(new TypeError('存储边界外的 URL 错误'), { code: 'ERR_INVALID_URL' })
    const unrelatedFactory = vi.fn(() => new Error('不能替换'))
    expectIdentity(() => withAuthorStorageError(() => { throw unrelatedUrlError }, unrelatedFactory), unrelatedUrlError)
    expect(unrelatedFactory).not.toHaveBeenCalled()
    for (const failure of failures) {
      const factory = vi.fn(() => new Error('不能替换'))
      expectIdentity(() => withAuthorStorageError(() => { throw failure }, factory), failure)
      expect(factory).not.toHaveBeenCalled()
      const parse = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => { throw failure })
      try { expectIdentity(() => parseAuthorJson('{}', factory), failure) }
      finally { parse.mockRestore() }
      expectIdentity(() => parseAuthorUrl({ toString: () => { throw failure } } as never, factory), failure)
      expect(factory).not.toHaveBeenCalled()
    }
  })
})
