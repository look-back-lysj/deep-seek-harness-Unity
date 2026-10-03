import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { nextPreflightRetry, UnsafePlanReview } from '../../packages/market/src/client/InstallPlanDialog.tsx'
import { TaskDrawer } from '../../packages/market/src/client/TaskDrawer.tsx'
import { MARKET_CSS } from '../../packages/market/src/client/marketStyles.ts'
import { Button, Modal } from '../../packages/market/src/client/ui.tsx'
import type { TaskItemResult, TaskState } from '../../packages/market/src/types.ts'
import { readOnlyRemote, taskFixture } from './fixtures.ts'

const react = await import(new URL('../../packages/market/node_modules/react/index.js', import.meta.url).href) as unknown as {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
}
const server = await import(new URL('../../packages/market/node_modules/react-dom/server.node.js', import.meta.url).href) as unknown as {
  renderToStaticMarkup(element: unknown): string
}
const createElement = react.createElement
const renderToStaticMarkup = server.renderToStaticMarkup
const here = dirname(fileURLToPath(import.meta.url))

function renderTaskDrawer(tasks: readonly TaskState[]): string {
  return renderToStaticMarkup(createElement(TaskDrawer as never, {
    open: true,
    tasks,
    onClose: () => {},
    remote: readOnlyRemote(),
    onChanged: () => {},
  }))
}

