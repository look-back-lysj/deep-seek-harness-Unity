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
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new AuthorDraftValidationError('draft/invalid-source-url', 'sourceUrl 必须是无凭据 HTTPS 地址')
    }
  })
  if (!Array.isArray(input.mediaIds) || input.mediaIds.length > 128 || input.mediaIds.some((item) => typeof item !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(item))) {
    throw new AuthorDraftValidationError('draft/invalid-media', 'mediaIds 无效')
  }
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
    mkdirSync(this.root, { recursive: true })
  }

  private draftDir(id: string): string {
    if (!DRAFT_ID_RE.test(id)) throw new AuthorDraftValidationError('draft/invalid-id', 'draft id 无效')
    const path = join(this.root, id)
    if (!pathInside(this.root, path)) throw new AuthorDraftValidationError('draft/unsafe-path', 'draft 路径越界')
    return path
  }

  list(): readonly AuthorDraft[] {
    return readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && DRAFT_ID_RE.test(entry.name))
      .map((entry) => this.get(entry.name))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  get(id: string): AuthorDraft {
    const path = join(this.draftDir(id), 'draft.json')
    const raw = readFileSync(path)
    if (raw.byteLength > this.maxTextBytes + 64 * 1024) throw new AuthorDraftValidationError('draft/too-large', '草稿文件超限')
    const value = JSON.parse(raw.toString('utf8')) as AuthorDraft
    if (value.id !== id || typeof value.revision !== 'string') throw new AuthorDraftValidationError('draft/corrupt', '草稿文件结构无效')
    return value
  }

  create(input: AuthorDraftInput): AuthorDraft {
    const validated = validateInput(input, this.maxTextBytes)
    const id = validated.id ?? this.idFactory()
    const dir = this.draftDir(id)
    if (existsSync(join(dir, 'draft.json'))) {
      throw new AuthorDraftConflictError(validated.expectedRevision, this.get(id).revision)
    }
    if (this.list().length >= this.maxDrafts) throw new AuthorDraftValidationError('draft/too-many', '草稿数量超限')
    mkdirSync(join(dir, 'media'), { recursive: true })
    const draft = draftFromInput({ ...validated, id }, id, this.now().toISOString())
    this.writeAtomic(dir, draft)
    return draft
  }

  update(input: AuthorDraftInput & { readonly id: string }): AuthorDraft {
    const validated = validateInput(input, this.maxTextBytes)
    const dir = this.draftDir(validated.id)
    const currentPath = join(dir, 'draft.json')
    if (!existsSync(currentPath)) return this.create({ ...validated, id: validated.id })
    const current = this.get(validated.id)
    if (validated.expectedRevision !== current.revision) {
      throw new AuthorDraftConflictError(validated.expectedRevision, current.revision)
    }
    const draft = draftFromInput({ ...validated, id: validated.id }, validated.id, this.now().toISOString())
    this.writeAtomic(dir, draft)
    return draft
  }

  delete(id: string, expectedRevision: string): void {
    const dir = this.draftDir(id)
    const current = this.get(id)
    if (current.revision !== expectedRevision) throw new AuthorDraftConflictError(expectedRevision, current.revision)
    rmSync(dir, { recursive: true, force: true })
  }

  mediaDirectory(id: string): string {
    return join(this.draftDir(id), 'media')
  }

  private writeAtomic(dir: string, draft: AuthorDraft): void {
    const path = join(dir, 'draft.json')
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temporary, JSON.stringify(draft, null, 2), { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, path)
  }
}
