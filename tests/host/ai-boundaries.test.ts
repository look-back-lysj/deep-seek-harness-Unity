import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiAssistant } from '../../packages/market-core/src/host/ai-assist.ts'
import { collectDiagnostics, sanitizeDiagnostic } from '../../packages/market-core/src/host/diagnostics.ts'
import { assessRiskyAction, type ManagementManifest } from '../../packages/market-core/src/host/management-impact.ts'
import type { CatalogPlugin, DiagnosticExport, InventorySnapshot, TaskState } from '../../packages/market-core/src/contracts/types.ts'

const diagnostic: DiagnosticExport = {
  schemaVersion: '1', generatedAt: new Date().toISOString(), marketVersion: 'test', environmentId: 'test', summaries: [], redacted: true,
  diagnostics: [{ id: 'fact-1', category: 'install', message: 'fixture 安装失败', source: 'test', redacted: true }],
}
const body = JSON.stringify({ summary: '启用 fixture', facts: ['fact-1'], actions: [{ kind: 'enable', packageName: 'fixture', reason: '已有安装证据' }] })
const selection = { currentSelection: () => ({ provider: 'test', model: 'test' }) }
const never = () => new Promise<never>(() => {})

afterEach(() => vi.useRealTimers())

describe('AI stream protocol boundaries', () => {
  it('accepts terminal stop without waiting for a non-cooperative iterator to close', async () => {
    vi.useFakeTimers()
    const close = vi.fn(never)
    const iterator = { next: vi.fn()
      .mockResolvedValueOnce({ done: false, value: { type: 'text-delta', text: body } })
      .mockResolvedValueOnce({ done: false, value: { type: 'finish', reason: { kind: 'stop' } } })
      .mockImplementation(never), return: close }
    const pending = new AiAssistant({ stream: () => ({ [Symbol.asyncIterator]: () => iterator }) }, selection).analyze({}, diagnostic)
    await vi.advanceTimersByTimeAsync(20_001)
    expect((await pending).status).toBe('ready')
    expect(iterator.next).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledOnce()
  })

  it('bounds a stalled next and never waits on stalled cleanup', async () => {
    vi.useFakeTimers()
    let resolveLate!: (value: unknown) => void
    const close = vi.fn(never)
    const iterator = { next: () => new Promise<any>(resolve => { resolveLate = resolve }), return: close }
    let signal: AbortSignal | undefined
    const pending = new AiAssistant({ stream: options => {
      signal = options.signal as AbortSignal
      return { [Symbol.asyncIterator]: () => iterator }
    } }, selection).analyze({}, diagnostic)
    await vi.advanceTimersByTimeAsync(20_001)
    expect((await pending).status).toBe('failed')
    expect(signal?.aborted).toBe(true)
    expect(close).toHaveBeenCalledOnce()
    resolveLate({ done: false, value: { type: 'text-delta', text: body } })
    expect((await pending).proposal).toBeUndefined()
  })

  it.each([
    { type: 'block-start', blockType: 'tool-call' },
    { type: 'block-end', block: { type: 'tool-call', name: 'shell', arguments: '{}' } },
  ])('rejects official tool block forms even without a tool delta: %j', async chunk => {
    const llm = { async *stream() {
      yield { type: 'text-delta', text: body }
      yield chunk
      yield { type: 'finish', reason: { kind: 'stop' } }
    } }
    expect((await new AiAssistant(llm, selection).analyze({}, diagnostic)).status).toBe('failed')
  })

  it('drops a stop that races with cancellation', async () => {
    const controller = new AbortController()
    const llm = { async *stream() {
      yield { type: 'text-delta', text: body }
      controller.abort()
      yield { type: 'finish', reason: { kind: 'stop' } }
    } }
    expect((await new AiAssistant(llm, selection).analyze({}, diagnostic, controller.signal)).status).toBe('failed')
  })

  it('does not forward extra request fields into the model', async () => {
    const stream = vi.fn(async function* () {
      yield { type: 'text-delta', text: body }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const request = { packageName: 'fixture', privateConversation: 'SYNTHETIC_PRIVATE_TEXT' }
    expect((await new AiAssistant({ stream }, selection).analyze(request, diagnostic)).status).toBe('failed')
    expect(stream).not.toHaveBeenCalled()
  })

  it.each([undefined, 'length', 'error', 'aborted', 'tool-calls'])('rejects missing or non-stop terminal reason %s', async reason => {
    const llm = { async *stream() {
      yield { type: 'text-delta', text: body }
      if (reason !== undefined) yield { type: 'finish', reason: { kind: reason } }
    } }
    expect((await new AiAssistant(llm, selection).analyze({}, diagnostic)).status).toBe('failed')
  })

  it('bounds an eager endless stream even when timers get no event-loop turn', async () => {
    let count = 0
    const llm = { async *stream() { while (++count < 100_000) yield { type: 'reasoning-delta', text: '' } } }
    expect((await new AiAssistant(llm, selection).analyze({}, diagnostic)).status).toBe('failed')
    expect(count).toBeLessThan(10_000)
  })

  it('resolves optional services when they load and uses the latest selection after replacement', async () => {
    const providers: unknown[] = []
    const makeLlm = () => ({ async *stream(options: Record<string, unknown>) {
      providers.push(options.provider)
      yield { type: 'text-delta', text: body }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } })
    let llm: ReturnType<typeof makeLlm> | undefined
    let model: typeof selection | undefined
    const assistant = new AiAssistant(() => llm, () => model)
    expect((await assistant.analyze({}, diagnostic)).status).toBe('blocked')
    llm = makeLlm(); model = selection
    expect((await assistant.analyze({}, diagnostic)).status).toBe('ready')
    llm = makeLlm(); model = { currentSelection: () => ({ provider: 'replacement', model: 'new' }) }
    expect((await assistant.analyze({}, diagnostic)).status).toBe('ready')
    expect(providers).toEqual(['test', 'replacement'])
  })
})

describe('diagnostic privacy boundary (synthetic secrets only)', () => {
  it.each([
    ['{"api_key":"SYNTHETIC_SECRET_JSON"}', 'SYNTHETIC_SECRET_JSON'],
    ['{"access_token":"SYNTHETIC_SECRET_ACCESS"}', 'SYNTHETIC_SECRET_ACCESS'],
    ['//registry.test/:_authToken=SYNTHETIC_SECRET_NPM', 'SYNTHETIC_SECRET_NPM'],
    ['Authorization: Basic SYNTHETIC_SECRET_BASIC', 'SYNTHETIC_SECRET_BASIC'],
    ['failed at "C:\\Users\\First Private\\Top Secret\\file.json"', 'Private'],
    ['failed at "/home/First Private/Top Secret/file.json"', 'Private'],
    ['failed at "/var/lib/private-project/credentials.json"', 'private-project'],
  ])('redacts %s', (raw, secret) => {
    expect(sanitizeDiagnostic(raw)).not.toContain(secret)
  })

  it('does not collect a task from another environment or outside the selected package', () => {
    const task = (environmentId: string, packageName: string, marker: string) => ({
      taskId: 'selected-task', environmentId, status: 'failed', nextAction: 'inspect',
      items: [{ packageName, targetVersion: '1.0.0', status: 'failed', installOutcome: 'failed', error: marker }],
    }) as unknown as TaskState
    const result = collectDiagnostics({ environmentId: 'current', hostVersion: 'test', marketVersion: 'test',
      selection: { taskId: 'selected-task', packageName: 'fixture' },
      tasks: [task('other', 'fixture', 'OTHER_ENV_PRIVATE'), task('current', 'unrelated', 'OTHER_PACKAGE_PRIVATE')],
    })
    expect(JSON.stringify(result)).not.toContain('OTHER_ENV_PRIVATE')
    expect(JSON.stringify(result)).not.toContain('OTHER_PACKAGE_PRIVATE')
  })

  it('bounds outgoing material and cleans source labels as well as messages', async () => {
    let sent = ''
    const llm = { async *stream(options: Record<string, unknown>) {
      sent = JSON.stringify(options.messages)
      yield { type: 'text-delta', text: body }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } }
    await new AiAssistant(llm, selection).analyze({}, { ...diagnostic, diagnostics: [
      { ...diagnostic.diagnostics[0]!, message: 'x'.repeat(100_000), source: 'C:\\Users\\Synthetic Private\\trace.txt' },
    ] })
    expect(sent.length).toBeLessThan(3000)
    expect(sent).not.toContain('Synthetic Private')
  })
})

const reviewed = {
  id: 'fixture', packageName: 'fixture', version: '1.0.0', artifactDigest: `sha256:${'a'.repeat(64)}`,
  managementEvidence: { reviewId: 'test-review', artifactDigest: `sha256:${'a'.repeat(64)}`, reviewedBy: 'test-reviewer',
    reviewedAt: '2026-09-27T00:00:00Z', stateless: true, removePreservesExternalData: true, downgradeFrom: ['2.0.0'], explanation: 'synthetic review' },
  name: 'Synthetic fixture', summary: 'Test only', author: 'Test', distribution: 'external', capabilityTier: 'test',
  verification: 'unverified', installability: 'bundle-installable', presentationId: 'fixture', categories: [], screenshots: [],
  enabledPolicy: 'default-off', requiresRestart: false, requiresSetup: false, largeExternalResource: false,
} satisfies CatalogPlugin
const inventory: InventorySnapshot = { environmentId: 'test', revision: 'test', unknownItems: [], items: [
  { packageName: 'fixture', version: '1.0.0', source: 'market-cache-file', installed: true, bundleEnabled: false, removable: true, rows: [], restartRequired: false },
] }
const base = { kind: 'remove' as const, packageName: 'fixture', currentVersion: '1.0.0', current: reviewed, inventory }

describe('risky action graph and artifact evidence', () => {
  it('walks through the target package to find a dependent hidden below it', () => {
    const readManifest = (name: string): ManagementManifest | undefined => name === 'fixture'
      ? { name, version: '1.0.0', dependencies: { consumer: '1.0.0' } }
      : { name, version: '1.0.0', dependencies: { fixture: '1.0.0' } }
    expect(assessRiskyAction({ ...base, readManifest }).unknowns.join(' ')).toContain('consumer')
  })

  it('does not accept an unreadable target manifest as a complete dependency graph', () => {
    expect(assessRiskyAction({ ...base, readManifest: () => undefined }).unknowns.length).toBeGreaterThan(0)
  })

  it.each([
    { ...reviewed, packageName: 'other-package' },
    { ...reviewed, version: '0.9.0' },
    { ...reviewed, managementEvidence: { ...reviewed.managementEvidence!, reviewedAt: 'not-a-date' } },
    { ...reviewed, managementEvidence: { ...reviewed.managementEvidence!, artifactDigest: `sha256:${'b'.repeat(64)}` } },
  ])('blocks unrelated, malformed or mismatched review evidence', current => {
    const impact = assessRiskyAction({ ...base, current, readManifest: name => ({ name, version: '1.0.0' }) })
    expect(impact.unknowns.length).toBeGreaterThan(0)
    expect(impact.dataBehavior).not.toContain('该制品有无状态审查')
  })

  it('blocks invalid dependency declarations instead of silently skipping them', () => {
    const impact = assessRiskyAction({ ...base, readManifest: name => ({ name, version: '1.0.0', dependencies: { '../unreadable': '1.0.0' } }) })
    expect(impact.unknowns.length).toBeGreaterThan(0)
  })

  it('does not collapse equal name/version packages resolved at different locations', () => {
    const manifests: Record<string, ManagementManifest> = {
      fixture: { name: 'fixture', version: '1.0.0', resolutionKey: '/fixture' },
      left: { name: 'left', version: '1.0.0', resolutionKey: '/left', dependencies: { shared: '1.0.0' } },
      right: { name: 'right', version: '1.0.0', resolutionKey: '/right', dependencies: { shared: '1.0.0' } },
    }
    const impact = assessRiskyAction({ ...base,
      inventory: { ...inventory, items: [...inventory.items, ...['left', 'right'].map(packageName => ({ ...inventory.items[0]!, packageName }))] },
      readManifest: (name, parent) => name === 'shared'
        ? { name, version: '1.0.0', resolutionKey: `${parent}/shared`, ...(parent === '/right' ? { peerDependencies: { fixture: '1.0.0' } } : {}) }
        : manifests[name],
    })
    expect(impact.affectedPackages).toContain('shared')
    expect(impact.unknowns.length).toBeGreaterThan(0)
  })

  it('accepts a complete reviewed downgrade and blocks review records for other source versions', () => {
    const input = { ...base, kind: 'downgrade' as const, target: reviewed, currentVersion: '2.0.0',
      inventory: { ...inventory, items: [{ ...inventory.items[0]!, version: '2.0.0' }] },
      readManifest: (name: string) => ({ name, version: '2.0.0', resolutionKey: '/fixture' }),
    }
    expect(assessRiskyAction(input).unknowns).toEqual([])
    const target = { ...reviewed, managementEvidence: { ...reviewed.managementEvidence!, downgradeFrom: ['3.0.0'] } }
    expect(assessRiskyAction({ ...input, target }).unknowns.join(' ')).toContain('未覆盖当前版本')
  })
})
