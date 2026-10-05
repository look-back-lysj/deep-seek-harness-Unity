import type { CatalogCoreRangeDeclaration, CatalogHostRequirements, VersionScheme } from '../contracts/types.ts'
import * as input from './input.ts'

export function agentForgeHostRequirements(value: unknown, packageName: string, version: string | undefined): CatalogHostRequirements {
  const provenance = input.object(value, 'agentForgeMetadata')
  const document = input.raw(provenance.document, 'agentForgeMetadata.document')
  const record = input.object(input.json(document.bytes, 'agentForgeMetadata.document'), 'agentForgeMetadata.record')
  if (record.schemaVersion !== 2 || record.name !== packageName || record.version !== version) input.invalid('host-requirements-identity', 'Agent Forge 范围元数据与该版本身份不符')
  const sourceId = input.string(provenance.sourceId, 'agentForgeMetadata.sourceId', 200)
  const sourceRevision = input.string(provenance.sourceRevision, 'agentForgeMetadata.sourceRevision', 200)
  const declarations = input.array(record.targets, 'agentForgeMetadata.targets', 128).map((value): CatalogCoreRangeDeclaration => {
    const declaration = input.object(value, 'agentForgeMetadata.target')
    if (declaration.versionScheme !== undefined && (typeof declaration.versionScheme !== 'string' || !['semver', 'npm', 'pep440', 'calver', 'date', 'custom', 'unknown'].includes(declaration.versionScheme))) input.invalid('host-requirements', '目标版本方案无效')
    const versionScheme = declaration.versionScheme as VersionScheme | undefined
    if (!['known', 'unknown'].includes(declaration.compatibilityStatus as string)) input.invalid('host-requirements', '目标声明状态无效')
    if (declaration.compatibilityStatus === 'unknown' && declaration.agentVersionRange !== null) input.invalid('host-requirements', '未知目标范围必须为 null')
    return {
      agentId: input.string(declaration.agentId, 'declaration.agentId', 200),
      range: declaration.compatibilityStatus === 'unknown' ? null : input.string(declaration.agentVersionRange, 'declaration.range', 4096),
      ...(versionScheme === undefined ? {} : { versionScheme }),
      origin: 'agent-forge-target', metadataDigest: document.record.sha256, sourceId, sourceRevision,
    }
  })
  return { historyCoverage: 'latest-only', declarations }
}

export function packageHostRequirements(metadata: Record<string, unknown>, metadataDigest: string): CatalogHostRequirements {
  const declarations: CatalogCoreRangeDeclaration[] = []
  const engines = metadata.engines as Record<string, unknown> | undefined
  const peers = metadata.peerDependencies as Record<string, unknown> | undefined
  const engineRange = engines?.dsh
  const peerRange = peers?.['@deepseek-ai/dsh']
  if (typeof engineRange === 'string') declarations.push({ agentId: 'dsh', range: engineRange, versionScheme: 'npm', origin: 'package-engines', metadataDigest })
  if (typeof peerRange === 'string') declarations.push({ agentId: 'dsh', range: peerRange, versionScheme: 'npm', origin: 'package-peer', metadataDigest })
  return { historyCoverage: 'unknown', declarations }
}
