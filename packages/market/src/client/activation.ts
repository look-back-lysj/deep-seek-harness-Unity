import { createElement, type ComponentType } from 'react'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { assertCompatibleHello, ClientCompatibilityError, PROTOCOL_REFRESH_HINT, type MarketRemote } from './model.ts'
import type { MarketPageProps } from './MarketPage.tsx'
import { createMarketExtensionHost, attachDshService, EXTENSION_CHILDREN, createDshExtensionRenderer, type MarketExtensionController, type MarketExtensionSlotRenderer } from './extensions/index.ts'
import { SERVICE_NAME, type ClientHandshakeRequest, type ClientHandshakeResult, type EnvironmentHello } from '@dsh-eac/market-core/contracts'
import { supportsApiVersion } from '@dsh-eac/market-core/compatibility'
import { ADAPTER_PROTOCOL_VERSION, ADAPTER_VERSION, REQUIRED_CORE_API_VERSION } from '../version.ts'
import type { SkinRuntime, SkinServiceBridge } from './skin-service.ts'

/** Optional Cordis dependency: installing/removing the loader updates the page
 * without turning the skin loader into a mandatory market dependency. */
export function attachSkinService(ctx: Context): SkinServiceBridge & { dispose(): Promise<void> } {
  const listeners = new Set<() => void>()
  let runtime: SkinRuntime | undefined
  let stopped = false
  const notify = (): void => {
    for (const listener of [...listeners]) {
      try { listener() } catch { console.warn('[eac-market/skins] listener failed') }
    }
  }
  const dependency = typeof ctx.inject === 'function' ? ctx.inject(['uiSkinLoader'], scope => {
    scope.effect(() => {
      const value = scope.get('uiSkinLoader') as SkinRuntime | undefined
      if (stopped || !value || !['list', 'current', 'switchTo', 'subscribe'].every(key => typeof (value as unknown as Record<string, unknown>)[key] === 'function')) return () => {}
      runtime = value
      notify()
      return () => {
        if (runtime === value) { runtime = undefined; notify() }
      }
    }, 'eac-market: optional skin runtime')
  }) : undefined
  return {
    getRuntime: () => runtime,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    async dispose() {
      if (stopped) return
      stopped = true
      runtime = undefined
      notify()
      listeners.clear()
      await dependency?.dispose()
    },
  }
}

export const PANEL_ID = 'eac-market' as MainPanelId

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    eacMarket: 'panel' | 'title'
  }
}

export interface Disposer {
  (): void | Promise<void>
}

export interface ActivationComponents {
  readonly MarketPage: ComponentType<MarketPageProps>
  readonly Icon: ComponentType
}

const METHOD_ALIASES: Readonly<Record<string, string>> = {
  createPlan: 'planCreate',
  startTask: 'taskStart',
  getTask: 'taskGet',
  listTasks: 'taskList',
  cancelTask: 'taskCancel',
  approveTask: 'taskApproveBuilds',
  resumeTask: 'taskResume',
  setPluginEnabled: 'pluginSetEnabled',
  removePlugin: 'pluginRemove',
  listDrafts: 'authorDraftList',
  getDraft: 'authorDraftGet',
  saveDraft: 'authorDraftSave',
  deleteDraft: 'authorDraftDelete',
  importReadme: 'authorReadmeImport',
  previewReadme: 'authorReadmePreview',
  applyReadmePreview: 'authorReadmeApplyPreview',
  transferBegin: 'authorTransferBegin',
  transferChunk: 'authorTransferChunk',
  transferRead: 'authorTransferRead',
  transferDispose: 'authorTransferDispose',
  exportDraft: 'authorExportDraft',
  readMedia: 'authorMediaRead',
  refreshCatalog: 'catalogRefresh',
  listCatalogSources: 'catalogSources',
  refreshAgentForge: 'agentForgeRefresh',
  getMaintenanceStatus: 'maintenanceStatus',
  checkUpdates: 'checkUpdates',
  getUpdatePolicy: 'updatePolicyGet',
  saveUpdatePolicy: 'updatePolicySave',
  exportDiagnostic: 'diagnosticsExport',
}

// 按后台方法名分类，让页面别名和直接调用都受保护。
// 预览、导出和 AI 分析也会分配后台状态，因此同样需要握手。
const SIDE_EFFECT_METHODS = new Set([
  'planCreate', 'taskStart', 'taskApproveBuilds', 'taskResume', 'taskCancel',
  'pluginSetEnabled', 'pluginRemove', 'catalogRefresh', 'agentForgeRefresh', 'checkUpdates', 'updatePolicySave',
  'authorDraftSave', 'authorDraftDelete', 'authorReadmeImport', 'authorReadmePreview', 'authorReadmeApplyPreview',
  'authorTransferBegin', 'authorTransferChunk', 'authorTransferDispose', 'authorExportDraft',
  'aiAnalyze', 'aiConfirm',
])
const HANDSHAKE_TIMEOUT_MS = 8_000

