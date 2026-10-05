import * as dnsPromises from 'node:dns/promises'
import { isIP } from 'node:net'

const HOSTNAMES = ['gitee.com', 'api.github.com', 'raw.githubusercontent.com']
const IP_SAMPLES = ['93.184.216.34', '198.18.0.1', '127.0.0.1', '2606:4700:4700::1111', '::1', 'invalid']
const PROXY_NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']

function errorFact(error) {
  return {
    name: typeof error?.name === 'string' ? error.name : 'unknown',
    ...(typeof error?.code === 'string' ? { code: error.code } : {}),
  }
}

export function captureLookupResult(value, classify = isIP) {
  if (!Array.isArray(value)) return { shape: 'non-array', type: value === null ? 'null' : typeof value }
  const entries = Array.from(value, item => {
    const record = typeof item === 'object' && item !== null && !Array.isArray(item)
    const address = typeof item === 'string' ? item : record ? item.address : undefined
    const kind = typeof address === 'string' ? classify(address) : 0
    return {
      shape: typeof item === 'string' ? 'string' : record ? 'record' : 'invalid',
      addressType: typeof address,
      ...(kind === 4 || kind === 6 ? { address, kind } : { kind: 0 }),
      ...(record ? { family: typeof item.family === 'number' ? item.family : null } : {}),
    }
  })
  return { shape: 'array', length: value.length, entries }
}

async function boundedCapture(action, timeoutMs) {
  let timer
  try {
    return { ok: true, value: await Promise.race([
      Promise.resolve().then(action),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Probe timeout'), { code: 'probe/timeout' })), timeoutMs)
      }),
    ]) }
  } catch (error) {
    return { ok: false, error: errorFact(error) }
  } finally {
    clearTimeout(timer)
  }
}

function moduleFact(specifier, resolve) {
  try {
    const resolved = resolve(specifier)
    return { specifier, builtin: resolved === specifier, protocol: new URL(resolved).protocol }
  } catch (error) {
    return { specifier, error: errorFact(error) }
  }
}

export async function captureDnsShape(options = {}) {
  const resolver = options.lookup ?? dnsPromises.lookup
  const classify = options.isIP ?? isIP
  const resolve = options.resolve ?? (specifier => import.meta.resolve(specifier))
  const hostnames = options.hostnames ?? HOSTNAMES
  const timeoutMs = options.timeoutMs ?? 5_000
  const hosts = []
  for (const hostname of hostnames) {
    const calls = []
    for (const lookupOptions of [{ all: true }, { all: true, order: 'verbatim' }]) {
      const result = await boundedCapture(() => resolver(hostname, lookupOptions), timeoutMs)
      calls.push({ options: lookupOptions, ...(result.ok
        ? { ok: true, result: captureLookupResult(result.value, classify) }
        : result) })
    }
    const gate = options.assertSafeRemoteUrl === undefined
      ? { tested: false }
      : await boundedCapture(async () => {
        await options.assertSafeRemoteUrl(`https://${hostname}/`)
        return { allowed: true }
      }, timeoutMs)
    hosts.push({ hostname, calls, gate })
  }
  return {
    probe: 'dns-shape-20261004',
    runtime: { node: process.versions.node, electron: process.versions.electron ?? null },
    modules: ['node:dns/promises', 'node:net'].map(specifier => moduleFact(specifier, resolve)),
    lookupFunction: { name: resolver.name, arity: resolver.length },
    ipSamples: IP_SAMPLES.map(address => ({ address, kind: classify(address) })),
    proxyConfigured: Object.fromEntries(PROXY_NAMES.map(name => [name, Boolean(process.env[name]?.trim())])),
    hosts,
  }
}

if (import.meta.main) {
  const argument = process.argv.find(value => value.startsWith('--security-module='))
  const security = argument === undefined ? undefined : await import(argument.slice('--security-module='.length))
  if (security !== undefined && typeof security.assertSafeRemoteUrl !== 'function') {
    throw new Error('Explicit security module must export assertSafeRemoteUrl')
  }
  console.log(JSON.stringify(await captureDnsShape({ assertSafeRemoteUrl: security?.assertSafeRemoteUrl }), null, 2))
}
