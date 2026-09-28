import { describe, expect, it } from 'vitest'
import { isSkinPlugin, skinCatalogForInventory, skinSwitchBlockReason } from '../../packages/market/src/client/skin-model.ts'
import { inventoryFixture, pluginFixtures } from './fixtures.ts'
import { SKIN_LOADER_PACKAGE } from '../../packages/market/src/client/skin-service.ts'

const skin = { ...pluginFixtures.verified, kind: 'skin' as const, skinId: 'aurora' }
const item = { ...inventoryFixture.items[0]!, packageName: skin.packageName, version: skin.version, installed: true, bundleEnabled: true, restartRequired: false }
const registered = { id: 'aurora', name: '合成皮肤', version: skin.version, status: 'discovered' as const }

describe('skin navigation and switch eligibility', () => {
  it('classifies by kind, including missing artifacts and blocked skins, never by package prefix', () => {
    expect(isSkinPlugin({ ...skin, installability: 'missing-artifact' })).toBe(true)
    expect(isSkinPlugin({ ...skin, installability: 'hard-blocked' })).toBe(true)
    expect(isSkinPlugin({ ...pluginFixtures.verified, packageName: '@dsh-eac/skin-fake' })).toBe(false)
    expect(isSkinPlugin({ ...pluginFixtures.verified, packageName: SKIN_LOADER_PACKAGE })).toBe(false)
  })
  it('groups only metadata-proven skin packages and respects exact installed release classification', () => {
    expect(skinCatalogForInventory(item, [skin])).toBe(skin)
    expect(skinCatalogForInventory({ ...item, version: '0.9.0' }, [skin])).toBe(skin)
    expect(skinCatalogForInventory(item, [{ ...skin, version: '2.0.0' }, { ...skin, kind: 'plugin' }])).toBeUndefined()
    expect(skinCatalogForInventory({ ...item, packageName: 'unknown' }, [skin])).toBeUndefined()
  })
  it('blocks missing installation/registration, disabled plugins, pending restart and divergent versions', () => {
    expect(skinSwitchBlockReason({ ...item, installed: false }, skin, registered)).toContain('尚未安装')
    expect(skinSwitchBlockReason({ ...item, bundleEnabled: false }, skin, registered)).toContain('停用')
    expect(skinSwitchBlockReason({ ...item, restartRequired: true }, skin, registered)).toContain('重启')
    expect(skinSwitchBlockReason(item, skin, undefined)).toContain('登记')
    expect(skinSwitchBlockReason(item, skin, { ...registered, version: '9.0.0' })).toContain('版本')
    expect(skinSwitchBlockReason(item, { ...skin, skinId: undefined }, registered)).toContain('标识')
    expect(skinSwitchBlockReason(item, skin, { ...registered, incompatible: '协议版本不兼容' })).toContain('协议版本不兼容')
  })
  it('permits a matching discovered or fault skin to be selected without asserting it is active', () => {
    expect(skinSwitchBlockReason(item, skin, registered)).toBeUndefined()
    expect(skinSwitchBlockReason(item, skin, { ...registered, status: 'fault' })).toBeUndefined()
  })
})
