import { describe, expect, it } from 'vitest'
import { createTaskBrowserHarness } from './task-browser-harness.ts'

const { state, until, settle, click, disabled, readyProposal } = createTaskBrowserHarness()


import { TaskRequestGuard } from '../../packages/market/src/client/task-request-guard.ts'

describe('纯请求锁', () => {
  it('超时停止接受回包仍持有原锁；只有 finish 解锁', () => {
    const guard = new TaskRequestGuard()
    const ticket = guard.begin()!
    expect(guard.accepts(ticket)).toBe(true)
    guard.expire(ticket)
    expect(guard.accepts(ticket)).toBe(false)
    expect(guard.pending).toBe(true)
    expect(guard.begin()).toBeUndefined()
    expect(guard.finish(ticket)).toBe(true)
    expect(guard.pending).toBe(false)
    expect(guard.begin()).toBeDefined()
  })
  it('失效旧请求不能解除新请求锁', () => {
    const guard = new TaskRequestGuard()
    const oldTicket = guard.begin()!
    guard.invalidate()
    const newTicket = guard.begin()!
    expect(guard.finish(oldTicket)).toBe(false)
    expect(guard.accepts(newTicket)).toBe(true)
    expect(guard.pending).toBe(true)
  })
})

describe('TaskCard 原 Promise 在途锁（真实 React / 隔离 Edge）', () => {
  it.each([
    { kind: 'cancel', status: 'installing', button: '取消任务' },
    { kind: 'approve', status: 'awaiting-approval', button: '同意运行清单内脚本并继续' },
    { kind: 'resume', status: 'awaiting-resume', button: '已重启，重新核对' },
  ])('$kind updatedAt 不解锁，双击不重发，真实结果后解锁', async ({ kind, status, button }) => {
    await settle('fixture.render(' + JSON.stringify({ status, approval: { id: 'approval', attemptId: 'attempt', digest: 'digest', packages: ['@example/alpha'], createdAt: '2026-10-04T00:00:00Z' }, resume: { id: 'resume', digest: 'digest', remainingPluginIds: ['plugin-alpha'], createdAt: '2026-10-04T00:00:00Z' } }) + ')')
    await settle('fixture.click(' + JSON.stringify(button) + '); fixture.click(' + JSON.stringify(button) + ')')
    await until('fixture.calls.' + kind + '.length === 1')
    await settle('fixture.render({ updatedAt: "2026-10-04T01:00:00Z" })')
    expect(await disabled(button)).toBe(true)
    await click(button)
    expect((await state()).calls[kind]).toHaveLength(1)
    await settle('fixture.complete(' + JSON.stringify(kind) + ', 0, { ...fixture.task, status: "cancelled" })')
    expect((await state()).changed).toHaveLength(1)
    expect(await disabled(button)).toBe(false)
    expect((await state()).errors).toEqual([])
  })
  it.each(['resolve', 'reject'])('取消超时直到原 Promise %s 才解锁', async result => {
    await settle('fixture.render({ status: "installing" })')
    await click('取消任务')
    await settle('fixture.expire(12000)')
    expect((await state()).text).toContain('原请求仍可能执行中')
    expect(await disabled('取消任务')).toBe(true)
    await settle('fixture.render({ updatedAt: "2026-10-04T02:00:00Z" })')
    await click('取消任务')
    expect((await state()).calls.cancel).toHaveLength(1)
    if (result === 'resolve') await settle('fixture.complete("cancel", 0, { ...fixture.task, status: "cancelled" })')
    else await settle('fixture.reject("cancel", 0, "迟到取消错误")')
    expect(await disabled('取消任务')).toBe(false)
    expect((await state()).changed).toEqual([])
    expect((await state()).errors).toEqual([])
    expect((await state()).text).not.toContain('迟到取消错误')
  })
  it.each(['approve', 'resume'])('%s 超时不得解锁或重发', async kind => {
    const button = kind === 'approve' ? '同意运行清单内脚本并继续' : '已重启，重新核对'
    await settle('fixture.render(' + JSON.stringify({ status: kind === 'approve' ? 'awaiting-approval' : 'awaiting-resume', approval: { id: 'approval', attemptId: 'attempt', digest: 'digest', packages: ['@example/alpha'] }, resume: { id: 'resume', digest: 'digest', remainingPluginIds: ['plugin-alpha'] } }) + ')')
    await click(button)
    await settle('fixture.expire(12000); fixture.render({ updatedAt: "2026-10-04T03:00:00Z" })')
    expect(await disabled(button)).toBe(true)
    await click(button)
    expect((await state()).calls[kind]).toHaveLength(1)
    await settle('fixture.complete(' + JSON.stringify(kind) + ', 0, fixture.task)')
    expect(await disabled(button)).toBe(false)
    expect((await state()).changed).toEqual([])
  })
  it('AI 确认 updatedAt 不重置方案/key，确认超时不能二次写', async () => {
    await readyProposal()
    await click('确认执行 AI 方案')
    const firstKey = (await state()).calls.confirm[0]!.idempotencyKey
    await settle('fixture.render({ updatedAt: "2026-10-04T04:00:00Z" })')
    expect((await state()).text).toContain('仅属于 task-1 的方案')
    expect(await disabled('确认执行 AI 方案')).toBe(true)
    await settle('fixture.expire(20000)')
    await click('确认执行 AI 方案')
    expect((await state()).calls.confirm).toHaveLength(1)
    expect((await state()).calls.confirm[0]!.idempotencyKey).toBe(firstKey)
    await settle('fixture.complete("confirm", 0, { status: "applied", changed: true })')
    expect(await disabled('确认执行 AI 方案')).toBe(false)
    expect((await state()).refreshes).toBe(0)
    expect((await state()).text).not.toContain('AI 方案已执行，后台已返回提交结果')
  })
  it('AI 分析 updatedAt 不解锁且仍属于原任务', async () => {
    await click('AI 分析本任务')
    await settle('fixture.render({ updatedAt: "2026-10-04T05:00:00Z" })')
    expect(await disabled('AI 分析本任务')).toBe(true)
    await click('AI 分析本任务')
    expect((await state()).calls.analyze).toHaveLength(1)
    await settle('fixture.complete("analyze", 0, fixture.proposal())')
    expect((await state()).text).toContain('仅属于 task-1 的方案')
  })
  it('AI 二次确认保留 challenge，状态更新不能绕过确认', async () => {
    await readyProposal()
    await click('确认执行 AI 方案')
    await settle('fixture.complete("confirm", 0, { status: "requires-confirmation", changed: false, challenge: { id: "risk", digest: "risk-digest", expiresAt: new Date(Date.now() + 3600000).toISOString(), impact: { summary: "卸载影响", affectedPackages: ["@example/alpha"], dataBehavior: "保留数据", unknowns: [] } } })')
    await settle('fixture.render({ updatedAt: "2026-10-04T06:00:00Z" })')
    expect((await state()).text).toContain('再次确认影响')
    expect((await state()).calls.confirm).toHaveLength(1)
    await click('已了解影响，再次确认执行')
    expect((await state()).calls.confirm[1]).toMatchObject({ challengeId: 'risk', challengeDigest: 'risk-digest', riskConfirmed: true })
    expect((await state()).calls.confirm[1]!.idempotencyKey).not.toBe((await state()).calls.confirm[0]!.idempotencyKey)
  })
  it('真实 StrictMode 重复点击也只有一个请求', async () => {
    await settle('fixture.strict = true; fixture.render({ status: "installing" })')
    await settle('fixture.click("取消任务"); fixture.click("取消任务")')
    await settle('fixture.render({ updatedAt: "2026-10-04T07:00:00Z" })')
    expect((await state()).calls.cancel).toHaveLength(1)
    expect(await disabled('取消任务')).toBe(true)
    await settle('fixture.complete("cancel", 0, fixture.task)')
    expect((await state()).changed).toHaveLength(1)
  })
})
