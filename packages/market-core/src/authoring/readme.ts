/**
 * 公开 GitHub README 导入。
 *
 * 先把分支解析成完整 commit，之后 README 与相对图片都只从该 commit 读取；
 * 不使用 GitHub 登录、cookie 或用户 token。网络失败时保留手动粘贴路径，不伪造导入成功。
 */
import { posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AuthorDraft, AuthorDraftInput, ReadmeImportRequest, ReadmeImportResult } from '../contracts/types.ts'
import { AuthorDraftStore, AuthorDraftConflictError, type DraftStoreOptions } from './drafts.ts'
import { rewriteRelativeLinks } from './markdown.ts'
import { MediaStore, type MediaLimits } from './media.ts'
import { AuthorPackageService } from './package.ts'
import { safeFetch, type RemoteSecurityOptions } from '../delivery/security.ts'

export interface RemoteBytesReader {
  readonly readJson: (url: string) => Promise<unknown>
  readonly readBytes: (url: string) => Promise<Uint8Array>
}

export interface ReadmeImporterOptions {
  readonly remote?: RemoteBytesReader
  readonly security?: RemoteSecurityOptions
  readonly draft?: DraftStoreOptions
  readonly media?: MediaLimits
  readonly maxReadmeBytes?: number
  readonly maxMediaFiles?: number
  readonly now?: () => Date
}

export type ReadmeImportRequestWithRevision = ReadmeImportRequest & { readonly expectedRevision?: string | undefined }

export interface ReadmePreview {
  readonly previewId: string
  readonly expiresAt: string
  readonly before?: AuthorDraft
  readonly candidate: AuthorDraftInput
  readonly repositoryUrl: string
  readonly commit: string
  readonly importedAt: string
  readonly mediaWarnings: readonly string[]
}

interface PreparedReadme {
  readonly input: AuthorDraftInput
  readonly before?: AuthorDraft
  readonly repositoryUrl: string
  readonly commit: string
  readonly importedAt: string
  readonly mediaWarnings: readonly string[]
}

export class ReadmeImportError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ReadmeImportError'
    this.code = code
  }
}

interface GithubRepository {
  readonly full_name?: unknown
  readonly default_branch?: unknown
  readonly license?: { readonly spdx_id?: unknown }
}

interface GithubCommit {
  readonly sha?: unknown
}

function text(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new ReadmeImportError('readme/invalid-field', `${field} 无效`)
  }
  return value
}

function githubCoordinates(input: string): { owner: string; repository: string; repositoryUrl: string } {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/i.exec(input)
  if (!match || match[0] !== input) {
    throw new ReadmeImportError('readme/invalid-repository', '只接受无凭据的公开 github.com 仓库地址')
  }
  const owner = match[1] ?? ''
  const repositoryWithSuffix = match[2] ?? ''
  const repository = repositoryWithSuffix.replace(/\.git$/, '')
  if (!repository || [owner, repository].some((segment) => segment === '.' || segment === '..')) {
    throw new ReadmeImportError('readme/invalid-repository', '仓库名包含不安全字符')
  }
  return { owner, repository, repositoryUrl: `https://github.com/${owner}/${repository}` }
}

function safeRepoPath(input: string | undefined): string {
  const value = input ?? 'README.md'
  if (/[\\?#\u0000-\u001f\u007f]/.test(value) || /%(?:25|2e|2f|5c|3f|23|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value) || value.split('/').includes('..')) {
    throw new ReadmeImportError('readme/unsafe-path', 'README 或媒体路径不安全')
  }
  const normalized = posix.normalize(value.replace(/\\/g, '/')).replace(/^\.\//, '')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new ReadmeImportError('readme/unsafe-path', 'README 或媒体路径不安全')
  }
  return normalized
}

function githubContentUrl(input: string): string {
  const match = /^https:\/\/raw\.githubusercontent\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/([0-9a-f]{40})\/([^?#\\\s]+)$/.exec(input)
  if (!match || match[0] !== input) throw new ReadmeImportError('readme/unsafe-url', '只接受固定 commit 的公开 GitHub 文件地址')
  const owner = match[1] ?? ''
  const repository = match[2] ?? ''
  const commit = match[3] ?? ''
  const encodedPath = match[4] ?? ''
  if ([owner, repository].some((segment) => segment === '.' || segment === '..')) {
    throw new ReadmeImportError('readme/unsafe-url', '仓库坐标不安全')
  }
  let path: string
  try { path = decodeURIComponent(encodedPath) }
  catch { throw new ReadmeImportError('readme/unsafe-path', '文件路径编码无效') }
  const safePath = safeRepoPath(path).split('/').map(encodeURIComponent).join('/')
  if (safePath !== encodedPath) throw new ReadmeImportError('readme/unsafe-path', '文件路径编码不安全')
  return `https://api.github.com/repos/${owner}/${repository}/contents/${safePath}?ref=${commit}`
}

function defaultRemote(options: RemoteSecurityOptions): RemoteBytesReader {
  const headers = { 'user-agent': 'eac-market-readme-importer', 'x-github-api-version': '2022-11-28' }
  return {
    readJson: async (url: string) => {
      const response = await safeFetch(url, { ...options, headers: { ...headers, accept: 'application/vnd.github+json' } })
      const bytes = await readResponse(response, 1024 * 1024)
      return JSON.parse(Buffer.from(bytes).toString('utf8'))
    },
    readBytes: async (url: string) => readResponse(await safeFetch(githubContentUrl(url), {
      ...options, headers: { ...headers, accept: 'application/vnd.github.raw+json' },
    }), 8 * 1024 * 1024),
  }
}

async function readResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => undefined)
    throw new ReadmeImportError('readme/too-large', '远程内容声明体积超限')
  }
  const body = response.body as AsyncIterable<Uint8Array> | null
  if (!body) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of body) {
    total += chunk.byteLength
    if (total > maxBytes) throw new ReadmeImportError('readme/too-large', '远程内容体积超限')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks, total)
}

