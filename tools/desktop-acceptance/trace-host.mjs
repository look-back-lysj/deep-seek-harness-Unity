import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { captureDnsShape } from '../review-probes/dns-shape-20261004.mjs'
import { assertSafeRemoteUrl, safeFetch, readLimitedResponse } from '../../packages/market-core/src/delivery/security.ts'

export const inject = ['typert', 'loader', 'profileContext']

export function apply(ctx) {
  const home = process.env.DSH_HOME
  if (!home || !home.includes('eac-market-verify')) throw new Error('Host trace requires an isolated acceptance home')
  const directory = join(home, 'acceptance-trace')
  mkdirSync(directory, { recursive: true })
  const file = join(directory, 'registry.jsonl')
  const entries = () => [...ctx.loader.entries()].filter(entry => /settings|typert|market/.test(entry.options.name ?? '')).map(entry => ({
    id: entry.id, name: entry.options.name, disabled: entry.disabled, state: entry.fiber?.state, uid: entry.fiber?.uid, present: entry.fiber !== undefined,
  }))
  const local = ctx.typert.local
  const log = (event, details = {}) => appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), event, settingsPresent: !!local.get('settings/describe'),
    settingsSeen: local.hasSeen('settings/describe'), entries: entries(), ...details }) + '\n')
  log('trace-mounted')
  local.subscribe(change => {
    if (/^(settings|eacMarket)\//.test(change.key)) log('descriptor-change', { key: change.key, stack: new Error('trace-only').stack })
  })
  ctx.on('internal/plugin', fiber => {
    log('plugin-change', { name: fiber.name, entryName: fiber.entry?.options.name, uid: fiber.uid, state: fiber.state })
  })
  ctx.on('internal/status', (fiber, previous) => {
    if (/settings|typert|market/.test(fiber.name)) log('plugin-status', { name: fiber.name, uid: fiber.uid, previous, state: fiber.state, effects: fiber.getEffects(), failure: fiber._error ? { name: fiber._error.name, message: fiber._error.message, errors: fiber._error.errors?.map(error => ({ name: error.name, message: error.message, stack: error.stack })) } : undefined, stack: new Error('trace-only').stack })
  })
  void captureDnsShape({ lookup, isIP, assertSafeRemoteUrl, hostnames: ['gitee.com', 'api.github.com', 'raw.giteeusercontent.com', 'raw.githubusercontent.com'], resolve: specifier => import.meta.resolve(specifier) }).then(result => log('host-dns', { result }), error => log('host-dns-error', { name: error?.name, code: error?.code }))
  void (async () => {
    for (const [id, url, headers] of [
      ['catalog-gitee', 'https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror/raw/master/catalog/index.json', {}],
      ['catalog-github', 'https://api.github.com/repos/look-back-lysj/deep-seek-harness-Unity/contents/catalog/index.json?ref=distribution', { accept: 'application/vnd.github.raw+json', 'user-agent': 'EAC-Market' }],
    ]) {
      try {
        const response = await safeFetch(url, { headers, timeoutMs: 15000 })
        const bytes = await readLimitedResponse(response, 8 * 1024 * 1024)
        log('host-network', { id, status: response.status, bytes: bytes.length })
      } catch (error) { log('host-network', { id, error: { name: error?.name, code: error?.code, message: error?.message } }) }
    }
  })()
  const timer = setInterval(() => log('sample'), 2000)
  timer.unref()
  ctx.effect(() => () => { clearInterval(timer); log('trace-disposed') })
}
