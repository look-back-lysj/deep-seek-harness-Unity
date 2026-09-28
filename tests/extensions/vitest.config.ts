import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
const market = resolve('packages/market/node_modules')
const official = process.env.DSH_SOURCE_DIR
if (!official) throw new Error('Set DSH_SOURCE_DIR to the official 0.1.7-rc.2 source checkout for this optional suite.')
export default defineConfig({
  cacheDir: resolve('node_modules/.cache/eac-extension-tests'),
  resolve: { alias: [
    { find: /^react(\/.*)?$/, replacement: `${market}/react$1` },
    { find: /^react-dom(\/.*)?$/, replacement: `${market}/react-dom$1` },
    { find: '@deepseek-ai/cordis', replacement: `${market}/@deepseek-ai/cordis/lib/index.js` },
    { find: '@deepseek-ai/dsh-client-ui-slots', replacement: `${market}/@deepseek-ai/dsh-client-ui-slots/lib/index.js` },
    { find: '@official/slot-registry', replacement: resolve(official, 'packages/client/ui-renderer/src/client/registry.ts') },
    { find: '@official/module-system', replacement: resolve(official, 'packages/client/modules/src/client/system.ts') },
    { find: '@official/module-manifest', replacement: resolve(official, 'packages/client/modules/src/client/manifest.ts') },
  ] },
  test: { include: ['tests/extensions/**/*.test.ts', 'tests/extensions/**/*.check.ts'], fileParallelism: false },
})
