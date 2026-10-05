import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReadmeImporter, type ReadmeImporterOptions, type RemoteBytesReader } from '../../packages/market-core/src/authoring/readme.ts'

const { request } = vi.hoisted(() => ({ request: vi.fn<typeof fetch>() }))
vi.mock('../../packages/market-core/src/delivery/https-reader.ts', () => ({ desktopHttpsFetch: request }))

const commit = '0123456789abcdef'.repeat(2) + '01234567'
const repoUrl = 'https://api.github.com/repos/acme/widget'
const rawRoot = `https://raw.githubusercontent.com/acme/widget/${commit}/`
const roots: string[] = []
const image = Buffer.from('GIF89a\x01\x00\x01\x00', 'binary')

function contentsUrl(path: string): string {
  return `${repoUrl}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`
}

function fixture(options: ReadmeImporterOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'eac-readme-transport-'))
  roots.push(root)
  const lookup = vi.fn(async (hostname: string) => {
    if (hostname === 'raw.githubusercontent.com') throw new Error('getaddrinfo ENOENT raw.githubusercontent.com')
    return ['93.184.216.34']
  })
  const importer = new ReadmeImporter(root, { ...options, security: { lookup, ...options.security } })
  const reader = Reflect.get(importer, 'remote') as RemoteBytesReader
  request.mockImplementation(async (input) => {
    const url = String(input)
    if (url === repoUrl) return Response.json({ full_name: 'acme/widget', default_branch: 'main', license: { spdx_id: 'MIT' } })
    if (url === `${repoUrl}/commits/main`) return Response.json({ sha: commit })
    if (url === contentsUrl('README.md')) return new Response('# Widget\n\n固定提交的说明。')
    throw new Error(`unexpected request: ${url}`)
  })
  return { root, importer, reader, lookup }
}

function requestedUrls(): string[] {
  return request.mock.calls.map(([input]) => String(input))
}

