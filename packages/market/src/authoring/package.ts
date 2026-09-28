/**
 * 介绍资料包导入/导出。
 *
 * 扩展名固定为 .eac-market-presentation.zip；这是作者资料，不是插件安装包，
 * 不包含可执行入口，也不会调用任何包内脚本。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuthorDraft, AuthorDraftInput } from '../contracts/types.ts'
import { AuthorDraftConflictError, AuthorDraftStore, type DraftStoreOptions } from './drafts.ts'
import { MediaStore, type MediaLimits, type StoredMedia } from './media.ts'
import { createZip, readZip, safeZipPath, type ZipEntry, type ZipLimits } from './zip.ts'

export const AUTHOR_EXPORT_FILENAME = 'presentation.eac-market-presentation.zip'

export interface AuthorProvenance {
  readonly repositoryUrl?: string
  readonly commit?: string
  readonly license?: string
  readonly licenseNotice?: string
  readonly notes?: string
  readonly attribution?: string
  readonly licenseUrl?: string
}

export interface AuthorPackageResult {
  readonly draft: AuthorDraft
  readonly provenance: AuthorProvenance
  readonly warnings: readonly string[]
}

/** 有界预览；只返回当前草稿引用的图片，无本机路径。 */
export interface AuthorMediaView extends StoredMedia {
  readonly draftId: string
  readonly data: string
}

export class AuthorPackageError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AuthorPackageError'
    this.code = code
  }
}

interface PresentationDocument {
  readonly schemaVersion: '1'
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly markdown: string
  readonly pluginId?: string
  readonly pluginVersion?: string
  readonly mediaIds: readonly string[]
  readonly sourceCommit?: string
  readonly sourceUrl?: string
  readonly exportedAt: string
}

interface ChecksumDocument {
  readonly schemaVersion: '1'
  readonly algorithm: 'sha256'
  readonly files: Record<string, string>
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function text(value: unknown, field: string, maxBytes: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new AuthorPackageError('author-package/invalid-field', `${field} 无效`)
  }
  return value
}

function parseJson(bytes: Uint8Array, field: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    throw new AuthorPackageError('author-package/invalid-json', `${field} 不是合法 JSON`)
  }
}

function validateProvenance(value: unknown): AuthorProvenance {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new AuthorPackageError('author-package/invalid-provenance', 'provenance.json 结构无效')
  const record = value as Record<string, unknown>
  const repositoryUrlValue = record.repositoryUrl === undefined ? undefined : text(record.repositoryUrl, 'provenance.repositoryUrl', 4_096)
  const commitValue = record.commit === undefined ? undefined : text(record.commit, 'provenance.commit', 64)
  const license = record.license === undefined ? undefined : text(record.license, 'provenance.license', 200)
  const licenseNotice = record.licenseNotice === undefined ? undefined : text(record.licenseNotice, 'provenance.licenseNotice', 4_096, true)
  const notes = record.notes === undefined ? undefined : text(record.notes, 'provenance.notes', 8_192, true)
  const attribution = record.attribution === undefined ? undefined : text(record.attribution, 'provenance.attribution', 4_096, true)
  const licenseUrlValue = record.licenseUrl === undefined ? undefined : text(record.licenseUrl, 'provenance.licenseUrl', 4_096)
  let licenseUrl: string | undefined
  if (licenseUrlValue !== undefined) {
    const url = new URL(licenseUrlValue)
    if (url.protocol !== 'https:' || url.username || url.password) throw new AuthorPackageError('author-package/invalid-source', 'provenance licenseUrl 必须是无凭据 HTTPS')
    licenseUrl = url.href
  }
  let repositoryUrl: string | undefined
  if (repositoryUrlValue !== undefined) {
    const url = new URL(repositoryUrlValue)
    if (url.protocol !== 'https:' || url.username || url.password) throw new AuthorPackageError('author-package/invalid-source', 'provenance URL 必须是无凭据 HTTPS')
    repositoryUrl = url.href
  }
  if (commitValue !== undefined && !/^[0-9a-f]{40}$/.test(commitValue)) throw new AuthorPackageError('author-package/invalid-commit', 'provenance commit 必须完整固定')
  return {
    ...(repositoryUrl === undefined ? {} : { repositoryUrl }),
    ...(commitValue === undefined ? {} : { commit: commitValue }),
    ...(license === undefined ? {} : { license }),
    ...(licenseNotice === undefined ? {} : { licenseNotice }),
    ...(notes === undefined ? {} : { notes }),
    ...(attribution === undefined ? {} : { attribution }),
    ...(licenseUrl === undefined ? {} : { licenseUrl }),
  }
}

