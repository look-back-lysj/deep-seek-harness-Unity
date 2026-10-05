/**
 * 供货草稿读取（A1）：只读本地文件，不联网、不写入任何正式目录。
 * 上限 8 MiB 来自双方共识 §5.8 的安全边界。
 */
import { readFile, stat } from 'node:fs/promises'

/** 共识 §5.8：供货清单上限 8 MiB。 */
export const SUPPLY_DRAFT_MAX_BYTES = 8 * 1024 * 1024

export interface SupplyDraftRead {
  /** 实际读到的原始字节数。 */
  readonly bytes: number
  /** 完整解析后的 JSON 文档；失败时本函数只抛错，不返回半份结果。 */
  readonly document: unknown
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function readSupplyDraft(path: string): Promise<SupplyDraftRead> {
  if (typeof path !== 'string' || path.trim() === '') throw new Error('供货清单路径为空，未读取任何内容')
  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error('目标不是普通文件')
    size = info.size
  } catch (error) {
    // 不回显完整路径，避免把本机目录结构写进日志或报告。
    throw new Error('供货清单无法访问或不是普通文件：' + reason(error))
  }
  if (size > SUPPLY_DRAFT_MAX_BYTES) {
    throw new Error(`供货清单超过 8 MiB 上限（实际 ${size} 字节），已拒绝读取`)
  }
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (error) {
    throw new Error('供货清单读取失败：' + reason(error))
  }
  if (bytes.byteLength > SUPPLY_DRAFT_MAX_BYTES) {
    throw new Error(`供货清单超过 8 MiB 上限（实际 ${bytes.byteLength} 字节），已拒绝读取`)
  }
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '')
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (error) {
    throw new Error('供货清单不是合法 JSON：' + reason(error))
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('供货清单顶层必须是 JSON 对象')
  }
  return { bytes: bytes.byteLength, document }
}
