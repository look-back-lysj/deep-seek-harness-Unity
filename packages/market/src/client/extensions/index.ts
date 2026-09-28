/** Private Client SDK. The controller exports are for market assembly; third-party
 * declarations should import contract types only and register via Cordis injection.
 */
export * from './contract.ts'
export { createMarketExtensionHost, type MarketExtensionController, type MarketExtensionOptions, type ExtensionIssue } from './registry.ts'
export { registerBuiltinExtension } from './builtin.ts'
export { attachDshService, attachDshSlots, EXTENSION_CHILDREN, createDshExtensionRenderer, type MarketExtensionSlotRenderer } from './dsh.tsx'
export { ExtensionSurface, renderExtensionSurface, useExtensionRuntime, type ExtensionSurfaceProps } from './surface.tsx'
export { createManagedExtensionRuntime, type ManagedExtensionRuntime, type ManagedResult } from './managed.ts'
