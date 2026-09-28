import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Tag } from './ui.tsx'
import type {
  AiAnalysisResult,
  AiApplyResult,
  CatalogPack,
  CatalogPlugin,
  InventoryItem,
  PlanResult,
  TaskState,
  TransferResult,
} from '../types.ts'
import {
  formatBytes,
  installabilityLabel,
  isInstalled,
  readOnlyLabel,
  summarizeInventory,
  taskItemStatusLabel,
  taskStatusLabel,
  taskTone,
  verificationLabel,
  createIdempotencyKey,
  hasCatalogUpdate,
  PlanRequestGuard,
  planTargetSignature,
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

export function PluginCard({ plugin, inventory, onOpen, onInstall }: {
  readonly plugin: CatalogPlugin
  readonly inventory: readonly InventoryItem[]
  readonly onOpen: (plugin: CatalogPlugin) => void
  readonly onInstall: (plugin: CatalogPlugin) => void
}): React.JSX.Element {
  const installed = isInstalled(inventory, plugin)
  const blocked = plugin.installability !== 'bundle-installable' || plugin.verification === 'hard-incompatible'
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
            title={blocked ? installabilityLabel(plugin.installability) : installed !== undefined ? '已安装，请到我的插件管理' : undefined}
            onClick={() => onInstall(plugin)}
          >{installed !== undefined ? '已安装' : blocked ? '暂不可安装' : '查看安装方案'}</Button>
        </div>
      </div>
    </article>
  )
}

export interface PlanTarget {
  readonly plugin?: CatalogPlugin
  readonly pack?: CatalogPack
  readonly plugins: readonly CatalogPlugin[]
}

export function planSelectionFor(plugin: CatalogPlugin, inventory: readonly InventoryItem[], tryUnverified: boolean) {
  const installed = isInstalled(inventory, plugin)
  const deliveryDigest = plugin.artifactDigest ?? 'digest-unavailable'
  return {
    pluginId: plugin.id,
    packageName: plugin.packageName,
    targetVersion: plugin.version,
    targetDigest: deliveryDigest,
    enabledIntent: installed?.bundleEnabled ?? plugin.enabledPolicy !== 'default-off',
    tryUnverified,
  }
}

