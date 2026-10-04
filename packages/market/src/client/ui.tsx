import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'

export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar'

type MagnetFrame = { x: number; y: number } | undefined
const magnetButtons = new Set<HTMLButtonElement>()
let magnetListenersOn = false
let magnetFrame = 0
let magnetPoint: MagnetFrame
function magnetCapable(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  return true
}
function paintMagnets(): void {
  magnetFrame = 0
  const point = magnetPoint
  for (const el of magnetButtons) {
    const blocked = point === undefined || !el.isConnected || el.disabled || el.getAttribute('aria-busy') === 'true'
    if (blocked) {
      el.style.transform = ''
      el.removeAttribute('data-magnet')
      continue
    }
    const rect = el.getBoundingClientRect()
    const dx = point.x - (rect.left + rect.width / 2)
    const dy = point.y - (rect.top + rect.height / 2)
    const distance = Math.hypot(dx, dy)
    const radius = Math.hypot(rect.width, rect.height) / 2
    if (distance < 1 || distance > radius + 40) {
      el.style.transform = ''
      el.removeAttribute('data-magnet')
      continue
    }
    const pull = Math.min(3, 3 * (distance / Math.max(radius, 1)))
    const nx = dx / distance
    const ny = dy / distance
    el.style.transform = `translate(${(nx * pull).toFixed(2)}px, ${(ny * pull).toFixed(2)}px)`
    el.setAttribute('data-magnet', 'on')
  }
}
function scheduleMagnets(): void {
  if (magnetFrame === 0 && typeof requestAnimationFrame === 'function') magnetFrame = requestAnimationFrame(paintMagnets)
}
function handleMagnetPointer(event: PointerEvent): void {
  magnetPoint = { x: event.clientX, y: event.clientY }
  scheduleMagnets()
}
function clearMagnetPoint(): void {
  magnetPoint = undefined
  scheduleMagnets()
}
function bindMagnets(): void {
  if (magnetListenersOn) return
  document.addEventListener('pointermove', handleMagnetPointer, { passive: true })
  document.addEventListener('pointerleave', clearMagnetPoint)
  magnetListenersOn = true
}
function unbindMagnets(): void {
  if (!magnetListenersOn) return
  document.removeEventListener('pointermove', handleMagnetPointer)
  document.removeEventListener('pointerleave', clearMagnetPoint)
  magnetListenersOn = false
}

export function Button({ variant = 'ghost', size = 'md', className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant
  readonly size?: 'sm' | 'md'
}): React.JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const el = buttonRef.current
    if (!el || variant !== 'primary' || size !== 'md' || !magnetCapable()) return
    const engage = (): void => {
      magnetButtons.add(el)
      bindMagnets()
      scheduleMagnets()
    }
    const release = (): void => {
      magnetButtons.delete(el)
      el.style.transform = ''
      el.removeAttribute('data-magnet')
      if (magnetButtons.size === 0) unbindMagnets()
    }
    el.addEventListener('pointerenter', engage)
    el.addEventListener('pointerleave', release)
    return () => {
      el.removeEventListener('pointerenter', engage)
      el.removeEventListener('pointerleave', release)
      release()
    }
  }, [variant, size])
  return <button ref={buttonRef} type="button" className={`eac-button eac-button--${variant} eac-button--${size} ${className}`.trim()} {...rest}>{children}</button>
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return <input className={`eac-input ${className}`.trim()} {...rest} />
}

export function Tag({ tone = 'outline', className = '', children }: {
  readonly tone?: 'outline' | 'solid' | 'neutral' | 'quiet' | 'success' | 'info' | 'warning' | 'danger'
  readonly className?: string
  readonly children?: ReactNode
}): React.JSX.Element {
  return <span className={`eac-tag eac-tag--${tone} ${className}`.trim()}>{children}</span>
}

export function Pill({ active = false, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly active?: boolean
}): React.JSX.Element {
  return <button type="button" aria-pressed={active} className={`eac-pill ${active ? 'eac-pill--active' : ''} ${className}`.trim()} {...rest}>{children}</button>
}

export function Modal({ open, onClose, title, description, children, footer, closeLabel, className = '', contentClassName = '' }: {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly description?: string
  readonly children?: ReactNode
  readonly footer?: ReactNode
  readonly closeLabel: string
  readonly className?: string
  readonly contentClassName?: string
}): React.JSX.Element | null {
  const cardRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    if (!open) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const card = cardRef.current
    const first = card?.querySelector<HTMLElement>('[data-modal-autofocus]:not([disabled]), button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]')
    ;(first ?? card)?.focus()
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
      }
      if (event.key !== 'Tab' || card === null) return
      const focusable = [...card.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]')]
      if (focusable.length === 0) { event.preventDefault(); card.focus(); return }
      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      if (firstEl === undefined || lastEl === undefined) return
      if (!card.contains(document.activeElement)) { event.preventDefault(); firstEl.focus() }
      else if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault()
        lastEl.focus()
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      returnFocus.current?.focus()
    }
  }, [open])
  if (!open) return null
  return (
    <div className="eac-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <div className={`eac-modal ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} {...(description === undefined ? {} : { 'aria-describedby': descriptionId })} tabIndex={-1} ref={cardRef}>
        <div className="eac-modal__head">
          <div><h2 id={titleId}>{title}</h2>{description !== undefined && <p id={descriptionId}>{description}</p>}</div>
          <Button variant="ghost" aria-label={closeLabel} onClick={onClose}>关闭</Button>
        </div>
        <div className={`eac-modal__content ${contentClassName}`.trim()}>{children}</div>
        {footer !== undefined && <div className="eac-modal__footer">{footer}</div>}
      </div>
    </div>
  )
}

