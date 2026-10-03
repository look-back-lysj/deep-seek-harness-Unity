/**
 * Bounded package-graph inspection for AI remove/downgrade. Reading manifests
 * never loads plugin JavaScript. Missing graph/evidence blocks only this risky
 * suggestion; ordinary browsing and official manual management remain usable.
 */
import type { AiActionImpact, CatalogPlugin, InventorySnapshot } from '../contracts/types.ts'
import { compareVersions, validVersion } from '../core/semver.ts'
import { sanitizeDiagnostic } from './diagnostics.ts'

export interface ManagementManifest {
  readonly name: string
  readonly version: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  /** Host-supplied resolver identity, never read from author JSON. */
  readonly resolutionKey?: string | undefined
}

export type ManagementManifestReader = (name: string, parent?: string) => ManagementManifest | undefined

function packageRoot(moduleName: string): string | undefined {
  const match = /^(?:@([a-z0-9._-]+)\/)?([a-z0-9][a-z0-9._-]*)(?:\/.*)?$/i.exec(moduleName)
  return match ? match[1] ? `@${match[1]}/${match[2]}` : match[2] : undefined
}

export function assessRiskyAction(input: {
  readonly kind: 'remove' | 'downgrade'
  readonly packageName: string
  readonly currentVersion: string
  readonly target?: CatalogPlugin | undefined
  readonly current?: CatalogPlugin | undefined
  readonly inventory: InventorySnapshot
  readonly readManifest: ManagementManifestReader
}): AiActionImpact {
  const unknowns: string[] = []
  const dependents = new Set<string>()
  const visited = new Set<string>()
  const resolved = new Set<string>()
  const queue = input.inventory.items.slice(0, 1500).map(item => ({ name: packageRoot(item.packageName),
    parent: undefined as string | undefined, optional: false, version: item.version }))
  if (input.inventory.items.length > 1500) unknowns.push('依赖图超过检查上限')
  let cursor = 0
  while (cursor < queue.length && visited.size < 1500) {
    const next = queue[cursor++]!
    if (!next.name) { unknowns.push('库存含无法解析的包身份'); continue }
    const key = `${next.parent ?? '<root>'}:${next.name}`
    if (visited.has(key)) continue
    visited.add(key)
    let manifest: ManagementManifest | undefined
    try { manifest = input.readManifest(next.name, next.parent) } catch {
      unknowns.push(`读取 ${next.name} 的依赖声明失败`)
      continue
    }
    if (!manifest) {
      if (!next.optional) unknowns.push(`无法核实 ${next.name} 的依赖声明`)
      continue
    }
    if (manifest.name !== next.name || !validVersion(manifest.version) || next.version !== undefined && manifest.version !== next.version) {
      unknowns.push(`无法核实 ${next.name} 的实际包身份或版本`)
      continue
    }
    // Only a Host resolver location distinguishes equal name/version packages
    // installed under different parents. Never deduplicate by name/version.
    if (manifest.resolutionKey) {
      if (resolved.has(manifest.resolutionKey)) continue
      resolved.add(manifest.resolutionKey)
    } else if (next.parent) unknowns.push(`无法核实 ${next.name} 的依赖解析位置`)
    const dependencies = new Map<string, boolean>()
    for (const [field, optional] of [['dependencies', false], ['optionalDependencies', true], ['peerDependencies', false]] as const) {
      const declarations = manifest[field]
      if (declarations === undefined) continue
      if (!declarations || typeof declarations !== 'object' || Array.isArray(declarations)) {
        unknowns.push(`${manifest.name} 的依赖声明格式无效`)
        continue
      }
      const entries = Object.entries(declarations)
      if (entries.length > 1500) unknowns.push('依赖图超过检查上限')
      for (const [name, version] of entries.slice(0, 1500)) {
        if (packageRoot(name) !== name || typeof version !== 'string' || !version.trim()) {
          unknowns.push(`${manifest.name} 含无法核实的依赖声明`)
          continue
        }
        // If any declaration is required, absence cannot be called optional.
        dependencies.set(name, (dependencies.get(name) ?? true) && optional)
      }
    }
    if (manifest.name !== input.packageName && dependencies.has(input.packageName)) dependents.add(manifest.name)
    for (const [name, optional] of dependencies) {
      if (name === manifest.name) continue
      if (queue.length >= 6000) { unknowns.push('依赖图超过检查上限'); break }
      queue.push({ name, parent: manifest.resolutionKey ?? manifest.name, optional, version: undefined })
    }
  }
  if (cursor < queue.length) unknowns.push('依赖图超过检查上限')
  if (input.inventory.unknownItems.some(issue => issue === `bundle-version:${input.packageName}` || issue.startsWith(`bundle:${input.packageName}:`))) unknowns.push('目标库存有未核实项目')
  const installed = input.inventory.items.find(item => item.packageName === input.packageName)
  if (!installed?.installed || installed.version !== input.currentVersion || !validVersion(input.currentVersion)) unknowns.push('当前安装身份或版本无法核实')
  if (dependents.size) unknowns.push(`以下组件依赖当前插件：${[...dependents].sort().join('、')}`)
  const subject = input.kind === 'remove' ? input.current : input.target
  const evidence = subject?.managementEvidence
  const boundEvidence = subject?.packageName === input.packageName && validVersion(subject.version)
    && (input.kind === 'remove' ? subject.version === input.currentVersion
      : validVersion(input.currentVersion) && compareVersions(subject.version, input.currentVersion) < 0)
    && !!evidence && /^sha256:[a-f0-9]{64}$/.test(subject.artifactDigest ?? '')
    && evidence.artifactDigest === subject.artifactDigest && evidence.stateless === true
    && typeof evidence.reviewId === 'string' && !!evidence.reviewId.trim()
    && typeof evidence.reviewedBy === 'string' && !!evidence.reviewedBy.trim()
    && Number.isFinite(Date.parse(evidence.reviewedAt)) && Date.parse(evidence.reviewedAt) <= Date.now()
    && typeof evidence.explanation === 'string' && !!evidence.explanation.trim()
    && Array.isArray(evidence.downgradeFrom) && evidence.downgradeFrom.every(version => typeof version === 'string' && validVersion(version))
  let dataReviewed = !!boundEvidence
  if (!boundEvidence) {
    unknowns.push('缺少绑定该制品的无状态数据审查记录')
  } else if (input.kind === 'remove' && evidence!.removePreservesExternalData !== true) {
    unknowns.push('未证明卸载保留独立用户数据')
    dataReviewed = false
  } else if (input.kind === 'downgrade' && !evidence!.downgradeFrom.includes(input.currentVersion)) {
    unknowns.push('审查记录未覆盖当前版本到目标版本的降级')
    dataReviewed = false
  }
  return {
    summary: input.kind === 'remove' ? `卸载 ${input.packageName}@${input.currentVersion}` : `${input.packageName} 从 ${input.currentVersion} 降至 ${input.target?.version ?? '未知'}`,
    currentVersion: input.currentVersion,
    ...(input.target ? { targetVersion: input.target.version } : {}),
    affectedPackages: [input.packageName, ...[...dependents].sort()],
    dataBehavior: dataReviewed
      ? `该制品有无状态审查：${sanitizeDiagnostic(evidence!.explanation)}。仅调用官方管理器，不额外删除独立配置和用户文件。`
      : '数据影响尚未完整确认；无法通过 AI 执行该危险操作。',
    unknowns: [...new Set(unknowns)].slice(0, 20),
  }
}
