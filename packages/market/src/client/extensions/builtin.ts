import type { ExtensionDefinition, ExtensionOwnerScope, ExtensionRegistration } from './contract.ts'
import type { MarketExtensionController } from './registry.ts'

/** Builtins use the exact same validation and teardown path as external plugins. */
export function registerBuiltinExtension(host: MarketExtensionController, owner: ExtensionOwnerScope, definition: ExtensionDefinition): ExtensionRegistration {
  return host.registerBuiltin(owner, definition)
}
