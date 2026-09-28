import type { CatalogPlugin, InventoryItem } from '../types.ts'
import type { SkinRuntimeInfo } from './skin-service.ts'

export function isSkinPlugin(plugin: CatalogPlugin): boolean { return plugin.kind === 'skin' }

export function skinCatalogForInventory(item: InventoryItem, plugins: readonly CatalogPlugin[]): CatalogPlugin | undefined {
  const matches = plugins.filter((plugin) => plugin.packageName === item.packageName)
  const exact = matches.find((plugin) => plugin.version === item.version)
  if (exact) return isSkinPlugin(exact) ? exact : undefined
  // A missing installed release may still be grouped, but never authorizes switching.
  return matches.length > 0 && matches.every(isSkinPlugin) ? matches[0] : undefined
}

export function skinSwitchBlockReason(item: InventoryItem, plugin: CatalogPlugin, info: SkinRuntimeInfo | undefined): string | undefined {
  if (!item.installed) return '尚未安装，不能切换。'
  if (!item.bundleEnabled) return '皮肤插件已停用，请先启用。'
  if (item.restartRequired) return '安装或启停正在等待重启，请重启 DSH 后再切换。'
  if (!plugin.skinId) return '目录缺少有效皮肤标识，暂不能切换。'
  if (!info) return '尚未向皮肤管理器登记，请检查插件启用及重启状态。'
  if (!item.version || info.version !== item.version || plugin.version !== item.version) return '安装、目录或运行版本未对齐，请先核对版本。'
  if (info.incompatible) return `加载器拒绝此皮肤：${info.incompatible}`
  return undefined
}