function safeHref(value: string): string | undefined {
  return /^https?:\/\//i.test(value) ? value : undefined
}

function inlineNodes(text: string, keyPrefix: string, mediaUrls: Readonly<Record<string, string>>): readonly ReactNode[] {
  const pattern = /(!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*)/g
  const output: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) output.push(text.slice(cursor, match.index))
    const key = `${keyPrefix}-${match.index}`
    if (match[1]?.startsWith('!') === true) {
      const mediaId = /^media:\/\/([a-zA-Z0-9_-]+)$/.exec(match[3] ?? '')?.[1]
      const href = mediaId === undefined ? undefined : mediaUrls[mediaId]
      output.push(href === undefined
        ? <span key={key}>图片未载入：{match[2] || '作者图片'}（需受控媒体）</span>
        : <img key={key} src={href} alt={match[2] ?? ''} loading="lazy" />)
    } else if (match[4] !== undefined && match[5] !== undefined) {
      const href = safeHref(match[5])
      output.push(href === undefined
        ? <span key={key}>{match[4]}</span>
        : <a key={key} href={href} target="_blank" rel="noreferrer">{match[4]}</a>)
    } else if (match[6] !== undefined) {
      output.push(<code key={key}>{match[6]}</code>)
    } else if (match[7] !== undefined) {
      output.push(<strong key={key}>{match[7]}</strong>)
    }
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) output.push(text.slice(cursor))
  return output
}

function CodeBlock({ code }: { readonly code: string }): React.JSX.Element {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function copy(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) await navigator.clipboard.writeText(code)
      else {
        const field = document.createElement('textarea')
        field.value = code
        field.setAttribute('readonly', '')
        field.style.position = 'fixed'
        field.style.opacity = '0'
        document.body.append(field)
        field.select()
        if (!document.execCommand('copy')) throw new Error('clipboard-unavailable')
        field.remove()
      }
      setCopyState('copied')
      globalThis.setTimeout(() => setCopyState('idle'), 1500)
    } catch {
      setCopyState('failed')
      globalThis.setTimeout(() => setCopyState('idle'), 2500)
    }
  }
  return (
    <div className="eac-code">
      <div className="eac-code__bar"><span>示例</span><Button size="sm" variant="ghost" onClick={() => void copy()}>{copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败，请手动选择' : '复制代码'}</Button></div>
      <pre><code>{code}</code></pre>
    </div>
  )
}

export function MarkdownText({ text, labels, mediaUrls = {} }: {
  readonly text: string
  readonly labels: unknown
  readonly mediaUrls?: Readonly<Record<string, string>>
}): React.JSX.Element {
  void labels
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | undefined
  let code: string[] | undefined
  function flushParagraph(): void {
    if (paragraph.length === 0) return
    const content = paragraph.join(' ')
    blocks.push(<p key={`p-${blocks.length}`}>{inlineNodes(content, `p-${blocks.length}`, mediaUrls)}</p>)
    paragraph = []
  }
  function flushList(): void {
    if (list === undefined) return
    const items = list.items.map((item, index) => <li key={index}>{inlineNodes(item, `li-${blocks.length}-${index}`, mediaUrls)}</li>)
    blocks.push(list.ordered ? <ol key={`l-${blocks.length}`}>{items}</ol> : <ul key={`l-${blocks.length}`}>{items}</ul>)
    list = undefined
  }
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (code === undefined) {
        flushParagraph(); flushList(); code = []
      } else {
        blocks.push(<CodeBlock key={`c-${blocks.length}`} code={code.join('\n')} />)
        code = undefined
      }
      continue
    }
    if (code !== undefined) { code.push(line); continue }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    const unordered = /^\s*[-*]\s+(.+)$/.exec(line)
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line)
    if (heading !== null) {
      flushParagraph(); flushList()
      const level = heading[1]?.length ?? 1
      const content = inlineNodes(heading[2] ?? '', `h-${blocks.length}`, mediaUrls)
      blocks.push(level === 1 ? <h1 key={`h-${blocks.length}`}>{content}</h1>
        : level === 2 ? <h2 key={`h-${blocks.length}`}>{content}</h2>
          : level === 3 ? <h3 key={`h-${blocks.length}`}>{content}</h3>
            : <h4 key={`h-${blocks.length}`}>{content}</h4>)
    } else if (unordered !== null || ordered !== null) {
      flushParagraph()
      const orderedList = ordered !== null
      const item = (orderedList ? ordered?.[1] : unordered?.[1]) ?? ''
      if (list?.ordered !== orderedList) flushList()
      list = { ordered: orderedList, items: [...(list?.items ?? []), item] }
    } else if (line.trim() === '') {
      flushParagraph(); flushList()
    } else {
      flushList()
      paragraph.push(line.trim())
    }
  }
  if (code !== undefined) blocks.push(<CodeBlock key={`c-${blocks.length}`} code={code.join('\n')} />)
  flushParagraph(); flushList()
  return <>{blocks}</>
}
