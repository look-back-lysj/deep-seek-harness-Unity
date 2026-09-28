import { useState } from 'react'
import { Button, Input, Modal } from './ui.tsx'
import type {
  CatalogPlugin,
  InventoryItem,
  TransferResult,
} from '../types.ts'
import {
  formatBytes,
  installabilityLabel,
  isInstalled,
  readOnlyLabel,
  summarizeInventory,
  verificationLabel,
  hasCatalogUpdate,
  type MarketRemote,
} from './model.ts'
import { uploadFile } from './transfer.ts'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function toneClass(tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral'): string {
  return tone === 'neutral' ? '' : ` eac-market__status--${tone}`
}

export function Status({ tone = 'neutral', children }: {
  readonly tone?: 'success' | 'info' | 'warning' | 'danger' | 'neutral'
  readonly children: React.ReactNode
}): React.JSX.Element {
  return <span className={`eac-market__status${toneClass(tone)}`}>{children}</span>
}

export function VerificationStatus({ value }: { readonly value: CatalogPlugin['verification'] }): React.JSX.Element {
  const tone = value === 'verified' ? 'success' : value === 'hard-incompatible' ? 'danger' : value === 'unverified' ? 'warning' : 'neutral'
  return <Status tone={tone}>{verificationLabel(value)}</Status>
}

export function EmptyState({ title, description, action }: {
  readonly title: string
  readonly description: string
  readonly action?: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="eac-market__empty">
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  )
}

export function PluginCard({ plugin, inventory, onOpen, onInstall, canInstall = true }: {
  readonly plugin: CatalogPlugin
  readonly inventory: readonly InventoryItem[]
  readonly onOpen: (plugin: CatalogPlugin) => void
  readonly onInstall: (plugin: CatalogPlugin) => void
  readonly canInstall?: boolean
}): React.JSX.Element {
  const installed = isInstalled(inventory, plugin)
  const blocked = !canInstall || plugin.installability !== 'bundle-installable' || plugin.verification === 'hard-incompatible'
  const blockedReason = !canInstall ? '当前市场未提供安装服务' : plugin.verification === 'hard-incompatible' ? '与当前环境已知不兼容，不能安装' : installabilityLabel(plugin.installability)
  return (
    <article className="eac-market__card eac-market__plugin-card">
      <div className="eac-market__plugin-top">
        <span className="eac-market__plugin-icon" aria-hidden="true">{plugin.name.slice(0, 1).toUpperCase()}</span>
        <div className="eac-market__plugin-title">
          <h3 title={plugin.name}>{plugin.name}</h3>
          <p title={`${plugin.author} · ${plugin.packageName}`}>{plugin.author} · {plugin.packageName}</p>
        </div>
      </div>
      <p className="eac-market__plugin-summary">{plugin.summary || '作者尚未提供一句话简介。'}</p>
      {plugin.kind === 'skin' && blocked && <p className="eac-market__usage-guidance">暂不可安装：{blockedReason}。可查看详情中的暂停原因。</p>}
      {plugin.kind === 'skin' && !blocked && plugin.verification === 'unknown' && <p className="eac-market__usage-guidance">兼容状态未知，需要在完整安装方案中明确确认试装。</p>}
      <div className="eac-market__plugin-bottom">
        <div className="eac-market__tags">
          <VerificationStatus value={plugin.verification} />
          {installed !== undefined && <Status tone="success">已安装</Status>}
          {!installed && plugin.installability !== 'bundle-installable' && <Status tone="warning">{installabilityLabel(plugin.installability)}</Status>}
        </div>
        <div className="eac-market__button-row">
          <Button size="sm" onClick={() => onOpen(plugin)}>查看详情</Button>
          <Button
            size="sm"
            variant={blocked || installed !== undefined ? 'outline' : 'primary'}
            disabled={blocked || installed !== undefined}
            title={blocked ? blockedReason : installed !== undefined ? '已安装，请到我的插件管理' : undefined}
            onClick={() => onInstall(plugin)}
          >{installed !== undefined ? '已安装' : blocked ? '暂不可安装' : '查看安装方案'}</Button>
        </div>
      </div>
    </article>
  )
}

export { InstallPlanDialog, planSelectionFor, type PlanTarget } from './InstallPlanDialog.tsx'

export { TaskDrawer } from './TaskDrawer.tsx'

