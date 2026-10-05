import { createHash } from 'node:crypto'
import type { CatalogDisplayMedia, CatalogMedia } from '../contracts/types.ts'

const IMAGE_URL_RE = /^https:\/\/[^\s/@?#\\\x00-\x1f\x7f]+(?:[/?#][^\s<>"{}|\\^`\x00-\x1f\x7f]*)?$/
const THEMES = new Set(['light', 'dark', 'system'])

export function parseAgentForgeMedia(
  value: unknown,
  field: string,
  fail: (code: string, message: string) => never,
  maxPreviews = 12,
): CatalogDisplayMedia {
  function invalid(path: string, reason: string): never {
    return fail('invalid-media', `${path} ${reason}`)
  }

  function object(input: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(path, '必须是对象')
    const record = input as Record<string, unknown>
    if (Object.keys(record).some(key => !keys.includes(key))) invalid(path, '包含未声明的字段')
    return record
  }

  function image(input: unknown, path: string, role: 'icon' | 'preview'): CatalogMedia {
    const record = object(input, path, role === 'icon' ? ['url', 'alt'] : ['url', 'alt', 'theme'])
    const url = record.url
    if (typeof url !== 'string' || Array.from(url).length > 4096 || url.trim() !== url || !IMAGE_URL_RE.test(url)) invalid(`${path}.url`, '必须是至多 4096 字符的无凭据 HTTPS 地址')
    let parsed: URL
    try { parsed = new URL(url) } catch { invalid(`${path}.url`, '不是有效的 HTTPS 地址') }
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) invalid(`${path}.url`, '必须是无凭据 HTTPS 地址')
    const alt = record.alt
    if (typeof alt !== 'string' || !/\S/.test(alt) || Array.from(alt).length > 500) invalid(`${path}.alt`, '必须是至多 500 字符的非空白文本')
    const theme = record.theme
    if (theme !== undefined && (typeof theme !== 'string' || !THEMES.has(theme))) invalid(`${path}.theme`, '必须是 light、dark 或 system')
    const id = `agent-forge.media.${createHash('sha256').update(JSON.stringify([role, url, alt, theme ?? null])).digest('hex')}`
    return { id, sourceUrl: url, alt, ...(theme === undefined ? {} : { theme: theme as NonNullable<CatalogMedia['theme']> }) }
  }

  const record = object(value, field, ['icon', 'previews'])
  if (Object.keys(record).length === 0) invalid(field, '至少需要 icon 或 previews')
  const icon = 'icon' in record ? image(record.icon, `${field}.icon`, 'icon') : undefined
  let previews: CatalogMedia[] | undefined
  if ('previews' in record) {
    if (!Array.isArray(record.previews) || record.previews.length < 1 || record.previews.length > maxPreviews) invalid(`${field}.previews`, `必须是包含 1～${maxPreviews} 项的有序数组`)
    previews = record.previews.map((item, index) => image(item, `${field}.previews[${index}]`, 'preview'))
    if (new Set(previews.map(item => item.id)).size !== previews.length) invalid(`${field}.previews`, '不能包含重复项')
  }
  return { ...(icon === undefined ? {} : { icon }), ...(previews === undefined ? {} : { previews }) }
}
