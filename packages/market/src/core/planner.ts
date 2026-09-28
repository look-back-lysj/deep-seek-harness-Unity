/**
 * Pure install-plan construction.
 *
 * The planner does not call Host, download, or write files. It converts a
 * catalog selection and an inventory snapshot into an immutable plan and a
 * deterministic execution order. Any unknown dependency or local identity is
 * blocked instead of guessed.
 */
import type {
  InstallPlan,
  InstallPlanItem,
  InventoryItem,
  PackExecutionEdge,
  PlanAction,
  PlanSelection,
} from '../contracts/types.ts'
import {
  canonicalJson,
  deepFreeze,
  sha256Hex,
} from './canonical.ts'
import type {
  ExpectedItemState,
  PackExecutionContext,
  PlanCatalogContext,
  PlanStep,
  PlanBundle,
  PreparedPlanResult,
} from './ports.ts'

const DEFAULT_TTL_MS = 15 * 60 * 1000
let planSequence = 0

function versionParts(version: string): readonly (string | number)[] {
  return version.split(/[-+]/, 1)[0]?.split('.').map((part) => {
    const numeric = Number(part)
    return Number.isInteger(numeric) ? numeric : part
  }) ?? []
}

/** Conservative SemVer-ish ordering; equal strings remain exactly equal. */
export function compareVersions(left: string, right: string): number {
  if (left === right) return 0
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const av = a[index] ?? 0
    const bv = b[index] ?? 0
    if (typeof av === 'number' && typeof bv === 'number') {
      if (av !== bv) return av < bv ? -1 : 1
    } else {
      const result = String(av).localeCompare(String(bv))
      if (result !== 0) return result < 0 ? -1 : 1
    }
  }
  const prereleaseA = left.includes('-') ? 1 : 0
  const prereleaseB = right.includes('-') ? 1 : 0
  return prereleaseA === prereleaseB ? 0 : prereleaseA > prereleaseB ? -1 : 1
}

function actionFor(current: InventoryItem | undefined, targetVersion: string): PlanAction {
  if (current === undefined || !current.installed) return 'add'
  if (current.version === undefined) return 'blocked'
  if (current.version === targetVersion) return 'keep'
  return compareVersions(targetVersion, current.version) > 0 ? 'upgrade' : 'downgrade'
}

function findInventoryItem(inventory: readonly InventoryItem[], packageName: string, pluginId: string): InventoryItem | undefined {
  return inventory.find((item) => item.packageName === packageName && (item.pluginId === undefined || item.pluginId === pluginId))
}

function freezePlan(plan: InstallPlan): InstallPlan {
  return deepFreeze(plan)
}

async function digestPlan(plan: InstallPlan): Promise<string> {
  return sha256Hex(canonicalJson({ ...plan, planDigest: '' }))
}

async function digestBundle(bundle: Omit<PlanBundle, 'bundleDigest'>): Promise<string> {
  return sha256Hex(canonicalJson({ ...bundle, bundleDigest: '' }))
}

/**
 * Builds and seals a plan. `pack` is optional for single-plugin plans; when
 * present, its Lock bytes are hashed and compared with the private execution
 * record before any dependency is trusted.
 */