export class AuthorPackageService {
  readonly drafts: AuthorDraftStore
  readonly media: MediaStore
  private readonly zipLimits: ZipLimits
  private readonly provenanceDir: string

  constructor(
    root: string,
    options: { readonly draft?: DraftStoreOptions; readonly media?: MediaLimits; readonly zip?: ZipLimits } = {},
  ) {
    this.drafts = new AuthorDraftStore(`${root}/drafts`, options.draft)
    this.media = new MediaStore(`${root}/media`, options.media)
    this.provenanceDir = join(root, 'provenance')
    mkdirSync(this.provenanceDir, { recursive: true })
    this.zipLimits = options.zip ?? {}
  }

  private provenancePath(id: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) throw new AuthorPackageError('author-package/invalid-id', 'draft id 无效')
    return join(this.provenanceDir, `${id}.json`)
  }

  readProvenance(draftId: string): AuthorProvenance {
    const inline = this.drafts.provenance(draftId)
    if (inline !== undefined) return validateProvenance(inline)
    const path = this.provenancePath(draftId)
    if (!existsSync(path)) return {}
    return validateProvenance(JSON.parse(readFileSync(path, 'utf8')))
  }

  private writeProvenance(draftId: string, provenance: AuthorProvenance): void {
    this.drafts.setProvenance(draftId, validateProvenance(provenance))
  }

  export(draftId: string, provenance?: AuthorProvenance): Uint8Array {
    const draft = this.drafts.get(draftId)
    // {} 表示未修改，不能删除历史署名许可；部分覆盖也必须保留未提及的字段。
    const existing = this.readProvenance(draftId)
    const validatedProvenance = validateProvenance({ ...existing, ...validateProvenance(provenance) })
    const presentation: PresentationDocument = {
      schemaVersion: '1',
      id: draft.id,
      title: draft.title,
      summary: draft.summary,
      markdown: draft.markdown,
      ...(draft.pluginId === undefined ? {} : { pluginId: draft.pluginId }),
      ...(draft.pluginVersion === undefined ? {} : { pluginVersion: draft.pluginVersion }),
      mediaIds: draft.mediaIds,
      ...(draft.sourceCommit === undefined ? {} : { sourceCommit: draft.sourceCommit }),
      ...(draft.sourceUrl === undefined ? {} : { sourceUrl: draft.sourceUrl }),
      exportedAt: new Date().toISOString(),
    }
    const entries: ZipEntry[] = [
      { path: 'presentation.json', data: Buffer.from(JSON.stringify(presentation, null, 2), 'utf8') },
      { path: 'README.md', data: Buffer.from(draft.markdown, 'utf8') },
      { path: 'provenance.json', data: Buffer.from(JSON.stringify(validatedProvenance, null, 2), 'utf8') },
    ]
    for (const mediaId of draft.mediaIds) {
      const stored = this.media.get(mediaId)
      entries.push({ path: `media/${stored.metadata.id}.bin`, data: stored.bytes })
    }
    const checksums: ChecksumDocument = {
      schemaVersion: '1',
      algorithm: 'sha256',
      files: Object.fromEntries(entries.map((entry) => [entry.path, sha256(entry.data)])),
    }
    entries.push({ path: 'checksums.json', data: Buffer.from(JSON.stringify(checksums, null, 2), 'utf8') })
    const archive = createZip(entries, this.zipLimits)
    if (JSON.stringify(existing) !== JSON.stringify(validatedProvenance)) this.writeProvenance(draftId, validatedProvenance)
    return archive
  }

  readMedia(draftId: string, mediaId: string): AuthorMediaView {
    const draft = this.drafts.get(draftId)
    if (!draft.mediaIds.includes(mediaId)) throw new AuthorPackageError('author-package/media-not-owned', '草稿没有引用该媒体')
    const stored = this.media.get(mediaId)
    return { draftId, ...stored.metadata, data: Buffer.from(stored.bytes).toString('base64') }
  }

  attachMedia(draftId: string, expectedRevision: string, bytes: Uint8Array, filename: string): { readonly draft: AuthorDraft; readonly media: StoredMedia } {
    const draft = this.drafts.get(draftId)
    if (draft.revision !== expectedRevision) throw new AuthorDraftConflictError(expectedRevision, draft.revision)
    const media = this.media.save(bytes, filename)
    const next = this.drafts.update({ ...draft, expectedRevision, mediaIds: [...new Set([...draft.mediaIds, media.id])] })
    return { draft: next, media }
  }

  /**
   * 导入只产生作者草稿/媒体，不会注册 Delivery、执行脚本或触发安装。
   * targetDraftId + expectedRevision 用于更新；缺 expectedRevision 时只能新建，避免并发覆盖。
   */
  import(
    archive: Uint8Array,
    options: {
      readonly targetDraftId?: string
      readonly expectedRevision?: string
      readonly defaultProvenance?: AuthorProvenance
    } = {},
  ): AuthorPackageResult {
    if (options.targetDraftId !== undefined && options.expectedRevision !== undefined) {
      const current = this.drafts.get(options.targetDraftId)
      if (current.revision !== options.expectedRevision) throw new AuthorDraftConflictError(options.expectedRevision, current.revision)
    }
    const entries = readZip(archive, this.zipLimits)
    const map = new Map(entries.map((entry) => [entry.path, entry.data]))
    const required = ['presentation.json', 'README.md', 'provenance.json', 'checksums.json']
    for (const path of required) if (!map.has(path)) throw new AuthorPackageError('author-package/missing-file', `资料包缺少 ${path}`)
    const allowed = new Set(required)
    for (const entry of entries) {
      if (!allowed.has(entry.path) && !/^media\/img_[a-zA-Z0-9_-]{1,64}\.bin$/.test(safeZipPath(entry.path))) {
        throw new AuthorPackageError('author-package/unexpected-file', `资料包包含不允许的文件 ${entry.path}`)
      }
    }
    const checksumValue = parseJson(map.get('checksums.json') ?? Buffer.alloc(0), 'checksums.json') as ChecksumDocument
    if (!checksumValue || checksumValue.schemaVersion !== '1' || checksumValue.algorithm !== 'sha256' || typeof checksumValue.files !== 'object' || checksumValue.files === null || Array.isArray(checksumValue.files)) {
      throw new AuthorPackageError('author-package/invalid-checksums', 'checksums.json 结构无效')
    }
    for (const [path, expected] of Object.entries(checksumValue.files)) {
      const bytes = map.get(safeZipPath(path))
      if (!bytes || sha256(bytes) !== expected) throw new AuthorPackageError('author-package/checksum-mismatch', `${path} 摘要不符`)
    }
    for (const path of map.keys()) {
      if (path !== 'checksums.json' && checksumValue.files[path] === undefined) {
        throw new AuthorPackageError('author-package/missing-checksum', `${path} 未列入摘要清单`)
      }
    }

    const presentationValue = parseJson(map.get('presentation.json') ?? Buffer.alloc(0), 'presentation.json') as Partial<PresentationDocument>
    if (!presentationValue || presentationValue.schemaVersion !== '1') throw new AuthorPackageError('author-package/schema-mismatch', '不支持的 presentation schemaVersion')
    const markdown = text(presentationValue.markdown, 'presentation.markdown', 512 * 1024, true)
    const readme = Buffer.from(map.get('README.md') ?? Buffer.alloc(0)).toString('utf8')
    if (readme !== markdown) throw new AuthorPackageError('author-package/readme-mismatch', 'README.md 与 presentation.markdown 不一致')
    const sourceCommit = presentationValue.sourceCommit
    if (sourceCommit !== undefined && !/^[0-9a-f]{40}$/.test(sourceCommit)) throw new AuthorPackageError('author-package/invalid-commit', 'sourceCommit 必须完整固定')
    const sourceUrl = presentationValue.sourceUrl
    if (sourceUrl !== undefined) {
      const url = new URL(sourceUrl)
      if (url.protocol !== 'https:' || url.username || url.password) throw new AuthorPackageError('author-package/invalid-source', 'sourceUrl 必须是无凭据 HTTPS')
    }
    if (!Array.isArray(presentationValue.mediaIds)) throw new AuthorPackageError('author-package/invalid-media', 'mediaIds 必须是数组')
    const mediaIds = presentationValue.mediaIds
    if (mediaIds.length > 128 || mediaIds.some((item) => typeof item !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item))) {
      throw new AuthorPackageError('author-package/invalid-media', 'mediaIds 无效')
    }
    const mediaFiles = entries.filter((entry) => entry.path.startsWith('media/'))
    if (mediaFiles.length !== mediaIds.length) throw new AuthorPackageError('author-package/media-mismatch', 'mediaIds 与媒体文件数量不一致')
    if (new Set(mediaIds).size !== mediaIds.length) throw new AuthorPackageError('author-package/media-mismatch', 'mediaIds 重复')
    const savedMedia: StoredMedia[] = []
    for (const entry of mediaFiles) {
      const id = entry.path.slice('media/'.length, -'.bin'.length)
      const stored = this.media.save(entry.data, `${id}.bin`)
      if (stored.id !== id || !mediaIds.includes(id)) throw new AuthorPackageError('author-package/media-id-mismatch', `媒体身份不一致 ${id}`)
      savedMedia.push(stored)
    }

    const provenance = validateProvenance({
      ...(options.defaultProvenance ?? {}),
      ...validateProvenance(parseJson(map.get('provenance.json') ?? Buffer.alloc(0), 'provenance.json')),
    })
    const input: AuthorDraftInput = {
      ...(options.targetDraftId === undefined ? {} : { id: options.targetDraftId }),
      ...(options.expectedRevision === undefined ? {} : { expectedRevision: options.expectedRevision }),
      title: text(presentationValue.title, 'presentation.title', 200),
      summary: text(presentationValue.summary, 'presentation.summary', 512 * 1024, true),
      markdown,
      ...(presentationValue.pluginId === undefined ? {} : { pluginId: text(presentationValue.pluginId, 'presentation.pluginId', 200) }),
      ...(presentationValue.pluginVersion === undefined ? {} : { pluginVersion: text(presentationValue.pluginVersion, 'presentation.pluginVersion', 100) }),
      mediaIds: mediaIds.map((id) => savedMedia.find((item) => item.id === id)?.id ?? id),
      ...(sourceCommit === undefined ? {} : { sourceCommit }),
      ...(sourceUrl === undefined ? {} : { sourceUrl: new URL(sourceUrl).href }),
    }
    const draft = options.targetDraftId !== undefined && options.expectedRevision !== undefined
      ? this.drafts.update({ ...input, id: options.targetDraftId }, provenance)
      : this.drafts.create(input, provenance)
    return { draft, provenance, warnings: [] }
  }
}
