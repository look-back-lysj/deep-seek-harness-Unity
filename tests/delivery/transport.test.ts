import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ArtifactCache, DeliveryError, safeFetch } from '../../packages/market-core/src/delivery/index.ts'
import { DeliverySecurityError } from '../../packages/market-core/src/delivery/security.ts'
import type { CatalogDelivery, DeliverySource } from '../../packages/market-core/src/contracts/types.ts'
import { createTgz, digest, validTgz } from './fixtures.ts'

function withTemp<T>(action: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'eac-network-'))
  return Promise.resolve(action(root)).finally(() => rmSync(root, { recursive: true, force: true }))
}

const makeDelivery = (bytes: Uint8Array, sources: readonly DeliverySource[] = [
  { kind: 'https-artifact', ref: 'https://origin.example.test/plugin.tgz', priority: 0 },
]): CatalogDelivery => ({
  pluginId: 'test.alpha', packageName: '@test/alpha', version: '1.2.3', artifactDigest: digest(bytes), sources,
})

function interruptedResponse(bytes: Uint8Array, splitAt: number, etag = '\"fixture-v1\"'): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, splitAt))
      setTimeout(() => controller.error(new TypeError('socket reset while downloading')), 10)
    },
  })
  return new Response(body, { status: 200, headers: { 'content-length': String(bytes.byteLength), etag } })
}

function successfulRange(bytes: Uint8Array, start: number, etag = '"fixture-v1"'): Response {
  const tail = bytes.subarray(start)
  return new Response(tail, { status: 206, headers: {
    'content-length': String(tail.byteLength), 'content-range': `bytes ${start}-${bytes.byteLength - 1}/${bytes.byteLength}`, etag,
  } })
}