export async function createPlanBundle(
  context: PlanCatalogContext,
  pack?: PackExecutionContext,
): Promise<PreparedPlanResult> {
  const details: string[] = []
  const structural: string[] = []
  const selectionsById = new Map<string, PlanSelection>()
  for (const selection of context.selections) {
    if (selectionsById.has(selection.pluginId)) {
      structural.push(`duplicate-selection:${selection.pluginId}`)
    } else {
      selectionsById.set(selection.pluginId, selection)
    }
  }

  if (pack !== undefined) {
    const lockDigest = await sha256Hex(pack.lockBytes)
    if (pack.execution.schemaVersion !== '1') structural.push('pack-execution:schema-version')
    if (pack.execution.packId !== pack.packId || pack.execution.packVersion !== pack.packVersion) {
      structural.push('pack-execution:identity-mismatch')
    }
    if (pack.execution.lockDigest !== lockDigest) structural.push('pack-execution:lock-digest-mismatch')
    if (pack.execution.coverage !== 'complete') structural.push(`pack-execution:coverage-${pack.execution.coverage}`)
    const componentIds = new Set(pack.components.map((component) => component.pluginId))
    for (const edge of pack.execution.edges) {
      if (!componentIds.has(edge.prerequisiteId) || !componentIds.has(edge.consumerId)) {
        structural.push(`pack-execution:edge-component-missing:${edge.prerequisiteId}->${edge.consumerId}`)
      }
      if (edge.prerequisiteId === edge.consumerId) structural.push(`pack-execution:self-edge:${edge.prerequisiteId}`)
    }
    for (const edge of pack.execution.edges) {
      if (selectionsById.has(edge.consumerId) && !selectionsById.has(edge.prerequisiteId)) {
        structural.push(`dependency:prerequisite-not-selected:${edge.prerequisiteId}`)
      }
    }
    const edgeKeys = new Set<string>()
    for (const edge of pack.execution.edges) {
      const key = `${edge.prerequisiteId}->${edge.consumerId}:${edge.milestone}`
      if (edgeKeys.has(key)) structural.push(`pack-execution:duplicate-edge:${key}`)
      edgeKeys.add(key)
    }
    const graph = new Map<string, PackExecutionEdge[]>()
    for (const pluginId of selectionsById.keys()) graph.set(pluginId, [])
    for (const edge of pack.execution.edges) {
      if (selectionsById.has(edge.consumerId)) graph.get(edge.consumerId)?.push(edge)
    }
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const order: string[] = []
    const visit = (pluginId: string): void => {
      if (visiting.has(pluginId)) {
        structural.push(`dependency:cycle:${pluginId}`)
        return
      }
      if (visited.has(pluginId)) return
      visiting.add(pluginId)
      for (const edge of graph.get(pluginId) ?? []) visit(edge.prerequisiteId)
      visiting.delete(pluginId)
      visited.add(pluginId)
      order.push(pluginId)
    }
    for (const pluginId of selectionsById.keys()) visit(pluginId)
    if (structural.length > 0) {
      return { status: 'blocked', reason: 'invalid-pack-execution', details: structural, blockers: structural }
    }
    const edgeByConsumer = new Map<string, PackExecutionEdge>()
    for (const edge of pack.execution.edges) {
      if (selectionsById.has(edge.consumerId)) edgeByConsumer.set(edge.consumerId, edge)
    }
    const factsByPlugin = new Map(context.plugins.map((fact) => [fact.pluginId, fact]))
    const inventory = contextInventory(context)
    const items: InstallPlanItem[] = []
    const steps: PlanStep[] = []
    const expected: ExpectedItemState[] = []
    let stepOrder = 0
    for (const pluginId of order) {
      const selection = selectionsById.get(pluginId)
      if (selection === undefined) continue
      const fact = factsByPlugin.get(pluginId)
      const current = findInventoryItem(inventory, selection.packageName, pluginId)
      const blockers: string[] = []
      if (fact === undefined || fact.packageName !== selection.packageName || fact.version !== selection.targetVersion || fact.artifactDigest !== selection.targetDigest) {
        blockers.push('catalog:selection-fact-mismatch')
      }
      if (fact?.verification === 'hard-incompatible') blockers.push('verification:hard-incompatible')
      if (fact?.verification === 'unknown' && !selection.tryUnverified) blockers.push('verification:unknown-not-confirmed')
      if (fact?.installable === false) blockers.push('artifact:not-installable')
      const localIdentity = context.localIdentityByPackage?.[selection.packageName]
      const managed = context.marketManagedPackageNames?.includes(selection.packageName) === true
      const protectedIdentity = localIdentity === undefined
        ? current?.source !== 'market-cache-file'
        : localIdentity !== 'registry'
      if (current?.installed === true && !managed && protectedIdentity) {
        blockers.push('local-identity:protected')
      }
      const action = actionFor(current, selection.targetVersion)
      if (action === 'blocked') blockers.push('inventory:version-unknown')
      if (blockers.length > 0) details.push(`${selection.packageName}:${blockers.join(',')}`)
      const edge = edgeByConsumer.get(pluginId)
      const requiresRestart = fact?.requiresRestart === true
      const item: InstallPlanItem = {
        pluginId,
        packageName: selection.packageName,
        action: blockers.length > 0 ? 'blocked' : action,
        ...(current?.version === undefined ? {} : { currentVersion: current.version }),
        currentEnabled: current?.bundleEnabled ?? false,
        targetVersion: selection.targetVersion,
        targetDigest: selection.targetDigest,
        requestedEnabled: selection.enabledIntent,
        verification: fact?.verification ?? 'unknown',
        requiresRestart,
        blockers,
      }
      items.push(item)
      expected.push({
        pluginId,
        packageName: selection.packageName,
        ...(current?.version === undefined ? {} : { version: current.version }),
        enabled: current?.bundleEnabled ?? false,
        source: current?.source ?? 'unknown',
        ...(localIdentity === undefined ? {} : { localIdentity }),
      })
      if (item.action !== 'keep' && item.action !== 'blocked') {
        steps.push({
          order: stepOrder++,
          pluginId,
          packageName: selection.packageName,
          ...(edge === undefined ? {} : { dependencyMilestone: edge.milestone }),
        })
      }
    }

    const plan = await makePlan(context, items, pack)
    if (structural.length > 0) return { status: 'blocked', reason: 'invalid-pack-execution', details: structural, blockers: structural }
    const bundleWithoutDigest = {
      plan,
      steps,
      dependencies: pack.execution.edges.filter((edge) => selectionsById.has(edge.consumerId)),
      expected,
    }
    const bundleDigest = await digestBundle(bundleWithoutDigest)
    const bundle = deepFreeze({ ...bundleWithoutDigest, bundleDigest })
    return { status: 'ready', bundle, details }
  }

  if (structural.length > 0) {
    return { status: 'blocked', reason: 'invalid-selection', details: structural, blockers: structural }
  }
  const factsByPlugin = new Map(context.plugins.map((fact) => [fact.pluginId, fact]))
  const inventory = contextInventory(context)
  const items: InstallPlanItem[] = []
  const steps: PlanStep[] = []
  const expected: ExpectedItemState[] = []
  let order = 0
  for (const selection of context.selections) {
    const fact = factsByPlugin.get(selection.pluginId)
    const current = findInventoryItem(inventory, selection.packageName, selection.pluginId)
    const blockers: string[] = []
    if (fact === undefined || fact.packageName !== selection.packageName || fact.version !== selection.targetVersion || fact.artifactDigest !== selection.targetDigest) {
      blockers.push('catalog:selection-fact-mismatch')
    }
    if (fact?.verification === 'hard-incompatible') blockers.push('verification:hard-incompatible')
    if (fact?.verification === 'unknown' && !selection.tryUnverified) blockers.push('verification:unknown-not-confirmed')
    if (fact?.installable === false) blockers.push('artifact:not-installable')
    const localIdentity = context.localIdentityByPackage?.[selection.packageName]
    const managed = context.marketManagedPackageNames?.includes(selection.packageName) === true
    const protectedIdentity = localIdentity === undefined
      ? current?.source !== 'market-cache-file'
      : localIdentity !== 'registry'
    if (current?.installed === true && !managed && protectedIdentity) {
      blockers.push('local-identity:protected')
    }
    const action = actionFor(current, selection.targetVersion)
    if (action === 'blocked') blockers.push('inventory:version-unknown')
    const item: InstallPlanItem = {
      pluginId: selection.pluginId,
      packageName: selection.packageName,
      action: blockers.length > 0 ? 'blocked' : action,
      ...(current?.version === undefined ? {} : { currentVersion: current.version }),
      currentEnabled: current?.bundleEnabled ?? false,
      targetVersion: selection.targetVersion,
      targetDigest: selection.targetDigest,
      requestedEnabled: selection.enabledIntent,
      verification: fact?.verification ?? 'unknown',
      requiresRestart: fact?.requiresRestart === true,
      blockers,
    }
    items.push(item)
    expected.push({
      pluginId: selection.pluginId,
      packageName: selection.packageName,
      ...(current?.version === undefined ? {} : { version: current.version }),
      enabled: current?.bundleEnabled ?? false,
      source: current?.source ?? 'unknown',
      ...(localIdentity === undefined ? {} : { localIdentity }),
    })
    if (item.action !== 'keep' && item.action !== 'blocked') {
      steps.push({ order: order++, pluginId: selection.pluginId, packageName: selection.packageName })
    }
    if (blockers.length > 0) details.push(`${selection.packageName}:${blockers.join(',')}`)
  }
  const plan = await makePlan(context, items)
  const bundleWithoutDigest = { plan, steps, dependencies: [], expected }
  const bundleDigest = await digestBundle(bundleWithoutDigest)
  return { status: 'ready', bundle: deepFreeze({ ...bundleWithoutDigest, bundleDigest }), details }
}

