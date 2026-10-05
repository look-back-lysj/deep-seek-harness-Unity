(async () => {
  const api = window.__marketAcceptanceRemote
  if (!api) throw new Error('Actual installed MarketPage Remote was not captured')
  const results = []
  const assert = (condition, reason) => { if (!condition) throw new Error(reason) }
  const check = async (id, operation) => {
    try { results.push({ id, status: 'passed', evidence: await operation() }) }
    catch (error) { results.push({ id, status: 'failed', error: String(error.message ?? error) }) }
  }
  const reject = async operation => { try { await operation() } catch (error) { return { rejected: true, message: String(error.message ?? error) } } throw new Error('Unsafe request unexpectedly accepted') }
  const hash = async bytes => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
  const bytesOf = text => Uint8Array.from(atob(text), character => character.charCodeAt(0))
  const base64 = bytes => btoa(String.fromCharCode(...bytes))
  const catalog = await api.catalog()
  const hello = await api.hello()
  await check('API-identity', async () => {
    const host = await api.hostCore()
    assert(host.version === '0.2.0-rc.2' && hello.hostCore.version === host.version, 'Incorrect official runtime identity')
    assert(hello.protocolVersion === '2.1.0' && hello.coreApiVersion === '1.1.0', 'Incorrect provider versions')
    return { profile: hello.profileName, runtime: host, adapter: hello.marketVersion, core: hello.coreVersion }
  })
  await check('API-catalog-inventory', async () => {
    const inventory = await api.inventory()
    assert(catalog.plugins.length === 61 && catalog.listings.length === 21, 'Wrong accepted catalog')
    const market = inventory.items.find(item => item.packageName === '@dsh-eac/market')
    assert(market?.installed && market.bundleEnabled && market.rows.some(row => row.state === 'enabled'), 'Market not officially active')
    return { plugins: catalog.plugins.length, listings: catalog.listings.length, market, unknownItems: inventory.unknownItems }
  })
  await check('API-all-release-options', async () => {
    const packages = [...new Set(catalog.plugins.map(plugin => plugin.packageName))]
    const facts = []
    for (const packageName of packages) {
      const options = await api.releaseOptions({ packageName, limit: 100 })
      assert(options.hostCore.version === hello.hostCore.version, 'Host snapshot differs')
      assert(!('defaultReleaseId' in options), 'Backend chooses a UI default')
      assert(options.releases.every(release => release.identity.packageName === packageName), 'Cross-package result')
      facts.push({ packageName, versions: options.releases.length, latest: options.latestPublished?.version ?? null, compatible: options.latestCompatible?.version ?? null,
        reasons: options.releases.map(release => release.compatibility.reason ?? release.compatibility.status), selectable: options.releases.filter(release => release.selectable).length, coverage: options.coverage.historyCoverage })
    }
    window.__marketAcceptanceReleaseFacts = facts
    return { checkedPackages: facts.length, facts }
  })
  await check('API-release-input-safety', async () => {
    const packageName = catalog.plugins[0].packageName
    return { clientHost: await reject(() => api.releaseOptions({ packageName, hostVersion: '999.0.0' })),
      path: await reject(() => api.releaseOptions({ packageName: '../outside' })),
      unlisted: await reject(() => api.releaseOptions({ packageName: '@acceptance/unlisted' })),
      oversized: await reject(() => api.releaseOptions({ packageName, limit: 101 })) }
  })
  await check('API-maintenance-update-sources', async () => {
    const maintenance = await api.getMaintenanceStatus()
    const updates = await api.checkUpdates(undefined)
    const sources = await api.listCatalogSources()
    assert(maintenance.environmentId === hello.environmentId, 'Cross-environment maintenance')
    assert(sources.some(source => source.id === 'eac-gitee') && sources.some(source => source.id === 'eac-github'), 'Default sources missing')
    return { maintenancePackages: maintenance.packages.length, updateItems: updates.items.length, sources }
  })
  await check('API-policy-save-conflict', async () => {
    const before = await api.getUpdatePolicy()
    const saved = await api.saveUpdatePolicy({ expectedRevision: before.revision, policy: before.policy })
    assert(saved.policy.automaticDownloadsEnabled === false && saved.policy.automaticInstallsEnabled === false, 'Unexpected silent writes enabled')
    const conflict = await reject(() => api.saveUpdatePolicy({ expectedRevision: 'invalid-revision', policy: before.policy }))
    return { revision: saved.revision, policy: saved.policy, conflict }
  })
  let draft
  let exported
  let imported
  await check('API-author-draft-conflict', async () => {
    draft = await api.saveDraft({ title: '官方 Desktop 验收草稿', summary: '隔离实机测试资料', markdown: '# 实机验收\n\n本地可恢复正文。', mediaIds: [] })
    const reopened = await api.getDraft(draft.id)
    assert(reopened.markdown === draft.markdown, 'Draft content lost')
    const prior = draft
    draft = await api.saveDraft({ ...draft, expectedRevision: draft.revision, markdown: draft.markdown + '\n\n版本更新。' })
    const conflict = await reject(() => api.saveDraft({ ...prior, expectedRevision: prior.revision, markdown: '不应覆盖' }))
    assert((await api.getDraft(draft.id)).markdown === draft.markdown, 'Conflict overwrote saved content')
    assert((await api.listDrafts()).some(item => item.id === draft.id), 'Saved draft missing')
    window.__marketAcceptanceDraftId = draft.id
    return { id: draft.id, revision: draft.revision, conflict }
  })
  await check('API-author-media', async () => {
    if (!draft) throw new Error('Draft prerequisite failed')
    const png = bytesOf('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
    const digest = await hash(png)
    const transfer = await api.transferBegin({ purpose: 'draft-media', targetId: draft.id, expectedRevision: draft.revision, filename: 'acceptance.png', size: png.length, mediaType: 'image/png', sha256: digest })
    const completed = await api.transferChunk({ transferId: transfer.transferId, sequence: 0, data: base64(png) })
    assert(completed.complete && completed.resultId, 'Media transfer did not finish')
    draft = await api.getDraft(draft.id)
    const media = await api.readMedia({ draftId: draft.id, mediaId: completed.resultId })
    assert(media.sha256 === digest && await hash(bytesOf(media.data)) === digest, 'Stored media digest differs')
    const cross = await reject(() => api.readMedia({ draftId: 'unowned-draft', mediaId: completed.resultId }))
    await api.transferDispose({ transferId: transfer.transferId })
    return { mediaId: completed.resultId, digest, boundToDraft: draft.mediaIds.includes(completed.resultId), cross }
  })
  await check('API-author-export-import', async () => {
    if (!draft) throw new Error('Draft prerequisite failed')
    const outgoing = await api.exportDraft({ draftId: draft.id })
    const chunks = []
    for (let sequence = 0; sequence < 100; sequence++) {
      const chunk = await api.transferRead({ transferId: outgoing.transferId, sequence })
      chunks.push(bytesOf(chunk.data))
      if (chunk.last) break
    }
    exported = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) { exported.set(chunk, offset); offset += chunk.length }
    assert(exported[0] === 80 && exported[1] === 75, 'Export is not a real ZIP')
    const inbound = await api.transferBegin({ purpose: 'author-import', filename: 'acceptance.eac-market-presentation.zip', size: exported.length, mediaType: 'application/zip', sha256: await hash(exported) })
    const result = await api.transferChunk({ transferId: inbound.transferId, sequence: 0, data: base64(exported) })
    assert(result.complete && result.resultId, 'Author package import failed')
    imported = await api.getDraft(result.resultId)
    assert(imported.markdown === draft.markdown && imported.mediaIds.length === draft.mediaIds.length, 'Imported content or images differ')
    await api.transferDispose({ transferId: outgoing.transferId })
    await api.transferDispose({ transferId: inbound.transferId })
    return { exportedBytes: exported.length, digest: await hash(exported), importedId: imported.id, mediaCount: imported.mediaIds.length }
  })
  await check('API-author-readme-safety', async () => ({ privatePath: await reject(() => api.previewReadme({ repositoryUrl: 'file:///C:/private' })) }))
  await check('API-author-delete-revision', async () => {
    if (!imported) throw new Error('Import prerequisite failed')
    const conflict = await reject(() => api.deleteDraft({ id: imported.id, expectedRevision: 'wrong' }))
    assert(await api.deleteDraft({ id: imported.id, expectedRevision: imported.revision }) === true, 'Delete did not complete')
    assert(!(await api.listDrafts()).some(item => item.id === imported.id), 'Deleted draft remains')
    return { deletedOnlyImportedCopy: imported.id, conflict, retainedDraft: draft.id }
  })
  await check('API-task-empty-invalid-controls', async () => ({ tasks: await api.listTasks(), invalidGet: await reject(() => api.getTask({ taskId: 'not-existing' })), emptyEvents: await api.taskEvents({ taskId: 'not-existing', limit: 20 }),
    invalidCancel: await reject(() => api.cancelTask({ taskId: 'not-existing', idempotencyKey: 'acceptance-invalid-cancel' })), invalidResume: await reject(() => api.resumeTask({ taskId: 'not-existing', idempotencyKey: 'acceptance-invalid-resume' })) }))
  await check('API-range-write-protection', async () => {
    const plugin = catalog.plugins.find(plugin => plugin.packageName === '@dsh-eac/ui-skin-loader')
    const plan = await api.createPlan({ selections: [{ pluginId: plugin.id, packageName: plugin.packageName, targetVersion: plugin.version, targetDigest: plugin.artifactDigest, enabledIntent: true, tryUnverified: true }] })
    assert(plan.status === 'blocked' && plan.reason === 'core-too-new', 'Known wrong runtime package was not blocked')
    return { plan, tasks: (await api.listTasks()).length }
  })
  await check('API-self-management-protection', async () => ({ disable: await api.setPluginEnabled({ packageName: '@dsh-eac/market', expectedVersion: hello.marketVersion, enabled: false, idempotencyKey: 'acceptance-self-disable' }),
    remove: await api.removePlugin({ packageName: '@dsh-eac/market', expectedVersion: hello.marketVersion, confirmed: true, idempotencyKey: 'acceptance-self-remove' }) }))
  await check('API-ai-no-model-boundary', async () => {
    const analysis = await api.aiAnalyze({ packageName: catalog.plugins[0].packageName })
    const invalidConfirm = await api.aiConfirm({ proposalId: 'not-existing', confirmed: true, impactDigest: 'not-existing', idempotencyKey: 'acceptance-invalid-ai' })
    return { analysis, invalidConfirm, positiveModelFlow: 'blocked: no authorized API key in isolated profile' }
  })
  await check('API-diagnostics-redaction', async () => {
    const diagnostics = await api.exportDiagnostic()
    assert(diagnostics.redacted === true && diagnostics.environmentId === hello.environmentId, 'Diagnostic identity/redaction missing')
    assert(!JSON.stringify(diagnostics).includes('D:\\eac-market-verify'), 'Private physical profile path leaked')
    return { redacted: diagnostics.redacted, entries: diagnostics.diagnostics.length, summaries: diagnostics.summaries }
  })
  window.__marketAcceptanceApiResults = results
  return { evidence: 'actual installed official Desktop 0.2.0-rc.2; real Remote, no mock', results, passed: results.filter(result => result.status === 'passed').length, failed: results.filter(result => result.status === 'failed').length }
})()
