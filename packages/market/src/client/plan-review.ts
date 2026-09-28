import type { InstallPlan, InstallPlanItem, PackExecutionEdge } from '../types.ts'

export interface PlanReview {
  readonly executable: readonly InstallPlanItem[]
  readonly skipped: readonly InstallPlanItem[]
  readonly dependencyPaused: readonly InstallPlanItem[]
  readonly unsafe: readonly InstallPlanItem[]
  readonly canConfirm: boolean
}

/** Projects a Host plan for confirmation, without editing the sealed plan or
 * choosing a subset to execute. Partial execution requires the Host to mark unsafe
 * items blocked. The executor remains the authority for dependency execution. */
export function reviewInstallPlan(plan: InstallPlan, group: boolean, edges: readonly PackExecutionEdge[], consent: boolean): PlanReview {
  const skipped = plan.items.filter((item) => item.action === 'blocked')
  const unsafe = plan.items.filter((item) => item.action !== 'blocked' && (
    item.blockers.length > 0 || item.verification === 'hard-incompatible'
    || (!consent && (item.verification === 'unverified' || item.verification === 'unknown'))
  ))
  const blockedIds = new Set(skipped.map((item) => item.pluginId))
  const paused = new Set<string>()
  // Kept items have no install step. Do not invent dependency pauses for them.
  for (let pass = 0; pass < plan.items.length; pass += 1) {
    let changed = false
    for (const item of plan.items) {
      if (item.action === 'blocked' || item.action === 'keep' || paused.has(item.pluginId)) continue
      if (edges.some((edge) => edge.consumerId === item.pluginId && (blockedIds.has(edge.prerequisiteId) || paused.has(edge.prerequisiteId)))) {
        paused.add(item.pluginId); changed = true
      }
    }
    if (!changed) break
  }
  const dependencyPaused = plan.items.filter((item) => paused.has(item.pluginId))
  const executable = plan.items.filter((item) => item.action !== 'blocked' && !paused.has(item.pluginId) && !unsafe.includes(item))
  return { executable, skipped, dependencyPaused, unsafe,
    canConfirm: unsafe.length === 0 && executable.length > 0 && (group || skipped.length === 0 && dependencyPaused.length === 0),
  }
}

export function blockerExplanation(item: InstallPlanItem): string {
  if (item.verification === 'hard-incompatible') return '已知不兼容，不会执行。'
  if (item.blockers.some((reason) => /^verification:.*-not-confirmed$/.test(reason))) return '尚未同意试装，不会执行。'
  if (item.blockers.includes('artifact:not-installable')) return '缺少符合安装条件的制品，不会执行。'
  return '预检已阻止此项，不会执行；可展开查看具体原因。'
}
