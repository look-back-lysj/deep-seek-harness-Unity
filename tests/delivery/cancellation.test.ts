import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ArtifactCache, verifyTgzFile } from '../../packages/market/src/delivery/index.ts'
import { createTgz, digest, validTgz } from './fixtures.ts'

const delivery = (bytes: Uint8Array) => ({ pluginId: 'dev.test.alpha', packageName: '@test/alpha', version: '1.2.3', artifactDigest: digest(bytes), sources: [{ kind: 'https-artifact' as const, ref: 'https://primary.example.test/a.tgz', priority: 0 }, { kind: 'https-artifact' as const, ref: 'https://mirror.example.test/a.tgz', priority: 1 }] })

it('预取消零请求；流停滞时中止也不切镜像、不提交缓存', async () => {
  const controller = new AbortController()
  const bytes = validTgz()
  let requests = 0
  let started: () => void = () => undefined
  const ready = new Promise<void>(resolve => { started = resolve })
  const root = mkdtempSync(join(tmpdir(), 'delivery-abort-'))
  const cache = new ArtifactCache({ cacheDir: root, lookup: async () => ['93.184.216.34'], fetch: (async () => { requests++; started(); return new Response(new ReadableStream({ start() {} })) }) as typeof fetch })
  const operation = cache.download(delivery(bytes), { referenceId: 'task', referenceKind: 'active-task', signal: controller.signal })
  await ready
  controller.abort()
  await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
  expect(requests).toBe(1)
  expect(existsSync(cache.pathFor(digest(bytes)))).toBe(false)
  await expect(cache.download(delivery(bytes), { referenceId: 'task2', referenceKind: 'active-task', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(requests).toBe(1)
})

it('冻结来源不受 await 期间调用者修改影响，故障后只使用原镜像描述', async () => {
  const bytes = validTgz(), input = delivery(bytes)
  const attempted: string[] = []
  const root = mkdtempSync(join(tmpdir(), 'delivery-frozen-'))
  const cache = new ArtifactCache({ cacheDir: root, lookup: async () => ['93.184.216.34'], fetch: (async url => {
    attempted.push(String(url))
    if (attempted.length === 1) { input.sources[1]!.ref = 'https://surprise.example.test/new.tgz'; throw new Error('timeout') }
    return new Response(bytes)
  }) as typeof fetch })
  const result = await cache.download(input, { referenceId: 'task', referenceKind: 'active-task', requireBundle: true })
  expect(attempted[1]).toBe('https://mirror.example.test/a.tgz')
  expect(result.attempts.map(item => item.status)).toEqual(['network-failed', 'accepted'])
})

it('已声明但不存在的 bundle patch 拒绝；路径越界不交给官方安装', async () => {
  for (const patch of ['./missing.yml', '../escape.yml']) {
    const bytes = createTgz([{ path: 'package/package.json', data: JSON.stringify({ name: '@test/alpha', version: '1.2.3', dsh: { bundle: { patch } } }) }])
    const path = join(mkdtempSync(join(tmpdir(), 'delivery-patch-')), 'fixture.tgz')
    writeFileSync(path, bytes)
    await expect(verifyTgzFile(path, { artifactDigest: digest(bytes), packageName: '@test/alpha', version: '1.2.3', requireBundle: true })).rejects.toThrow()
  }
})
