(async () => {
  const api = window.__marketAcceptanceRemote
  const packageName = 'dsh-settings-scroll-fix'
  const expectedVersion = '2.0.2'
  const observe = async () => (await api.inventory()).items.find(item => item.packageName === packageName) ?? null
  const before = await observe()
  if (!before?.installed || !before.bundleEnabled) throw new Error('Expected actual installed enabled test target')
  const facts = []
  const request = { packageName, expectedVersion, enabled: false, idempotencyKey: 'b2-scroll-disable-confirmed-20261004' }
  const disabled = await api.pluginSetEnabled(request)
  facts.push({ action: 'disable', result: disabled, observed: await observe() })
  facts.push({ action: 'duplicate-disable', result: await api.pluginSetEnabled(request), observed: await observe() })
  const enabled = await api.pluginSetEnabled({ packageName, expectedVersion, enabled: true, idempotencyKey: 'b2-scroll-enable-confirmed-20261004' })
  facts.push({ action: 'enable', result: enabled, observed: await observe() })
  const remove = { packageName, expectedVersion, confirmed: true, idempotencyKey: 'b2-scroll-remove-confirmed-20261004' }
  facts.push({ action: 'remove', result: await api.pluginRemove(remove), observed: await observe() })
  facts.push({ action: 'duplicate-remove', result: await api.pluginRemove(remove), observed: await observe() })
  return { testOnly: true, officialDesktop: true, before, facts }
})()
