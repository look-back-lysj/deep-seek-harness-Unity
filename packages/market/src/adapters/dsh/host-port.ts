/**
 * Official pluginManager adapter for the market core ports. This is the only
 * layer allowed to turn official ChangeResult fields into market outcomes;
 * missing or unrecognised values remain unknown and never become success.
 */
import { readFileSync } from 'node:fs'
import { join, isAbsolute, resolve, normalize } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { NodePersistenceFiles } from './persistence-adapter.ts'
import { encodeJson, decodeJson } from '../../persistence/files.ts'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {
  ChangeResult,
  PluginInstallCancellation,
  PluginInstallRequestId,
} from '@deepseek-ai/dsh-plugin-manager/types'
import type {
  HostCancelOutcome,
  HostInstallOutcome,
  HostInstallRequest,
  HostPort,
  HostReadState,
} from '../../core/ports.ts'
import { canonicalJson, pendingBuildsDigest } from '../../core/canonical.ts'
import { DshManagerAdapter, type InventorySourceEvidence } from './manager.ts'

interface OfficialManager {
  installBundle?(spec: string, options?: {
    enabled?: boolean
    requestId?: PluginInstallRequestId
    approvedBuilds?: readonly string[]
  }): Promise<ChangeResult>
  setBundleEnabled?(name: string, enabled: boolean): Promise<ChangeResult>
  removeBundle?(name: string): Promise<ChangeResult>
  cancelInstall?(requestId: PluginInstallRequestId): Promise<PluginInstallCancellation>
  waitForInstall?(requestId: PluginInstallRequestId): Promise<ChangeResult | null>
}

interface RunRecord {
  readonly pid?: unknown
  readonly grouped?: unknown
}

type UnknownRecord = Record<string, unknown>
type PermissionChange = HostInstallOutcome['permissionChanges'][number]

const CHANGE_FIELDS = new Set([
  'kind', 'changed', 'application', 'stage', 'target', 'enabled', 'error', 'warnings',
  'packageResult', 'bundle', 'pendingBuilds', 'approvedBuilds', 'registries', 'failedAt',
])

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : undefined
}

interface ChangeView {
  readonly changed: boolean
  readonly application: string
  readonly stage: 'install' | 'enable' | 'remove'
  readonly target: string
}

function changeShapeErrors(result: UnknownRecord): readonly string[] {
  const errors: string[] = []
  if (typeof result.changed !== 'boolean') errors.push('changed')
  if (typeof result.application !== 'string') errors.push('application')
  if (result.stage !== 'install' && result.stage !== 'enable' && result.stage !== 'remove') errors.push('stage')
  if (typeof result.target !== 'string' || result.target.length === 0) errors.push('target')
  return errors
}

