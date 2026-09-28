import { describe, expect, it } from 'vitest'
import { CacheReferenceIndex } from '../../packages/market/src/core/cache.ts'

describe('cache reference cleanup', () => {
  it('protects active task and installed market-managed references', () => {
    const index = new CacheReferenceIndex([
      { digest: 'a', localRef: 'cache/a.tgz', taskId: 'task-a', installed: false },
      { digest: 'b', localRef: 'cache/b.tgz', taskId: 'task-b', packageName: 'b', installed: true },
    ])
    const active = index.collect(['task-a'])
    expect(active.protectedLocalRefs).toEqual(['cache/a.tgz', 'cache/b.tgz'])
    expect(active.deletableLocalRefs).toEqual([])

    index.releaseTask('task-a')
    const afterRelease = index.collect([])
    expect(afterRelease.deletableLocalRefs).toEqual(['cache/a.tgz'])
    expect(afterRelease.protectedLocalRefs).toEqual(['cache/b.tgz'])
  })

  it('keeps a released artifact protected after it becomes an installed dependency', () => {
    const index = new CacheReferenceIndex([
      { digest: 'a', localRef: 'cache/a.tgz', taskId: 'task-a', installed: false },
    ])
    index.markInstalled('cache/a.tgz', 'pkg-a')
    index.releaseTask('task-a')
    const decision = index.collect([])
    expect(decision.protectedLocalRefs).toEqual(['cache/a.tgz'])
    expect(decision.deletableLocalRefs).toEqual([])
    expect(index.snapshot()[0]?.packageName).toBe('pkg-a')
  })
})
