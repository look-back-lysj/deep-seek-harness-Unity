import { createHash } from 'node:crypto'
import type { AiAnalysisResult, AiAnalyzeRequest, AiProposal, AiProposedAction, DiagnosticExport } from '../contracts/types.ts'

interface LlmChunk { type: string; text?: string; reason?: { kind?: string } }
interface LlmService { stream(options: Record<string, unknown>): AsyncIterable<LlmChunk> }
interface DefaultModel { currentSelection(): { provider: string; model: string; reasoningEffort?: string } }

const ALLOWED = new Set(['install', 'update', 'retry-source', 'enable', 'disable', 'remove', 'downgrade'])

function digest(proposal: AiProposal): string {
  return createHash('sha256').update(JSON.stringify({ summary: proposal.summary, facts: proposal.facts, actions: proposal.actions })).digest('hex')
}

function parseProposal(text: string): AiProposal {
  const value = JSON.parse(text.trim()) as { summary?: unknown; facts?: unknown; actions?: unknown }
  const actions = Array.isArray(value.actions) ? value.actions.slice(0, 3) : []
  const parsed: AiProposedAction[] = []
  for (const raw of actions) {
    const action = raw as Record<string, unknown>
    if (typeof action.kind !== 'string' || !ALLOWED.has(action.kind) || typeof action.packageName !== 'string' || typeof action.reason !== 'string') throw new Error('invalid action')
    parsed.push({
      kind: action.kind as AiProposedAction['kind'],
      packageName: action.packageName,
      ...(typeof action.targetVersion === 'string' ? { targetVersion: action.targetVersion } : {}),
      ...(typeof action.sourceId === 'string' ? { sourceId: action.sourceId } : {}),
      reason: action.reason,
      requiresSecondConfirmation: action.kind === 'remove' || action.kind === 'downgrade',
    })
  }
  const proposal: AiProposal = {
    id: createHash('sha256').update(String(Date.now()) + ':' + text).digest('hex').slice(0, 24),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    summary: typeof value.summary === 'string' ? value.summary.slice(0, 500) : '模型提出了一项有限建议',
    facts: Array.isArray(value.facts) ? value.facts.filter((item): item is string => typeof item === 'string').slice(0, 20) : [],
    actions: parsed,
    impactDigest: '',
  }
  return { ...proposal, impactDigest: digest(proposal) }
}

export class AiAssistant {
  constructor(private readonly llm: LlmService | undefined, private readonly model: DefaultModel | undefined) {}
  available(): boolean { return this.llm !== undefined && this.model !== undefined }
  impactDigest(proposal: AiProposal): string { return digest(proposal) }

  async analyze(request: AiAnalyzeRequest, diagnostics: DiagnosticExport): Promise<AiAnalysisResult> {
    if (!this.available()) return { status: 'blocked', reason: 'DSH 默认模型服务不可用' }
    const selection = this.model!.currentSelection()
    const material = diagnostics.diagnostics.map((entry) => ({ id: entry.id, category: entry.category, message: entry.message, source: entry.source }))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    let text = ''
    let sawToolCall = false
    let finished = false
    try {
      for await (const chunk of this.llm!.stream({
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
        system: '你是 EAC 市场诊断助手。只输出一个 JSON 对象，不使用工具，不执行命令。只依据输入事实提出有限操作建议。禁止伪造用户确认。',
        messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ task: request, diagnostics: material, allowedActions: [...ALLOWED] }) }] }],
        maxTokens: 1200,
        signal: controller.signal,
      })) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        if (chunk.type === 'tool-call-delta') sawToolCall = true
        if (chunk.type === 'finish') finished = chunk.reason?.kind === 'stop'
      }
    } catch (error) {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timeout)
    }
    if (sawToolCall || !finished) return { status: 'failed', reason: '模型结果缺少完整无工具响应' }
    try {
      return { status: 'ready', proposal: parseProposal(text) }
    } catch (error) {
      return { status: 'failed', reason: '模型输出不是可校验提案：' + (error instanceof Error ? error.message : String(error)) }
    }
  }
}