function isChangeView(result: UnknownRecord): result is UnknownRecord & ChangeView {
  return changeShapeErrors(result).length === 0
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Keeps useful official diagnostics bounded and strips credentials/absolute paths. */
export function redactDiagnostic(value: string, limit = 2000): string {
  const redacted = value
    .replace(/(https?:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, '$1***@')
    .replace(/((?:bearer|basic)\s+)[A-Za-z0-9._+/=-]+/gi, '$1<redacted>')
    .replace(/((?:["']?)(?:token|password|secret|api[_-]?key|authorization)(?:["']?)\s*[:=]\s*["']?)[^"'\s,;}&]+/gi, '$1<redacted>')
    .replace(/([?&](?:token|password|secret|api[_-]?key)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/([A-Za-z]:[\\/]|\\\\)[^\s"']+/g, '<path>')
  return redacted.length > limit ? redacted.slice(0, limit) + '…' : redacted
}

function errorCode(result: UnknownRecord): string | undefined {
  const error = record(result.error)
  const packageResult = record(result.packageResult)
  const code = typeof error?.code === 'string' && error.code.length > 0 ? error.code : undefined
  if (code !== undefined) return code
  const packageKind = typeof packageResult?.kind === 'string' && packageResult.kind.length > 0 ? packageResult.kind : undefined
  if (packageKind !== undefined) return packageKind
  return typeof packageResult?.exitCode === 'number' ? `exit-${packageResult.exitCode}` : undefined
}

function packageResultCode(result: UnknownRecord): string | undefined {
  const packageResult = record(result.packageResult)
  if (packageResult === undefined) return undefined
  const kind = typeof packageResult.kind === 'string' && packageResult.kind.length > 0 ? packageResult.kind : undefined
  return kind ?? (typeof packageResult.exitCode === 'number' ? `exit-${packageResult.exitCode}` : undefined)
}

function diagnosticFor(result: UnknownRecord): string | undefined {
  const error = record(result.error)
  const packageResult = record(result.packageResult)
  const parts = [
    typeof error?.diagnostic === 'string' ? error.diagnostic : undefined,
    typeof packageResult?.output === 'string' ? packageResult.output : undefined,
    typeof packageResult?.logPath === 'string' ? 'log:' + packageResult.logPath : undefined,
    result.failedAt === undefined ? undefined : 'failedAt:' + (typeof result.failedAt === 'string' ? result.failedAt : safeJson(result.failedAt)),
    Array.isArray(result.warnings) && result.warnings.length > 0 ? 'warnings:' + safeJson(result.warnings) : undefined,
    Array.isArray(result.registries) && result.registries.length > 0 ? 'registries:' + safeJson(result.registries) : undefined,
    error?.incompatible === undefined ? undefined : 'incompatible:' + safeJson(error.incompatible),
    packageResult?.incompatible === undefined ? undefined : 'packageIncompatible:' + safeJson(packageResult.incompatible),
  ].filter((part): part is string => typeof part === 'string' && part.length > 0)
  const additional = Object.fromEntries(Object.entries(result).filter(([key]) => !CHANGE_FIELDS.has(key)))
  if (Object.keys(additional).length > 0) parts.push('additionalFields:' + safeJson(additional))
  if (error !== undefined) {
    const errorAdditional = Object.fromEntries(Object.entries(error).filter(([key]) => key !== 'code' && key !== 'diagnostic' && key !== 'incompatible'))
    if (typeof error.code !== 'string' || error.code.length === 0 || Object.keys(errorAdditional).length > 0) {
      parts.push('errorFields:' + safeJson({ ...errorAdditional, ...(typeof error.code === 'string' ? {} : { code: error.code }) }))
    }
  }
  if (packageResult !== undefined) {
    const packageAdditional = Object.fromEntries(Object.entries(packageResult).filter(([key]) =>
      key !== 'exitCode' && key !== 'output' && key !== 'truncated' && key !== 'logPath' && key !== 'kind' && key !== 'timedOut' && key !== 'incompatible'))
    if (Object.keys(packageAdditional).length > 0) parts.push('packageResultFields:' + safeJson(packageAdditional))
  }
  return parts.length === 0 ? undefined : redactDiagnostic(parts.join('\n'))
}

function permissionChanges(names: readonly string[]): readonly PermissionChange[] {
  // Requested permission is not evidence of persisted permission. Official
  // approval can fail (for example a stale package list) before changing it.
  return [...new Set(names)].sort().map((packageName) => ({ packageName, decision: 'approved' }))
}

function isPermissionChanges(value: unknown): value is readonly PermissionChange[] {
  return Array.isArray(value) && value.every(item => {
    const entry = record(item)
    return entry !== undefined
      && typeof entry.packageName === 'string'
      && (entry.decision === 'approved' || entry.decision === 'revoked' || entry.decision === 'already-approved')
  })
}

function isMarketOutcome(value: unknown): value is HostInstallOutcome {
  const entry = record(value)
  if (entry === undefined || !isPermissionChanges(entry.permissionChanges)) return false
  if (entry.kind === 'applied') return typeof entry.changed === 'boolean' && typeof entry.restartRequired === 'boolean'
  if (entry.kind === 'awaiting-approval') {
    return typeof entry.attemptId === 'string' && Array.isArray(entry.pendingBuilds)
      && entry.pendingBuilds.every(name => typeof name === 'string') && typeof entry.pendingBuildsDigest === 'string'
  }
  if (entry.kind === 'failed') return typeof entry.changed === 'boolean' && typeof entry.error === 'string'
  if (entry.kind === 'cancelled') return typeof entry.changed === 'boolean'
  return entry.kind === 'unknown' && typeof entry.error === 'string'
}

function unknownOutcome(message: string, errorCodeValue: string, result: unknown, permissions: readonly PermissionChange[] = []): HostInstallOutcome {
  const diagnostic = redactDiagnostic(safeJson(result))
  return {
    kind: 'unknown',
    error: message,
    errorCode: errorCodeValue,
    ...(diagnostic === undefined ? {} : { diagnostic }),
    permissionChanges: permissions,
  }
}

export async function mapOfficialChange(value: unknown, _approvedBuilds?: readonly string[], attemptId = `official-${Date.now()}`): Promise<HostInstallOutcome> {
  if (isMarketOutcome(value)) return value
  const result = record(value)
  if (result === undefined) return unknownOutcome('official ChangeResult is not an object', 'protocol/shape', value)

  if (!isChangeView(result)) {
    return unknownOutcome(
      'official ChangeResult fields are missing or use an unverified signature: ' + changeShapeErrors(result).join(', '),
      'protocol/shape',
      value,
    )
  }
  const changed = result.changed
  const application = result.application

  let pendingBuilds: readonly string[] = []
  if (result.pendingBuilds !== undefined) {
    if (!Array.isArray(result.pendingBuilds) || result.pendingBuilds.some(name => typeof name !== 'string')) {
      return unknownOutcome('official pendingBuilds field changed shape', 'protocol/shape', value)
    }
    pendingBuilds = result.pendingBuilds as string[]
  }
  let approvedBuilds: readonly string[] = []
  if (result.approvedBuilds !== undefined) {
    if (!Array.isArray(result.approvedBuilds) || result.approvedBuilds.some(name => typeof name !== 'string')) {
      return unknownOutcome('official approvedBuilds field changed shape', 'protocol/shape', value)
    }
    approvedBuilds = result.approvedBuilds as string[]
  }
  if (result.enabled !== undefined && typeof result.enabled !== 'boolean') {
    return unknownOutcome('official enabled field changed shape', 'protocol/shape', value)
  }
  if (result.bundle !== undefined && typeof result.bundle !== 'string') {
    return unknownOutcome('official bundle field changed shape', 'protocol/shape', value)
  }
  if (result.warnings !== undefined && (!Array.isArray(result.warnings) || result.warnings.some(warning => typeof warning !== 'string'))) {
    return unknownOutcome('official warnings field changed shape', 'protocol/shape', value)
  }
  if (result.failedAt !== undefined && result.failedAt !== 'registry' && result.failedAt !== 'spec-host') {
    return unknownOutcome('official failedAt field changed shape', 'protocol/shape', value)
  }
  if (result.registries !== undefined && (!Array.isArray(result.registries) || result.registries.some(registry => typeof registry !== 'string' && registry !== null))) {
    return unknownOutcome('official registries field changed shape', 'protocol/shape', value)
  }
  if (result.error !== undefined && record(result.error) === undefined) {
    return unknownOutcome('official error field changed shape', 'protocol/shape', value)
  }
  const errorRecord = record(result.error)
  if (errorRecord !== undefined && errorRecord.code !== undefined && typeof errorRecord.code !== 'string') {
    return unknownOutcome('official error code field changed shape', 'protocol/shape', value)
  }
  if (result.packageResult !== undefined && record(result.packageResult) === undefined) {
    return unknownOutcome('official packageResult field changed shape', 'protocol/shape', value)
  }
  const packageRecord = record(result.packageResult)
  if (packageRecord !== undefined && (
    typeof packageRecord.exitCode !== 'number'
    || typeof packageRecord.output !== 'string'
    || typeof packageRecord.truncated !== 'boolean'
    || typeof packageRecord.logPath !== 'string'
    || (packageRecord.kind !== undefined && typeof packageRecord.kind !== 'string')
    || (packageRecord.timedOut !== undefined && typeof packageRecord.timedOut !== 'boolean')
  )) {
    return unknownOutcome('official packageResult field changed shape', 'protocol/shape', value)
  }
  const permissions = permissionChanges(approvedBuilds)
  const diagnostic = diagnosticFor(result)
  const code = errorCode(result)
  const packageCode = packageResultCode(result)

  if (pendingBuilds.length > 0) {
    return {
      kind: 'awaiting-approval',
      attemptId,
      pendingBuilds: [...pendingBuilds].sort(),
      pendingBuildsDigest: await pendingBuildsDigest(pendingBuilds),
      permissionChanges: permissions,
    }
  }

  const packageResult = record(result.packageResult)
  const explicitFailure = result.error !== undefined
    || (typeof packageResult?.kind === 'string' && packageResult.kind.length > 0)
    || (typeof packageResult?.exitCode === 'number' && packageResult.exitCode !== 0)
  if (explicitFailure) {
    const conflicting = application !== 'failed'
    return {
      kind: 'failed',
      changed,
      ...(packageCode === undefined ? {} : { packageResultCode: packageCode }),
      error: code ?? (conflicting ? 'official success-shaped result also contains a failure field' : 'official operation failed without an error code'),
      errorCode: code ?? (conflicting ? 'protocol/conflicting-result' : 'protocol/missing-error-code'),
      ...(diagnostic === undefined ? {} : { diagnostic }),
      permissionChanges: permissions,
      ...(conflicting ? { unknownSharedImpact: true } : {}),
    }
  }

  if (application === 'applied' || application === 'restart-required') {
    return {
      kind: 'applied',
      changed,
      restartRequired: application === 'restart-required',
      ...(packageCode === undefined ? {} : { packageResultCode: packageCode }),
      permissionChanges: permissions,
    }
  }
  if (application === 'overridden') {
    return {
      kind: 'unknown',
      error: 'official application was overridden by a higher-priority state',
      errorCode: 'overridden',
      ...(diagnostic === undefined ? {} : { diagnostic }),
      permissionChanges: permissions,
    }
  }
  if (application === 'cancelled') {
    return {
      kind: 'cancelled',
      changed,
      ...(packageCode === undefined ? {} : { packageResultCode: packageCode }),
      permissionChanges: permissions,
    }
  }
  if (application === 'failed') {
    return {
      kind: 'failed',
      changed,
      ...(packageCode === undefined ? {} : { packageResultCode: packageCode }),
      error: code ?? 'official operation failed without an error code',
      errorCode: code ?? 'protocol/missing-error-code',
      ...(diagnostic === undefined ? {} : { diagnostic }),
      permissionChanges: permissions,
    }
  }
  return unknownOutcome(
    'official ChangeResult application is missing or unrecognised',
    'protocol/unknown-application',
    value,
    permissions,
  )
}

export function officialResultTarget(value: unknown): string | undefined {
  const result = record(value)
  const bundle = typeof result?.bundle === 'string' ? result.bundle : undefined
  return bundle ?? (typeof result?.target === 'string' ? result.target : undefined)
}
function alive(pid: number, grouped: boolean): boolean {
  try {
    process.kill(process.platform !== 'win32' && grouped ? -pid : pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

interface OfficialReceipt {
  readonly schemaVersion: 1
  readonly request: HostInstallRequest
  readonly sessionRevision: string
  readonly at: string
  readonly stage: 'dispatched' | 'received'
  readonly outcome?: HostInstallOutcome
}

// Node's process startup origin survives plugin service and module recreation.
const HOST_SESSION = 'host-' + process.pid + '-' + performance.timeOrigin

export class OfficialHostPort implements HostPort {
  readonly requiresFrozenDelivery = true
  private readonly adapter: DshManagerAdapter
  private readonly receipts: NodePersistenceFiles
  private readonly active = new Set<string>()

  constructor(
    private readonly ctx: Context,
    private readonly environmentId = 'current',
    private readonly hostIdentity?: { readonly hostVersion: string; readonly profileName: string },
  ) {
    this.receipts = new NodePersistenceFiles(join(ctx.profileContext.dir, 'eac-market', 'official-receipts'))
    this.adapter = new DshManagerAdapter(ctx, environmentId, () => this.sourceEvidence())
  }

  /** Resolve at call time: pluginManager may activate after this service. */
  private get manager(): OfficialManager | undefined {
    return this.ctx.get('pluginManager') as OfficialManager | undefined
  }

  capabilities(): readonly import('../../contracts/types.ts').CapabilityName[] {
    return this.adapter.capabilities()
  }

  async readState(): Promise<HostReadState & { readonly hostFingerprint?: string }> {
    const inventory = await this.adapter.inventory(this.environmentId)
    let stable = inventory.unknownItems.length === 0 && this.active.size === 0
    let unknownSharedImpact = !stable
    let reason: string | undefined = stable ? undefined : 'official inventory or active request is not settled'
    try {
      const raw = readFileSync(join(this.ctx.profileContext.dir, '.plugin-manager', 'run.json'), 'utf8')
      const value = JSON.parse(raw) as RunRecord
      const pid = typeof value.pid === 'number' ? value.pid : undefined
      const grouped = value.grouped === true
      if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0 || typeof value.grouped !== 'boolean') throw new Error('invalid run record')
      if (alive(pid, grouped)) {
        stable = false
        unknownSharedImpact = true
        reason = `official package process ${pid} is still active`
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        stable = false
        unknownSharedImpact = true
        reason = 'official package run record is unreadable'
      }
    }
    return {
      inventory,
      ...(this.hostIdentity === undefined ? {} : { hostFingerprint: canonicalJson({ ...this.hostIdentity, capabilities: [...this.capabilities()].sort() }) }),
      sessionRevision: HOST_SESSION,
      activeRequests: [...this.active],
      activity: { stable, unknownSharedImpact, ...(reason === undefined ? {} : { reason }) },
    }
  }

  private receiptPath(requestId: string): string { return 'requests/' + createHash('sha256').update(requestId).digest('hex') + '.json' }

  private async readReceipt(requestId: string): Promise<OfficialReceipt | undefined> {
    const bytes = await this.receipts.read(this.receiptPath(requestId))
    if (bytes === undefined) return undefined
    const value = decodeJson(bytes) as OfficialReceipt
    if (value.schemaVersion !== 1 || value.request?.requestId !== requestId || !['dispatched', 'received'].includes(value.stage)) throw new Error('official receipt is corrupt')
    return value
  }

  private async artifactMatches(request: HostInstallRequest): Promise<boolean> {
    const artifact = request.artifact
    if (!isAbsolute(artifact.localRef) || !/^(?:sha256:)?[0-9a-f]{64}$/i.test(artifact.artifactDigest)) return false
    const size = await stat(artifact.localRef)
    if (!size.isFile() || size.size !== artifact.size) return false
    const bytes = await readFile(artifact.localRef)
    return createHash('sha256').update(bytes).digest('hex') === artifact.artifactDigest.replace(/^sha256:/, '').toLowerCase()
  }

  /** Rebuild ownership from receipts, current references and current bytes. */
  private async sourceEvidence(): Promise<readonly InventorySourceEvidence[]> {
    const paths = await this.receipts.list('requests/')
    if (paths.length === 0) return []
    const manifest = JSON.parse(await readFile(join(this.ctx.profileContext.dir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
    const evidence: InventorySourceEvidence[] = []
    for (const path of paths) {
      const bytes = await this.receipts.read(path)
      if (bytes === undefined) throw new Error('official receipt disappeared')
      const receipt = decodeJson(bytes) as OfficialReceipt
      if (receipt.schemaVersion !== 1 || !receipt.request?.artifact) throw new Error('invalid official receipt')
      if (receipt.stage !== 'received' || receipt.outcome?.kind !== 'applied') continue
      const request = receipt.request
      const dependencyRef = manifest.dependencies?.[request.artifact.packageName]
      if (typeof dependencyRef !== 'string' || !dependencyRef.startsWith('file:')) continue
      const dependencyPath = resolve(this.ctx.profileContext.dir, dependencyRef.slice(5))
      const key = (value: string): string => process.platform === 'win32' ? normalize(value).toLowerCase() : normalize(value)
      if (key(dependencyPath) !== key(resolve(request.artifact.localRef))) continue
      let matches = false
      try { matches = await this.artifactMatches(request) } catch { /* Missing cache cannot grant ownership. */ }
      if (!matches) continue
      evidence.push({ packageName: request.artifact.packageName, version: request.artifact.version,
        kind: 'market-cache-file', receiptId: request.requestId, digest: request.artifact.artifactDigest,
        dependencyRef, cacheRef: request.artifact.localRef,
        restartRequired: receipt.outcome.restartRequired && receipt.sessionRevision === HOST_SESSION })
    }
    return evidence
  }

  async install(request: HostInstallRequest): Promise<HostInstallOutcome> {
    if (this.manager?.installBundle === undefined) return {
      kind: 'unknown',
      error: 'official installBundle is unavailable',
      errorCode: 'adapter/capability-unavailable',
      permissionChanges: [],
    }
    const prior = await this.readReceipt(request.requestId)
    if (prior !== undefined) {
      if (canonicalJson(prior.request) !== canonicalJson(request)) return { kind: 'unknown', error: 'request identity changed', permissionChanges: [] }
      return await this.reconcileInstall(request.requestId) ?? { kind: 'unknown', error: 'old request has no reliable receipt; not replayed', permissionChanges: [] }
    }
    try {
      if (!await this.artifactMatches(request)) return { kind: 'failed', changed: false, error: 'artifact bytes, size or digest changed before official write', errorCode: 'artifact/integrity', permissionChanges: [] }
    } catch (error) { return { kind: 'failed', changed: false, error: redactDiagnostic(String(error)), errorCode: 'artifact/unreadable', permissionChanges: [] } }
    const receipt: OfficialReceipt = { schemaVersion: 1, request, sessionRevision: HOST_SESSION, at: new Date().toISOString(), stage: 'dispatched' }
    await this.receipts.writeAtomic(this.receiptPath(request.requestId), encodeJson(receipt))
    this.active.add(request.requestId)
    try {
      const result = await this.manager.installBundle(request.artifact.localRef, {
        enabled: request.enabled, requestId: request.requestId as PluginInstallRequestId,
        ...(request.approvedBuilds === undefined ? {} : { approvedBuilds: [...request.approvedBuilds] }),
      })
      let mapped = await mapOfficialChange(result, request.approvedBuilds, request.requestId)
      if (mapped.kind === 'applied' && officialResultTarget(result) !== request.artifact.packageName)
        mapped = { kind: 'unknown', error: 'official result target differs from confirmed artifact', errorCode: 'receipt/target-mismatch', permissionChanges: mapped.permissionChanges }
      await this.receipts.writeAtomic(this.receiptPath(request.requestId), encodeJson({ ...receipt, stage: 'received', outcome: mapped }))
      // The official enabled:false option leaves existing selections untouched.
      // A corrective disable remains inside the caller's execution occupation.
      if (mapped.kind === 'applied' && !request.enabled && result.changed) {
        const manifest = JSON.parse(await readFile(join(this.ctx.profileContext.dir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; dsh?: { profile?: { bundles?: string[] } } }
        if (manifest.dsh?.profile?.bundles?.includes(request.artifact.packageName)) {
          const inventory = await this.adapter.inventory(this.environmentId)
          const target = inventory.items.find(item => item.packageName === request.artifact.packageName)
          const dependency = manifest.dependencies?.[request.artifact.packageName]
          const safe = typeof dependency === 'string' && dependency.startsWith('file:')
            && normalize(resolve(this.ctx.profileContext.dir, dependency.slice(5))).toLowerCase() === normalize(resolve(request.artifact.localRef)).toLowerCase()
            && await this.artifactMatches(request)
            && inventory.unknownItems.length === 0 && target?.version === request.artifact.version && target.source === 'market-cache-file'
          if (!safe || this.manager.setBundleEnabled === undefined) mapped = { kind: 'unknown', error: 'explicit disable prerequisite changed or unavailable', permissionChanges: mapped.permissionChanges }
          else {
            const disabled = await mapOfficialChange(await this.manager.setBundleEnabled(request.artifact.packageName, false))
            if (disabled.kind !== 'applied') mapped = { kind: 'unknown', error: 'installed but explicit disable is unconfirmed', permissionChanges: mapped.permissionChanges }
          }
        }
      }
      await this.receipts.writeAtomic(this.receiptPath(request.requestId), encodeJson({ ...receipt, stage: 'received', outcome: mapped }))
      if (mapped.kind === 'applied') {
        const inventory = await this.adapter.inventory(this.environmentId)
        const installed = inventory.items.find(item => item.packageName === request.artifact.packageName)
        if (inventory.unknownItems.length > 0 || installed?.version !== request.artifact.version || installed.source !== 'market-cache-file' || installed.bundleEnabled !== request.enabled)
          return { kind: 'unknown', error: 'official receipt saved but dependency, cache bytes or inventory did not verify', errorCode: 'receipt/postcondition', permissionChanges: mapped.permissionChanges }
      }
      return mapped
    } catch (error) {
      // After dispatch an exception never establishes changed:false. Retain the
      // request journal and consult the official activity/receipt during recovery.
      return { kind: 'unknown', error: redactDiagnostic(error instanceof Error ? error.message : 'official install failed'),
        errorCode: 'adapter/exception', diagnostic: redactDiagnostic(error instanceof Error ? error.stack ?? error.message : 'official install failed'), permissionChanges: [] }
    } finally { this.active.delete(request.requestId) }
  }

  async reconcileInstall(requestId: string): Promise<HostInstallOutcome | undefined> {
    let receipt = await this.readReceipt(requestId)
    if (receipt?.stage === 'received' && receipt.outcome !== undefined) return receipt.outcome
    const result = await this.manager?.waitForInstall?.(requestId as PluginInstallRequestId)
    if (result == null) return undefined
    const outcome = await mapOfficialChange(result, receipt?.request.approvedBuilds, requestId)
    if (receipt !== undefined) {
      receipt = { ...receipt, stage: 'received', outcome }
      await this.receipts.writeAtomic(this.receiptPath(requestId), encodeJson(receipt))
    }
    return outcome
  }

  async cancel(requestId: string): Promise<HostCancelOutcome> {
    if (this.manager?.cancelInstall === undefined) return { kind: 'unknown', reason: 'official cancelInstall is unavailable' }
    try {
      const result = await this.manager.cancelInstall(requestId as PluginInstallRequestId) as unknown
      const status = record(result)?.status
      return status === 'cancelled' || status === 'too-late' || status === 'not-running'
        ? { kind: status }
        : { kind: 'unknown', reason: 'unrecognised cancellation result: ' + redactDiagnostic(safeJson(result)) }
    } catch (error) {
      return { kind: 'unknown', reason: redactDiagnostic(error instanceof Error ? error.message : 'cancellation failed') }
    }
  }

  async setEnabled(packageName: string, enabled: boolean): Promise<HostInstallOutcome> {
    if (this.manager?.setBundleEnabled === undefined) return { kind: 'unknown', error: 'official setBundleEnabled is unavailable', permissionChanges: [] }
    try {
      return await mapOfficialChange(await this.manager.setBundleEnabled(packageName, enabled))
    } catch (error) {
      return {
        kind: 'unknown',
        error: redactDiagnostic(error instanceof Error ? error.message : 'official enable change failed'),
        errorCode: 'adapter/exception',
        diagnostic: redactDiagnostic(error instanceof Error ? error.stack ?? error.message : 'official enable change failed'),
        permissionChanges: [],
      }
    }
  }

  async remove(packageName: string): Promise<ChangeResult | HostInstallOutcome> {
    if (this.manager?.removeBundle === undefined) {
      return {
        kind: 'unknown',
        error: 'official removeBundle is unavailable',
        errorCode: 'adapter/capability-unavailable',
        permissionChanges: [],
      }
    }
    try {
      // Official 0.1.7-rc.2 and the typed remote contract accept exactly one
      // argument; extra options could alter future compatibility silently.
      return await this.manager.removeBundle(packageName)
    } catch (error) {
      return {
        kind: 'unknown',
        error: redactDiagnostic(error instanceof Error ? error.message : 'official remove failed'),
        errorCode: 'adapter/exception',
        diagnostic: redactDiagnostic(error instanceof Error ? error.stack ?? error.message : 'official remove failed'),
        permissionChanges: [],
      }
    }
  }
}