describe('稳定远端制品传输', () => {
  it('按 HTTPS_PROXY 与 NO_PROXY 规则逐请求注入 dispatcher，不改变全局 fetch', async () => {
    const originalFetch = globalThis.fetch
    const calls: Array<{ url: string; dispatcher: unknown }> = []
    const selectedProxies: string[] = []
    const dispatcherA = { id: 'proxy-dispatcher' }
    const fetcher = (async (url, init) => {
      calls.push({ url: String(url), dispatcher: (init as RequestInit & { dispatcher?: unknown }).dispatcher })
      return new Response('ok')
    }) as typeof fetch
    const security = {
      lookup: async () => ['93.184.216.34'],
      proxy: { httpsProxy: 'http://market-user:market-secret@proxy.example.test:8080', noProxy: '.internal.example.test,10.0.0.0/8' },
      dispatcherForProxy: (url: URL) => { selectedProxies.push(url.href); return dispatcherA },
      fetch: fetcher,
    }
    await safeFetch('https://assets.example.test/a.tgz', security)
    await safeFetch('https://mirror.internal.example.test/a.tgz', security)
    expect(calls).toEqual([
      { url: 'https://assets.example.test/a.tgz', dispatcher: dispatcherA },
      { url: 'https://mirror.internal.example.test/a.tgz', dispatcher: undefined },
    ])
    expect(selectedProxies).toEqual(['http://market-user:market-secret@proxy.example.test:8080/'])
    expect(globalThis.fetch).toBe(originalFetch)
  })

  it('代理凭据不会写进来源失败诊断', async () => withTemp(async root => {
    const bytes = validTgz()
    const cache = new ArtifactCache({
      cacheDir: join(root, 'cache'), lookup: async () => ['93.184.216.34'], maxRetries: 0,
      proxy: { httpsProxy: 'http://proxy-user:proxy-password@proxy.example.test:8080' },
      dispatcherForProxy: () => ({ dispatcher: 'test' }),
      fetch: (async () => { throw new Error('proxy rejected request via https://proxy-user:proxy-password@proxy.example.test:8080/?token=private-signature') }) as typeof fetch,
    })
    await expect(cache.download(makeDelivery(bytes), { referenceId: 'task', referenceKind: 'active-task' })).rejects.toMatchObject({
      attempts: [expect.objectContaining({ status: 'network-failed', reason: expect.not.stringContaining('proxy-password') })],
    })
  }))

  it('断流后流式保留 .part，并用严格 206/Content-Range/ETag 续传', async () => withTemp(async root => {
    const bytes = createTgz([
      { path: 'package/package.json', data: JSON.stringify({ name: '@test/alpha', version: '1.2.3', dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } }) },
      { path: 'package/cordis.patch.yml', data: 'insert: []\n' },
      { path: 'package/payload.bin', data: randomBytes(220 * 1024) },
    ])
    const splitAt = 70 * 1024
    const requests: Array<{ range: string | null; ifRange: string | null }> = []
    const cacheDir = join(root, 'cache')
    const cache = new ArtifactCache({
      cacheDir, lookup: async () => ['93.184.216.34'], maxRetries: 2,
      retryBaseDelayMs: 0,
      fetch: (async (_url, init) => {
        const headers = new Headers(init?.headers)
        requests.push({ range: headers.get('range'), ifRange: headers.get('if-range') })
        if (requests.length === 1) return interruptedResponse(bytes, splitAt)
        return successfulRange(bytes, splitAt)
      }) as typeof fetch,
    })
    const progress: Array<{ stage: string; resumed: boolean }> = []
    const result = await cache.download(makeDelivery(bytes, [{ kind: 'https-artifact', ref: 'https://origin.example.test/plugin.tgz', priority: 0, size: bytes.byteLength }]), {
      referenceId: 'task-range', referenceKind: 'active-task', requireBundle: true,
      onProgress: async event => { progress.push({ stage: event.stage, resumed: event.resumed }) },
    })
    expect(requests).toEqual([
      { range: null, ifRange: null },
      { range: `bytes=${splitAt}-`, ifRange: '"fixture-v1"' },
    ])
    expect(result.verified.artifactDigest).toBe(digest(bytes))
    expect(result.verified.size).toBe(bytes.byteLength)
    expect(progress.some(event => event.stage === 'retrying')).toBe(true)
    expect(progress.some(event => event.stage === 'completed')).toBe(true)
    expect(progress.some(event => event.stage === 'retrying' && event.resumed)).toBe(true)
    expect(readdirSync(join(cacheDir, 'tmp')).some(name => name.endsWith('.part'))).toBe(false)
  }))

  it('无效 Content-Range 或变化的 ETag 会丢弃残片并发起全量 GET', async () => withTemp(async root => {
    const bytes = createTgz([
      { path: 'package/package.json', data: JSON.stringify({ name: '@test/alpha', version: '1.2.3', dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } }) },
      { path: 'package/cordis.patch.yml', data: 'insert: []\n' },
      { path: 'package/payload.bin', data: randomBytes(220 * 1024) },
    ])
    const splitAt = 70 * 1024
    const requests: Array<{ range: string | null; ifRange: string | null }> = []
    const cache = new ArtifactCache({ cacheDir: join(root, 'cache'), lookup: async () => ['93.184.216.34'], maxRetries: 2, retryBaseDelayMs: 0,
      fetch: (async (_url, init) => {
        const headers = new Headers(init?.headers)
        requests.push({ range: headers.get('range'), ifRange: headers.get('if-range') })
        if (requests.length === 1) return interruptedResponse(bytes, splitAt)
        if (requests.length === 2) {
          const tail = bytes.subarray(splitAt)
          return new Response(tail, { status: 206, headers: {
            'content-length': String(tail.byteLength), 'content-range': `bytes ${splitAt + 1}-${bytes.byteLength}/${bytes.byteLength}`,
            etag: '"fixture-v2"',
          } })
        }
        return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength), etag: '"fixture-v2"' } })
      }) as typeof fetch,
    })
    const result = await cache.download(makeDelivery(bytes, [{ kind: 'https-artifact', ref: 'https://origin.example.test/plugin.tgz', priority: 0, size: bytes.byteLength }]), {
      referenceId: 'task-restart', referenceKind: 'active-task', requireBundle: true,
    })
    expect(requests.map(request => request.range)).toEqual([null, `bytes=${splitAt}-`, null])
    expect(requests[1]?.ifRange).toBe('"fixture-v1"')
    expect(result.verified.artifactDigest).toBe(digest(bytes))
  }))

  it('If-Range 命中的 206 若 ETag 已变化，会丢弃旧 .part 并从头下载', async () => withTemp(async root => {
    const bytes = createTgz([
      { path: 'package/package.json', data: JSON.stringify({ name: '@test/alpha', version: '1.2.3', dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } }) },
      { path: 'package/cordis.patch.yml', data: 'insert: []\n' },
      { path: 'package/payload.bin', data: randomBytes(220 * 1024) },
    ])
    const splitAt = 70 * 1024
    const ranges: Array<string | null> = []
    const cache = new ArtifactCache({ cacheDir: join(root, 'cache'), lookup: async () => ['93.184.216.34'], maxRetries: 2, retryBaseDelayMs: 0,
      fetch: (async (_url, init) => {
        ranges.push(new Headers(init?.headers).get('range'))
        if (ranges.length === 1) return interruptedResponse(bytes, splitAt, '\"old-etag\"')
        if (ranges.length === 2) return successfulRange(bytes, splitAt, '\"new-etag\"')
        return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength), etag: '\"new-etag\"' } })
      }) as typeof fetch,
    })
    const result = await cache.download(makeDelivery(bytes, [{ kind: 'https-artifact', ref: 'https://origin.example.test/etag.tgz', priority: 0, size: bytes.byteLength }]), {
      referenceId: 'task-etag', referenceKind: 'active-task', requireBundle: true,
    })
    expect(ranges).toEqual([null, `bytes=${splitAt}-`, null])
    expect(result.verified.artifactDigest).toBe(digest(bytes))
  }))

  it('响应头阶段有单独的超时，不会等待一个不响应的 fetch', async () => {
    const pendingFetch = (() => new Promise<Response>(() => undefined)) as typeof fetch
    await expect(safeFetch('https://slow.example.test/file', {
      lookup: async () => ['93.184.216.34'], fetch: pendingFetch, headersTimeoutMs: 10, timeoutMs: 500,
    })).rejects.toMatchObject({ code: 'delivery/headers-timeout' })
  })

  it('有效缓存不因另一个镜像的错误 size 声明被拒绝', async () => withTemp(async root => {
    const bytes = validTgz(), cacheDir = join(root, 'cache')
    const good = { kind: 'https-artifact' as const, ref: 'https://good.example.test/a.tgz', priority: 0, size: bytes.byteLength }
    const cache = new ArtifactCache({ cacheDir, allowLocalFileSources: [root] })
    const path = cache.pathFor(digest(bytes))
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, bytes)
    const delivery = makeDelivery(bytes, [
      { kind: 'https-artifact', ref: 'https://bad.example.test/a.tgz', priority: 0, size: bytes.byteLength + 1 },
      good,
    ])
    const result = await cache.download(delivery, { referenceId: 'task-cache', referenceKind: 'active-task', requireBundle: true })
    expect(result.localPath).toBe(path)
    expect(result.attempts).toEqual([])
  }))

  it('并发请求同一摘要共用一次远端传输并分别保留缓存引用', async () => withTemp(async root => {
    const bytes = createTgz([
      { path: 'package/package.json', data: JSON.stringify({ name: '@test/alpha', version: '1.2.3', dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } }) },
      { path: 'package/cordis.patch.yml', data: 'insert: []\n' },
      { path: 'package/payload.bin', data: randomBytes(120 * 1024) },
    ])
    let networkRequests = 0
    const cacheDir = join(root, 'cache')
    const cache = new ArtifactCache({ cacheDir, lookup: async () => ['93.184.216.34'], maxRetries: 0,
      fetch: (async () => {
        networkRequests += 1
        await new Promise(resolve => setTimeout(resolve, 15))
        return new Response(bytes, { headers: { 'content-length': String(bytes.byteLength), etag: '\"shared-v1\"' } })
      }) as typeof fetch,
    })
    const delivery = makeDelivery(bytes, [{ kind: 'https-artifact', ref: 'https://origin.example.test/shared.tgz', priority: 0, size: bytes.byteLength }])
    const [left, right] = await Promise.all([
      cache.download(delivery, { referenceId: 'task-left', referenceKind: 'active-task', requireBundle: true }),
      cache.download(delivery, { referenceId: 'task-right', referenceKind: 'installed', requireBundle: true }),
    ])
    expect(networkRequests).toBe(1)
    expect(left.localPath).toBe(right.localPath)
    const references = JSON.parse(readFileSync(join(cacheDir, 'refs', 'index.json'), 'utf8')) as { references: Record<string, Array<{ id: string; kind: string }>> }
    expect(references.references[digest(bytes)]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'task-left', kind: 'active-task' }),
      expect.objectContaining({ id: 'task-right', kind: 'installed' }),
    ]))
  }))

  it('404 不会在同一来源重复尝试，且只尝试已登记备用镜像', async () => withTemp(async root => {
    const bytes = validTgz(), called: string[] = []
    const cache = new ArtifactCache({ cacheDir: join(root, 'cache'), lookup: async () => ['93.184.216.34'], maxRetries: 3,
      fetch: (async url => { called.push(String(url)); return new Response('missing', { status: 404 }) }) as typeof fetch,
    })
    const delivery = makeDelivery(bytes, [
      { kind: 'https-artifact', ref: 'https://primary.example.test/a.tgz', priority: 0 },
      { kind: 'https-artifact', ref: 'https://mirror.example.test/a.tgz', priority: 1 },
    ])
    await expect(cache.download(delivery, { referenceId: 'task-404', referenceKind: 'active-task' })).rejects.toBeInstanceOf(DeliveryError)
    expect(called).toEqual(['https://primary.example.test/a.tgz', 'https://mirror.example.test/a.tgz'])
  }))
})
