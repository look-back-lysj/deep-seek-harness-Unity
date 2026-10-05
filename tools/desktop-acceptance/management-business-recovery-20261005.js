(async () => {
  const api = window.__marketAcceptanceRemote
  const baseline = window.__marketAcceptanceBusinessBaseline
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
  const maintenanceFacts = value => { const { generatedAt: _generatedAt, ...facts } = value; return facts }
  assert(api?.pluginActionRecover && api?.inventory && api?.maintenanceStatus, 'Expected installed read-only recovery namespace')
  assert(baseline?.testOnly && baseline?.fixtureOnly && baseline?.summary?.passed === 4, 'Expected verified original fixture requests; never invent or replay writes')
  const hello = await api.hello()
  assert(hello.environmentId === baseline.environmentId, 'Original environment identity changed; stop without querying another environment')
  const inventory = await api.inventory()
  const maintenance = await api.maintenanceStatus()
  const facts = []
  for (const original of baseline.originals) {
    const prior = baseline.facts.find(fact => fact.request?.idempotencyKey === original.request.idempotencyKey)
    assert(prior?.status === 'passed', 'Original baseline result missing')
    const recovered = await api.pluginActionRecover(original.request)
    assert(canonical(recovered) === canonical(prior.recovered), 'Reload changed complete historical business result')
    facts.push({ action: original.request.action, request: original.request, status: 'passed', recovered })
  }
  assert(canonical(await api.inventory()) === canonical(inventory), 'Read-only recovery changed current inventory')
  assert(canonical(maintenanceFacts(await api.maintenanceStatus())) === canonical(maintenanceFacts(maintenance)), 'Read-only recovery changed maintenance facts')
  return { testOnly: true, fixtureOnly: true, officialDesktop: true, checkedAt: new Date().toISOString(), environmentId: hello.environmentId,
    facts, summary: { passed: facts.length, failed: 0 }, writeReplayAttempted: false }
})().catch(error => ({ testOnly: true, fixtureOnly: true, officialDesktop: true, status: 'failed', error: String(error?.message ?? error), writeReplayAttempted: false }))
