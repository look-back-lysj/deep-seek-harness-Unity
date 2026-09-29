import { describe, expect, it } from 'vitest'
import { AiAssistant } from '../../packages/market-core/src/host/ai-assist.ts'

const emptyDiagnostics = {
  schemaVersion: '1',
  generatedAt: new Date().toISOString(),
  marketVersion: 'test',
  environmentId: 'test',
  summaries: [],
  diagnostics: [{ id: 'fact-1', category: 'install' as const, message: 'fixture 安装返回网络失败', source: 'test-receipt', redacted: true }],
  redacted: true,
}

describe('AiAssistant', () => {
  it('拒绝没有默认模型的分析', async () => {
    const result = await new AiAssistant(undefined, undefined).analyze({}, emptyDiagnostics)
    expect(result.status).toBe('blocked')
  })

  it('拒绝工具调用和非正常结束', async () => {
    const llm = { async *stream() { yield { type: 'tool-call-delta' }; yield { type: 'finish', reason: { kind: 'stop' } } } }
    const model = { currentSelection: () => ({ provider: 'test', model: 'test' }) }
    const result = await new AiAssistant(llm, model).analyze({}, emptyDiagnostics)
    expect(result.status).toBe('failed')
  })

  it('校验模型提案动作范围', async () => {
    const llm = { async *stream() { yield { type: 'text-delta', text: JSON.stringify({ summary: 'test', facts: [], actions: [{ kind: 'shell', packageName: 'x', reason: 'bad' }] }) }; yield { type: 'finish', reason: { kind: 'stop' } } } }
    const model = { currentSelection: () => ({ provider: 'test', model: 'test' }) }
    const result = await new AiAssistant(llm, model).analyze({}, emptyDiagnostics)
    expect(result.status).toBe('failed')
  })

  it.each([
    { summary: 'unexpected', facts: ['fact-1'], actions: [{ kind: 'enable', packageName: 'fixture', reason: 'x', confirmed: true }] },
    { summary: 'multiple', facts: ['fact-1'], actions: [{ kind: 'enable', packageName: 'fixture', reason: 'x' }, { kind: 'disable', packageName: 'fixture', reason: 'y' }] },
    { summary: 'invented evidence', facts: ['fake'], actions: [{ kind: 'enable', packageName: 'fixture', reason: 'x' }] },
  ])('拒绝额外字段、多动作和伪造证据引用', async (proposal) => {
    const llm = { async *stream() { yield { type: 'text-delta', text: JSON.stringify(proposal) }; yield { type: 'finish', reason: { kind: 'stop' } } } }
    const result = await new AiAssistant(llm, { currentSelection: () => ({ provider: 'test', model: 'test' }) }).analyze({}, emptyDiagnostics)
    expect(result.status).toBe('failed')
  })

  it('接收一个有证据的动作但不接收模型用户确认，也不提供工具', async () => {
    let sent: Record<string, unknown> | undefined
    const llm = { async *stream(options: Record<string, unknown>) {
      sent = options
      yield { type: 'text-delta', text: JSON.stringify({ summary: '启用已安装插件', facts: ['fact-1'], actions: [{ kind: 'enable', packageName: 'fixture', reason: '依据已有安装结果' }] }) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } }
    const result = await new AiAssistant(llm, { currentSelection: () => ({ provider: 'test', model: 'test' }) }).analyze({}, emptyDiagnostics)
    expect(result.status).toBe('ready')
    expect(result.proposal?.actions).toHaveLength(1)
    expect(sent).not.toHaveProperty('tools')
    expect(sent).not.toHaveProperty('sessionId')
  })

  it('已取消分析不接受迟到结果', async () => {
    const controller = new AbortController()
    controller.abort()
    const llm = { async *stream() { yield { type: 'text-delta', text: '{}' }; yield { type: 'finish', reason: { kind: 'stop' } } } }
    const result = await new AiAssistant(llm, { currentSelection: () => ({ provider: 'test', model: 'test' }) }).analyze({}, emptyDiagnostics, controller.signal)
    expect(result.status).toBe('failed')
  })
})
