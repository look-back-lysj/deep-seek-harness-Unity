import { describe, expect, it } from 'vitest'
import { AiAssistant } from '../../packages/market/src/host/ai-assist.ts'

const emptyDiagnostics = {
  schemaVersion: '1',
  generatedAt: new Date().toISOString(),
  marketVersion: 'test',
  environmentId: 'test',
  summaries: [],
  diagnostics: [],
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
})
