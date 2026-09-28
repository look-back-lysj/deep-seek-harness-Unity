/** 市场私有资料校验工具。公共格式仍由 public-format 按固定协议解释。 */
import { createHash } from 'node:crypto'
import { CatalogValidationError, type RawDocumentRecord } from './model.ts'

export function invalid(code: string, message: string): never { throw new CatalogValidationError(`catalog/${code}`, message) }
export function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('invalid-field', `${field} 必须是对象`)
  return value as Record<string, unknown>
}
export function string(value: unknown, field: string, max = 4096): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max) invalid('invalid-field', `${field} 必须是非空且有界的字符串`)
  return value
}
export function array(value: unknown, field: string, max = 10000): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid('invalid-field', `${field} 必须是最多 ${max} 项的数组`)
  return value
}
export function integer(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid('invalid-field', `${field} 整数范围无效`)
  return value as number
}
export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') invalid('invalid-field', `${field} 必须是布尔值`)
  return value
}
export function digest(value: unknown, field: string): string {
  const result = string(value, field, 71)
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) invalid('invalid-digest', `${field} 必须是 sha256:<64位小写十六进制>`)
  return result
}
export function exactVersion(value: unknown, field: string): string {
  const result = string(value, field, 100)
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(result)
  if (!match || match[4]?.split('.').some(part => /^0\d+$/.test(part))) invalid('invalid-version', `${field} 必须是精确 SemVer`)
  return result
}
export function timestamp(value: unknown, field: string): string {
  const result = string(value, field, 64)
  // Date.parse 会把 2月30日滚到3月；先独立核对日历，要求带明确时区。
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(result)
  if (!match) invalid('invalid-date', `${field} 必须是带时区的 ISO 时间`)
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  const maxDay = [31, year % 400 === 0 || year % 4 === 0 && year % 100 !== 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
  if (month < 1 || month > 12 || day < 1 || day > maxDay || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 || !Number.isFinite(Date.parse(result))) invalid('invalid-date', `${field} 不是有效日历时间`)
  return new Date(result).toISOString()
}
export function httpsUrl(value: unknown, field: string): string {
  const result = string(value, field)
  let url: URL
  try { url = new URL(result) } catch { return invalid('invalid-url', `${field} URL 无效`) }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) invalid('invalid-url', `${field} 必须是无凭据、无片段 HTTPS URL`)
  return url.href
}
export function relativeFile(value: unknown, field: string): string {
  const path = string(value, field).replace(/^\.\//, '')
  if (path.includes('\\') || path.includes(':') || /[\u0000-\u001f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) invalid('unsafe-path', `${field} 必须是包内相对文件路径`)
  return path
}
export function hash(bytes: string | Uint8Array): string { return `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
export function raw(value: unknown, field: string, maxBytes = 1024 * 1024): { record: RawDocumentRecord; bytes: Buffer } {
  const item = object(value, field)
  const encoded = string(item.contentBase64, `${field}.contentBase64`, Math.ceil(maxBytes / 3) * 4)
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64') !== encoded || bytes.length > maxBytes) invalid('invalid-base64', `${field} 原字节编码无效或超限`)
  const sha256 = digest(item.sha256, `${field}.sha256`)
  if (hash(bytes) !== sha256) invalid('digest-mismatch', `${field} 原字节摘要不符`)
  return { record: { contentBase64: encoded, sha256 }, bytes }
}
export function json(bytes: Uint8Array, field: string): unknown {
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { return invalid('invalid-json', `${field} JSON 无效`) }
}
