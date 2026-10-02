import type {
  BundleSelectionGraph,
  BundleSelectionNode,
  CancelSelectionResult,
  CancellationPreservationReason,
  PreservedCancellationItem,
} from '../contracts/types.ts'

/**
 * 宿主之外的事实由 Core 传入；这些值只用于取消保护，不会改变选择图。
 * 数组使用节点 id、pluginId 或 packageName 均可，解析时会统一到图节点。
 */
export interface CancellationSelectionContext {
  readonly selectedPackageIds?: readonly string[]
  readonly installedPackageIds?: readonly string[]
  readonly explicitPackageIds?: readonly string[]
  readonly parallelSelectedPackageIds?: readonly string[]
  readonly otherBundleSelectedPackageIds?: readonly string[]
  readonly completedPackageIds?: readonly string[]
  readonly unknownPackageIds?: readonly string[]
  readonly officialProtectedPackageIds?: readonly string[]
}

export interface SelectionGraphValidation {
  readonly valid: boolean
  readonly errors: readonly string[]
}

export interface SelectionGraphIndex {
  readonly nodes: ReadonlyMap<string, BundleSelectionNode>
  readonly dependents: ReadonlyMap<string, readonly string[]>
  readonly dependencies: ReadonlyMap<string, readonly string[]>
}

/** Agent Forge v2 package projection inputs. `id` is the package record ID;
 * bundle members refer to it through `memberId`, not packageName.
 */
export interface AgentForgeBundleMemberInput {
  readonly id: string
  readonly kind?: 'bundle' | 'plugin'
  readonly packageName?: string
  readonly version?: string
}

export interface AgentForgeBundleRecordInput {
  readonly id: string
  readonly kind?: 'bundle' | 'plugin'
  readonly packageName?: string
  readonly version?: string
  readonly members?: readonly (string | AgentForgeBundleMemberInput)[]
  readonly dependencies?: readonly (string | AgentForgeBundleMemberInput)[]
}

export type AgentForgePackageRecord = Readonly<Record<string, unknown>>

/** Convert real Agent Forge records, resolving every memberId against record id.
 * Duplicate identities or unsupported references remain validation failures.
 */
