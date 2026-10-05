import { useId, useState } from 'react'
import { Button, Input } from './ui.tsx'
import { CatalogMediaIcon } from './media.tsx'
import type {
  CatalogPlugin,
  InventoryItem,
  TransferResult,
} from '../types.ts'
import {
  formatBytes,
  isInstalled,
  pluginActionState,
  isSystemInventoryItem,
  readOnlyLabel,
  summarizeInventory,
  verificationLabel,
  hasCatalogUpdate,
  type MarketRemote,
} from './model.ts'
import { uploadFile } from './transfer.ts'

export { CatalogMediaIcon, ScreenshotFailure, ScreenshotGallery } from './media.tsx'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function toneClass(tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral'): string {
  return tone === 'neutral' ? '' : ` eac-market__status--${tone}`
}

/** 状态标签始终携带文字；颜色只增强语义，不能成为唯一线索。 */
export function Status({ tone = 'neutral', children }: {
  readonly tone?: 'success' | 'info' | 'warning' | 'danger' | 'neutral'
  readonly children: React.ReactNode
}): React.JSX.Element {
  return <span className={`eac-market__status${toneClass(tone)}`} data-tone={tone}>{children}</span>
}

export function VerificationStatus({ value }: { readonly value: CatalogPlugin['verification'] }): React.JSX.Element {
  const tone = value === 'verified' ? 'success' : value === 'hard-incompatible' ? 'danger' : 'neutral'
  return <Status tone={tone}>{verificationLabel(value)}</Status>
}

export function EmptyState({ title, description, action }: {
  readonly title: string
  readonly description: string
  readonly action?: React.ReactNode
}): React.JSX.Element {
  const headingId = useId()
  return (
    <section className="eac-market__empty" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  )
}

export function PluginCard({ plugin, inventory, onOpen, onInstall, onManage, canInstall = true }: {
  readonly plugin: CatalogPlugin
  readonly inventory: readonly InventoryItem[]
  readonly onOpen: (plugin: CatalogPlugin) => void
  readonly onInstall: (plugin: CatalogPlugin) => void
  /** 已安装且主控接好管理入口时启用；缺入口时保留原有 disabled“已安装”。 */
  readonly onManage?: (() => void) | undefined
  readonly canInstall?: boolean
}): React.JSX.Element {
  const actionReasonId = useId()
  const installed = isInstalled(inventory, plugin)
  const action = pluginActionState(plugin, inventory, { canInstall, canManage: onManage !== undefined })
  const actionReason = action.reason
  const canManage = action.kind === 'manage' && onManage !== undefined
  return (
    <article className="eac-market__card eac-market__plugin-card">
      <div className="eac-market__plugin-top">
        <CatalogMediaIcon name={plugin.name} media={plugin.media?.icon} />
        <div className="eac-market__plugin-title">
          <h3 title={plugin.name}>{plugin.name}</h3>
          <p title={`${plugin.author} · ${plugin.packageName}`}>{plugin.author} · {plugin.packageName}</p>
        </div>
      </div>
      <p className="eac-market__plugin-summary">{plugin.summary || '作者尚未提供一句话简介。'}</p>
      {plugin.kind === 'skin' && !action.disabled && plugin.verification === 'unknown' && (
        <p className="eac-market__usage-guidance">兼容状态未知；安装结果由官方安装器和上游插件负责。</p>
      )}
      <div className="eac-market__plugin-bottom">
        <div className="eac-market__tags">
          <VerificationStatus value={plugin.verification} />
          {installed !== undefined && <Status tone="success">已安装</Status>}
          {installed === undefined && action.disabled && <Status tone="warning">{action.label}</Status>}
        </div>
        <div className="eac-market__button-row">
          <Button size="sm" variant="outline" aria-label={`查看 ${plugin.name} 详情`} onClick={() => onOpen(plugin)}>查看详情</Button>
          {canManage ? (
            <Button size="sm" variant="primary" aria-label={`管理插件：${plugin.name}`} onClick={onManage}>管理</Button>
          ) : (
            <Button
              size="sm"
              variant={action.disabled ? 'outline' : 'primary'}
              disabled={action.disabled}
              title={actionReason}
              aria-describedby={actionReason === undefined ? undefined : actionReasonId}
              onClick={() => onInstall(plugin)}
            >{action.label}</Button>
          )}
        </div>
      </div>
      {actionReason !== undefined && <p className="eac-market__action-reason" id={actionReasonId}>{actionReason}</p>}
    </article>
  )
}

export { InstallPlanDialog, planSelectionFor, type PlanTarget } from './InstallPlanDialog.tsx'

export { TaskDrawer } from './TaskDrawer.tsx'

