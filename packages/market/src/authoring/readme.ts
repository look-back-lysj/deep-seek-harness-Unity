/**
 * 公开 GitHub README 导入。
 *
 * 先把分支解析成完整 commit，之后 README 与相对图片都只从该 commit 读取；
 * 不使用 GitHub 登录、cookie 或用户 token。网络失败时保留手动粘贴路径，不伪造导入成功。
 */
import { posix } from 'node:path'
import type { ReadmeImportRequest, ReadmeImportResult } from '../contracts/types.ts'
import { AuthorDraftStore, AuthorDraftConflictError, type DraftStoreOptions } from './drafts.ts'
import { rewriteRelativeLinks } from './markdown.ts'
import { MediaStore, type MediaLimits } from './media.ts'
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
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password) {
    throw new ReadmeImportError('readme/invalid-repository', '只接受无凭据的公开 github.com 仓库地址')
  }
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 2) throw new ReadmeImportError('readme/invalid-repository', '仓库地址必须是 https://github.com/<owner>/<repo>')
  const owner = segments[0] ?? ''
  const repositoryWithSuffix = segments[1] ?? ''
  const repository = repositoryWithSuffix.replace(/\.git$/, '')
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new ReadmeImportError('readme/invalid-repository', '仓库名包含不安全字符')
  }
  return { owner, repository, repositoryUrl: `https://github.com/${owner}/${repository}` }
}

function safeRepoPath(input: string | undefined): string {
  const value = input ?? 'README.md'
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

function defaultRemote(options: RemoteSecurityOptions): RemoteBytesReader {
  return {
    readJson: async (url: string) => {
      const response = await safeFetch(url, { ...options, headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } })
      const bytes = await readResponse(response, 1024 * 1024)
      return JSON.parse(Buffer.from(bytes).toString('utf8'))
    },
    readBytes: async (url: string) => readResponse(await safeFetch(url, options), 8 * 1024 * 1024),
  }
}

async function readResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) throw new ReadmeImportError('readme/too-large', '远程内容声明体积超限')
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

  constructor(root: string, options: ReadmeImporterOptions = {}) {
    this.drafts = new AuthorDraftStore(`${root}/drafts`, options.draft)
    this.media = new MediaStore(`${root}/media`, options.media)
    this.remote = options.remote ?? defaultRemote(options.security ?? {})
    this.maxReadmeBytes = options.maxReadmeBytes ?? 512 * 1024
    this.maxMediaFiles = options.maxMediaFiles ?? 20
    this.now = options.now ?? (() => new Date())
  }

  async importReadme(request: ReadmeImportRequestWithRevision): Promise<ReadmeImportResult> {
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
    for (const relativePath of relativeImages) {
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
        mediaIds.push(stored.id)
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
      ...(request.targetDraftId === undefined ? {} : { id: request.targetDraftId }),
      title: text(repository.full_name ?? coordinates.repository, 'repository name', 200),
      summary: summaryFromMarkdown(markdown),
      markdown: finalMarkdown,
      mediaIds,
      sourceCommit: commit,
      sourceUrl: coordinates.repositoryUrl,
    }
    let draft
    if (request.targetDraftId === undefined) {
      draft = this.drafts.create(input)
    } else {
      if (request.expectedRevision === undefined) throw new ReadmeImportError('readme/revision-required', '更新 README 必须带用户看到的 expectedRevision')
      draft = this.drafts.update({ ...input, id: request.targetDraftId, expectedRevision: request.expectedRevision })
    }
    return {
      draft,
      repositoryUrl: coordinates.repositoryUrl,
      commit,
      importedAt: this.now().toISOString(),
      mediaWarnings,
    }
  }
}

export { AuthorDraftConflictError }
