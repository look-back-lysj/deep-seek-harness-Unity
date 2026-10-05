/**
 * 作者草稿 CRUD 与 revision 冲突控制。
 *
 * revision 是并发修改的乐观锁：客户端保存时必须带自己读到的 revision，
 * 不匹配就拒绝写入，避免后一个人默默覆盖前一个人的内容。
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AuthorDraft, AuthorDraftInput } from '../contracts/types.ts'
import type { AuthorProvenance } from './package.ts'
import { parseAuthorJson, parseAuthorUrl, withAuthorStorageError } from './errors.ts'

export interface DraftStoreOptions {
  readonly maxTextBytes?: number
  readonly maxDrafts?: number
  readonly now?: () => Date
  readonly idFactory?: () => string
}

export class AuthorDraftValidationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AuthorDraftValidationError'
    this.code = code
    delete this.stack
  }
}

export class AuthorDraftConflictError extends Error {
  readonly expectedRevision: string | undefined
  readonly actualRevision: string
  constructor(expectedRevision: string | undefined, actualRevision: string) {
    super(`草稿 revision 已变化：expected=${expectedRevision ?? '(none)'}, actual=${actualRevision}`)
    this.name = 'AuthorDraftConflictError'
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
    delete this.stack
  }
}

const DRAFT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/
const COMMIT_RE = /^[0-9a-f]{40}$/
const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function bounded(value: unknown, field: string, maxBytes: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new AuthorDraftValidationError('draft/invalid-field', `${field} 长度或类型无效`)
  }
  return value
}

function optional<T>(value: T | undefined, validate: (item: T) => void): void {
  if (value !== undefined) validate(value)
}

function pathInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..'))
}

function validateInput<T extends AuthorDraftInput>(input: T, maxTextBytes: number): T {
  bounded(input.title, 'title', 200)
  bounded(input.summary, 'summary', maxTextBytes, true)
  bounded(input.markdown, 'markdown', maxTextBytes, true)
  if (input.id !== undefined && !DRAFT_ID_RE.test(input.id)) throw new AuthorDraftValidationError('draft/invalid-id', 'draft id 无效')
  if (input.expectedRevision !== undefined) bounded(input.expectedRevision, 'expectedRevision', 100)
  optional(input.pluginId, (value) => bounded(value, 'pluginId', 200))
  optional(input.pluginVersion, (value) => {
    bounded(value, 'pluginVersion', 100)
    if (!VERSION_RE.test(value)) throw new AuthorDraftValidationError('draft/invalid-version', 'pluginVersion 必须是精确 semver')
  })
  optional(input.sourceCommit, (value) => {
    bounded(value, 'sourceCommit', 40)
    if (!COMMIT_RE.test(value)) throw new AuthorDraftValidationError('draft/invalid-commit', 'sourceCommit 必须是完整40位 commit')
  })
  optional(input.sourceUrl, (value) => {
    bounded(value, 'sourceUrl', 4_096)
    const url = parseAuthorUrl(value, () => new AuthorDraftValidationError('draft/invalid-source-url', 'sourceUrl 必须是无凭据 HTTPS 地址'))
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new AuthorDraftValidationError('draft/invalid-source-url', 'sourceUrl 必须是无凭据 HTTPS 地址')
    }
  })
  if (!Array.isArray(input.mediaIds) || input.mediaIds.length > 128 || input.mediaIds.some((item) => typeof item !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(item))) {
    throw new AuthorDraftValidationError('draft/invalid-media', 'mediaIds 无效')
  }
  if (new Set(input.mediaIds).size !== input.mediaIds.length) throw new AuthorDraftValidationError('draft/duplicate-media', 'mediaIds 不允许重复')
  return input
}

function revisionFor(input: AuthorDraftInput, updatedAt: string): string {
  return `r-${createHash('sha256')
    .update(JSON.stringify({
      title: input.title,
      summary: input.summary,
      markdown: input.markdown,
      pluginId: input.pluginId,
      pluginVersion: input.pluginVersion,
      mediaIds: input.mediaIds,
      sourceCommit: input.sourceCommit,
      sourceUrl: input.sourceUrl,
      updatedAt,
      previousRevision: input.expectedRevision,
    }))
    .digest('hex')
    .slice(0, 16)}`
}

function draftFromInput(input: AuthorDraftInput, id: string, updatedAt: string): AuthorDraft {
  return {
    id,
    revision: revisionFor(input, updatedAt),
    title: input.title,
    summary: input.summary,
    markdown: input.markdown,
    ...(input.pluginId === undefined ? {} : { pluginId: input.pluginId }),
    ...(input.pluginVersion === undefined ? {} : { pluginVersion: input.pluginVersion }),
    mediaIds: input.mediaIds,
    ...(input.sourceCommit === undefined ? {} : { sourceCommit: input.sourceCommit }),
    ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
    updatedAt,
  }
}

export class AuthorDraftStore {
  private readonly root: string
  private readonly maxTextBytes: number
  private readonly maxDrafts: number
  private readonly now: () => Date
  private readonly idFactory: () => string

  constructor(root: string, options: DraftStoreOptions = {}) {
    this.root = resolve(root)
    this.maxTextBytes = options.maxTextBytes ?? 512 * 1024
    this.maxDrafts = options.maxDrafts ?? 2_000
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => randomUUID())
    this.storage(() => mkdirSync(this.root, { recursive: true }))
  }

  private storage<T>(operation: () => T): T {
    return withAuthorStorageError(operation, () => new AuthorDraftValidationError('draft/storage-error', '草稿存储操作失败，请检查存储状态后重试'))
  }

  private draftDir(id: string): string {
    if (!DRAFT_ID_RE.test(id)) throw new AuthorDraftValidationError('draft/invalid-id', 'draft id 无效')
    const path = join(this.root, id)
    if (!pathInside(this.root, path)) throw new AuthorDraftValidationError('draft/unsafe-path', 'draft 路径越界')
    return path
  }

  list(): readonly AuthorDraft[] {
    return this.storage(() => readdirSync(this.root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && DRAFT_ID_RE.test(entry.name))
      .filter((entry) => existsSync(join(this.root, entry.name, 'draft.json')))
      .map((entry) => this.get(entry.name))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  get(id: string): AuthorDraft {
    const value = this.readRecord(id)
    const { provenance: _provenance, ...draft } = value
    return draft
  }

  private readRecord(id: string): AuthorDraft & { provenance?: AuthorProvenance } {
    const path = join(this.draftDir(id), 'draft.json')
    const raw = withAuthorStorageError(() => readFileSync(path), (missing) => new AuthorDraftValidationError(
      missing ? 'draft/not-found' : 'draft/storage-error',
      missing ? '草稿已不存在' : '草稿读取失败，请检查存储状态后重试',
    ))
    if (raw.byteLength > 2 * this.maxTextBytes + 64 * 1024) throw new AuthorDraftValidationError('draft/too-large', '草稿文件超限')
    const value = parseAuthorJson(raw.toString('utf8'), () => new AuthorDraftValidationError('draft/corrupt', '草稿文件不是合法 JSON')) as AuthorDraft & { provenance?: AuthorProvenance }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.id !== id || typeof value.revision !== 'string' || typeof value.updatedAt !== 'string') {
      throw new AuthorDraftValidationError('draft/corrupt', '草稿文件结构无效')
    }
    validateInput(value, this.maxTextBytes)
    return value
  }

  /** provenance 与正文放进同一个原子文件，导入失败不能留下新正文配旧署名。 */
  provenance(id: string): AuthorProvenance | undefined {
    return this.readRecord(id).provenance
  }

  /** 导出参数只改署名材料，不改正文 revision；同一原子文件保留当前正文。 */
  setProvenance(id: string, provenance: AuthorProvenance): void {
    this.writeAtomic(this.draftDir(id), this.get(id), provenance)
  }

  create(input: AuthorDraftInput, provenance?: AuthorProvenance): AuthorDraft {
    const validated = validateInput(input, this.maxTextBytes)
    const id = validated.id ?? this.idFactory()
    const dir = this.draftDir(id)
    if (existsSync(join(dir, 'draft.json'))) {
      throw new AuthorDraftConflictError(validated.expectedRevision, this.get(id).revision)
    }
    if (this.list().length >= this.maxDrafts) throw new AuthorDraftValidationError('draft/too-many', '草稿数量超限')
    this.storage(() => mkdirSync(join(dir, 'media'), { recursive: true }))
    const draft = draftFromInput({ ...validated, id }, id, this.now().toISOString())
    this.writeAtomic(dir, draft, provenance)
    return draft
  }

  update(input: AuthorDraftInput & { readonly id: string }, provenance?: AuthorProvenance): AuthorDraft {
    const validated = validateInput(input, this.maxTextBytes)
    const dir = this.draftDir(validated.id)
    const currentPath = join(dir, 'draft.json')
    if (!existsSync(currentPath)) {
      if (validated.expectedRevision !== undefined) throw new AuthorDraftValidationError('draft/not-found', '草稿已不存在，不能用旧 revision 重新创建')
      return this.create({ ...validated, id: validated.id }, provenance)
    }
    const current = this.get(validated.id)
    if (validated.expectedRevision !== current.revision) {
      throw new AuthorDraftConflictError(validated.expectedRevision, current.revision)
    }
    const draft = draftFromInput({ ...validated, id: validated.id }, validated.id, this.now().toISOString())
    this.writeAtomic(dir, draft, provenance ?? this.provenance(validated.id))
    return draft
  }

  delete(id: string, expectedRevision: string): void {
    const dir = this.draftDir(id)
    const current = this.get(id)
    if (current.revision !== expectedRevision) throw new AuthorDraftConflictError(expectedRevision, current.revision)
    this.storage(() => rmSync(dir, { recursive: true, force: true }))
  }

  mediaDirectory(id: string): string {
    return join(this.draftDir(id), 'media')
  }

  private writeAtomic(dir: string, draft: AuthorDraft, provenance?: AuthorProvenance): void {
    const path = join(dir, 'draft.json')
    const temporary = `${path}.${randomUUID()}.tmp`
    const data = JSON.stringify({ ...draft, ...(provenance === undefined ? {} : { provenance }) }, null, 2)
    this.storage(() => writeFileSync(temporary, data, { encoding: 'utf8', flag: 'wx' }))
    this.storage(() => renameSync(temporary, path))
  }
}
