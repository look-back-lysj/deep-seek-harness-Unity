import { useId, useState } from 'react'
import type { CatalogMedia, CatalogPlugin } from '../types.ts'
import { Button, Modal } from './ui.tsx'

export function safeMediaSource(value: unknown): string | undefined {
  if (typeof value !== 'string' || Array.from(value).length > 4096 || value.trim() !== value || /[\u0000-\u0020\u007f\\]/u.test(value)) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '' ? value : undefined
  } catch {
    return undefined
  }
}

export function CatalogMediaIcon({ name, media }: {
  readonly name: string
  readonly media?: CatalogMedia | undefined
}): React.JSX.Element {
  const source = safeMediaSource(media?.sourceUrl)
  return (
    <span className="eac-market__plugin-icon eac-market__media-icon" aria-hidden="true">
      {source === undefined ? name.slice(0, 1).toUpperCase() : (
        <IconImage key={JSON.stringify([media?.id, source])} source={source} alt={media?.alt ?? name} name={name} />
      )}
    </span>
  )
}

function IconImage({ source, alt, name }: { readonly source: string; readonly alt: string; readonly name: string }): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <>
      {!loaded && name.slice(0, 1).toUpperCase()}
      {!failed && <img src={source} alt={alt} hidden={!loaded} width={44} height={44} decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => { setLoaded(false); setFailed(true) }} />}
    </>
  )
}

function MediaThemeDeclaration({ media }: { readonly media: CatalogMedia }): React.JSX.Element | null {
  if (media.theme !== 'light' && media.theme !== 'dark' && media.theme !== 'system') return null
  return <span className="eac-market__media-theme">声明主题：{media.theme}</span>
}

export function ScreenshotFailure({ media, onRetry }: {
  readonly media: CatalogMedia
  readonly onRetry: (media: CatalogMedia) => void
}): React.JSX.Element {
  const validSource = safeMediaSource(media.sourceUrl) !== undefined
  return (
    <div className="eac-market__gallery-fallback" role="status">
      <svg className="eac-market__fallback-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
        <path d="m6.5 16 3.2-3.2 2.2 2.2 1.7-1.7 3.9 3.9M8 8.5h.01M4 4l16 16" />
      </svg>
      <div className="eac-market__fallback-copy">
        <strong>{validSource ? '截图加载失败' : '预览地址不可用'}</strong>
        <span>{media.alt}</span>
        <span>{validSource ? '图片来源暂时无法读取。可重试；不会用占位图替代上游图片。' : '仅加载无凭据的 HTTPS 图片地址。'}</span>
        <MediaThemeDeclaration media={media} />
        <small>来源：<span className="eac-market__fallback-source">{validSource ? media.sourceUrl : '地址不符合客户端安全要求'}</span></small>
      </div>
      {validSource && <Button size="sm" variant="outline" aria-label={'重试加载截图：' + media.alt} onClick={() => onRetry(media)}>重试加载</Button>}
    </div>
  )
}

function MediaPreview({ media }: { readonly media: CatalogMedia }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [active, setActive] = useState(false)
  const source = safeMediaSource(media.sourceUrl)
  function fail(): void {
    setActive(false)
    setFailed(true)
  }
  function retry(): void {
    setFailed(false)
    setAttempt(value => value + 1)
  }
  if (source === undefined || failed) return <ScreenshotFailure media={media} onRetry={retry} />
  return (
    <div className="eac-market__media-preview">
      <button type="button" onClick={() => setActive(true)} aria-label={'放大查看：' + media.alt}>
        <img key={attempt} src={source} alt={media.alt} loading="lazy" referrerPolicy="no-referrer" width={media.width ?? 800} height={media.height ?? 450} onError={fail} />
      </button>
      <MediaThemeDeclaration media={media} />
      {active && (
        <Modal open onClose={() => setActive(false)} title={media.alt} closeLabel="关闭图片">
          <MediaThemeDeclaration media={media} />
          <img className="eac-market__media-enlarged" src={source} alt={media.alt} referrerPolicy="no-referrer" onError={fail} style={{ width: '100%', height: 'auto', maxHeight: '70vh', objectFit: 'contain' }} />
        </Modal>
      )}
    </div>
  )
}

export function ScreenshotGallery({ screenshots, title = '预览图片' }: {
  readonly screenshots: CatalogPlugin['screenshots']
  readonly title?: string
}): React.JSX.Element | null {
  const headingId = useId()
  if (screenshots.length === 0) return null
  return (
    <section className="eac-market__section" aria-labelledby={headingId}>
      <div className="eac-market__section-head"><h2 id={headingId}>{title}</h2></div>
      <p className="eac-market__media-disclaimer">图片与主题由上游声明，仅供展示，不代表审核结论、真实验收或核心兼容性。</p>
      <div className="eac-market__gallery">
        {screenshots.map((media, index) => <MediaPreview key={JSON.stringify([index, media.id, media.sourceUrl])} media={media} />)}
      </div>
    </section>
  )
}
