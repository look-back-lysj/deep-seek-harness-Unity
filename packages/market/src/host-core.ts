import { createHash } from 'node:crypto'
import type { HostCoreSnapshot } from '@dsh-eac/market-core/contracts'
import { validVersion } from '@dsh-eac/market-core/semver'

function dshHostSnapshot(version: string | null): HostCoreSnapshot {
  const snapshot = {
    agentId: 'dsh',
    agentName: 'DSH',
    version,
    versionScheme: 'semver' as const,
    status: version === null ? 'unknown' as const : 'known' as const,
    source: 'dsh-runtime-getter',
  }
  const hostRevision = `sha256:${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}`
  return version === null
    ? { ...snapshot, hostRevision, reason: '无法确认 DSH 运行时版本。' }
    : { ...snapshot, hostRevision }
}

export function readDshHostCore(readVersion: () => unknown): HostCoreSnapshot {
  let version: unknown
  try {
    version = readVersion()
  } catch {
    return dshHostSnapshot(null)
  }
  return dshHostSnapshot(typeof version === 'string' && version === version.trim() && validVersion(version) ? version : null)
}