export function InstallPlanDialog({ target, inventory, remote, open, onClose, onStarted }: {
  readonly target: PlanTarget | undefined
  readonly inventory: readonly InventoryItem[]
  readonly remote: MarketRemote
  readonly open: boolean
  readonly onClose: () => void
  readonly onStarted: (task: TaskState) => void
}): React.JSX.Element {
  const [tryUnverified, setTryUnverified] = useState(false)
  const [result, setResult] = useState<PlanResult | undefined>(undefined)
  const [resultTargetKey, setResultTargetKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const requestGuard = useRef(new PlanRequestGuard())

  useEffect(() => {
    requestGuard.current.invalidate()
    setTryUnverified(false)
    setResult(undefined)
    setResultTargetKey('')
    setNotice('')
  }, [target, open])
  const plugins = target?.plugins ?? []
  const title = target?.pack === undefined ? '确认安装方案' : `确认套餐：${target.pack.name}`

  async function prepare(): Promise<void> {
    if (target === undefined) return
    setBusy(true)
    setNotice('')
    setResult(undefined)
    try {
      const ticket = requestGuard.current.begin(planTargetSignature(target))
      const selected = plugins.map((plugin) => planSelectionFor(plugin, inventory, tryUnverified))
      if (remote.createPlan === undefined) {
        setNotice('当前 DSH 运行时未开放正式安装计划，不能在市场里伪造确认结果。')
        return
      }
      const planResult = await remote.createPlan({
        ...(target.pack === undefined ? {} : {
          packId: target.pack.id,
          packVersion: target.pack.version,
        }),
        selections: selected,
        attemptUnknown: tryUnverified,
      })
      const accepted = requestGuard.current.accept(ticket, planResult)
      if (accepted === undefined) return
      setResult(accepted)
      setResultTargetKey(ticket.targetKey)
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function start(): Promise<void> {
    if (target === undefined || result?.status !== 'ready' || remote.startTask === undefined || resultTargetKey !== planTargetSignature(target)) return
    setBusy(true)
    setNotice('')
    try {
      const task = await remote.startTask({
        planId: result.plan.planId,
        planDigest: result.plan.planDigest,
        idempotencyKey: createIdempotencyKey('market-install'),
        confirmed: true,
      })
      if (target === undefined || resultTargetKey !== planTargetSignature(target)) return
      onStarted(task)
      onClose()
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open && target !== undefined}
      onClose={onClose}
      title={title}
      closeLabel="关闭安装方案"
      description="先核对版本调整与风险，再由官方插件管理器执行。"
      className="eac-market__modal"
      contentClassName="eac-market__modal-content"
    >
      <div className="eac-market__form">
        {plugins.length === 0 && (
          <div className="eac-market__notice">套餐没有可解析的组件，当前目录不足以生成安装方案。</div>
        )}
        {(tryUnverified || plugins.some((plugin) => plugin.verification === 'unverified' || plugin.verification === 'unknown')) && (
          <label className="eac-market__notice eac-market__notice--warning">
            <input
              data-modal-autofocus
              type="checkbox"
              checked={tryUnverified}
              onChange={(event) => { requestGuard.current.invalidate(); setResult(undefined); setResultTargetKey(''); setTryUnverified(event.currentTarget.checked) }}
            />
            {' '}仍然尝试安装未验证内容。不会绕过硬性不兼容、产物校验或官方安全限制。
          </label>
        )}
        {result?.status === 'ready' && (
          <div className="eac-market__table-wrap">
            <table className="eac-market__table">
              <thead><tr><th>插件</th><th>版本调整</th><th>启用</th><th>风险</th></tr></thead>
              <tbody>
                {result.plan.items.map((item) => (
                  <tr key={item.pluginId}>
                    <td>{item.packageName}</td>
                    <td>{item.action === 'keep' ? '保持' : item.action === 'add' ? '新增' : item.action === 'upgrade' ? `升级 ${item.currentVersion ?? ''} → ${item.targetVersion}` : item.action === 'downgrade' ? `降级 ${item.currentVersion ?? ''} → ${item.targetVersion}` : '阻止'}</td>
                    <td>{item.requestedEnabled ? '启用' : '停用'}</td>
                    <td>{item.blockers.length > 0 ? item.blockers.join('；') : item.requiresRestart ? '需要重启' : verificationLabel(item.verification)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result?.status === 'stale' && (
          <div className="eac-market__notice eac-market__notice--warning">
            <strong>目录已变化，请重新确认。</strong><br />{result.reason}<br />{result.details.join('；')}
          </div>
        )}
        {result?.status === 'blocked' && (
          <div className="eac-market__notice eac-market__notice--danger">
            <strong>安装方案被阻止。</strong><br />{result.reason}<br />{result.blockers.join('；')}
          </div>
        )}
        {notice && <div className="eac-market__notice eac-market__notice--warning" role="status">{notice}</div>}
        <div className="eac-market__button-row">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant="outline" disabled={busy || plugins.length === 0} onClick={() => void prepare()}>
            {result === undefined ? '生成正式方案' : result.status === 'ready' ? '重新生成方案' : '重试'}
          </Button>
          <Button
            variant="primary"
            disabled={busy || result?.status !== 'ready' || remote.startTask === undefined}
            title={remote.startTask === undefined ? '当前 DSH 运行时未提供任务启动能力' : undefined}
            onClick={() => void start()}
          >确认安装</Button>
        </div>
      </div>
    </Modal>
  )
}

function taskProgress(task: TaskState): number {
  if (task.status === 'completed') return 100
  if (task.items.length === 0) return task.status === 'queued' ? 8 : 24
  const done = task.items.filter((item) => ['installed', 'enabled', 'disabled', 'restart-required'].includes(item.status)).length
  return Math.max(8, Math.min(96, Math.round((done / task.items.length) * 100)))
}

export function TaskDrawer({ open, tasks, onClose, remote, onChanged }: {
  readonly open: boolean
  readonly tasks: readonly TaskState[]
  readonly onClose: () => void
  readonly remote: MarketRemote
  readonly onChanged: (task: TaskState) => void
}): React.JSX.Element | null {
  const [cancelling, setCancelling] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState('')
  const [aiResult, setAiResult] = useState<AiAnalysisResult | undefined>(undefined)
  const [aiApplyResult, setAiApplyResult] = useState<AiApplyResult | undefined>(undefined)
  const [aiBusy, setAiBusy] = useState(false)

  async function askAi(task: TaskState): Promise<void> {
    setAiResult(undefined)
    setAiApplyResult(undefined)
    setAiBusy(true)
    try {
      if (remote.aiAnalyze === undefined) throw new Error("当前运行时未开放 AI 辅助")
      setAiResult(await remote.aiAnalyze({ taskId: task.taskId }))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setAiBusy(false)
    }
  }

  async function applyAi(): Promise<void> {
    if (aiResult?.proposal === undefined || remote.aiConfirm === undefined) return
    setAiBusy(true)
    try {
      const action = aiResult.proposal.actions[0]
      setAiApplyResult(await remote.aiConfirm({ proposalId: aiResult.proposal.id, impactDigest: aiResult.proposal.impactDigest, confirmed: true, riskConfirmed: action?.requiresSecondConfirmation === true ? true : undefined, idempotencyKey: createIdempotencyKey("market-ai") }))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setAiBusy(false)
    }
  }

  async function cancel(task: TaskState): Promise<void> {
    setCancelling((current) => new Set(current).add(task.taskId))
    setError('')
    try {
      if (remote.cancelTask === undefined) throw new Error('当前 DSH 运行时未开放取消任务能力')
      onChanged(await remote.cancelTask({ taskId: task.taskId, idempotencyKey: createIdempotencyKey('market-cancel') }))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setCancelling((current) => {
        const next = new Set(current)
        next.delete(task.taskId)
        return next
      })
    }
  }

  async function approve(task: TaskState): Promise<void> {
    setError('')
    try {
      if (remote.approveTask === undefined || task.approval === undefined) throw new Error('当前任务没有可处理的脚本授权')
      onChanged(await remote.approveTask({
        taskId: task.taskId,
        attemptId: task.approval.attemptId,
        challengeId: task.approval.id,
        pendingBuildsDigest: task.approval.digest,
        approvedBuilds: task.approval.packages,
        idempotencyKey: createIdempotencyKey('market-approve'),
      }))
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  async function resume(task: TaskState): Promise<void> {
    setError('')
    try {
      if (remote.resumeTask === undefined || task.resume === undefined) throw new Error('当前任务没有可继续的重启确认')
      onChanged(await remote.resumeTask({
        taskId: task.taskId,
        challengeId: task.resume.id,
        resumeDigest: task.resume.digest,
        idempotencyKey: createIdempotencyKey('market-resume'),
      }))
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  const drawerRef = useRef<HTMLElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!open) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    drawerRef.current?.querySelector<HTMLElement>('button')?.focus()
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      returnFocus.current?.focus()
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <button className="eac-market__drawer-backdrop" aria-label="关闭任务面板" onClick={onClose} />
      <aside ref={drawerRef} className="eac-market__drawer" aria-label="安装任务">
        <div className="eac-market__drawer-head">
          <h2>安装任务</h2>
          <Button variant="ghost" onClick={onClose}>关闭</Button>
        </div>
        <div className="eac-market__drawer-body">
          {error && <div className="eac-market__notice eac-market__notice--danger" role="alert">{error}</div>}
          {tasks.length === 0 && <EmptyState title="暂无安装任务" description="安装插件或套餐后，下载、校验和安装进度会显示在这里。" />}
          {[...tasks].reverse().map((task) => {
            const displayStatus = cancelling.has(task.taskId) ? 'cancelling' as const : task.status
            const canCancel = !['completed', 'failed', 'cancelled', 'unknown'].includes(task.status) && !cancelling.has(task.taskId)
            return (
              <article className="eac-market__task" key={task.taskId}>
                <div className="eac-market__task-head">
                  <div>
                    <h3>{task.items[0]?.packageName ?? '安装任务'}</h3>
                    <p>{task.nextAction}</p>
                  </div>
                  <Status tone={taskTone(displayStatus)}>{taskStatusLabel(displayStatus)}</Status>
                </div>
                <div className="eac-market__progress" aria-label={`任务进度 ${taskProgress(task)}%`}>
                  <div style={{ width: `${taskProgress(task)}%` }} />
                </div>
                <div className="eac-market__tags">
                  {task.items.map((item) => (
                    <Tag key={item.pluginId} tone={item.status === 'failed' ? 'danger' : item.status === 'restart-required' ? 'warning' : item.status === 'enabled' ? 'success' : 'neutral'}>
                      {item.packageName}：{taskItemStatusLabel(item.status)}
                    </Tag>
                  ))}
                </div>
                <div className="eac-market__button-row">
                  {canCancel && <Button size="sm" variant="outline" onClick={() => void cancel(task)}>取消任务</Button>}
                  {["failed", "needs-attention", "unknown"].includes(task.status) && <Button size="sm" variant="outline" disabled={aiBusy} onClick={() => void askAi(task)}>AI 帮我处理</Button>}
                  {task.status === 'awaiting-approval' && <Button size="sm" variant="primary" onClick={() => void approve(task)}>授权脚本并继续</Button>}
                  {task.status === 'awaiting-resume' && <Button size="sm" variant="primary" onClick={() => void resume(task)}>已重启，继续检查</Button>}
                </div>
                {aiResult?.proposal !== undefined && <div className="eac-market__notice" role="status"><strong>{aiResult.proposal.summary}</strong><div>{aiResult.proposal.facts.join("；")}</div><div>{aiResult.proposal.actions.map((action) => `${action.kind} ${action.packageName}${action.targetVersion === undefined ? "" : `@${action.targetVersion}`}：${action.reason}`).join("；")}</div><Button size="sm" variant="primary" disabled={aiBusy} onClick={() => void applyAi()}>确认执行 AI 方案</Button></div>}
                {aiApplyResult !== undefined && <div className="eac-market__notice" role="status">AI 执行结果：{aiApplyResult.status}{aiApplyResult.error === undefined ? "" : ` ${aiApplyResult.error}`}</div>}
                <ul className="eac-market__event-list">
                  {task.events.slice(-6).map((event) => (
                    <li key={`${event.sequence}-${event.at}`} data-level={event.level}>{event.message}</li>
                  ))}
                </ul>
              </article>
            )
          })}
        </div>
      </aside>
    </>
  )
}

export function InventoryCard({ item, catalogPlugin, onToggle, onRemove, onUpdate }: {
  readonly item: InventoryItem
  readonly catalogPlugin: CatalogPlugin | undefined
  readonly onToggle: (item: InventoryItem, enabled: boolean) => void
  readonly onRemove: (item: InventoryItem) => void
  readonly onUpdate?: (item: InventoryItem, plugin: CatalogPlugin) => void
}): React.JSX.Element {
  const readOnly = readOnlyLabel(item)
  const state = summarizeInventory(item)
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
      {catalogPlugin?.requiresSetup === true && <p className="eac-market__usage-guidance">需设置：当前市场契约没有可调用的设置接口，请在 DSH 官方插件页完成设置。</p>}
      <div className="eac-market__plugin-bottom">
        <div className="eac-market__tags">
          <Status tone={state.includes('失败') ? 'danger' : state.includes('启用') ? 'success' : state.includes('重启') ? 'warning' : 'neutral'}>{state}</Status>
          {readOnly && <Status tone="warning">{readOnly}</Status>}
        </div>
        <div className="eac-market__button-row">
          {catalogPlugin !== undefined && hasCatalogUpdate(item, catalogPlugin) && onUpdate !== undefined && (
            <Button size="sm" variant="primary" onClick={() => onUpdate(item, catalogPlugin)}>更新到 {catalogPlugin.version}</Button>
          )}
          <Button
            size="sm"
            disabled={readOnly !== undefined}
            title={readOnly}
            onClick={() => onToggle(item, !item.bundleEnabled)}
          >{item.bundleEnabled ? '停用' : '启用'}</Button>
          <Button size="sm" variant="outline" disabled={!item.removable || readOnly !== undefined} title={item.removable ? undefined : '当前项目不可卸载'} onClick={() => onRemove(item)}>卸载</Button>
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
