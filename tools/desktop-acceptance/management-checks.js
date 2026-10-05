(async () => {
  const api = window.__marketAcceptanceRemote
  const packageName = 'eac-market-acceptance-noop'
  const facts = []
  const observe = async () => (await api.inventory()).items.find(item => item.packageName === packageName)
  const before = await observe()
  if (!before?.installed || !before.bundleEnabled) throw new Error('No-op fixture is not active in official inventory')
  const disableRequest = { packageName, expectedVersion: '1.0.0', enabled: false, idempotencyKey: 'acceptance-noop-disable-once' }
  const disabled = await api.setPluginEnabled(disableRequest)
  facts.push({ action: 'disable', result: disabled, observed: await observe() })
  const duplicate = await api.setPluginEnabled(disableRequest)
  facts.push({ action: 'duplicate-disable', result: duplicate, observed: await observe() })
  const enabled = await api.setPluginEnabled({ packageName, expectedVersion: '1.0.0', enabled: true, idempotencyKey: 'acceptance-noop-enable-once' })
  facts.push({ action: 'enable', result: enabled, observed: await observe() })
  const removed = await api.removePlugin({ packageName, expectedVersion: '1.0.0', confirmed: true, idempotencyKey: 'acceptance-noop-remove-once' })
  facts.push({ action: 'remove', result: removed, observed: await observe() ?? null })
  const removedAgain = await api.removePlugin({ packageName, expectedVersion: '1.0.0', confirmed: true, idempotencyKey: 'acceptance-noop-remove-once' })
  facts.push({ action: 'duplicate-remove', result: removedAgain, observed: await observe() ?? null })
  const maintenance = await api.getMaintenanceStatus()
  return { evidence: 'officially installed safe fixture, actual market management APIs and official inventory', before, facts, maintenance: maintenance.packages.find(item => item.packageName === packageName) }
})()
