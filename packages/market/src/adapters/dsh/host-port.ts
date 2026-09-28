/**
 * Official pluginManager adapter for the market core ports. This is the only
 * layer allowed to turn official ChangeResult fields into market outcomes;
 * missing or unrecognised values remain unknown and never become success.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
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
import { pendingBuildsDigest } from '../../core/canonical.ts'
import { DshManagerAdapter } from './manager.ts'

interface OfficialManager {
  installBundle(spec: string, options?: {
    enabled?: boolean
    requestId?: PluginInstallRequestId
    approvedBuilds?: readonly string[]
  }): Promise<ChangeResult>
  setBundleEnabled(name: string, enabled: boolean): Promise<ChangeResult>
  removeBundle(name: string, options?: unknown): Promise<ChangeResult>
  cancelInstall(requestId: PluginInstallRequestId): Promise<PluginInstallCancellation>
  waitForInstall(requestId: PluginInstallRequestId): Promise<ChangeResult | null>
}

interface RunRecord {
  readonly pid?: unknown
  readonly grouped?: unknown
}

function errorCode(result: ChangeResult): string | undefined {
  return result.error?.code ?? result.packageResult?.kind
}

/** Keeps useful official diagnostics bounded and strips credentials/absolute paths. */
export function redactDiagnostic(value: string, limit = 2000): string {
  const redacted = value
    .replace(/([A-Za-z]:[\\/]|\\\\)[^\s"']+/g, '<path>')
    .replace(/(https?:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, '$1***@')
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, '$1<redacted>')
    .replace(/((?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1<redacted>')
  return redacted.length > limit ? redacted.slice(0, limit) + '…' : redacted
}

function diagnosticFor(result: ChangeResult): string | undefined {
  const parts = [
    result.error?.diagnostic,
    result.packageResult?.output,
    result.packageResult?.logPath === undefined ? undefined : 'log:' + result.packageResult.logPath,
    result.failedAt === undefined ? undefined : 'failedAt:' + result.failedAt,
  ].filter((part): part is string => typeof part === 'string' && part.length > 0)
  return parts.length === 0 ? undefined : redactDiagnostic(parts.join('\n'))
}

function permissionChanges(result: ChangeResult, approvedBuilds: readonly string[] | undefined): readonly { packageName: string; decision: 'approved' | 'revoked' | 'already-approved' }[] {
  const names = result.approvedBuilds ?? approvedBuilds ?? []
  return [...new Set(names)].sort().map((packageName) => ({ packageName, decision: 'approved' }))
}

async function mapChange(result: ChangeResult, approvedBuilds?: readonly string[], attemptId = `official-${Date.now()}`): Promise<HostInstallOutcome> {
  const permissions = permissionChanges(result, approvedBuilds)
  const diagnostic = diagnosticFor(result)
  const packageResultCode = result.packageResult?.kind ?? (result.packageResult?.exitCode === undefined ? undefined : `exit-${result.packageResult.exitCode}`)
  if (result.pendingBuilds !== undefined && result.pendingBuilds.length > 0) {
    return {
      kind: 'awaiting-approval',
      attemptId,
      pendingBuilds: [...result.pendingBuilds].sort(),
      pendingBuildsDigest: await pendingBuildsDigest(result.pendingBuilds),
      permissionChanges: permissions,
    }
  }
  if (result.application === 'applied' || result.application === 'restart-required') {
    return {
      kind: 'applied',
      changed: result.changed,
      restartRequired: result.application === 'restart-required',
      ...(packageResultCode === undefined ? {} : { packageResultCode }),
      permissionChanges: permissions,
    }
  }
  if (result.application === 'overridden') {
    return {
      kind: 'unknown',
      error: 'official application was overridden by a higher-priority state',
      errorCode: 'overridden',
      ...(diagnostic === undefined ? {} : { diagnostic }),
      permissionChanges: permissions,
    }
  }
  if (result.application === 'cancelled') {
    return {
      kind: 'cancelled',
      changed: result.changed,
      ...(packageResultCode === undefined ? {} : { packageResultCode }),
      permissionChanges: permissions,
    }
  }
  if (result.application === 'failed') {
    const code = errorCode(result)
    return {
      kind: 'failed',
      changed: result.changed,
      ...(packageResultCode === undefined ? {} : { packageResultCode }),
      error: code ?? 'operation-error',
      ...(code === undefined ? {} : { errorCode: code }),
      ...(diagnostic === undefined ? {} : { diagnostic }),
      permissionChanges: permissions,
    }
  }
  return {
    kind: 'unknown',
    error: 'official ChangeResult application is missing or unrecognised',
    errorCode: 'protocol/unknown',
    ...(diagnostic === undefined ? {} : { diagnostic }),
    permissionChanges: permissions,
  }
}
function alive(pid: number, grouped: boolean): boolean {
  try {
    process.kill(process.platform !== 'win32' && grouped ? -pid : pid, 0)
    return true
  } catch {
    return false
  }
}

export class OfficialHostPort implements HostPort {
  private readonly adapter: DshManagerAdapter

  constructor(private readonly ctx: Context, private readonly environmentId = 'current') {
    this.adapter = new DshManagerAdapter(ctx)
  }

  /** Resolve at call time: pluginManager may activate after this service. */
  private get manager(): OfficialManager | undefined {
    return this.ctx.get('pluginManager') as OfficialManager | undefined
  }

  capabilities(): readonly import('../../contracts/types.ts').CapabilityName[] {
    return this.adapter.capabilities()
  }

  async readState(): Promise<HostReadState> {
    const inventory = await this.adapter.inventory(this.environmentId)
    let stable = true
    let unknownSharedImpact = false
    let reason: string | undefined
    try {
      const raw = readFileSync(join(this.ctx.profileContext.dir, '.plugin-manager', 'run.json'), 'utf8')
      const value = JSON.parse(raw) as RunRecord
      const pid = typeof value.pid === 'number' ? value.pid : undefined
      const grouped = value.grouped === true
      if (pid !== undefined && alive(pid, grouped)) {
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
      sessionRevision: `official-${inventory.items.length}-${inventory.items.map((item) => `${item.packageName}@${item.version ?? ''}`).join(',')}`,
      activeRequests: [],
      activity: { stable, unknownSharedImpact, ...(reason === undefined ? {} : { reason }) },
    }
  }

  async install(request: HostInstallRequest): Promise<HostInstallOutcome> {
    if (this.manager?.installBundle === undefined) return { kind: 'unknown', error: 'official installBundle is unavailable', permissionChanges: [] }
    const spec = request.artifact.localRef
    if (!/^[A-Za-z]:[\\/]/.test(spec) && !spec.startsWith('\\\\')) {
      return { kind: 'unknown', error: 'artifact adapter did not provide an internal local path', permissionChanges: [] }
    }
    try {
      const result = await this.manager.installBundle(spec, {
        enabled: request.enabled,
        requestId: request.requestId as PluginInstallRequestId,
        ...(request.approvedBuilds === undefined ? {} : { approvedBuilds: [...request.approvedBuilds] }),
      })
      const mapped = await mapChange(result, request.approvedBuilds, request.requestId)
      if (mapped.kind === 'applied' && !request.enabled && result.changed) {
        const name = result.bundle ?? result.target
        if (name !== undefined && this.manager.setBundleEnabled !== undefined) {
          const disable = await this.manager.setBundleEnabled(name, false)
          if (disable.application !== 'applied' && disable.application !== 'restart-required') {
            return {
              kind: 'unknown',
              error: 'installed, but explicit disable could not be confirmed',
              errorCode: 'disable/unconfirmed',
              ...(diagnosticFor(disable) === undefined ? {} : { diagnostic: diagnosticFor(disable) }),
              permissionChanges: mapped.permissionChanges,
            }
          }
        }
      }
      return mapped
    } catch (error) {
      return {
        kind: 'failed',
        changed: false,
        error: redactDiagnostic(error instanceof Error ? error.message : 'official install failed'),
        errorCode: 'adapter/exception',
        diagnostic: redactDiagnostic(error instanceof Error ? error.stack ?? error.message : 'official install failed'),
        permissionChanges: [],
      }
    }
  }

  async cancel(requestId: string): Promise<HostCancelOutcome> {
    if (this.manager?.cancelInstall === undefined) return { kind: 'unknown', reason: 'official cancelInstall is unavailable' }
    try {
      const result = await this.manager.cancelInstall(requestId as PluginInstallRequestId)
      return result.status === 'cancelled' || result.status === 'too-late' || result.status === 'not-running'
        ? { kind: result.status }
        : { kind: 'unknown', reason: 'unrecognised cancellation result' }
    } catch (error) {
      return { kind: 'unknown', reason: error instanceof Error ? error.message : 'cancellation failed' }
    }
  }

  async setEnabled(packageName: string, enabled: boolean): Promise<HostInstallOutcome> {
    if (this.manager?.setBundleEnabled === undefined) return { kind: 'unknown', error: 'official setBundleEnabled is unavailable', permissionChanges: [] }
    try {
      return await mapChange(await this.manager.setBundleEnabled(packageName, enabled))
    } catch (error) {
      return {
        kind: 'failed',
        changed: false,
        error: redactDiagnostic(error instanceof Error ? error.message : 'official enable change failed'),
        errorCode: 'adapter/exception',
        diagnostic: redactDiagnostic(error instanceof Error ? error.stack ?? error.message : 'official enable change failed'),
        permissionChanges: [],
      }
    }
  }

  async remove(packageName: string): Promise<ChangeResult> {
    if (this.manager?.removeBundle === undefined) throw new Error('official removeBundle is unavailable')
    return this.manager.removeBundle(packageName, {})
  }
}