export function agentForgeBundleRecords(records: readonly unknown[]): readonly AgentForgeBundleRecordInput[] {
  const normalized = records.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid-package-record:${index}`)
    const record = value as Record<string, unknown>
    const id = record.id
    const name = record.name
    const version = record.version
    const type = record.type
    if (record.schemaVersion !== 2 || typeof id !== 'string' || !id || typeof name !== 'string' || !name || typeof version !== 'string' || !version || typeof type !== 'string') {
      throw new Error(`invalid-agent-forge-package:${String(id ?? index)}`)
    }
    let members: readonly AgentForgeBundleMemberInput[] | undefined
    if (type === 'bundle') {
      const details = record.bundleDetails
      if (!details || typeof details !== 'object' || Array.isArray(details)) throw new Error(`bundle-members-missing:${id}`)
      const rawMembers = (details as Record<string, unknown>).members
      if (!Array.isArray(rawMembers) || rawMembers.length === 0) throw new Error(`bundle-members-missing:${id}`)
      members = rawMembers.map((rawMember, memberIndex) => {
        if (!rawMember || typeof rawMember !== 'object' || Array.isArray(rawMember)) throw new Error(`invalid-bundle-member:${id}:${memberIndex}`)
        const member = rawMember as Record<string, unknown>
        if (typeof member.memberId !== 'string' || !member.memberId || (member.memberType !== 'package' && member.memberType !== 'bundle')) throw new Error(`invalid-bundle-member:${id}:${memberIndex}`)
        return { id: member.memberId, kind: member.memberType === 'bundle' ? 'bundle' as const : 'plugin' as const }
      })
    }
    let dependencies: readonly string[] | undefined
    if (record.dependencies !== undefined) {
      if (!Array.isArray(record.dependencies)) throw new Error(`invalid-dependencies:${id}`)
      dependencies = record.dependencies.map((rawDependency, dependencyIndex) => {
        if (!rawDependency || typeof rawDependency !== 'object' || Array.isArray(rawDependency) || typeof (rawDependency as Record<string, unknown>).id !== 'string' || !(rawDependency as Record<string, unknown>).id) {
          throw new Error(`invalid-dependency:${id}:${dependencyIndex}`)
        }
        return (rawDependency as Record<string, unknown>).id as string
      })
    }
    return { id, name, version, type, ...(members === undefined ? {} : { members }), ...(dependencies === undefined ? {} : { dependencies }) }
  })
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const record of normalized) {
    if (ids.has(record.id)) throw new Error(`duplicate-package-id:${record.id}`)
    if (names.has(record.name)) throw new Error(`duplicate-package-name:${record.name}`)
    ids.add(record.id)
    names.add(record.name)
  }
  return normalized.map(record => ({
    id: record.id,
    kind: record.type === 'bundle' ? 'bundle' : 'plugin',
    packageName: record.name,
    version: record.version,
    ...(record.members === undefined ? {} : { members: record.members }),
    ...(record.dependencies === undefined ? {} : { dependencies: record.dependencies }),
  }))
}

export interface BuildSelectionGraphResult {
  readonly graph: BundleSelectionGraph
  readonly validation: SelectionGraphValidation
}

const emptyContext: Required<CancellationSelectionContext> = {
  selectedPackageIds: [], installedPackageIds: [], explicitPackageIds: [],
  parallelSelectedPackageIds: [], otherBundleSelectedPackageIds: [], completedPackageIds: [],
  unknownPackageIds: [], officialProtectedPackageIds: [],
}

function nodeLabels(node: BundleSelectionNode): readonly string[] {
  return [node.id, node.pluginId, node.packageName].filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function displayName(node: BundleSelectionNode): string {
  return node.packageName ?? node.pluginId ?? node.id
}

function addUnique(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key) ?? []
  if (!values.includes(value)) values.push(value)
  map.set(key, values)
}

/**
 * 展开 Agent Forge 的 Bundle 成员和嵌套 Bundle。该投影不推导必选项：
 * Bundle 成员与 dependency 节点始终 optional=true、selected=false；依赖只形成边。
 */
export function buildBundleSelectionGraph(
  records: readonly AgentForgeBundleRecordInput[],
  rootBundleId: string,
  revision = 'unknown',
): BuildSelectionGraphResult {
  const recordsById = new Map<string, AgentForgeBundleRecordInput>()
  const duplicateIdentityErrors: string[] = []
  const packageNames = new Map<string, string>()
  for (const record of records) {
    if (recordsById.has(record.id)) duplicateIdentityErrors.push(`duplicate-record-id:${record.id}`)
    else recordsById.set(record.id, record)
    if (record.packageName !== undefined) {
      const previousId = packageNames.get(record.packageName)
      if (previousId !== undefined && previousId !== record.id) duplicateIdentityErrors.push(`duplicate-package-name:${record.packageName}`)
      else packageNames.set(record.packageName, record.id)
    }
  }
  const nodes = new Map<string, BundleSelectionNode>()
  const edges: { readonly prerequisiteId: string; readonly consumerId: string; readonly milestone: 'installed' }[] = []
  const expanded = new Set<string>()
  const expansionStack = new Set<string>()
  const buildErrors: string[] = []
  const ensureNode = (id: string, kind: 'bundle' | 'plugin' | 'dependency', parentId: string | undefined, source?: AgentForgeBundleRecordInput | AgentForgeBundleMemberInput): string => {
    const existing = nodes.get(id)
    if (existing) return id
    const node: BundleSelectionNode = {
      id, kind, ...(parentId === undefined ? {} : { parentId }),
      ...(source?.packageName === undefined ? {} : { packageName: source.packageName }),
      ...(source?.version === undefined ? {} : { version: source.version }),
      ...(kind === 'plugin' || kind === 'dependency' ? { pluginId: source?.id ?? id } : {}),
      optional: true, selected: false, dependencies: [],
    }
    nodes.set(id, node)
    return id
  }
  const addDependency = (consumerId: string, dependency: string | AgentForgeBundleMemberInput): void => {
    const dependencyRecord = recordsById.get(typeof dependency === 'string' ? dependency : dependency.id)
    const dependencyId = typeof dependency === 'string' ? dependency : dependency.id
    const nodeId = dependencyRecord?.kind === 'bundle' || dependencyRecord?.members !== undefined
      ? expandBundle(dependencyId)
      : dependencyRecord === undefined
        ? dependencyId
        : ensureNode(dependencyId, 'plugin', undefined, dependencyRecord)
    const consumer = nodes.get(consumerId)
    if (consumer && !consumer.dependencies.includes(nodeId)) {
      nodes.set(consumerId, { ...consumer, dependencies: [...consumer.dependencies, nodeId] })
      edges.push({ prerequisiteId: nodeId, consumerId, milestone: 'installed' })
    }
  }
  const expandBundle = (bundleId: string, parentId?: string): string => {
    if (expansionStack.has(bundleId)) {
      buildErrors.push(`bundle-member-cycle:${[...expansionStack, bundleId].join('->')}`)
      return bundleId
    }
    const record = recordsById.get(bundleId)
    if (!record) {
      buildErrors.push(parentId === undefined ? `missing-root:${bundleId}` : `missing-member:${parentId}->${bundleId}`)
      return bundleId
    }
    const bundleNodeId = ensureNode(bundleId, 'bundle', parentId, record)
    if (expanded.has(bundleId)) return bundleNodeId
    expanded.add(bundleId)
    expansionStack.add(bundleId)
    const memberIds = new Set<string>()
    for (const member of record.members ?? []) {
      const memberId = typeof member === 'string' ? member : member.id
      if (memberIds.has(memberId)) {
        buildErrors.push(`duplicate-member:${bundleNodeId}->${memberId}`)
        continue
      }
      memberIds.add(memberId)
      const memberRecord = recordsById.get(memberId)
      const memberIsBundle = typeof member === 'string'
        ? memberRecord?.kind === 'bundle' || memberRecord?.members !== undefined
        : member.kind === 'bundle' || memberRecord?.kind === 'bundle' || memberRecord?.members !== undefined
      if (memberRecord && typeof member !== 'string' && memberRecord.kind !== undefined && memberRecord.kind !== member.kind) {
        buildErrors.push(`member-type-mismatch:${bundleNodeId}->${memberId}`)
        continue
      }
      if (memberRecord === undefined) {
        buildErrors.push(`missing-member:${bundleNodeId}->${memberId}`)
      } else if (memberIsBundle) expandBundle(memberId, bundleNodeId)
      else ensureNode(memberId, 'plugin', bundleNodeId, memberRecord)
    }
    for (const dependency of record.dependencies ?? []) addDependency(bundleNodeId, dependency)
    expansionStack.delete(bundleId)
    return bundleNodeId
  }
  const rootId = expandBundle(rootBundleId)
  // Expand plugin records referenced by members after creating their node, including dependency chains.
  const processedPlugins = new Set<string>()
  let pluginCursor = 0
  while (pluginCursor < nodes.size) {
    const pluginNodes = [...nodes.values()].filter(node => node.kind === 'plugin')
    const node = pluginNodes[pluginCursor++]
    if (!node || processedPlugins.has(node.id)) continue
    processedPlugins.add(node.id)
    const record = recordsById.get(node.pluginId ?? node.id)
    for (const dependency of record?.dependencies ?? []) addDependency(node.id, dependency)
  }
  const graph: BundleSelectionGraph = { revision, rootId, nodes: [...nodes.values()], edges }
  const validation = validateSelectionGraph(graph)
  const errors = [...new Set([...duplicateIdentityErrors, ...buildErrors, ...validation.errors])]
  return { graph, validation: { valid: errors.length === 0, errors } }
}

/** Returns a stable graph index and resolves dependency edges from both node.dependencies and graph.edges. */
export function indexSelectionGraph(graph: BundleSelectionGraph): SelectionGraphIndex {
  const nodes = new Map<string, BundleSelectionNode>()
  for (const node of graph.nodes) nodes.set(node.id, node)
  const dependencies = new Map<string, string[]>()
  const dependents = new Map<string, string[]>()
  for (const node of graph.nodes) {
    for (const prerequisite of node.dependencies) {
      if (!dependencies.get(node.id)?.includes(prerequisite)) addUnique(dependencies, node.id, prerequisite)
      addUnique(dependents, prerequisite, node.id)
    }
  }
  for (const edge of graph.edges) {
    addUnique(dependencies, edge.consumerId, edge.prerequisiteId)
    addUnique(dependents, edge.prerequisiteId, edge.consumerId)
  }
  return { nodes, dependencies, dependents }
}

/** Checks duplicate ids, missing roots/references, and dependency cycles before freezing a plan. */
export function validateSelectionGraph(graph: BundleSelectionGraph): SelectionGraphValidation {
  const errors: string[] = []
  const ids = new Set<string>()
  for (const node of graph.nodes) {
    if (ids.has(node.id)) errors.push(`duplicate-node:${node.id}`)
    ids.add(node.id)
    if (node.optional !== true) errors.push(`non-optional:${node.id}`)
  }
  if (!ids.has(graph.rootId)) errors.push(`missing-root:${graph.rootId}`)
  const index = indexSelectionGraph(graph)
  for (const [consumer, prerequisites] of index.dependencies) {
    if (!ids.has(consumer)) errors.push(`missing-consumer:${consumer}`)
    for (const prerequisite of prerequisites) if (!ids.has(prerequisite)) errors.push(`missing-prerequisite:${consumer}->${prerequisite}`)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) { errors.push(`dependency-cycle:${id}`); return }
    if (visited.has(id)) return
    visiting.add(id)
    for (const prerequisite of index.dependencies.get(id) ?? []) if (ids.has(prerequisite)) visit(prerequisite)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of ids) visit(id)
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

function resolveNode(index: SelectionGraphIndex, value: string): BundleSelectionNode | undefined {
  const direct = index.nodes.get(value)
  if (direct) return direct
  for (const node of index.nodes.values()) if (nodeLabels(node).includes(value)) return node
  return undefined
}

function resolveSet(index: SelectionGraphIndex, values: readonly string[] | undefined): Set<string> {
  const result = new Set<string>()
  for (const value of values ?? []) {
    const node = resolveNode(index, value)
    if (node) result.add(node.id)
  }
  return result
}

function walk(index: SelectionGraphIndex, start: string, direction: 'dependencies' | 'dependents'): string[] {
  const result: string[] = []
  const seen = new Set<string>([start])
  const queue = [...(index[direction].get(start) ?? [])]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
    queue.push(...(index[direction].get(id) ?? []))
  }
  return result
}

export function selectionDependencies(graph: BundleSelectionGraph, id: string): readonly BundleSelectionNode[] {
  const index = indexSelectionGraph(graph)
  const node = resolveNode(index, id)
  if (!node) return []
  return walk(index, node.id, 'dependencies').map(item => index.nodes.get(item)).filter((item): item is BundleSelectionNode => item !== undefined)
}

export function selectionDependents(graph: BundleSelectionGraph, id: string): readonly BundleSelectionNode[] {
  const index = indexSelectionGraph(graph)
  const node = resolveNode(index, id)
  if (!node) return []
  return walk(index, node.id, 'dependents').map(item => index.nodes.get(item)).filter((item): item is BundleSelectionNode => item !== undefined)
}

function reasonText(reason: CancellationPreservationReason, packageName: string): string {
  const text: Record<CancellationPreservationReason, string> = {
    'has-selected-dependent': `仍有已选项目依赖 ${packageName}`,
    'has-installed-dependent': `仍有已安装项目依赖 ${packageName}`,
    'explicitly-installed': `${packageName} 是 explicit 安装`,
    'selected-in-parallel-task': `${packageName} 已在并行任务中选择`,
    'selected-in-other-bundle': `${packageName} 已在其它整合包中选择`,
    'completed-outside-current-task': `${packageName} 已在当前任务外完成`,
    'unknown-state': `${packageName} 状态未知`,
    'official-protected': `${packageName} 受官方管理保护`,
  }
  return text[reason]
}

function preserved(node: BundleSelectionNode, reasons: readonly CancellationPreservationReason[], dependents: readonly BundleSelectionNode[]): PreservedCancellationItem {
  return { packageName: displayName(node), reasons: [...new Set(reasons)], dependentPackages: dependents.map(displayName) }
}

/**
 * 计算普通取消或 Force 取消。普通取消遇到任何依赖者只返回 blocked，不产生取消清单；
 * Force 从依赖叶子向根传播保护，只有未完成且没有外部事实保护的节点才会进入 cascadedCancelled。
 */
export function cancelSelection(
  graph: BundleSelectionGraph,
  targetId: string,
  options: { readonly force?: boolean; readonly context?: CancellationSelectionContext } = {},
): CancelSelectionResult {
  const validation = validateSelectionGraph(graph)
  if (!validation.valid) return { status: 'blocked', dependentPackages: [], cascadedCancelled: [], preservedPackages: [], reasons: validation.errors }
  const index = indexSelectionGraph(graph)
  const target = resolveNode(index, targetId)
  if (!target) return { status: 'not-found', dependentPackages: [], cascadedCancelled: [], preservedPackages: [], reasons: [`未找到选择项:${targetId}`] }
  const context = { ...emptyContext, ...(options.context ?? {}) }
  const selected = resolveSet(index, context.selectedPackageIds)
  const installed = resolveSet(index, context.installedPackageIds)
  const explicit = resolveSet(index, context.explicitPackageIds)
  const parallel = resolveSet(index, context.parallelSelectedPackageIds)
  const otherBundle = resolveSet(index, context.otherBundleSelectedPackageIds)
  const completed = resolveSet(index, context.completedPackageIds)
  const unknown = resolveSet(index, context.unknownPackageIds)
  const official = resolveSet(index, context.officialProtectedPackageIds)
  const directOrTransitive = selectionDependents(graph, target.id)
  const dependentPackages = directOrTransitive.map(displayName)
  const isActiveDependent = (node: BundleSelectionNode): boolean => node.selected || selected.has(node.id) || installed.has(node.id)
    || explicit.has(node.id) || parallel.has(node.id) || otherBundle.has(node.id) || completed.has(node.id) || unknown.has(node.id) || official.has(node.id)
  const activeDependents = directOrTransitive.filter(isActiveDependent)
  const candidateIds = [target.id, ...activeDependents.map(node => node.id)]
  const candidateSet = new Set(candidateIds)
  const preservedById = new Map<string, PreservedCancellationItem>()
  const cancelled = new Set<string>()

  const externalReasons = (node: BundleSelectionNode): CancellationPreservationReason[] => {
    const reasons: CancellationPreservationReason[] = []
    if (installed.has(node.id) && !selected.has(node.id) && !node.selected) reasons.push('completed-outside-current-task')
    if (explicit.has(node.id)) reasons.push('explicitly-installed')
    if (parallel.has(node.id)) reasons.push('selected-in-parallel-task')
    if (otherBundle.has(node.id)) reasons.push('selected-in-other-bundle')
    if (completed.has(node.id)) reasons.push('completed-outside-current-task')
    if (unknown.has(node.id)) reasons.push('unknown-state')
    if (official.has(node.id)) reasons.push('official-protected')
    return reasons
  }

  if (!options.force && activeDependents.length > 0) {
    const directInstalled = activeDependents.filter(node => installed.has(node.id))
    const directSelected = activeDependents.filter(node => selected.has(node.id) || node.selected)
    const reasons: CancellationPreservationReason[] = []
    if (directSelected.length > 0) reasons.push('has-selected-dependent')
    if (directInstalled.length > 0) reasons.push('has-installed-dependent')
    const dependents = [...new Map(activeDependents.map(node => [node.id, node])).values()]
    preservedById.set(target.id, preserved(target, reasons.length > 0 ? reasons : ['has-selected-dependent'], dependents))
    return {
      status: 'blocked', dependentPackages, cascadedCancelled: [], preservedPackages: [...preservedById.values()],
      reasons: [...new Set([...reasons.map(reason => reasonText(reason, displayName(target))), '请先取消所有依赖该项目的选择项'])],
    }
  }

  if (!options.force && externalReasons(target).length > 0) {
    const reasons = externalReasons(target)
    const item = preserved(target, reasons, [])
    return { status: 'blocked', dependentPackages, cascadedCancelled: [], preservedPackages: [item], reasons: reasons.map(reason => reasonText(reason, displayName(target))) }
  }

  if (!options.force) {
    return { status: 'cancelled', dependentPackages, cascadedCancelled: [displayName(target)], preservedPackages: [], reasons: [] }
  }

  // Dependents must be considered before prerequisites so a preserved dependent protects its dependency.
  const ordered = [...candidateIds].reverse()
  for (const id of ordered) {
    const node = index.nodes.get(id)
    if (!node) continue
    const reasons = externalReasons(node)
    const dependents = (index.dependents.get(id) ?? []).map(dep => index.nodes.get(dep)).filter((item): item is BundleSelectionNode => item !== undefined)
    const preservedDependents = dependents.filter(dep => candidateSet.has(dep.id) && preservedById.has(dep.id))
    if (preservedDependents.length > 0) {
      if (preservedDependents.some(dep => selected.has(dep.id) || dep.selected)) reasons.push('has-selected-dependent')
      if (preservedDependents.some(dep => installed.has(dep.id))) reasons.push('has-installed-dependent')
    }
    if (reasons.length > 0) preservedById.set(id, preserved(node, reasons, [...dependents.filter(dep => preservedById.has(dep.id)), ...preservedDependents]))
    else cancelled.add(id)
  }
  // A dependency of any preserved item is protected even when it was not part of the requested closure.
  for (const [id] of preservedById) {
    for (const prerequisite of index.dependencies.get(id) ?? []) {
      if (!candidateSet.has(prerequisite) || preservedById.has(prerequisite)) continue
      const dependency = index.nodes.get(prerequisite)
      if (!dependency) continue
      const reason: CancellationPreservationReason = selected.has(id) || index.nodes.get(id)?.selected === true
        ? 'has-selected-dependent'
        : 'has-installed-dependent'
      const dependent = index.nodes.get(id)
      if (dependent) preservedById.set(prerequisite, preserved(dependency, [reason], [dependent]))
      cancelled.delete(prerequisite)
    }
  }
  const cascadedCancelled = [...cancelled].map(id => displayName(index.nodes.get(id)!))
  const preservedPackages = [...preservedById.values()]
  const status = preservedPackages.length === 0 ? 'cancelled' : cascadedCancelled.length === 0 ? 'blocked' : 'partial'
  const reasons = preservedPackages.flatMap(item => item.reasons.map(reason => reasonText(reason, item.packageName)))
  return { status, dependentPackages, cascadedCancelled, preservedPackages, reasons: [...new Set(reasons)] }
}

export function canCancelSelection(graph: BundleSelectionGraph, targetId: string, context?: CancellationSelectionContext): boolean {
  const result = cancelSelection(graph, targetId, context === undefined ? {} : { context })
  return result.status === 'cancelled'
}


export function buildAgentForgeBundleSelectionGraph(
  records: readonly unknown[],
  rootBundleId: string,
  revision = 'unknown',
): BuildSelectionGraphResult {
  try {
    return buildBundleSelectionGraph(agentForgeBundleRecords(records), rootBundleId, revision)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const root = records.find(value => !!value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).id === rootBundleId) as Record<string, unknown> | undefined
    const rootNode: BundleSelectionNode = {
      id: rootBundleId,
      kind: 'bundle',
      ...(root === undefined || typeof root.name !== 'string' ? {} : { packageName: root.name }),
      ...(root === undefined || typeof root.version !== 'string' ? {} : { version: root.version }),
      optional: true,
      selected: false,
      dependencies: [],
    }
    return {
      graph: { revision, rootId: rootBundleId, nodes: [rootNode], edges: [] },
      validation: { valid: false, errors: [message] },
    }
  }
}
