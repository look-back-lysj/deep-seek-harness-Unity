/** Cooperative supervision for reviewed code. It cannot stop a blocked JS thread
 * or a Promise that ignores AbortSignal; it does stop accepting its late result.
 */
export type ManagedResult<T> = { readonly status: 'ok'; readonly value: T } | { readonly status: 'error' | 'aborted' | 'timeout' }
export interface ManagedExtensionRuntime {
  readonly signal: AbortSignal
  run<T>(work: (signal: AbortSignal) => T | PromiseLike<T>, accept?: (value: T) => unknown, timeoutMs?: number): Promise<ManagedResult<T>>
  guard<Args extends unknown[]>(work: (...args: Args) => unknown): (...args: Args) => void
  effect(setup: (signal: AbortSignal) => void | (() => unknown)): () => void
  getSnapshot(): string | undefined
  subscribe(listener: () => void): () => void
  fail(code: string): void
  /** React commit lease; tolerates StrictMode's immediate cleanup/setup replay. */
  retain(): () => void
  dispose(): void
}

export function createManagedExtensionRuntime(options: {
  readonly signals?: readonly AbortSignal[] | undefined
  readonly onIssue?: ((code: string) => unknown) | undefined
  readonly timeoutMs?: number | undefined
  readonly deferSignals?: boolean | undefined
} = {}): ManagedExtensionRuntime {
  const controller = new AbortController()
  const pending = new Set<() => void>()
  const cleanups = new Set<() => void>()
  const listeners = new Set<() => void>()
  let issue: string | undefined
  let linked = false; let references = 0; let suspended = false
  const notify = (code: string): void => {
    if (controller.signal.aborted && code !== 'extension/cleanup-error') return
    try { void Promise.resolve(options.onIssue?.(code)).catch(() => {}) } catch { /* diagnostic sink */ }
    if (controller.signal.aborted) return
    issue = code
    for (const listener of [...listeners]) {
      try { void Promise.resolve(listener()).catch(() => {}) } catch { /* isolate subscribers */ }
    }
  }
  const connect = (): void => {
    if (linked || controller.signal.aborted) return
    linked = true
    for (const signal of options.signals ?? []) {
      if (signal.aborted) { runtime.dispose(); break }
      signal.addEventListener('abort', runtime.dispose, { once: true })
    }
  }
  const runtime: ManagedExtensionRuntime = {
    signal: controller.signal,
    getSnapshot: () => issue,
    subscribe(listener) { if (controller.signal.aborted) return () => {}; listeners.add(listener); return () => { listeners.delete(listener) } },
    fail: notify,
    run<T>(work: (signal: AbortSignal) => T | PromiseLike<T>, accept?: (value: T) => unknown, timeoutMs = options.timeoutMs ?? 15_000): Promise<ManagedResult<T>> {
      connect()
      if (controller.signal.aborted || suspended) return Promise.resolve({ status: 'aborted' })
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) { notify('extension/invalid-timeout'); return Promise.resolve({ status: 'error' }) }
      const operation = new AbortController()
      return new Promise((resolve) => {
        let settled = false
        const finish = (result: ManagedResult<T>): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          pending.delete(cancel)
          if (result.status !== 'ok') operation.abort()
          resolve(result)
        }
        const cancel = (): void => finish({ status: 'aborted' })
        const timer = setTimeout(() => { notify('extension/async-timeout'); finish({ status: 'timeout' }) }, timeoutMs)
        pending.add(cancel)
        let result: T | PromiseLike<T>
        try { result = work(operation.signal) }
        catch { notify('extension/callback-error'); finish({ status: 'error' }); return }
        void Promise.resolve(result).then(async (value) => {
          if (settled || controller.signal.aborted) return
          // Acceptance is supervised too; async UI callbacks cannot leak a rejection.
          if (accept) await accept(value)
          if (!settled && !controller.signal.aborted) finish({ status: 'ok', value })
        }).catch(() => {
          if (settled || controller.signal.aborted) return
          notify('extension/async-error'); finish({ status: 'error' })
        })
      })
    },
    guard(work) { return (...args) => { void runtime.run(() => work(...args)) } },
    effect(setup) {
      connect()
      if (controller.signal.aborted || suspended) return () => {}
      let cleanup: void | (() => unknown)
      try { cleanup = setup(controller.signal) } catch { notify('extension/effect-error') }
      let disposed = false
      const dispose = (): void => {
        if (disposed) return
        disposed = true; cleanups.delete(dispose)
        try { void Promise.resolve(cleanup?.()).catch(() => { notify('extension/cleanup-error') }) } catch { notify('extension/cleanup-error') }
      }
      cleanups.add(dispose)
      if (controller.signal.aborted) dispose()
      return dispose
    },
    retain() {
      references++; suspended = false; connect()
      let released = false
      return () => {
        if (released) return
        released = true
        if (--references !== 0) return
        suspended = true
        for (const cancel of [...pending]) cancel()
        for (const cleanup of [...cleanups].reverse()) cleanup()
        queueMicrotask(() => { if (references === 0) runtime.dispose() })
      }
    },
    dispose() {
      if (controller.signal.aborted) return
      controller.abort()
      for (const cancel of [...pending]) cancel()
      for (const cleanup of [...cleanups].reverse()) cleanup()
      for (const signal of options.signals ?? []) signal.removeEventListener('abort', runtime.dispose)
      listeners.clear()
    },
  }
  if (!options.deferSignals) connect()
  return runtime
}
