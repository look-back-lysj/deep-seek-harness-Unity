import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ArtifactCache,
  DeliveryError,
  assertSafeRemoteUrl,
  safeFetch,
  verifyTgzFile,
} from '../../packages/market/src/delivery/index.ts'
import type { CatalogDelivery } from '../../packages/market/src/contracts/types.ts'
import { createTgz, digest, validTgz } from './fixtures.ts'

function withTemp<T>(name: string, action: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), name))
  return Promise.resolve(action(root)).finally(() => {
    expect(root.startsWith(tmpdir())).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })
}

describe('下载来源安全', () => {
  it('拒绝 HTTPS URL 解析到本机/私网', async () => {
    await expect(assertSafeRemoteUrl('https://127.0.0.1/file.tgz')).rejects.toMatchObject({ code: 'delivery/private-address' })
    await expect(assertSafeRemoteUrl('http://example.com/file.tgz')).rejects.toMatchObject({ code: 'delivery/insecure-url' })
  })

  it('逐次拒绝重定向到本机私网', async () => {
    let calls = 0
    const fetcher = (async () => {
      calls += 1
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/download.tgz' } })
    }) as typeof fetch
    await expect(
      safeFetch('https://example.com/start', {
        lookup: async () => ['93.184.216.34'],
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^delivery\/(private-address|insecure-url)$/) })
    expect(calls).toBe(1)
  })
})

describe('tgz 正反 fixture', () => {
  it('接受同摘要同身份的有效 tgz', async () => {
    await withTemp('eac-tgz-valid-', async (root) => {
      const bytes = validTgz()
      const path = join(root, 'alpha.tgz')
      writeFileSync(path, bytes)
      await expect(verifyTgzFile(path, {
        artifactDigest: digest(bytes),
        packageName: '@test/alpha',
        version: '1.2.3',
        requireBundle: true,
      })).resolves.toMatchObject({ packageName: '@test/alpha', version: '1.2.3', bundlePatch: './cordis.patch.yml' })
    })
  })

  it.each([
    ['摘要不符', (bytes: Uint8Array) => ({ artifactDigest: `sha256:${'0'.repeat(64)}`, packageName: '@test/alpha', version: '1.2.3' }), 'tgz/digest-mismatch'],
    ['包身份不符', (bytes: Uint8Array) => ({ artifactDigest: digest(bytes), packageName: '@test/other', version: '1.2.3' }), 'tgz/identity-mismatch'],
    ['缺少bundle声明', (bytes: Uint8Array) => ({ artifactDigest: digest(bytes), packageName: '@test/alpha', version: '1.2.3', requireBundle: true }), 'tgz/missing-bundle-declaration'],
  ])('拒绝%s', async (_label, makeExpected, code) => {
    await withTemp('eac-tgz-bad-', async (root) => {
      const bytes = _label === '缺少bundle声明'
        ? createTgz([{ path: 'package/package.json', data: JSON.stringify({ name: '@test/alpha', version: '1.2.3' }) }])
        : validTgz()
      const path = join(root, 'bad.tgz')
      writeFileSync(path, bytes)
      await expect(verifyTgzFile(path, makeExpected(bytes))).rejects.toMatchObject({ code })
    })
  })

  it('拒绝路径穿越、符号链接和解压膨胀', async () => {
    await withTemp('eac-tgz-unsafe-', async (root) => {
      const traversal = createTgz([
        { path: 'package/package.json', data: JSON.stringify({ name: '@test/alpha', version: '1.2.3' }) },
        { path: '../escape.txt', data: 'x' },
      ])
      const traversalPath = join(root, 'traversal.tgz')
      writeFileSync(traversalPath, traversal)
      await expect(verifyTgzFile(traversalPath, {
        artifactDigest: digest(traversal), packageName: '@test/alpha', version: '1.2.3',
      })).rejects.toMatchObject({ code: 'tgz/unsafe-path' })

      const symlink = createTgz([
        { path: 'package/package.json', data: JSON.stringify({ name: '@test/alpha', version: '1.2.3' }) },
        { path: 'package/link', data: '', type: 'symlink', linkName: '../../outside' },
      ])
      const symlinkPath = join(root, 'symlink.tgz')
      writeFileSync(symlinkPath, symlink)
      await expect(verifyTgzFile(symlinkPath, {
        artifactDigest: digest(symlink), packageName: '@test/alpha', version: '1.2.3',
      })).rejects.toMatchObject({ code: 'tgz/link-forbidden' })

      const valid = validTgz()
      const bombPath = join(root, 'bomb.tgz')
      writeFileSync(bombPath, valid)
      await expect(verifyTgzFile(bombPath, {
        artifactDigest: digest(valid), packageName: '@test/alpha', version: '1.2.3',
      }, { maxExpandedBytes: 10 })).rejects.toMatchObject({ code: 'tgz/expanded-too-large' })
    })
  })
})

describe('Delivery 同制品镜像与缓存引用', () => {
  it('模拟多源中坏字节被拒绝、同摘要好字节才可安装交付', async () => {
    await withTemp('eac-delivery-mirror-', async (root) => {
      const good = validTgz()
      const bad = validTgz('@test/alpha', '1.2.3')
      const goodPath = join(root, 'good.tgz')
      const badPath = join(root, 'bad.tgz')
      writeFileSync(goodPath, good)
      writeFileSync(badPath, Buffer.from('not the declared bytes'))
      const delivery: CatalogDelivery = {
        pluginId: 'dev.test.alpha',
        version: '1.2.3',
        artifactDigest: digest(good),
        packageName: '@test/alpha',
        sources: [
          { kind: 'local-file', ref: badPath, priority: 0 },
          { kind: 'local-file', ref: goodPath, priority: 1 },
        ],
      }
      const cache = new ArtifactCache({ cacheDir: join(root, 'cache'), allowLocalFileSources: [root] })
      const result = await cache.download(delivery, {
        referenceId: 'task-1',
        referenceKind: 'active-task',
        requireBundle: true,
        allowLocalFileSources: [root],
      })
      expect(result.attempts.map((item) => item.status)).toEqual(['digest-mismatch', 'accepted'])
      expect(result.localPath).toBe(cache.pathFor(digest(good)))
      expect(result.verified.packageName).toBe('@test/alpha')
    })
  })

  it('有 active/installed 引用的缓存不会被 prune 删除', async () => {
    await withTemp('eac-delivery-cache-', async (root) => {
      const bytes = validTgz()
      const sourcePath = join(root, 'alpha.tgz')
      writeFileSync(sourcePath, bytes)
      const cache = new ArtifactCache({ cacheDir: join(root, 'cache'), allowLocalFileSources: [root] })
      const delivery: CatalogDelivery = {
        pluginId: 'dev.test.alpha',
        version: '1.2.3',
        artifactDigest: digest(bytes),
        packageName: '@test/alpha',
        sources: [{ kind: 'local-file', ref: sourcePath, priority: 0 }],
      }
      const acquired = await cache.download(delivery, {
        referenceId: 'task-keep',
        referenceKind: 'installed',
        requireBundle: true,
        allowLocalFileSources: [root],
      })
      const old = new Date(Date.now() - 60_000)
      utimesSync(acquired.localPath, old, old)
      expect(cache.pruneUnreferenced(new Date())).toEqual([])
      cache.release(digest(bytes), 'task-keep')
      expect(cache.pruneUnreferenced(new Date())).toEqual([`${digest(bytes).slice(7)}.tgz`])
    })
  })
})
