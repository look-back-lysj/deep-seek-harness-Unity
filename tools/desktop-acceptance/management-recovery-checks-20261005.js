(async () => {
  const api = window.__marketAcceptanceRemote
  const packageName = 'eac-market-acceptance-noop'
  const expectedVersion = '1.0.0'
  const facts = []
  const originals = []
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  const observe = async () => {
    const inventory = await api.inventory()
    const item = inventory.items.find(entry => entry.packageName === packageName && entry.installed)
    return { revision: inventory.revision, item: item ? {
      packageName: item.packageName, version: item.version, installed: item.installed, bundleEnabled: item.bundleEnabled,
    } : null }
  }
  const check = async (id, operation) => {
    try { facts.push({ id, status: 'passed', evidence: await operation() }) }
    catch (error) { facts.push({ id, status: 'failed', error: String(error?.message ?? error) }); throw error }
  }
  assert(api?.pluginActionRecover && api?.pluginSetEnabled && api?.pluginRemove, 'Actual installed market namespace is missing')
  window.__marketAcceptanceManagementOriginals = originals
  const before = await observe()
  assert(before.item?.bundleEnabled && before.item.version === expectedVersion, 'Expected enabled official no-op fixture')
  for (const action of ['disable', 'enable', 'remove']) {
    await check(`official-${action}-and-readonly-recovery`, async () => {
      const request = { packageName, expectedVersion, idempotencyKey: `b1-noop-${action}-20261005` }
      const writeRequest = action === 'remove' ? { ...request, confirmed: true } : { ...request, enabled: action === 'enable' }
      const recoveryRequest = { ...request, action }
      const absent = await api.pluginActionRecover(recoveryRequest)
      assert(absent.status === 'not-found', 'New fixture identity unexpectedly already exists; do not replay')
      originals.push({ kind: 'management', request: recoveryRequest, submittedAt: new Date().toISOString() })
      const result = action === 'remove' ? await api.pluginRemove(writeRequest) : await api.pluginSetEnabled(writeRequest)
      const observed = await observe()
      const recovered = await api.pluginActionRecover(recoveryRequest)
      assert(result.status === 'applied', `Official ${action} did not report applied: ${JSON.stringify(result)}`)
      assert(recovered.status === 'found' && recovered.stage === 'settled', 'Original durable receipt not recovered')
      assert(recovered.receipt?.status === result.status && recovered.receipt.changed === result.changed, 'Recovery lost official receipt')
      assert(recovered.result?.status === 'unknown' && recovered.result.errorCode === 'management/business-result-unavailable', 'Missing maintenance durability falsely reported business success')
      assert(action === 'remove' ? observed.item === null : observed.item?.bundleEnabled === (action === 'enable'), 'Inventory does not match official fixture action')
      const afterRecovery = await observe()
      assert(afterRecovery.revision === observed.revision, 'Read-only recovery changed inventory')
      return { original: recoveryRequest, result, observed, recovered, recoveryReplayedWrite: false, wholeBusinessCompletionInferred: false }
    })
  }
  await check('management-original-key-intent-conflict-rejected', async () => {
    const original = originals[0].request
    let rejected = false
    let message
    try { await api.pluginActionRecover({ ...original, action: 'enable' }) }
    catch (error) { rejected = true; message = String(error?.message ?? error) }
    assert(rejected, 'Different action recovered the original disable receipt')
    assert((await observe()).item === null, 'Conflict lookup changed inventory')
    return { rejected, message, original, replayed: false }
  })
  return { testOnly: true, officialDesktop: true, fixtureOnly: true, checkedAt: new Date().toISOString(), before, originals, facts,
    summary: { passed: facts.filter(fact => fact.status === 'passed').length, failed: facts.filter(fact => fact.status === 'failed').length },
    unverified: ['client-management-original-intent-and-complete-business-result-recovery', 'real-catalog-artifact-installation'] }
})().catch(error => ({ testOnly: true, officialDesktop: true, fixtureOnly: true, status: 'failed', error: String(error?.message ?? error),
  originalRequests: window.__marketAcceptanceManagementOriginals ?? [], replayAllowed: false }))