function summaryFromMarkdown(markdown: string): string {
  const paragraph = markdown
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .find((block) => block && !block.startsWith('#') && !block.startsWith('```') && !block.startsWith('>'))
  return (paragraph ?? '').replace(/[*_`[\]]/g, '').slice(0, 300)
}

export class ReadmeImporter {
  readonly drafts: AuthorDraftStore
  readonly media: MediaStore
  private readonly remote: RemoteBytesReader
  private readonly maxReadmeBytes: number
  private readonly maxMediaFiles: number
  private readonly now: () => Date
  private readonly previews = new Map<string, { readonly value: ReadmePreview; readonly prepared: PreparedReadme }>()
  private readonly packages: AuthorPackageService

  constructor(root: string, options: ReadmeImporterOptions = {}) {
    this.packages = new AuthorPackageService(root, { ...(options.draft ? { draft: options.draft } : {}), ...(options.media ? { media: options.media } : {}) })
    this.drafts = this.packages.drafts
    this.media = this.packages.media
    this.remote = options.remote ?? defaultRemote(options.security ?? {})
    this.maxReadmeBytes = options.maxReadmeBytes ?? 512 * 1024
    this.maxMediaFiles = options.maxMediaFiles ?? 20
    this.now = options.now ?? (() => new Date())
  }

  async importReadme(request: ReadmeImportRequestWithRevision): Promise<ReadmeImportResult> {
    return this.applyPrepared(await this.prepare(request))
  }

  /** 只生成差异候选；下载图片可留为无引用缓存，不更改目标正文/revision。 */
  async previewReadme(request: ReadmeImportRequestWithRevision): Promise<ReadmePreview> {
    const prepared = await this.prepare(request)
    for (const [id, entry] of this.previews) if (Date.parse(entry.value.expiresAt) <= this.now().getTime()) this.previews.delete(id)
    if (this.previews.size >= 32) throw new ReadmeImportError('readme/preview-limit', '未完成预览过多，请稍后重试')
    const previewId = randomUUID()
    const value: ReadmePreview = { previewId, expiresAt: new Date(this.now().getTime() + 15 * 60_000).toISOString(), candidate: prepared.input, ...(prepared.before ? { before: prepared.before } : {}), repositoryUrl: prepared.repositoryUrl, commit: prepared.commit, importedAt: prepared.importedAt, mediaWarnings: prepared.mediaWarnings }
    this.previews.set(previewId, { value, prepared })
    return structuredClone(value)
  }

  /** 用户确认后消费同一份候选字节；不重新请求浮动分支。 */
  applyReadmePreview(request: { readonly previewId: string; readonly expectedRevision?: string }): ReadmeImportResult {
    const entry = this.previews.get(request.previewId)
    if (!entry || Date.parse(entry.value.expiresAt) <= this.now().getTime()) throw new ReadmeImportError('readme/preview-expired', '预览不存在或已过期，请重新导入预览')
    if (entry.prepared.before?.revision !== request.expectedRevision) throw new ReadmeImportError('readme/preview-revision', '确认未绑定预览时的目标 revision')
    const result = this.applyPrepared(entry.prepared)
    this.previews.delete(request.previewId)
    return result
  }

  private applyPrepared(prepared: PreparedReadme): ReadmeImportResult {
    const input = prepared.input
    const existing = prepared.before === undefined ? {} : this.packages.readProvenance(prepared.before.id)
    // GitHub API 的 license 只是线索，不能写成已经确认的转载授权。
    const provenance = { ...existing, repositoryUrl: prepared.repositoryUrl, commit: prepared.commit }
    const draft = input.id === undefined ? this.drafts.create(input, provenance) : this.drafts.update({ ...input, id: input.id }, provenance)
    return { draft, repositoryUrl: prepared.repositoryUrl, commit: prepared.commit, importedAt: prepared.importedAt, mediaWarnings: prepared.mediaWarnings }
  }

  private async prepare(request: ReadmeImportRequestWithRevision): Promise<PreparedReadme> {
    // 网络前检查一次，下载后 update 再检查，防止网络期间手工保存被覆盖。
    const target = request.targetDraftId === undefined ? undefined : this.drafts.get(request.targetDraftId)
    if (target !== undefined) {
      if (request.expectedRevision === undefined) throw new ReadmeImportError('readme/revision-required', '更新 README 必须带用户看到的 expectedRevision')
      if (target.revision !== request.expectedRevision) throw new AuthorDraftConflictError(request.expectedRevision, target.revision)
    }
    const coordinates = githubCoordinates(request.repositoryUrl)
    const repoUrl = `https://api.github.com/repos/${coordinates.owner}/${coordinates.repository}`
    const repository = await this.remote.readJson(repoUrl) as GithubRepository
    const branch = request.branch ?? (typeof repository.default_branch === 'string' ? repository.default_branch : undefined)
    if (!branch || branch.length > 200) throw new ReadmeImportError('readme/invalid-branch', '无法确定公开分支')
    const commitValue = await this.remote.readJson(`${repoUrl}/commits/${encodeURIComponent(branch)}`) as GithubCommit
    const commit = typeof commitValue.sha === 'string' ? commitValue.sha : ''
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new ReadmeImportError('readme/invalid-commit', 'GitHub 未返回完整 commit')
    const readmePath = safeRepoPath(request.path)
    const rawRoot = `https://raw.githubusercontent.com/${coordinates.owner}/${coordinates.repository}/${commit}/`
    const readmeBytes = await this.remote.readBytes(new URL(readmePath.split('/').map(encodeURIComponent).join('/'), rawRoot).href)
    if (readmeBytes.byteLength > this.maxReadmeBytes) throw new ReadmeImportError('readme/too-large', 'README 正文超限')
    const markdown = Buffer.from(readmeBytes).toString('utf8')
    const warnings: string[] = []
    const mediaIds: string[] = []
    const replacements = new Map<string, string>()
    const relativeImages = [...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)]
      .map((match) => match[1] ?? '')
      .filter((href) => href && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) && !href.startsWith('/'))
    for (const relativePath of new Set(relativeImages)) {
      if (mediaIds.length >= this.maxMediaFiles) {
        warnings.push(`相对图片超过 ${this.maxMediaFiles} 张，已跳过：${relativePath}`)
        continue
      }
      try {
        const from = posix.dirname(readmePath)
        const mediaPath = safeRepoPath(posix.join(from === '.' ? '' : from, relativePath))
        const mediaUrl = new URL(mediaPath.split('/').map(encodeURIComponent).join('/'), rawRoot).href
        const bytes = await this.remote.readBytes(mediaUrl)
        const stored = this.media.save(bytes, posix.basename(mediaPath))
        if (!mediaIds.includes(stored.id)) mediaIds.push(stored.id)
        replacements.set(relativePath, stored.id)
      } catch (error) {
        warnings.push(`相对图片导入失败：${relativePath}；${error instanceof Error ? error.message : 'unknown error'}`)
      }
    }
    const rewritten = rewriteRelativeLinks(markdown, {
      image: (href) => replacements.get(href),
      link: (href) => {
        try {
          const from = posix.dirname(readmePath)
          const linkedPath = safeRepoPath(posix.join(from === '.' ? '' : from, href))
          return new URL(linkedPath.split('/').map(encodeURIComponent).join('/'), `https://github.com/${coordinates.owner}/${coordinates.repository}/blob/${commit}/`).href
        } catch {
          return undefined
        }
      },
    }, warnings)
    const mediaWarnings = warnings.slice()
    const licenseHint = repository.license?.spdx_id
    const provenanceLines = [
      '',
      '---',
      `> README 导入来源：${coordinates.repositoryUrl}（commit \`${commit}\`）`,
      `> 许可证线索：${typeof licenseHint === 'string' && licenseHint !== 'NOASSERTION' ? licenseHint : '未确认'}；导入不代表已获得转载或再发布授权。`,
    ]
    const finalMarkdown = `${rewritten}${provenanceLines.join('\n')}`
    const input = {
      ...(target?.pluginId === undefined ? {} : { pluginId: target.pluginId }),
      ...(target?.pluginVersion === undefined ? {} : { pluginVersion: target.pluginVersion }),
      ...(request.targetDraftId === undefined ? {} : { id: request.targetDraftId }),
      ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision }),
      title: text(repository.full_name ?? coordinates.repository, 'repository name', 200),
      summary: summaryFromMarkdown(markdown),
      markdown: finalMarkdown,
      mediaIds,
      sourceCommit: commit,
      sourceUrl: coordinates.repositoryUrl,
    }
    return {
      input,
      ...(target === undefined ? {} : { before: target }),
      repositoryUrl: coordinates.repositoryUrl,
      commit,
      importedAt: this.now().toISOString(),
      mediaWarnings,
    }
  }
}

export { AuthorDraftConflictError }