class RemoteCallError extends Error {
  readonly code?: string
  readonly details?: unknown
  readonly retryable?: boolean
  readonly nextAction?: string
}

function unwrap(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return value
  const result = value as { ok: unknown; value?: unknown; error?: { message?: string } }
  if (result.ok !== true) {
    const failure = (result.error ?? {}) as Record<string, unknown>
    const error = new RemoteCallError(typeof failure.message === 'string' ? failure.message : 'Remote call failed')
    error.name = 'RemoteCallError'
    Object.assign(error, failure)
    throw error
  }
  return result.value
}

/** 每次副作用都重新协商当前官方连接；不缓存许可、不自造连接身份。
 * hello 与握手共用等待上限，迟到回包不能恢复已经拒绝的写入。
 * 此处仅检查兼容性；真实连接绑定、审批与锁仍由后台负责。 */
async function negotiateWrite(source: Record<string, unknown>): Promise<void> {
  const deadline = Date.now() + HANDSHAKE_TIMEOUT_MS
  const read = async (name: 'hello' | 'clientConnect', args: unknown[]): Promise<unknown> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const method = source[name]
      if (typeof method !== 'function') throw new ClientCompatibilityError('后台缺少协议协商能力。')
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new ClientCompatibilityError('连接协商超时。')
      // 直接调用原始接口，避免代理再次进入自己的写入防护。
      return unwrap(await Promise.race([
        (method as (...values: unknown[]) => unknown).apply(source, args),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ClientCompatibilityError('连接协商超时。')), remaining)
        }),
      ]))
    } catch (error) {
      if (error instanceof ClientCompatibilityError) throw error
      // 补充中文刷新提示，同时保留后台错误码、详情与重试语义。
      const failure = new RemoteCallError(`连接协商失败，已停止操作：${error instanceof Error ? error.message : String(error)}。${PROTOCOL_REFRESH_HINT}`)
      failure.name = 'RemoteCallError'
      if (error instanceof RemoteCallError) {
        for (const key of ['code', 'details', 'retryable', 'nextAction'] as const) {
          if (error[key] !== undefined) Object.assign(failure, { [key]: error[key] })
        }
      }
      throw failure
    } finally { if (timer !== undefined) clearTimeout(timer) }
  }

  const hello = await read('hello', []) as EnvironmentHello
  assertCompatibleHello(hello)
  const request: ClientHandshakeRequest = { protocolVersion: ADAPTER_PROTOCOL_VERSION, adapterVersion: ADAPTER_VERSION }
  const result = await read('clientConnect', [request]) as ClientHandshakeResult | undefined
  if (result?.accepted !== true) {
    throw new ClientCompatibilityError(`后台未接受当前页面的连接${typeof result?.reason === 'string' ? `：${result.reason}` : ''}。`)
  }
  if (typeof result.protocolVersion !== 'string' || !supportsApiVersion(result.protocolVersion, ADAPTER_PROTOCOL_VERSION)) {
    throw new ClientCompatibilityError('连接协商返回了不兼容的市场协议。')
  }
  if (typeof result.coreApiVersion !== 'string' || !supportsApiVersion(result.coreApiVersion, REQUIRED_CORE_API_VERSION)
    || typeof result.coreVersion !== 'string' || result.coreVersion.trim() === '') {
    throw new ClientCompatibilityError('连接协商返回了不兼容或不完整的核心接口信息。')
  }
}

export function remoteFacade(raw: unknown): MarketRemote {
  const source = raw as Record<string, unknown>
  return new Proxy(source, {
    get(target, property): unknown {
      if (typeof property !== 'string') return undefined
      const name = METHOD_ALIASES[property] ?? property
      const method = target[name]
      if (typeof method !== 'function') return undefined
      return async (...args: readonly unknown[]): Promise<unknown> => {
        const updateRequest = args[0] as { readonly refreshFirst?: unknown } | undefined
        const readOnlyUpdateCheck = name === 'checkUpdates' && updateRequest?.refreshFirst !== true
        if (SIDE_EFFECT_METHODS.has(name) && !readOnlyUpdateCheck) await negotiateWrite(source)
        const callArgs = property === 'refreshCatalog' && args.length === 0 ? [{}] : [...args]
        const value = unwrap(await (method as (...values: unknown[]) => unknown).apply(target, callArgs))
        // Refresh failure is a domain result with a usable old snapshot. The
        // caller must receive its status/reason instead of a success-shaped snapshot.
        return value
      }
    },
  }) as unknown as MarketRemote
}