function findElement(node: unknown, predicate: (value: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (node === null || typeof node !== 'object') return undefined
  const element = node as Record<string, unknown>
  if (predicate(element)) return element
  return findElement(element.props ?? element.children, predicate)
}

function withItem(patch: Partial<TaskItemResult>): TaskState {
  const base = taskFixture()
  return { ...base, status: 'failed', items: [{ ...base.items[0]!, ...patch }] }
}

describe('任务与安装弹窗回归', () => {
  it('任务状态、可靠逐项总数和真实失败字段都清楚可扫读', () => {
    const completed: TaskState = {
      ...taskFixture({ taskId: 'completed', status: 'completed' }),
      items: [
        { ...taskFixture().items[0]!, status: 'installed', installOutcome: 'applied', changed: true },
        { ...taskFixture().items[1]!, status: 'disabled', installOutcome: 'applied', changed: true },
      ],
    }
    const failure = withItem({
      status: 'failed',
      installOutcome: 'failed',
      changed: false,
      error: '摘要与已登记制品不一致',
      errorCode: 'artifact:digest-mismatch',
      packageResultCode: 'EINTEGRITY',
      diagnostic: 'fixture diagnostic: source-2 failed integrity check',
      permissionChanges: [{ packageName: '@example/failing', decision: 'already-approved' }],
    })
    const html = renderTaskDrawer([
      completed,
      failure,
      taskFixture({ taskId: 'partial', status: 'partial' }),
      taskFixture({ taskId: 'approval', status: 'awaiting-approval' }),
      taskFixture({ taskId: 'resume', status: 'awaiting-resume' }),
      taskFixture({ taskId: 'unknown', status: 'unknown' }),
    ])
    expect(html).toContain('已完成')
    expect(html).toContain('部分完成')
    expect(html).toContain('待脚本授权')
    expect(html).toContain('等待重启')
    expect(html).toContain('状态未知')
    expect(html).toContain('失败')
    expect(html).toContain('已完成 2 / 2 项')
    expect(html).toContain('不显示未经核实的百分比')
    expect(html).toContain('安装问题')
    expect(html).toContain('下一步：')
    expect(html).toContain('摘要与已登记制品不一致')
    expect(html).toContain('artifact:digest-mismatch')
    expect(html).toContain('EINTEGRITY')
    expect(html).toContain('fixture diagnostic: source-2 failed integrity check')
    expect(html).toContain('@example/failing：already-approved')
    expect(html).toContain('不要使用校验失败的文件')
    expect(html).toMatch(/<details><summary>查看任务记录/)
  })

  it('版本不兼容只显示简短结论，长报告默认折叠', () => {
    const base = taskFixture({ taskId: 'incompatible', status: 'failed' })
    const task: TaskState = { ...base, items: [{ ...base.items[0]!, status: 'failed', installOutcome: 'failed',
      error: 'incompatible-version', errorCode: 'incompatible-version', packageResultCode: 'unknown',
      diagnostic: 'long official diagnostic with peerDependencies and rollback details' }] }
    const html = renderTaskDrawer([task])
    expect(html).toContain('插件与当前 DeepSeek Harness 版本不兼容')
    expect(html).toContain('请安装适配当前 DeepSeek Harness 版本的插件版本')
    expect(html).toContain('<details><summary>查看详细报告</summary>')
    expect(html).toContain('long official diagnostic')
  })

  it('成功结算后不继续展示旧 receipt/postcondition 错误摘要', () => {
    const base = taskFixture({ taskId: 'receipt-success', status: 'completed' })
    const task: TaskState = {
      ...base,
      items: [{ ...base.items[0]!, status: 'disabled', installOutcome: 'applied', changed: true,
        error: 'official receipt saved but dependency, cache bytes or inventory did not verify',
        errorCode: 'receipt/postcondition', packageResultCode: 'exit-0' }],
      events: [...base.events, { at: '2026-10-03T00:00:00.000Z', level: 'error' as const, message: 'Host结果：unknown', phase: 'installing' as const, sequence: 99 }],
    }
    const html = renderTaskDrawer([task])
    expect(html).toContain('已完成')
    expect(html).toContain('已停用')
    expect(html).not.toContain('错误摘要')
    expect(html).not.toContain('receipt/postcondition')
  })

  it('没有逐项总数时不编造百分比', () => {
    const html = renderTaskDrawer([{ ...taskFixture({ status: 'failed' }), items: [] }])
    expect(html).toContain('后台未提供逐项总数，不显示百分比。')
    expect(html).not.toContain('已完成 0 / 0 项')
    expect(html).not.toMatch(/\d+(?:\.\d+)?%/)
  })

  it('AI 卸载或降级影响仍要求第二次确认，不把模型文字当授权', () => {
    const source = readFileSync(join(here, '../../packages/market/src/client/TaskDrawer.tsx'), 'utf8')
    expect(source).toContain('再次确认影响')
    expect(source).toContain('riskConfirmed: true as const')
    expect(source).toContain('challengeDigest: challenge.digest')
    expect(source).toContain('idempotencyKey: second ? confirmationKeys.current.second : confirmationKeys.current.first')
    expect(source).toContain('applyAi(true)')
  })

  it('unsafe 预检说明勾选后自动重检，“重新预检”按钮真实调用 retry 流程', () => {
    const onRetry = vi.fn()
    const element = UnsafePlanReview({ consentRequired: true, onRetry }) as unknown
    const button = findElement(element, (value) => value.props !== undefined
      && (value.props as Record<string, unknown>).children === '重新预检')
    expect(button).toBeDefined()
    const buttonProps = button?.props as Record<string, unknown> | undefined
    const onClick = buttonProps?.onClick as (() => void) | undefined
    onClick?.()
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(renderToStaticMarkup(element)).toContain('勾选上方选项后会自动重新预检')
    expect(nextPreflightRetry(0)).toBe(1)
    const installSource = readFileSync(join(here, '../../packages/market/src/client/InstallPlanDialog.tsx'), 'utf8')
    expect(installSource).toContain('onRetry={() => setRetry(nextPreflightRetry)}')
    expect(installSource).toContain('[consent, retry, remote, target]')
  })

  it('安装弹窗保留硬限制、降级二次确认和未知结果不重放边界', () => {
    const html = renderToStaticMarkup(createElement(InstallModal as never, {
      open: true,
      onClose: () => {},
      title: '安装确认：长包名与中文说明换行检查',
      description: '预检不会安装插件。请核对目标版本、风险和操作层级后再确认。',
      closeLabel: '关闭安装确认',
    }, createElement('p', null, '硬性不兼容、缺少可安装制品和校验失败不会被“仍然尝试安装”绕过。')))
    expect(html).toContain('安装确认：长包名与中文说明换行检查')
    expect(html).toContain('预检不会安装插件')
    expect(html).toContain('硬性不兼容')
    const source = readFileSync(join(here, '../../packages/market/src/client/InstallPlanDialog.tsx'), 'utf8')
    expect(source).toContain('第 2 步：再次确认降级影响')
    expect(source).toContain('已了解影响，确认降级')
    expect(source).toContain('提交结果未知时先到任务面板核对，不自动重放安装。')
  })

  it('Escape、Tab 约束和关闭焦点恢复的 ui.tsx 合约仍在', () => {
    const source = readFileSync(join(here, '../../packages/market/src/client/ui.tsx'), 'utf8')
    expect(source).toContain('if (event.key === \'Escape\')')
    expect(source).toContain('event.preventDefault()')
    expect(source).toContain('firstEl.focus()')
    expect(source).toContain('lastEl.focus()')
    expect(source).toContain('returnFocus.current?.focus()')
    expect(source).toContain('card.contains(document.activeElement)')
    const html = renderToStaticMarkup(createElement(Modal as never, {
      open: true,
      onClose: () => {},
      title: '键盘检查',
      closeLabel: '关闭键盘检查',
    }, createElement(Button as never, null, '底部操作')))
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('aria-labelledby=')
    expect(html).toContain('底部操作')
  })

  it('约 480px 弹层结构使用换行、单列和包裹按钮，不依赖固定宽度', () => {
    const html = renderTaskDrawer([{
      ...taskFixture({ status: 'failed' }),
      items: [{ ...taskFixture().items[0]!, packageName: '@example/a-very-long-package-name-without-breaks-for-480px' }],
    }])
    expect(html).toContain('@example/a-very-long-package-name-without-breaks-for-480px')
    expect(html).toContain('eac-market__task-head')
    expect(html).toContain('eac-market__button-row')
    expect(MARKET_CSS).toContain('.eac-market__main, .eac-modal__content { overflow-wrap: anywhere; }')
    expect(MARKET_CSS).toContain('.eac-market__button-row { display: flex; flex-wrap: wrap;')
    expect(MARKET_CSS).toContain('.eac-modal { max-height: calc(100dvh - 24px); min-width: 0; }')
    expect(MARKET_CSS).toContain('.eac-market__task-head { flex-direction: column; gap: 6px; }')
  })
})

function InstallModal(props: Record<string, unknown>): React.JSX.Element {
  return createElement(Modal as never, props) as React.JSX.Element
}
