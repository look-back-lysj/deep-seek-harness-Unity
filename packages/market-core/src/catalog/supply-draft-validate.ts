/**
 * 供货草稿校验（A2）：Schema 层 + 语义层两段式纯函数。
 * 只使用双方共识已定字段；不联网、不读写目录、不做"更严"的私有规则。
 */
import { validVersion } from '../core/semver.ts'

/** 一期接受的类型白名单；`skill` 明确不收，未知类型整批拒绝。 */
export const SUPPLY_DRAFT_TYPES = ['plugin', 'skin', 'material', 'function-pack', 'appearance-pack'] as const
export type SupplyDraftType = typeof SUPPLY_DRAFT_TYPES[number]

export const SUPPLY_DRAFT_SCHEMA_VERSION = 'supply.eac/v1'

const MATERIAL_FIELDS = ['artifact', 'components', 'execution'] as const
const COVERAGES = ['unknown', 'partial', 'complete'] as const

export interface SupplyDraftValidation {
  readonly ok: boolean
  readonly errors: readonly string[]
}

type Writable = Record<string, unknown>

function isObject(value: unknown): value is Writable {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Schema 层：结构、版本号、来源标识、条目数组与类型白名单。 */
export function validateSupplyDraftSchema(document: unknown): SupplyDraftValidation {
  const errors: string[] = []
  if (!isObject(document)) return { ok: false, errors: ['清单顶层必须是 JSON 对象'] }
  if (document.schemaVersion !== SUPPLY_DRAFT_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须是 ${SUPPLY_DRAFT_SCHEMA_VERSION}`)
  }
  if (typeof document.sourceId !== 'string' || document.sourceId.trim() === '') {
    errors.push('sourceId 必须是非空字符串')
  }
  if (!Array.isArray(document.items)) {
    errors.push('items 必须是数组')
    return { ok: false, errors }
  }
  document.items.forEach((item, index) => {
    if (!isObject(item)) {
      errors.push(`第 ${index + 1} 条必须是 JSON 对象`)
      return
    }
    const type = item.type
    if (typeof type !== 'string' || !(SUPPLY_DRAFT_TYPES as readonly string[]).includes(type)) {
      errors.push(`第 ${index + 1} 条类型 ${JSON.stringify(type)} 不在一期供货类型白名单内，整批拒绝`)
    }
  })
  return { ok: errors.length === 0, errors }
}

function validateExecution(item: Writable, label: string, errors: string[]): void {
  const execution = item.execution
  if (execution === undefined || execution === null) return
  if (!isObject(execution)) {
    errors.push(`${label} 的 execution 必须是对象`)
    return
  }
  if (typeof execution.coverage !== 'string' || !(COVERAGES as readonly string[]).includes(execution.coverage)) {
    errors.push(`${label} 的 execution.coverage 只能是 unknown / partial / complete`)
  }
  if (!Array.isArray(execution.edges)) {
    errors.push(`${label} 的 execution.edges 必须是数组`)
    return
  }
  const edges = execution.edges
  if (edges.length === 0) return
  const components = item.components
  if (!Array.isArray(components)) {
    errors.push(`${label} 带执行边，但缺少 components 组件列表`)
    return
  }
  const ids = new Set<string>()
  for (const component of components) {
    if (isObject(component) && typeof component.id === 'string') ids.add(component.id)
  }
  const graph = new Map<string, string[]>()
  for (const [position, edge] of edges.entries()) {
    if (!isObject(edge)) {
      errors.push(`${label} 的第 ${position + 1} 条执行边必须是对象`)
      continue
    }
    const from = edge.prerequisiteId
    const to = edge.consumerId
    if (typeof from !== 'string' || !ids.has(from)) {
      errors.push(`${label} 的第 ${position + 1} 条执行边引用了不存在的组件 ${JSON.stringify(from)}`)
      continue
    }
    if (typeof to !== 'string' || !ids.has(to)) {
      errors.push(`${label} 的第 ${position + 1} 条执行边引用了不存在的组件 ${JSON.stringify(to)}`)
      continue
    }
    if (from === to) {
      errors.push(`${label} 的执行边不允许自依赖：${from}`)
      continue
    }
    graph.set(to, [...(graph.get(to) ?? []), from])
  }
  if (errors.length > 0) return
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false
    if (visited.has(id)) return true
    visiting.add(id)
    for (const next of graph.get(id) ?? []) if (!visit(next)) return false
    visiting.delete(id)
    visited.add(id)
    return true
  }
  for (const id of graph.keys()) {
    if (!visit(id)) {
      errors.push(`${label} 的执行边存在循环依赖`)
      return
    }
  }
}

/** 语义层：唯一键、精确版本、资料字段约束、兼容依据、执行图引用与成环。 */
export function validateSupplyDraftSemantics(document: unknown): SupplyDraftValidation {
  if (!isObject(document) || !Array.isArray(document.items)) {
    return { ok: false, errors: ['结构未通过校验，未执行语义检查'] }
  }
  const errors: string[] = []
  const seen = new Map<string, number>()
  document.items.forEach((raw, index) => {
    if (!isObject(raw)) return
    const label = `第 ${index + 1} 条`
    const packageName = raw.packageName
    const version = raw.version
    if (typeof packageName !== 'string' || packageName.trim() === '') errors.push(`${label} 缺少 packageName`)
    if (typeof version !== 'string' || !validVersion(version)) {
      errors.push(`${label} 的 version ${JSON.stringify(version)} 不是精确 SemVer（禁止 latest 与版本范围）`)
    }
    if (typeof packageName === 'string' && typeof version === 'string') {
      const key = `${packageName}@${version}`
      const prior = seen.get(key)
      if (prior !== undefined) errors.push(`${label} 与第 ${prior + 1} 条身份重复：${key}`)
      else seen.set(key, index)
    }
    if (raw.type === 'material') {
      if (raw.installable !== false) errors.push(`${label} 是 material，installable 必须为 false`)
      for (const field of MATERIAL_FIELDS) {
        if (raw[field] !== undefined) errors.push(`${label} 是 material，禁止携带 ${field}`)
      }
    }
    if ('requiresDsh' in raw && raw.requiresDsh === null && raw.compatibilityBasis !== 'unknown') {
      errors.push(`${label} 的 requiresDsh 为 null 时 compatibilityBasis 必须是 unknown`)
    }
    if (raw.type !== 'material') validateExecution(raw, label, errors)
  })
  return { ok: errors.length === 0, errors }
}

/** 两层连跑：Schema 不过就不做语义检查，避免对畸形结构乱下结论。 */
export function validateSupplyDraft(document: unknown): SupplyDraftValidation {
  const schema = validateSupplyDraftSchema(document)
  if (!schema.ok) return schema
  return validateSupplyDraftSemantics(document)
}