afterEach(() => {
  request.mockReset()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('README 默认 GitHub transport（合成请求，不代表官方宿主验收）', () => {
  it('raw DNS 不可达时以同仓库/path/完整 SHA 请求 API raw，预览确认不重请求', async () => {
    const { importer, lookup } = fixture()
    const existing = importer.drafts.create({ id: 'existing', title: '旧', summary: '', markdown: '旧正文', mediaIds: [] })
    const originalRequest = request.getMockImplementation()!
    request.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === `${repoUrl}/commits/release%2Fv1`) return Response.json({ sha: commit })
      if (url === contentsUrl('docs/说明 README.md')) return new Response('# Widget\n\n说明。\n\n![logo](../assets/logo.gif)\n\n[guide](./guide.md)')
      if (url === contentsUrl('assets/logo.gif')) return new Response(image)
      return originalRequest(input, init)
    })
    const preview = await importer.previewReadme({ repositoryUrl: 'https://github.com/acme/widget.git/', branch: 'release/v1', path: 'docs/说明 README.md', targetDraftId: existing.id, expectedRevision: existing.revision })
    expect(importer.drafts.get(existing.id)).toEqual(existing)
    expect(preview.commit).toBe(commit)
    expect(preview.candidate.mediaIds).toHaveLength(1)
    expect(preview.candidate.markdown).toContain('media://img_')
    expect(preview.candidate.markdown).toContain(`https://github.com/acme/widget/blob/${commit}/docs/guide.md`)
    expect(preview.mediaWarnings).toEqual([])
    const expectedUrls = [repoUrl, `${repoUrl}/commits/release%2Fv1`, contentsUrl('docs/说明 README.md'), contentsUrl('assets/logo.gif')]
    expect(requestedUrls()).toEqual(expectedUrls)
    expect(lookup.mock.calls.every(([hostname]) => hostname === 'api.github.com')).toBe(true)
    for (const [input, init] of request.mock.calls) {
      const headers = new Headers(init?.headers)
      expect(init).toMatchObject({ method: 'GET', redirect: 'manual' })
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      expect(headers.get('user-agent')).toBe('eac-market-readme-importer')
      expect(headers.get('x-github-api-version')).toBe('2022-11-28')
      expect(headers.get('accept')).toBe(String(input).includes('/contents/') ? 'application/vnd.github.raw+json' : 'application/vnd.github+json')
      expect(headers.has('authorization')).toBe(false)
      expect(headers.has('cookie')).toBe(false)
    }
    const applied = importer.applyReadmePreview({ previewId: preview.previewId, expectedRevision: existing.revision })
    expect(applied.draft.sourceCommit).toBe(commit)
    expect(applied.draft.markdown).toBe(preview.candidate.markdown)
    expect(requestedUrls()).toEqual(expectedUrls)
    expect(() => importer.applyReadmePreview({ previewId: preview.previewId, expectedRevision: existing.revision })).toThrow(/过期/)
    expect(requestedUrls()).toEqual(expectedUrls)
  })

  it('注入 RemoteBytesReader 仍收到固定 SHA raw URL，不改变合成合同', async () => {
    const remote = {
      readJson: vi.fn(async (url: string) => url.includes('/commits/') ? { sha: commit } : { default_branch: 'main' }),
      readBytes: vi.fn(async () => Buffer.from('# Widget\n\n说明。')),
    }
    const { importer } = fixture({ remote })
    const result = await importer.importReadme({ repositoryUrl: 'https://github.com/acme/widget' })
    expect(result.commit).toBe(commit)
    expect(remote.readBytes).toHaveBeenCalledExactlyOnceWith(`${rawRoot}README.md`)
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    'http://github.com/acme/widget', 'https://user:secret@github.com/acme/widget',
    'https://github.com:443/acme/widget', 'https://github.com/acme/widget?ref=main',
    'https://github.com/acme/widget#fragment', 'https://github.com/acme/../widget',
    'https://github.com/acme/%2e%2e/widget', 'https://github.com/acme%2fother/widget',
    'https://github.com/acme%5cother/widget', 'https://github.com//acme/widget',
    'https://github.com/./widget', 'https://github.com/acme/..',
    'https://github.com/acme/widget\n', 'https://github.com.evil.example/acme/widget',
  ])('拒绝不安全仓库坐标且零请求：%s', async (repositoryUrl) => {
    const { importer } = fixture()
    await expect(importer.importReadme({ repositoryUrl })).rejects.toMatchObject({ code: 'readme/invalid-repository' })
    expect(request).not.toHaveBeenCalled()
    expect(importer.drafts.list()).toEqual([])
  })

  it.each([
    `http://raw.githubusercontent.com/acme/widget/${commit}/README.md`,
    `https://user:secret@raw.githubusercontent.com/acme/widget/${commit}/README.md`,
    `https://raw.githubusercontent.com:443/acme/widget/${commit}/README.md`,
    `${rawRoot}README.md?ref=main`, `${rawRoot}README.md#fragment`,
    `${rawRoot}../README.md`, `${rawRoot}docs/../README.md`, `${rawRoot}%2e%2e/README.md`,
    `${rawRoot}docs%2fREADME.md`, `${rawRoot}docs%5cREADME.md`, `${rawRoot}docs%252fREADME.md`,
    `${rawRoot}docs/%252e%252e/README.md`, `${rawRoot}README%3fref=main.md`, `${rawRoot}README%23fragment.md`,
    `${rawRoot}README%00.md`, `${rawRoot}README%.md`, `${rawRoot}README.md\n`, `${rawRoot}/README.md`,
    `https://raw.githubusercontent.com/acme/widget/main/README.md`,
    `https://raw.githubusercontent.com/acme/widget/${commit.slice(0, 7)}/README.md`,
    `https://raw.githubusercontent.com/acme/../${commit}/README.md`,
    `https://raw.githubusercontent.com.evil.example/acme/widget/${commit}/README.md`,
    `https://api.github.com/repos/acme/widget/contents/README.md?ref=${commit}`,
    'https://example.com/README.md',
  ])('默认 bytes reader 不接纳非内部固定坐标：%s', async (url) => {
    const { reader, importer } = fixture()
    await expect(reader.readBytes(url)).rejects.toMatchObject({ name: 'ReadmeImportError' })
    expect(request).not.toHaveBeenCalled()
    expect(importer.drafts.list()).toEqual([])
  })

  it.each(['../README.md', 'docs/../README.md', 'docs/%2e%2e/README.md', 'docs%2fREADME.md', 'docs%252fREADME.md', 'docs\\README.md', 'README.md?ref=main', 'README.md#fragment'])('正文路径拒绝 traversal/encoded delimiter：%s', async (path) => {
    const { importer } = fixture()
    await expect(importer.importReadme({ repositoryUrl: 'https://github.com/acme/widget', path })).rejects.toMatchObject({ code: 'readme/unsafe-path' })
    expect(requestedUrls()).toEqual([repoUrl, `${repoUrl}/commits/main`])
    expect(importer.drafts.list()).toEqual([])
    expect(importer.media.list()).toEqual([])
  })

  it.each(['main', commit.slice(0, 7), `${commit}0`, '../README.md'])('API 未返回完整 SHA 时不读正文：%s', async (sha) => {
    const { importer } = fixture()
    request.mockResolvedValueOnce(Response.json({ default_branch: 'main' })).mockResolvedValueOnce(Response.json({ sha }))
    await expect(importer.importReadme({ repositoryUrl: 'https://github.com/acme/widget' })).rejects.toMatchObject({ code: 'readme/invalid-commit' })
    expect(request).toHaveBeenCalledTimes(2)
    expect(importer.drafts.list()).toEqual([])
  })

  it.each([403, 429, 404, 500])('API HTTP %s 原样失败、不回退 raw、不写目标草稿', async (status) => {
    const { root, importer } = fixture()
    const existing = importer.drafts.create({ id: 'existing', title: '旧', summary: '', markdown: '旧正文', mediaIds: [] })
    const filename = join(root, 'drafts', existing.id, 'draft.json')
    const before = readFileSync(filename)
    const originalRequest = request.getMockImplementation()!
    request.mockImplementation(async (input, init) => String(input).includes('/contents/') ? new Response('真实 HTTP 失败', { status, headers: { 'retry-after': '2' } }) : originalRequest(input, init))
    await expect(importer.previewReadme({ repositoryUrl: 'https://github.com/acme/widget', targetDraftId: existing.id, expectedRevision: existing.revision })).rejects.toMatchObject({ code: 'delivery/http-failed', status, retryAfterMs: 2000 })
    expect(readFileSync(filename)).toEqual(before)
    expect(importer.drafts.list()).toEqual([existing])
    expect(importer.media.list()).toEqual([])
    expect(readdirSync(join(root, 'provenance'))).toEqual([])
    expect(requestedUrls()).toEqual([repoUrl, `${repoUrl}/commits/main`, contentsUrl('README.md')])
  })

  it.each(['readJson', 'readBytes'] as const)('%s 声明和流式体积上限保持有效', async (method) => {
    const { importer, reader } = fixture()
    const limit = method === 'readJson' ? 1024 * 1024 : 8 * 1024 * 1024
    const url = method === 'readJson' ? repoUrl : `${rawRoot}README.md`
    const cancelled = vi.fn()
    request.mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'content-length': String(limit + 1) } }))
    await expect(reader[method](url)).rejects.toMatchObject({ code: 'readme/too-large' })
    expect(cancelled).toHaveBeenCalledTimes(1)
    request.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(limit)); controller.enqueue(new Uint8Array(1)); controller.close() } })))
    await expect(reader[method](url)).rejects.toMatchObject({ code: 'readme/too-large' })
    expect(importer.drafts.list()).toEqual([])
    expect(importer.media.list()).toEqual([])
  })

  it('README 独立字节限额仍阻止写入', async () => {
    const { importer } = fixture({ maxReadmeBytes: 8 })
    await expect(importer.importReadme({ repositoryUrl: 'https://github.com/acme/widget' })).rejects.toMatchObject({ code: 'readme/too-large' })
    expect(importer.drafts.list()).toEqual([])
    expect(importer.media.list()).toEqual([])
  })

  it('相对图片 HTTP 失败仍为真实 warning，不保存失败媒体', async () => {
    const { importer } = fixture()
    const originalRequest = request.getMockImplementation()!
    request.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === contentsUrl('README.md')) return new Response('# Widget\n\n![logo](assets/logo.gif)')
      if (url === contentsUrl('assets/logo.gif')) return new Response('rate limited', { status: 429 })
      return originalRequest(input, init)
    })
    const result = await importer.importReadme({ repositoryUrl: 'https://github.com/acme/widget' })
    expect(result.mediaWarnings.join('\n')).toContain('HTTP 429')
    expect(result.draft.mediaIds).toEqual([])
    expect(result.draft.markdown).toContain('media://blocked')
    expect(result.draft.markdown).not.toContain('media://img_')
    expect(importer.media.list()).toEqual([])
    expect(requestedUrls()).toEqual([repoUrl, `${repoUrl}/commits/main`, contentsUrl('README.md'), contentsUrl('assets/logo.gif')])
  })

  it('相对图片的数量和文件限额仍有效', async () => {
    const { importer } = fixture({ maxMediaFiles: 1 })
    const originalRequest = request.getMockImplementation()!
    request.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === contentsUrl('README.md')) return new Response('# Widget\n\n![first](first.gif)\n![second](second.gif)')
      if (url === contentsUrl('first.gif')) return new Response(image)
      return originalRequest(input, init)
    })
    const result = await importer.importReadme({ repositoryUrl: 'https://github.com/acme/widget' })
    expect(result.draft.mediaIds).toHaveLength(1)
    expect(result.mediaWarnings.join('\n')).toContain('相对图片超过 1 张')
    expect(requestedUrls()).not.toContain(contentsUrl('second.gif'))
    request.mockReset()
    const { importer: limited } = fixture({ media: { maxFileBytes: image.byteLength - 1 } })
    const limitedRequest = request.getMockImplementation()!
    request.mockImplementation(async (input, init) => {
      if (String(input) === contentsUrl('README.md')) return new Response('# Widget\n\n![logo](logo.gif)')
      if (String(input) === contentsUrl('logo.gif')) return new Response(image)
      return limitedRequest(input, init)
    })
    const limitedResult = await limited.importReadme({ repositoryUrl: 'https://github.com/acme/widget' })
    expect(limitedResult.mediaWarnings.join('\n')).toContain('体积超限')
    expect(limitedResult.draft.mediaIds).toEqual([])
    expect(limited.media.list()).toEqual([])
  })

  it('不安全相对图片路径与外部图片不产生新的 API 内容请求', async () => {
    const { importer } = fixture()
    const originalRequest = request.getMockImplementation()!
    request.mockImplementation(async (input, init) => String(input) === contentsUrl('README.md')
      ? new Response('# Widget\n\n![traversal](../escape.gif)\n![encoded](docs%2flogo.gif)\n![nested](docs%252flogo.gif)\n![external](https://example.com/logo.gif)')
      : originalRequest(input, init))
    const result = await importer.importReadme({ repositoryUrl: 'https://github.com/acme/widget' })
    expect(result.draft.mediaIds).toEqual([])
    expect(result.mediaWarnings.join('\n')).toContain('路径不安全')
    expect(importer.media.list()).toEqual([])
    expect(requestedUrls()).toEqual([repoUrl, `${repoUrl}/commits/main`, contentsUrl('README.md')])
  })

  it.each([0, 1])('repository/commit API 阶段 %s 的 HTTP 403 不中途伪造成功', async (stage) => {
    const { importer } = fixture()
    if (stage === 1) request.mockResolvedValueOnce(Response.json({ default_branch: 'main' }))
    request.mockResolvedValueOnce(new Response('forbidden', { status: 403 }))
    await expect(importer.importReadme({ repositoryUrl: 'https://github.com/acme/widget' })).rejects.toMatchObject({ code: 'delivery/http-failed', status: 403 })
    expect(request).toHaveBeenCalledTimes(stage + 1)
    expect(importer.drafts.list()).toEqual([])
    expect(importer.media.list()).toEqual([])
  })

  it('API DNS 解析私网时在请求前阻断', async () => {
    const { reader } = fixture({ security: { lookup: async () => ['127.0.0.1'] } })
    await expect(reader.readBytes(`${rawRoot}README.md`)).rejects.toMatchObject({ code: 'delivery/private-address' })
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['https://127.0.0.1/private', 'https://private.example.test/file', 'http://api.github.com/file', 'https://user:secret@api.github.com/file'])('API 重定向不绕过 SSRF/HTTPS/凭据保护：%s', async (location) => {
    const { reader } = fixture({ security: { lookup: async (hostname) => hostname === 'private.example.test' ? ['10.0.0.1'] : ['93.184.216.34'] } })
    request.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }))
    await expect(reader.readBytes(`${rawRoot}README.md`)).rejects.toMatchObject({ name: 'DeliverySecurityError' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('API 重定向次数仍受限', async () => {
    const { reader } = fixture({ security: { maxRedirects: 0 } })
    request.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: contentsUrl('other.md') } }))
    await expect(reader.readBytes(`${rawRoot}README.md`)).rejects.toMatchObject({ code: 'delivery/too-many-redirects' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('API 等待响应头与流式正文仍有时限', async () => {
    const { reader } = fixture({ security: { timeoutMs: 200, headersTimeoutMs: 10 } })
    request.mockImplementationOnce(async () => new Promise<Response>(() => undefined))
    await expect(reader.readBytes(`${rawRoot}README.md`)).rejects.toMatchObject({ code: 'delivery/headers-timeout' })
    const { reader: bodyReader } = fixture({ security: { timeoutMs: 10 } })
    request.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>()))
    await expect(bodyReader.readBytes(`${rawRoot}README.md`)).rejects.toMatchObject({ code: 'delivery/total-timeout' })
  })
})
