/** Structural subset of afa947… packages/loader/src/protocol.ts.
 * No loader import: catalog data never loads or executes a skin's JavaScript.
 */
export const SKIN_LOADER_PACKAGE = '@dsh-eac/ui-skin-loader'
export const DEFAULT_SKIN_ID = 'default'

export interface SkinRuntimeInfo {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly status: 'discovered' | 'active' | 'fault' | 'suspect-residue'
  readonly incompatible?: string | undefined
  readonly settingsHint?: string | undefined
}

export type SkinSwitchResult =
  | { readonly ok: true; readonly warning?: string }
  | { readonly ok: false; readonly error: string; readonly warning?: string; readonly rolledBackTo: string }

export interface SkinRuntime {
  list(): readonly SkinRuntimeInfo[]
  current(): string
  switchTo(id: string): Promise<SkinSwitchResult>
  subscribe(listener: () => void): () => void
}

/** Injected by activation; optional so browsing never depends on the loader.
 * getRuntime returns only the actual, currently provided uiSkinLoader service.
 * subscribe observes service appearance/replacement/removal, not skin state.
 * SkinCenter independently subscribes to runtime state and disposes both handles.
 * Removal must set getRuntime() to undefined BEFORE notifying listeners.
 */
export interface SkinServiceBridge {
  getRuntime(): SkinRuntime | undefined
  subscribe(listener: () => void): () => void
}
