/** 浏览器安全的自保护身份；桌面适配包和执行核心均交由官方入口管理。
 * 冻结数组而非可变 Set，避免使用方误改全局保护范围。
 */
export const PROTECTED_MARKET_PACKAGES: readonly string[] = Object.freeze([
  '@dsh-eac/market',
  '@dsh-eac/market-core',
])

export function isProtectedMarketPackage(packageName: string): boolean {
  return PROTECTED_MARKET_PACKAGES.includes(packageName)
}
