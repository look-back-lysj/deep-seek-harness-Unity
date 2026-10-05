(async () => {
  const api = window.__marketAcceptanceRemote
  if (!api?.planCreate) throw new Error('Expected actual installed market namespace')
  const pluginId = 'dev.eac.dsh-settings-scroll-fix'
  const catalog = await api.catalog()
  const plugin = catalog.plugins.find(item => item.id === pluginId)
  if (!plugin) throw new Error('Registered target is absent')
  const plan = await api.planCreate({ selections: [{ pluginId, packageName: plugin.packageName, targetVersion: plugin.version, targetDigest: plugin.artifactDigest, enabledIntent: true, tryUnverified: true }] })
  if (plan.status !== 'ready') return { status: 'blocked', plan }
  const request = { planId: plan.plan.planId, planDigest: plan.plan.planDigest, idempotencyKey: window.__marketAcceptanceInstallKey ?? 'b2-network-scroll-install-20261004', confirmed: true }
  let task = await api.taskStart(request)
  window.__marketAcceptanceNetworkTask = task.taskId
  for (let attempt = 0; attempt < 85 && !['completed', 'failed', 'cancelled', 'unknown', 'needs-attention', 'restart-required', 'partial'].includes(task.status); attempt++) {
    await new Promise(done => setTimeout(done, 1000))
    task = await api.taskGet({ taskId: task.taskId })
  }
  const duplicate = await api.taskStart(request)
  const inventory = await api.inventory()
  return { testOnly: true, officialDesktop: true, plan: plan.plan, task, duplicateTaskId: duplicate.taskId, observed: inventory.items.find(item => item.packageName === plugin.packageName) ?? null }
})()
