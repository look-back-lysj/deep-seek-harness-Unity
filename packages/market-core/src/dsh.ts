/** DSH 托管的无界面入口。可复用业务能力，但不是独立安装器或安全沙箱。
 * Context、文件与官方服务留在此入口内部；Client 只消费浏览器安全合同。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { MarketBackend } from './api.ts'
import { MarketRuntime, type RuntimeIdentity, type RuntimeOptions } from './host/market-runtime.ts'

export type { RuntimeIdentity } from './host/market-runtime.ts'

/** DSH adapter 唯一可公开的运行选项；目录原始字节由随包资源提供。 */
export type DshMarketBackendOptions = Omit<RuntimeOptions, 'embeddedCatalog' | 'embeddedCatalogBytes'> & {
  readonly embeddedCatalogBytes: Uint8Array
}

function requireCallerId(callerId: string): string {
  // 即使 JavaScript 调用方绕过类型检查，也不能落到旧运行时的默认身份。
  if (typeof callerId !== 'string' || !callerId.trim()) throw new Error('当前调用缺少明确的连接身份 callerId')
  return callerId
}

export function createDshMarketBackend(
  ctx: Context,
  identity: RuntimeIdentity,
  dataDirectory: string,
  options: DshMarketBackendOptions,
): MarketBackend {
  if (!(options.embeddedCatalogBytes instanceof Uint8Array)) {
    throw new Error('DSH adapter 必须提供 Uint8Array 形式的 embeddedCatalogBytes')
  }
  const runtime = new MarketRuntime(ctx, identity, dataDirectory, options)
  // 显式列出业务入口并保留接收者；解构调用也不会丢失 this。
  // 不转发内部对象或包装失败结果，审批、持久化和锁仍由原运行时负责。
  const backend: MarketBackend = {
    capabilities: () => runtime.capabilities(),
    catalog: () => ({ ...runtime.catalogView(), collections: runtime.catalog.collectionViews() }),
    inventory: async () => (await runtime.host.readState()).inventory,
    catalogRefresh: request => runtime.catalogRefresh(request),
    catalogSources: () => runtime.catalogSources(),
    agentForgeRefresh: request => runtime.agentForgeRefresh(request),
    maintenanceStatus: () => runtime.maintenanceStatus(),
    checkUpdates: request => runtime.checkUpdates(request),
    updatePolicyGet: () => runtime.updatePolicyGet(),
    updatePolicySave: request => runtime.updatePolicySave(request),
    planCreate: async (request, callerId) => runtime.planCreate(request, requireCallerId(callerId)),
    taskStart: async (request, callerId) => runtime.taskStart(request, requireCallerId(callerId)),
    taskGet: request => runtime.taskGet(request),
    taskList: () => runtime.taskList(),
    taskEvents: request => runtime.taskEvents(request),
    taskApproveBuilds: request => runtime.taskApproveBuilds(request),
    taskResume: request => runtime.taskResume(request),
    taskCancel: request => runtime.taskCancel(request),
    pluginSetEnabled: request => runtime.pluginSetEnabled(request),
    pluginRemove: request => runtime.pluginRemove(request),
    authorDraftList: () => runtime.authorDraftList(),
    authorDraftGet: id => runtime.authorDraftGet(id),
    authorDraftSave: input => runtime.authorDraftSave(input),
    authorDraftDelete: request => runtime.authorDraftDelete(request),
    authorReadmeImport: request => runtime.authorReadmeImport(request),
    authorReadmePreview: request => runtime.authorReadmePreview(request),
    authorReadmeApplyPreview: request => runtime.authorReadmeApplyPreview(request),
    authorTransferBegin: request => runtime.authorTransferBegin(request),
    authorTransferChunk: request => runtime.authorTransferChunk(request),
    authorTransferRead: request => runtime.authorTransferRead(request),
    authorTransferDispose: request => runtime.authorTransferDispose(request),
    authorExportDraft: request => runtime.authorExportDraft(request),
    authorMediaRead: request => runtime.authorMediaRead(request),
    diagnosticsExport: selection => runtime.diagnosticsExport(selection),
    aiAnalyze: async (request, callerId, signal) => runtime.aiAnalyze(request, requireCallerId(callerId), signal),
    aiConfirm: async (request, callerId) => runtime.aiConfirm(request, requireCallerId(callerId)),
  }
  return Object.freeze(backend)
}