function contextInventory(context: PlanCatalogContext): readonly InventoryItem[] {
  // The planner intentionally only sees the snapshot supplied by the caller.
  // Host is responsible for providing it; keeping this indirection prevents a
  // Client from selecting another profile.
  return (context as PlanCatalogContext & { inventory?: readonly InventoryItem[] }).inventory ?? []
}

async function makePlan(
  context: PlanCatalogContext,
  items: readonly InstallPlanItem[],
  pack?: PackExecutionContext,
): Promise<InstallPlan> {
  const planId = context.planId ?? `plan-${await sha256Hex(`${context.environmentId}:${context.catalogRevision}:${context.now.getTime()}:${planSequence++}:${canonicalJson(context.selections)}`)}`
  const createdMs = context.now.getTime()
  const plan: InstallPlan = {
    planId,
    schemaVersion: '1',
    createdAt: new Date(createdMs).toISOString(),
    expiresAt: new Date(createdMs + (context.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
    environmentId: context.environmentId,
    hostFingerprint: context.hostFingerprint,
    catalogRevision: context.catalogRevision,
    ...(pack === undefined ? {} : {
      packId: pack.packId,
      packVersion: pack.packVersion,
      packExecutionDigest: await sha256Hex(canonicalJson({ execution: pack.execution, lockBytesDigest: await sha256Hex(pack.lockBytes) })),
    }),
    items,
    planDigest: '',
  }
  const digest = await digestPlan(plan)
  return freezePlan({ ...plan, planDigest: digest })
}

export async function verifyPlanBundle(bundle: PlanBundle): Promise<boolean> {
  const expectedPlanDigest = await digestPlan(bundle.plan)
  if (expectedPlanDigest !== bundle.plan.planDigest) return false
  const expectedBundleDigest = await digestBundle({
    plan: bundle.plan,
    steps: bundle.steps,
    dependencies: bundle.dependencies,
    expected: bundle.expected,
  })
  return expectedBundleDigest === bundle.bundleDigest
}