function debugStage(stage: string): void {
  console.debug(`[eac-market/client:activation] ${stage}`)
}

async function disposeAll(disposers: readonly Disposer[]): Promise<void> {
  for (const dispose of [...disposers].reverse()) {
    try {
      await dispose()
    } catch (error) {
      console.warn('[eac-market/client:activation] cleanup failed', error)
    }
  }
}

/**
 * Mount the generated Remote contribution before reading its namespace. The
 * namespace is created by `$mount`; reading it earlier always fails even when
 * the Host MarketService itself is healthy.
 */
export async function activateMarketClient(
  ctx: Context,
  remoteContribution: unknown,
  components: ActivationComponents,
): Promise<Disposer> {
  const disposers: Disposer[] = []
  try {
    debugStage('remote-mount:start')
    const mountRemote = await ctx.remote.$mount(remoteContribution as never)
    disposers.push(mountRemote)
    debugStage('remote-mount:done')

    // The official Remote service installs dynamic namespaces as Cordis
    // services (`remote.eacMarket`); direct property access is intentionally
    // rejected unless the key is statically injected.
    const getter = (ctx as unknown as { get?: <T>(key: string) => T | undefined }).get
    const rawRemote = getter === undefined
      ? (ctx.remote as unknown as Record<string, MarketRemote | undefined>)[SERVICE_NAME]
      : getter<MarketRemote>(`remote.${SERVICE_NAME}`)
    if (rawRemote === undefined) {
      throw new Error(`EAC market Remote namespace "${SERVICE_NAME}" is unavailable after mount`)
    }
    const remote = remoteFacade(rawRemote)
    const skinService = attachSkinService(ctx)
    disposers.push(() => skinService.dispose())
    debugStage('remote-namespace:ready')

    let extensions: MarketExtensionController | undefined
    if (typeof remote.hello === 'function') {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const hello = await Promise.race([
          remote.hello(),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('extension host hello timeout')), 8_000) }),
        ])
        extensions = createMarketExtensionHost({ marketVersion: hello.marketVersion, dshVersion: hello.hostVersion,
          capabilities: ['browse', 'open-own-page', 'request-install-review', 'preview-draft-change'],
          onIssue: issue => console.warn('[eac-market/extensions]', issue.code),
        })
        disposers.push(attachDshService(ctx, extensions))
      } catch {
        // Unknown version/capability information must not be guessed. Ordinary
        // market browsing keeps its own loading/error and retry affordances.
        extensions?.dispose()
        extensions = undefined
        console.warn('[eac-market/extensions] service unavailable; ordinary market remains available')
      } finally { if (timeout !== undefined) clearTimeout(timeout) }
    }

    const localeDispose = ctx.locale.register('eacMarket', {
      zh: { panel: 'EAC', title: '插件市场' },
      en: { panel: 'EAC', title: 'Plugin Market' },
    })
    disposers.push(localeDispose)
    debugStage('locale:registered')

    const mainDispose = ctx.slots.inject('main', function* () {
      yield ctx.slots.register({
        name: 'main',
      key: PANEL_ID,
      locale: 'eacMarket',
      inject: () => ({}),
      children: extensions ? EXTENSION_CHILDREN : {},
      }, (props) => createElement(components.MarketPage, {
        remote,
        skinService,
        onOpenOfficialPlugins: () => { ctx.layout.selectPanel('plugins' as MainPanelId) },
        ...(extensions ? {
          extensions,
          renderExtensionSurface: createDshExtensionRenderer((props as unknown as { renderSlot: MarketExtensionSlotRenderer }).renderSlot),
        } : {}),
      }))
    })
    disposers.push(() => mainDispose())
    debugStage('main-slot:registered')

    const sidebarDispose = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 20,
      label: () => 'EAC',
      locale: 'eacMarket',
      inject: () => ({}),
    }, () => createElement(components.Icon)))
    disposers.push(() => sidebarDispose())
    debugStage('sidebar-slot:registered')

    debugStage('complete')
    return async () => {
      debugStage('cleanup:start')
      await disposeAll(disposers)
      debugStage('cleanup:done')
    }
  } catch (error) {
    console.error('[eac-market/client:activation] failed', error)
    await disposeAll(disposers)
    throw error
  }
}
