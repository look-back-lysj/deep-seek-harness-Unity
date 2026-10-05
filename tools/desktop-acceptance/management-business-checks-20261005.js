(async () => {
  const api = window.__marketAcceptanceRemote
  const packageName = 'eac-market-acceptance-noop'
  const expectedVersion = '1.0.0'
  const originals = []
  const facts = []
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
  assert(api?.pluginActionRecover && api?.pluginSetEnabled && api?.pluginRemove && api?.maintenanceStatus, 'Expected actual installed management namespace')
  assert(!window.__marketAcceptanceBusinessOriginals, 'This write probe has already run; use saved original requests for read-only recovery')
  const hello = await api.hello()
  const observe = async () => {
    const inventory = await api.inventory()
    const item = inventory.items.find(entry => entry.packageName === packageName && entry.installed)
    return { revision: inventory.revision, item: item ? { packageName: item.packageName, version: item.version, installed: item.installed, bundleEnabled: item.bundleEnabled } : null }
  }
  const before = await observe()
  assert(before.item?.installed && before.item.bundleEnabled && before.item.version === expectedVersion, 'Safe fixture must be freshly installed and enabled in isolated official Profile')
  window.__marketAcceptanceBusinessOriginals = originals
  for (const action of ['disable', 'enable', 'remove']) {
    const request = { packageName, expectedVersion, action, idempotencyKey: `management-business-${crypto.randomUUID()}` }
    assert((await api.pluginActionRecover(request)).status === 'not-found', 'New probe key already exists; stop without rewriting')
    originals.push({ environmentId: hello.environmentId, request, submittedAt: new Date().toISOString() })
    const result = action === 'remove'
      ? await api.pluginRemove({ packageName, expectedVersion, idempotencyKey: request.idempotencyKey, confirmed: true })
      : await api.pluginSetEnabled({ packageName, expectedVersion, idempotencyKey: request.idempotencyKey, enabled: action === 'enable' })
    assert(result.status === 'applied', `Stop on nonterminal fixture ${action}: ${canonical(result)}`)
    const after = await observe()
    const recovered = await api.pluginActionRecover(request)
    assert(recovered.status === 'found' && recovered.stage === 'settled', 'Original record was not recovered')
    assert(canonical(recovered.result) === canonical(result), 'Complete original business result was not recovered')
    assert(canonical(recovered.receipt) === canonical(result), 'Official receipt does not match this fixture result')
    assert(action === 'remove' ? after.item === null : after.item?.bundleEnabled === (action === 'enable'), 'Official fixture post-state does not match requested action')
    const maintenance = await api.maintenanceStatus()
    const explicit = maintenance.packages.filter(item => item.explicitState === 'explicit').map(item => item.packageName)
    assert(action === 'remove' ? !explicit.includes(packageName) : explicit.includes(packageName), 'Core maintenance intent was not committed')
    const repeated = await api.pluginActionRecover(request)
    assert(canonical(repeated) === canonical(recovered), 'Read-only original recovery is not stable')
    assert((await observe()).revision === after.revision, 'Read-only recovery changed inventory')
    facts.push({ id: `official-business-${action}`, status: 'passed', request, result, recovered, after, explicit, writeReplayAttempted: false })
  }
  const afterRemove = await observe()
  for (const original of originals) {
    const recovered = await api.pluginActionRecover(original.request)
    const prior = facts.find(fact => fact.request.idempotencyKey === original.request.idempotencyKey)
    assert(canonical(recovered) === canonical(prior.recovered), 'Later inventory changes altered historical business recovery')
  }
  assert((await observe()).revision === afterRemove.revision, 'Historical recovery changed inventory')
  let conflictRejected = false
  try { await api.pluginActionRecover({ ...originals[0].request, action: 'enable' }) }
  catch { conflictRejected = true }
  assert(conflictRejected, 'Different intent borrowed original management key')
  facts.push({ id: 'historical-business-result-after-remove-and-conflict', status: 'passed', conflictRejected, writeReplayAttempted: false })
  return { testOnly: true, officialDesktop: true, fixtureOnly: true, environmentId: hello.environmentId, checkedAt: new Date().toISOString(), before, originals, facts,
    summary: { passed: facts.length, failed: 0 }, unverified: ['real-catalog-artifact-installation', 'client-transport-timeout-fault-injection', 'normal-exit-and-original-rc1'] }
})().catch(error => ({ testOnly: true, officialDesktop: true, fixtureOnly: true, status: 'failed', error: String(error?.message ?? error),
  originalRequests: window.__marketAcceptanceBusinessOriginals ?? [], replayAllowed: false }))
