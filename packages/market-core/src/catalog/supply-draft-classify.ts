/**
 * 供货草稿四档分类（A3）：安装候选 / 来源展示 / 资料 / 未解析组合。
 * 纯函数；先做整批校验，结构不通过时不产出任何分类。
 */
import { validateSupplyDraft, type SupplyDraftType } from './supply-draft-validate.ts'

export type SupplyDraftClass = 'install-candidate' | 'source-only' | 'material' | 'unresolved-pack'

export interface SupplyDraftClassifiedItem {
  readonly index: number
  readonly packageName: string
  readonly version: string
  readonly type: SupplyDraftType
  readonly status: string
  readonly class: SupplyDraftClass
  readonly reasons: readonly string[]
}

export interface SupplyDraftClassification {
  readonly ok: boolean
  readonly errors: readonly string[]
  readonly items: readonly SupplyDraftClassifiedItem[]
}

type Writable = Record<string, unknown>

function isObject(value: unknown): value is Writable {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 产物四字段齐全才算"可下载"；任一缺失都只做来源展示，不算拒绝。 */
function artifactReason(item: Writable): string | undefined {
  const artifact = item.artifact
  if (artifact === undefined || artifact === null) return '缺少 artifact，仅展示来源'
  if (!isObject(artifact)) return 'artifact 不是对象，仅展示来源'
  if (typeof artifact.format !== 'string' || artifact.format === '') return 'artifact.format 缺失，仅展示来源'
  if (typeof artifact.downloadUrl !== 'string' || !artifact.downloadUrl.startsWith('https://')) return 'artifact.downloadUrl 不是 HTTPS 直链，仅展示来源'
  if (typeof artifact.sha256 !== 'string' || !/^(?:sha256:)?[0-9a-f]{64}$/u.test(artifact.sha256)) return 'artifact.sha256 不是 64 位小写十六进制，仅展示来源'
  if (typeof artifact.size !== 'number' || !Number.isSafeInteger(artifact.size) || artifact.size <= 0) return 'artifact.size 不是正整数，仅展示来源'
  return undefined
}

export function classifySupplyDraft(document: unknown): SupplyDraftClassification {
  const validation = validateSupplyDraft(document)
  if (!validation.ok) return { ok: false, errors: validation.errors, items: [] }
  const items = (document as Writable).items as readonly unknown[]
  const classified = items.map((raw, index): SupplyDraftClassifiedItem => {
    const item = raw as Writable
    const type = item.type as SupplyDraftType
    const packageName = String(item.packageName)
    const version = String(item.version)
    const status = typeof item.status === 'string' ? item.status : 'active'
    const base = { index, packageName, version, type, status }
    if (type === 'material') {
      return { ...base, class: 'material', reasons: ['资料仅展示与来源访问，任何安装路径都拒绝'] }
    }
    if (status === 'withdrawn') {
      return { ...base, class: 'source-only', reasons: ['记录已撤回，不进入安装路径'] }
    }
    if (type === 'function-pack' || type === 'appearance-pack') {
      return { ...base, class: 'unresolved-pack', reasons: ['组件尚未解析绑定到市场发行，保持薄包与来源展示'] }
    }
    const artifact = artifactReason(item)
    return artifact === undefined
      ? { ...base, class: 'install-candidate', reasons: ['产物四字段齐全，等待我方其余核对'] }
      : { ...base, class: 'source-only', reasons: [artifact] }
  })
  return { ok: true, errors: [], items: classified }
}
