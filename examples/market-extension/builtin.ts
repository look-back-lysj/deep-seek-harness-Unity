/** Opt-in built-in example for a team's future source build; never auto-loaded. */
import type { ExtensionOwnerScope, ExtensionRegistration } from '../../packages/market/src/client/extensions/contract.ts'
import { registerBuiltinExtension } from '../../packages/market/src/client/extensions/builtin.ts'
import type { MarketExtensionController } from '../../packages/market/src/client/extensions/registry.ts'
import { definition } from './src/client.tsx'

export function registerBuiltinExample(host: MarketExtensionController, owner: ExtensionOwnerScope): ExtensionRegistration {
  return registerBuiltinExtension(host, owner, { ...definition, id: 'eac.example.builtin' })
}
