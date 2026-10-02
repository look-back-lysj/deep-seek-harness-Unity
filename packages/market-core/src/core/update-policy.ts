import type { UpdatePolicy } from '../contracts/types.ts'

/** Product defaults: checks may run automatically, writes never do. */
export const DEFAULT_UPDATE_POLICY: UpdatePolicy = Object.freeze({
  automaticChecksEnabled: true,
  automaticDownloadsEnabled: false,
  automaticInstallsEnabled: false,
})

export interface UpdatePolicyInput {
  readonly automaticChecksEnabled?: unknown
  readonly automaticDownloadsEnabled?: unknown
  readonly automaticInstallsEnabled?: unknown
  readonly intervalMinutes?: unknown
}

export interface AutomaticUpdateInput {
  readonly now?: Date
  readonly lastCheckedAt?: Date | string
  readonly force?: boolean
}

export interface AutomaticUpdateDecision {
  readonly check: boolean
  readonly download: boolean
  readonly install: boolean
  readonly reasons: readonly string[]
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function intervalOr(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (!Number.isInteger(value) || value < 1 || value > 7 * 24 * 60) return undefined
  return value
}

/** Normalize persisted settings without allowing malformed data to enable writes. */
export function normalizeUpdatePolicy(value?: UpdatePolicyInput | null): UpdatePolicy {
  const input = value ?? {}
  const intervalMinutes = intervalOr(input.intervalMinutes)
  return {
    automaticChecksEnabled: booleanOr(input.automaticChecksEnabled, DEFAULT_UPDATE_POLICY.automaticChecksEnabled),
    automaticDownloadsEnabled: booleanOr(input.automaticDownloadsEnabled, DEFAULT_UPDATE_POLICY.automaticDownloadsEnabled),
    automaticInstallsEnabled: booleanOr(input.automaticInstallsEnabled, DEFAULT_UPDATE_POLICY.automaticInstallsEnabled),
    ...(intervalMinutes === undefined ? {} : { intervalMinutes }),
  }
}

export function canAutomaticDownload(policy: UpdatePolicy): boolean {
  return policy.automaticDownloadsEnabled === true
}

export function canAutomaticInstall(policy: UpdatePolicy): boolean {
  return policy.automaticInstallsEnabled === true
}

function parsedDate(value: Date | string | undefined): number | undefined {
  if (value === undefined) return undefined
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

/**
 * Decide whether a read-only automatic check is due. An explicit force is still
 * a check, but never turns on download or install. Invalid timestamps fail open
 * for the read-only check and remain closed for write actions.
 */
export function shouldAutomaticallyCheck(policy: UpdatePolicy, input: AutomaticUpdateInput = {}): boolean {
  if (input.force === true) return true
  if (!policy.automaticChecksEnabled) return false
  const last = parsedDate(input.lastCheckedAt)
  if (last === undefined) return true
  const now = (input.now ?? new Date()).getTime()
  if (!Number.isFinite(now)) return true
  const interval = (policy.intervalMinutes ?? 60) * 60_000
  return now - last >= interval
}

export function evaluateAutomaticUpdate(policyInput?: UpdatePolicyInput | null, input: AutomaticUpdateInput = {}): AutomaticUpdateDecision {
  const policy = normalizeUpdatePolicy(policyInput)
  const check = shouldAutomaticallyCheck(policy, input)
  const reasons: string[] = []
  if (!check) reasons.push('automatic-check-not-due')
  if (!policy.automaticChecksEnabled && input.force !== true) reasons.push('automatic-checks-disabled')
  if (!canAutomaticDownload(policy)) reasons.push('automatic-downloads-disabled')
  if (!canAutomaticInstall(policy)) reasons.push('automatic-installs-disabled')
  return {
    check,
    // A write is only eligible on a checked cycle. The caller still needs to
    // create and confirm a frozen plan before invoking either action.
    download: check && canAutomaticDownload(policy),
    install: check && canAutomaticInstall(policy),
    reasons,
  }
}

export const defaultUpdatePolicy = (): UpdatePolicy => normalizeUpdatePolicy()
export const automaticUpdateDecision = evaluateAutomaticUpdate
