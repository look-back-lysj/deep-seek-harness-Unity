/** Stable errors for core boundaries; callers must not interpret thrown values as success. */
export class MarketCoreError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly nextAction: string
  readonly details: readonly string[]

  constructor(code: string, message: string, options?: { retryable?: boolean; nextAction?: string; details?: readonly string[]; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'MarketCoreError'
    this.code = code
    this.retryable = options?.retryable ?? false
    this.nextAction = options?.nextAction ?? 'review'
    this.details = options?.details ?? []
  }
}
