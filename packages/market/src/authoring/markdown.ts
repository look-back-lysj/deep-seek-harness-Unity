/**
 * Markdown 安全子集。
 *
 * 作者正文是不可信输入。这里只生成固定白名单标签，原始 HTML 一律当文本转义；
 * 链接只允许 https/http/mailto/media，javascript/data/file 等不会成为可点击 URL。
 */
export interface SafeMarkdownResult {
  readonly html: string
  readonly warnings: readonly string[]
}

export class MarkdownSecurityError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MarkdownSecurityError'
    this.code = code
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeUrl(raw: string, image: boolean, warnings: string[], resolveMedia?: (id: string) => string | undefined): string | undefined {
  const value = raw.trim()
  if (image && /^media:\/\/[a-zA-Z0-9_-]+$/.test(value)) {
    const resolved = resolveMedia?.(value.slice('media://'.length))
    if (resolved === undefined) {
      warnings.push(`媒体引用无法解析：${value}`)
      return undefined
    }
    return safeUrl(resolved, true, warnings)
  }
  if (image && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return value
  try {
    const url = new URL(value)
    if (image && url.protocol !== 'https:') {
      warnings.push(`图片只允许 HTTPS 或 media 引用：${value}`)
      return undefined
    }
    if (!image && !['https:', 'http:', 'mailto:'].includes(url.protocol)) {
      warnings.push(`链接协议已禁用：${value}`)
      return undefined
    }
    return url.href
  } catch {
    warnings.push(`相对或无效链接已禁用：${value}`)
    return undefined
  }
}

function inline(value: string, warnings: string[], resolveMedia?: (id: string) => string | undefined): string {
  const protectedSpans: string[] = []
  const withoutCode = value.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const token = `\uE000${protectedSpans.length}\uE001`
    protectedSpans.push(`<code>${escapeHtml(code)}</code>`)
    return token
  })
  const normalized = withoutCode.replace(/[\uE000\uE001\uE002]/g, '\uE002')
  let output = escapeHtml(normalized)
  output = output.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt: string, rawHref: string) => {
    const href = safeUrl(rawHref, true, warnings, resolveMedia)
    if (!href) return `<span class="eac-media-blocked">${alt}</span>`
    const token = `\uE000${protectedSpans.length}\uE001`
    protectedSpans.push(`<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}" loading="lazy">`)
    return token
  })
  output = output.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, text: string, rawHref: string) => {
    const href = safeUrl(rawHref, false, warnings)
    if (!href) return text
    const token = `\uE000${protectedSpans.length}\uE001`
    protectedSpans.push(`<a href="${escapeHtml(href)}" rel="noreferrer noopener" target="_blank">${escapeHtml(text)}</a>`)
    return token
  })
  output = output
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
  return output.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => protectedSpans[Number(index)] ?? '')
}

export function renderSafeMarkdown(markdown: string, options: { readonly maxBytes?: number; readonly resolveMedia?: (id: string) => string | undefined } = {}): SafeMarkdownResult {
  const maxBytes = options.maxBytes ?? 512 * 1024
  if (Buffer.byteLength(markdown, 'utf8') > maxBytes) throw new MarkdownSecurityError('markdown/too-large', 'Markdown 正文超限')
  const warnings: string[] = []
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let inFence = false
  let fence: string[] = []
  let list: 'ul' | 'ol' | undefined
  const closeList = (): void => {
    if (list) html.push(`</${list}>`)
    list = undefined
  }
  for (const line of lines) {
    const fenceMatch = /^\s*```/.exec(line)
    if (fenceMatch) {
      if (inFence) {
        html.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`)
        fence = []
        inFence = false
      } else {
        closeList()
        inFence = true
      }
      continue
    }
    if (inFence) {
      fence.push(line)
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading?.[1] && heading[2]) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2], warnings, options.resolveMedia)}</h${level}>`)
      continue
    }
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (unordered?.[1] || ordered?.[1]) {
      const kind = unordered?.[1] ? 'ul' : 'ol'
      if (list !== kind) {
        closeList()
        html.push(`<${kind}>`)
        list = kind
      }
      html.push(`<li>${inline(unordered?.[1] ?? ordered?.[1] ?? '', warnings, options.resolveMedia)}</li>`)
      continue
    }
    closeList()
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote?.[1] !== undefined) {
      html.push(`<blockquote>${inline(quote[1], warnings, options.resolveMedia)}</blockquote>`)
      continue
    }
    if (line.trim() === '') continue
    html.push(`<p>${inline(line, warnings, options.resolveMedia)}</p>`)
  }
  if (inFence) {
    html.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`)
    warnings.push('未闭合的代码围栏已按代码块安全收尾')
  }
  closeList()
  return { html: html.join('\n'), warnings }
}

/** 导入外部 Markdown 后先把相对图片改写为受控 media://，再做预览。 */
export interface RelativeLinkResolvers {
  readonly image: (path: string) => string | undefined
  readonly link: (path: string) => string | undefined
}

export function rewriteRelativeLinks(
  markdown: string,
  resolve: RelativeLinkResolvers,
  warnings: string[],
): string {
  return markdown
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt: string, href: string) => {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('/')) return match
      const mediaId = resolve.image(href)
      if (!mediaId) {
        warnings.push(`相对图片无法安全解析：${href}`)
        return `![${alt}](media://blocked)`
      }
      return /^media:\/\//.test(mediaId) ? `![${alt}](${mediaId})` : `![${alt}](media://${mediaId})`
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text: string, href: string) => {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('/')) return match
      const resolved = resolve.link(href)
      if (!resolved) {
        warnings.push(`相对链接无法安全解析：${href}`)
        return text
      }
      return `[${text}](${resolved})`
    })
}

export function rewriteRelativeImages(
  markdown: string,
  resolveRelative: (path: string) => string | undefined,
  warnings: string[],
): string {
  return rewriteRelativeLinks(markdown, { image: resolveRelative, link: () => undefined }, warnings)
}
