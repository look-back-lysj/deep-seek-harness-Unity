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
  CollectionExecutionContext,
  PlanCatalogContext,
  PlanStep,
  PlanBundle,
  PreparedPlanResult,
} from './ports.ts'

const DEFAULT_TTL_MS = 15 * 60 * 1000
let planSequence = 0
import { compareVersions, validVersion } from './semver.ts'
export { compareVersions } from './semver.ts'

function verificationBlockers(verification: string | undefined, consent: boolean): string[] {
  if (verification === 'hard-incompatible') return ['verification:hard-incompatible']
  if (verification !== 'verified' && consent !== true) return [`verification:${verification ?? 'unknown'}-not-confirmed`]
  return []
}

function frozenDeliveries(context: PlanCatalogContext): Pick<PlanBundle, 'deliveries'> {
  const selected = new Set(context.selections.map(item => item.pluginId))
  const deliveries = context.plugins.filter(fact => selected.has(fact.pluginId) && fact.delivery !== undefined)
    .map(fact => structuredClone(fact.delivery!))
  return deliveries.length === 0 ? {} : { deliveries }
}

function actionFor(current: InventoryItem | undefined, targetVersion: string): PlanAction {
  if (!validVersion(targetVersion) || (current?.version !== undefined && !validVersion(current.version))) return 'blocked'
  if (current === undefined || !current.installed) return 'add'
  if (current.version === undefined) return 'blocked'
  if (current.version === targetVersion) return 'keep'
  const order = compareVersions(targetVersion, current.version)
  // Different build metadata has equal precedence but can identify different bytes.
  // Neither a silent keep nor a guessed downgrade is an honest installation plan.
  return order === 0 ? 'blocked' : order > 0 ? 'upgrade' : 'downgrade'
}

function versionBlocker(current: InventoryItem | undefined, targetVersion: string): string {
  if (!validVersion(targetVersion) || (current?.version !== undefined && !validVersion(current.version))) return 'version:invalid-semver'
  return current?.version === undefined ? 'inventory:version-unknown' : 'version:equal-precedence-different-identity'
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
  pack?: PackExecutionContext | CollectionExecutionContext,
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
    if (pack.kind === 'market-collection') {
      const digest = await sha256Hex(pack.documentBytes)
      if (pack.collectionDigest.replace(/^sha256:/, '') !== digest) structural.push('collection:document-digest-mismatch')
      let document: { kind?: string; id?: string; version?: string; components?: unknown; execution?: unknown } = {}
      try { document = JSON.parse(new TextDecoder().decode(pack.documentBytes)) as typeof document } catch { structural.push('collection:invalid-document') }
      if (document.kind !== 'MarketCollection' || document.id !== pack.collectionId || document.version !== pack.collectionVersion
        || canonicalJson(document.components ?? null) !== canonicalJson(pack.components)
        || canonicalJson(document.execution ?? null) !== canonicalJson(pack.execution)) structural.push('collection:identity-mismatch')
      for (const component of pack.components) {
        const selected = selectionsById.get(component.pluginId)
        if (component.required && !selected) structural.push(`collection:required-missing:${component.pluginId}`)
        if (selected && (selected.targetVersion !== component.version || selected.targetDigest !== component.artifactDigest)) structural.push(`collection:selection-mismatch:${component.pluginId}`)
      }
    } else {
      const lockDigest = await sha256Hex(pack.lockBytes)
      if (pack.execution.schemaVersion !== '1') structural.push('pack-execution:schema-version')
      if (pack.execution.packId !== pack.packId || pack.execution.packVersion !== pack.packVersion) structural.push('pack-execution:identity-mismatch')
      if (pack.execution.lockDigest !== lockDigest) structural.push('pack-execution:lock-digest-mismatch')
    }
    if (pack.execution.coverage !== 'complete') structural.push(`pack-execution:coverage-${pack.execution.coverage}`)
    const componentIds = new Set(pack.components.map((component) => component.pluginId))
    if ([...selectionsById.keys()].some(id => !componentIds.has(id))) structural.push('group:selection-not-in-components')
    for (const component of pack.components) if (component.required && !selectionsById.has(component.pluginId)) structural.push(`group:required-missing:${component.pluginId}`)
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
      blockers.push(...verificationBlockers(fact?.verification, selection.tryUnverified))
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
      if (action === 'blocked') blockers.push(versionBlocker(current, selection.targetVersion))
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
      ...frozenDeliveries(context),
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
    blockers.push(...verificationBlockers(fact?.verification, selection.tryUnverified))
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
    if (action === 'blocked') blockers.push(versionBlocker(current, selection.targetVersion))
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
  const bundleWithoutDigest = { plan, steps, dependencies: [], expected, ...frozenDeliveries(context) }
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
  pack?: PackExecutionContext | CollectionExecutionContext,
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
    ...(pack === undefined ? {} : pack.kind === 'market-collection' ? {
      collectionId: pack.collectionId,
      collectionVersion: pack.collectionVersion,
      collectionDigest: pack.collectionDigest,
    } : {
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
    ...(bundle.deliveries === undefined ? {} : { deliveries: bundle.deliveries }),
  })
  return expectedBundleDigest === bundle.bundleDigest
}