export function InventoryCard({ item, catalogPlugin, onToggle, onRemove, onUpdate, updatePlugin, onOpenOfficialPlugins, busy = false }: {
  readonly item: InventoryItem
  readonly catalogPlugin: CatalogPlugin | undefined
  readonly onToggle: (item: InventoryItem, enabled: boolean) => void
  readonly onRemove: (item: InventoryItem) => void
  readonly onUpdate?: (item: InventoryItem, plugin: CatalogPlugin) => void
  readonly updatePlugin?: CatalogPlugin | undefined
  readonly onOpenOfficialPlugins?: (() => void) | undefined
  readonly busy?: boolean
}): React.JSX.Element {
  const readOnly = readOnlyLabel(item)
  const state = summarizeInventory(item)
  const self = item.packageName === '@dsh-eac/market'
  return (
    <article className="eac-market__card">
      <div className="eac-market__plugin-top">
        <span className="eac-market__plugin-icon" aria-hidden="true">{item.packageName.slice(0, 1).toUpperCase()}</span>
        <div className="eac-market__plugin-title">
          <h3>{catalogPlugin?.name ?? item.packageName}</h3>
          <p>{item.packageName}{item.version === undefined ? '' : ` · ${item.version}`}</p>
        </div>
      </div>
      <p className="eac-market__plugin-summary">{catalogPlugin?.summary ?? '此插件不在当前市场目录中，以下状态来自官方插件管理器。'}</p>
      {catalogPlugin?.requiresSetup === true && <p className="eac-market__usage-guidance">需要设置：请到 DSH 官方插件页，按作者说明完成设置。</p>}
      {self && <p>管理市场自身时，请使用 DSH 侧栏的「插件」页面。</p>}
      {item.rows.some((row) => row.error || row.state === 'unknown') && <details><summary>查看运行诊断</summary><ul>{item.rows.map((row) => <li key={row.id}>{row.name}：{row.error ?? (row.state === 'unknown' ? '运行状态尚未确认' : row.state === 'disabled' ? '已停用' : row.state === 'load-error' ? '加载失败' : '配置启用')}</li>)}</ul></details>}
      <div className="eac-market__plugin-bottom">
        <div className="eac-market__tags">
          <Status tone={state.includes('失败') ? 'danger' : state.includes('启用') ? 'success' : state.includes('重启') ? 'warning' : 'neutral'}>{state}</Status>
          {readOnly && <Status tone="warning">{readOnly}</Status>}
        </div>
        <div className="eac-market__button-row">
          {onOpenOfficialPlugins && <Button size="sm" variant="outline" onClick={onOpenOfficialPlugins}>打开官方插件页</Button>}
          {!self && updatePlugin !== undefined && hasCatalogUpdate(item, updatePlugin) && onUpdate !== undefined && (
            <Button size="sm" variant="primary" onClick={() => onUpdate(item, updatePlugin)}>更新到 {updatePlugin.version}</Button>
          )}
          <Button
            size="sm"
            disabled={busy || self || readOnly !== undefined}
            title={readOnly}
            onClick={() => onToggle(item, !item.bundleEnabled)}
          >{item.bundleEnabled ? '停用' : '启用'}</Button>
          <Button size="sm" variant="outline" disabled={busy || self || !item.removable || readOnly !== undefined} title={item.removable ? undefined : '当前项目不可卸载'} onClick={() => onRemove(item)}>卸载</Button>
        </div>
      </div>
    </article>
  )
}

export function ScreenshotGallery({ screenshots }: { readonly screenshots: CatalogPlugin['screenshots'] }): React.JSX.Element | null {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const [active, setActive] = useState<string | undefined>(undefined)
  if (screenshots.length === 0) return null
  const current = screenshots.find((item) => item.id === active)
  return (
    <>
      <section className="eac-market__section" aria-labelledby="screenshots-title">
        <div className="eac-market__section-head"><h2 id="screenshots-title">真实截图</h2></div>
        <div className="eac-market__gallery">
          {screenshots.map((media) => failed.has(media.id) ? (
            <div className="eac-market__gallery-fallback" key={media.id}>{media.alt}（图片加载失败）</div>
          ) : (
            <button type="button" key={media.id} onClick={() => setActive(media.id)} aria-label={`放大查看：${media.alt}`}>
              <img
                src={media.sourceUrl}
                alt={media.alt}
                loading="lazy"
                width={media.width ?? 800}
                height={media.height ?? 450}
                onError={() => setFailed((value) => new Set(value).add(media.id))}
              />
            </button>
          ))}
        </div>
      </section>
      {current !== undefined && (
        <Modal open onClose={() => setActive(undefined)} title={current.alt} closeLabel="关闭图片">
          <img src={current.sourceUrl} alt={current.alt} style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
        </Modal>
      )}
    </>
  )
}

export function FileTransferField({ remote, purpose, label, accept, onComplete }: {
  readonly remote: MarketRemote
  readonly purpose: 'draft-media' | 'author-import'
  readonly label: string
  readonly accept: string
  readonly onComplete: (result: TransferResult, file: File) => void
}): React.JSX.Element {
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  async function select(file: File | undefined): Promise<void> {
    if (file === undefined) return
    setMessage('')
    setProgress(0)
    try {
      const result = await uploadFile(remote, file, purpose, (received, total) => {
        setProgress(total === 0 ? 100 : Math.round((received / total) * 100))
      })
      setMessage(`已分块接收 ${result.receivedBytes} 字节`)
      onComplete(result, file)
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }
  return (
    <div className="eac-market__field">
      <label>{label}<input type="file" accept={accept} onChange={(event) => void select(event.currentTarget.files?.[0])} /></label>
      {progress > 0 && <div className="eac-market__progress" aria-label={`文件传输进度 ${progress}%`}><div style={{ width: `${progress}%` }} /></div>}
      {message && <small role="status">{message}</small>}
    </div>
  )
}

export function SearchField({ value, onChange }: { readonly value: string; readonly onChange: (value: string) => void }): React.JSX.Element {
  return (
    <div className="eac-market__search">
      <label className="eac-market__sr-only" htmlFor="eac-market-search">搜索功能、插件或作者</label>
      <Input
        id="eac-market-search"
        type="search"
        value={value}
        placeholder="搜索功能、插件或作者…"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  )
}

export function formatTransferStatus(result: TransferResult | undefined): string {
  if (result === undefined) return '尚未传输'
  return result.complete ? `传输完成（${formatBytes(result.receivedBytes)}）` : `部分传输（${formatBytes(result.receivedBytes)}）`
}
