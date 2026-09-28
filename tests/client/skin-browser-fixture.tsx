/** Synthetic data only; this module is never imported by the shipped client. */
import type { Root } from 'react-dom/client'
import { MarketPage } from '../../packages/market/src/client/MarketPage.tsx'
import { SKIN_LOADER_PACKAGE, type SkinRuntime, type SkinRuntimeInfo, type SkinSwitchResult } from '../../packages/market/src/client/skin-service.ts'
import type { CatalogPlugin, InventoryItem, PlanCreateRequest, TaskStartRequest } from '../../packages/market/src/types.ts'
import type { MarketRemote } from '../../packages/market/src/client/model.ts'
import { catalogFixture, helloFixture, inventoryFixture, pluginFixtures, readOnlyRemote, taskFixture } from './fixtures.ts'

export const skinStats = { switches: [] as string[], plans: [] as PlanCreateRequest[], starts: [] as TaskStartRequest[], runtimeListeners: 0, bridgeListeners: 0 }
let service: SkinRuntime | undefined
let current = 'default'
let behavior = 'success'
let infos: SkinRuntimeInfo[] = []
let resolvePending: ((value: SkinSwitchResult) => void) | undefined
const runtimeListeners = new Set<() => void>()
const bridgeListeners = new Set<() => void>()
let renderEpoch = 0
const publish = () => runtimeListeners.forEach((listener) => listener())
const runtime: SkinRuntime = {
  list: () => infos,
  current: () => current,
  subscribe: (listener) => { runtimeListeners.add(listener); skinStats.runtimeListeners = runtimeListeners.size; return () => { runtimeListeners.delete(listener); skinStats.runtimeListeners = runtimeListeners.size } },
  switchTo: async (id) => {
    skinStats.switches.push(id)
    if (behavior === 'late') return new Promise((resolve) => { resolvePending = resolve })
    if (behavior === 'fail') { infos = infos.map((info) => info.id === id ? { ...info, status: 'fault' } : info); publish(); return { ok: false, error: '合成激活故障', rolledBackTo: current, warning: '合成残留提醒' } }
    if (behavior === 'throw') throw new Error('合成连接中断')
    if (behavior !== 'unconfirmed') {
      current = id
      infos = infos.map((info) => ({ ...info, status: info.id === id ? 'active' : info.status === 'active' ? 'discovered' : info.status }))
      publish()
    }
    return { ok: true }
  },
}
const bridge = {
  getRuntime: () => service,
  subscribe: (listener: () => void) => { bridgeListeners.add(listener); skinStats.bridgeListeners = bridgeListeners.size; return () => { bridgeListeners.delete(listener); skinStats.bridgeListeners = bridgeListeners.size } },
}
export const skinFixture = {
  stats: skinStats,
  behavior: (value: string) => { behavior = value },
  availability: (value: boolean) => { service = value ? runtime : undefined; bridgeListeners.forEach((listener) => listener()) },
  settle: () => { resolvePending?.({ ok: true }); resolvePending = undefined },
  ghost: () => { current = 'test-skin-4'; infos = [...infos, { id: current, name: '目录已收录但未安装', version: '1.0.0', status: 'active' }]; publish() },
}

export function renderSkinFixture(root: Root, mode: string): void {
  skinStats.switches = []; skinStats.plans = []; skinStats.starts = []
  current = 'default'; behavior = 'success'
  const base = { ...pluginFixtures.verified, version: '1.0.0', screenshots: [], requiresSetup: false, requiresRestart: false, enabledPolicy: 'default-off' as const }
  const loader: CatalogPlugin = { ...base, id: 'test-loader', name: '合成皮肤管理器', packageName: SKIN_LOADER_PACKAGE }
  const skins: CatalogPlugin[] = Array.from({ length: 13 }, (_, index) => ({ ...base, id: `skin-${index}`, kind: 'skin', skinId: `test-skin-${index}`, name: `合成皮肤 ${index}`, packageName: `@test/appearance-${index}`, summary: index > 10 ? '合成暂停原因：归档缺少已确认的兼容修复。' : index === 10 ? '合成元数据已识别，缺少可下载制品。' : '此内容仅用于浏览器回归，不是正式推荐。', installability: index > 10 ? 'hard-blocked' : index === 10 ? 'missing-artifact' : 'bundle-installable', verification: index > 10 ? 'unknown' : index === 9 ? 'unknown' : 'verified' }))
  const normal = { ...base, id: 'function', name: '合成功能插件', packageName: '@dsh-eac/skin-name-only' }
  const installed = (plugin: CatalogPlugin): InventoryItem => ({ ...inventoryFixture.items[0]!, packageName: plugin.packageName, version: plugin.version, source: 'profile', installed: true, bundleEnabled: true, restartRequired: false, rows: [], removable: true, readOnlyReason: undefined })
  let items: InventoryItem[] = mode === 'skins-catalog' || mode === 'skins-ghost' ? [] : [installed(loader), ...skins.slice(0, 3).map(installed)]
  if (items[3]) items[3] = { ...items[3], bundleEnabled: false }
  infos = skins.slice(0, 3).map((skin, index) => ({ id: skin.skinId!, name: skin.name, version: skin.version, status: index === 1 ? 'fault' : 'discovered' }))
  service = mode === 'skins-catalog' || mode === 'skins-offline' ? undefined : runtime
  const remote: MarketRemote = {
    ...readOnlyRemote(), listTasks: async () => [],
    catalog: async () => ({ ...catalogFixture, plugins: [normal, loader, ...skins], packs: [], collections: [], recommendations: [{ pluginId: skins[0]!.id, placement: 'featured', reason: '合成皮肤推荐也不得占据功能发现页', order: 1 }],
      ...(mode !== 'skins-listings' ? {} : { listings: Array.from({ length: 27 }, (_, index) => ({ id: `listing-${index}`, name: `合成登记功能 ${index}`, packageName: `@test/pending-${index}`, summary: index === 6 ? '用于搜索说明回归的语音整理功能' : '仅登记资料的合成条目，尚未核验安装包。', reason: '缺少原始 package 元数据与发行制品，待作者补齐。', sourceUrl: 'https://example.invalid/registered-source', ...(index === 2 ? { requestedVersion: '2.0.0' } : {}) })) }),
    }),
    inventory: async () => ({ ...inventoryFixture, items, unknownItems: [] }),
    createPlan: async (request) => {
      skinStats.plans.push(request)
      return { status: 'ready', plan: { planId: 'skin-plan', schemaVersion: '1', hostFingerprint: 'synthetic', planDigest: 'sha256:skin-test', environmentId: helloFixture.environmentId, catalogRevision: 'fixture', expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString(), items: request.selections.map((selection) => ({ pluginId: selection.pluginId, packageName: selection.packageName, action: 'add', targetVersion: selection.targetVersion, targetDigest: selection.targetDigest, currentEnabled: false, requestedEnabled: selection.enabledIntent, verification: 'verified', requiresRestart: false, blockers: [] })) } }
    },
    startTask: async (request) => { skinStats.starts.push(request); return taskFixture({ status: 'completed' }) },
    setPluginEnabled: async (request) => { items = items.map((item) => item.packageName === request.packageName ? { ...item, bundleEnabled: request.enabled } : item); return { status: 'applied', changed: true, permissionChanges: [] } },
  }
  root.render(<MarketPage key={`${mode}:${++renderEpoch}`} remote={remote} skinService={bridge} />)
}