export function InventoryCard({ item, catalogPlugin, showCatalogNotice = true, onToggle, onRemove, onUpdate, updatePlugin, onOpenOfficialPlugins, busy = false }: {
  readonly item: InventoryItem
  readonly catalogPlugin: CatalogPlugin | undefined
  /** 普通卡片默认展示目录缺失说明；系统分组由顶部统一说明一次。 */
  readonly showCatalogNotice?: boolean
  readonly onToggle: (item: InventoryItem, enabled: boolean) => void
  readonly onRemove: (item: InventoryItem) => void
  readonly onUpdate?: (item: InventoryItem, plugin: CatalogPlugin) => void
  readonly updatePlugin?: CatalogPlugin | undefined
  readonly onOpenOfficialPlugins?: (() => void) | undefined
  readonly busy?: boolean
}): React.JSX.Element {
  const actionReasonId = useId()
  const readOnly = readOnlyLabel(item)
  const stateSummary = summarizeInventory(item)
  const state = item.restartRequired ? stateSummary.replace(' · 需要重启', '') : stateSummary
  const self = item.packageName === '@dsh-eac/market'
  const systemItem = isSystemInventoryItem(item, catalogPlugin)
  const catalogNoticeVisible = showCatalogNotice && catalogPlugin === undefined && !systemItem
  const busyReason = busy ? '正在处理插件操作，请稍候后再试。' : undefined
  const selfReason = self ? '市场自身请在 DSH 官方插件页管理。' : undefined
  const toggleReasons = [busyReason, selfReason, readOnly].filter((reason): reason is string => reason !== undefined)
  const removeReasons = [busyReason, selfReason, readOnly, item.removable ? undefined : '当前项目不可卸载'].filter((reason): reason is string => reason !== undefined)
  const updateReasons = busyReason === undefined ? [] : [busyReason]
  const toggleReasonText = [...new Set(toggleReasons)].join('；')
  const removeReasonText = [...new Set(removeReasons)].join('；')
  const updateReasonText = [...new Set(updateReasons)].join('；')
  const actionReasonText = [...new Set([...toggleReasons, ...removeReasons, ...updateReasons])].join('；')
  const diagnostics = item.rows.filter((row) => row.error || row.state === 'unknown')
  return (
    <article className="eac-market__card">
      <div className="eac-market__plugin-top">
        <span className="eac-market__plugin-icon" aria-hidden="true">{item.packageName.slice(0, 1).toUpperCase()}</span>
        <div className="eac-market__plugin-title">
          <h3 title={catalogPlugin?.name ?? item.packageName}>{catalogPlugin?.name ?? item.packageName}</h3>
          <p title={`${item.packageName}${item.version === undefined ? '' : ` · ${item.version}`}`}>{item.packageName}{item.version === undefined ? '' : ` · ${item.version}`}</p>
        </div>
      </div>
      {catalogNoticeVisible && (
        <p className="eac-market__plugin-summary">此插件不在当前市场目录中，以下状态来自官方插件管理器。</p>
      )}
      {catalogPlugin?.requiresSetup === true && <p className="eac-market__usage-guidance">需要设置：请到 DSH 官方插件页，按作者说明完成设置。</p>}
      {self && <p className="eac-market__usage-guidance">管理市场自身时，请使用 DSH 侧栏的「插件」页面。</p>}
      {diagnostics.length > 0 && (
        <details className="eac-market__diagnostics">
          <summary>查看运行诊断</summary>
          <ul>
            {diagnostics.map((row) => (
              <li key={row.id}>{row.name}：{row.error ?? (row.state === 'unknown' ? '运行状态尚未确认' : row.state === 'disabled' ? '已停用' : row.state === 'load-error' ? '加载失败' : '配置启用')}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="eac-market__plugin-bottom">
        <div className="eac-market__tags">
          <Status tone={state.includes('失败') ? 'danger' : state.includes('启用') || state.includes('运行中') ? 'success' : state.includes('重启') ? 'warning' : 'neutral'}>{state}</Status>
          {item.restartRequired && <Status tone="warning">需要重启</Status>}
          {readOnly && <Status tone="warning">{readOnly}</Status>}
        </div>
        <div className="eac-market__button-row">
          {onOpenOfficialPlugins && <Button size="sm" variant="outline" onClick={onOpenOfficialPlugins}>打开官方插件页</Button>}
          {!self && updatePlugin !== undefined && hasCatalogUpdate(item, updatePlugin) && onUpdate !== undefined && (
            <Button
              size="sm"
              variant="primary"
              disabled={updateReasonText !== ''}
              title={updateReasonText === '' ? undefined : updateReasonText}
              aria-describedby={updateReasonText === '' ? undefined : actionReasonId}
              onClick={() => onUpdate(item, updatePlugin)}
            >更新到 {updatePlugin.version}</Button>
          )}
          <Button
            size="sm"
            disabled={toggleReasonText !== ''}
            title={toggleReasonText === '' ? undefined : toggleReasonText}
            aria-describedby={toggleReasonText === '' ? undefined : actionReasonId}
            onClick={() => onToggle(item, !item.bundleEnabled)}
          >{item.bundleEnabled ? '停用' : '启用'}</Button>
          <Button
            size="sm"
            variant="outline"
            disabled={removeReasonText !== ''}
            title={removeReasonText === '' ? undefined : removeReasonText}
            aria-describedby={removeReasonText === '' ? undefined : actionReasonId}
            onClick={() => onRemove(item)}
          >卸载</Button>
        </div>
      </div>
      {actionReasonText !== '' && <p className="eac-market__action-reason" id={actionReasonId}>{actionReasonText}</p>}
    </article>
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

export function SearchField({ value, onChange }: {
  readonly value: string
  readonly onChange: (value: string) => void
}): React.JSX.Element {
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
