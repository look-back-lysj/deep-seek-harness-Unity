import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const packageManifest = JSON.parse(
  await readFile(new URL('../../packages/market/package.json', import.meta.url), 'utf8'),
) as {
  version: string
  engines: { dsh?: unknown }
  peerDependencies: Record<string, string>
}
const pluginManifest = JSON.parse(
  await readFile(new URL('../../packages/market/dsh-plugin.json', import.meta.url), 'utf8'),
) as { version: string }

const dshPeers = Object.fromEntries(
  Object.entries(packageManifest.peerDependencies).filter(
    ([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'),
  ),
)

describe('market manifest official peer gate', () => {
  it('declares every DSH runtime peer as the current workspace runtime', () => {
    expect(Object.keys(dshPeers).length).toBeGreaterThan(0)
    expect(dshPeers).toEqual(
      Object.fromEntries(Object.keys(dshPeers).map((name) => [name, 'workspace:*'])),
    )
  })

  it('uses the intentionally broad DSH core engine gate', () => {
    expect(packageManifest.engines.dsh).toBe('*')
  })

  it('keeps non-DSH compatibility ranges stable', () => {
    expect(packageManifest.peerDependencies).toMatchObject({
      '@deepseek-ai/cordis': '~4.0.4',
      '@deepseek-ai/schemastery': '~3.18.4',
      react: '>=18',
    })
  })

  it('keeps package and DSH manifest versions identical', () => {
    expect(packageManifest.version).toBe('0.1.0-mvp.8')
    expect(packageManifest.version).toBe(pluginManifest.version)
  })
})
