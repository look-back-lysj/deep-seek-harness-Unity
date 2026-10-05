(async () => {
  const api = window.__marketAcceptanceRemote
  const checks = []
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  const canonical = value => JSON.stringify(value, (_, item) => object(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
  const keys = (value, allowed, label) => {
    assert(object(value), `${label}: expected object`)
    assert(Object.keys(value).every(key => allowed.includes(key)), `${label}: unexpected fields ${Object.keys(value).filter(key => !allowed.includes(key)).join(',')}`)
  }
  const check = async (id, operation) => {
    try {
      const evidence = await operation()
      checks.push({ id, status: evidence?.unknown === true ? 'unknown' : 'passed', evidence })
      return evidence
    } catch (error) {
      checks.push({ id, status: 'failed', error: { name: error?.name ?? 'Error', message: String(error?.message ?? error) } })
      return undefined
    }
  }
  const report = () => ({ testOnly: true, probe: 'installed-market-release-api-20261005', readOnly: true,
    execution: 'actual-MarketPage-namespace-required', checkedAt: new Date().toISOString(), checks,
    summary: Object.fromEntries(['passed', 'failed', 'unknown'].map(status => [status, checks.filter(item => item.status === status).length])),
    unverified: ['official-carrier-identity-and-installed-byte-match-are-main-controller-evidence',
      'runtime-getter-value-not-independently-invoked-in-renderer', 'install-and-management-writes-not-exercised',
      'frontend-version-selection-timeout-and-restart-not-exercised', 'original-operation-recovery-requires-exact-original-request',
      'not-found-is-not-proof-that-an-original-write-never-happened'],
  })
  const available = await check('installed-namespace-read-methods', async () => {
    const methods = ['hello', 'hostCore', 'catalog', 'inventory', 'releaseOptions', 'taskStartRecover', 'pluginActionRecover']
    assert(api && methods.every(method => typeof api[method] === 'function'), 'Actual installed MarketPage namespace lacks required read methods')
    return { methods }
  })
  if (!available) return report()

  const hello = await check('hello-new-capabilities', async () => {
    const value = await api.hello()
    assert(object(value) && typeof value.environmentId === 'string' && value.environmentId.length > 0, 'Missing environment identity')
    assert(Array.isArray(value.capabilities), 'Missing capability list')
    for (const capability of ['host-release-options', 'host-release-context', 'operation-recovery']) {
      assert(value.capabilities.includes(capability), `Missing capability: ${capability}`)
    }
    return value
  })
  const hostCore = await check('runtime-getter-core-identity', async () => {
    const value = await api.hostCore()
    assert(hello, 'Hello prerequisite failed')
    assert(canonical(value) === canonical(hello.hostCore), 'Hello and hostCore getter disagree')
    assert(value.agentId === 'dsh' && value.agentName === 'DSH', 'Core must identify DSH')
    assert(value.source === 'dsh-runtime-getter', 'Core identity must come from runtime getter, not Desktop version')
    assert(value.versionScheme === 'semver' && /^sha256:[a-f0-9]{64}$/.test(value.hostRevision), 'Missing core scheme/revision')
    assert(['known', 'unknown'].includes(value.status), 'Invalid core status')
    assert(value.status === 'known' ? typeof value.version === 'string' && value.version.length > 0 : value.version === null, 'Invalid core version fact')
    return { ...value, unknown: value.status === 'unknown', desktopVersionUsedForCompatibility: false,
      independentGetterVerification: 'not-performed-in-renderer' }
  })
  const catalog = await check('actual-catalog-package-candidates', async () => {
    const value = await api.catalog()
    assert(Array.isArray(value.plugins) && typeof value.revision === 'string', 'Invalid catalog snapshot')
    const packages = [...new Set(value.plugins.map(plugin => plugin.packageName).filter(name => typeof name === 'string' && name.length > 0))]
    assert(packages.length > 0, 'Actual catalog has no package records')
    return { revision: value.revision, stale: value.stale, packages, plugins: value.plugins }
  })
  const inventory = await check('actual-inventory-snapshot', async () => {
    const value = await api.inventory()
    assert(hello && value.environmentId === hello.environmentId, 'Inventory environment differs from hello')
    assert(typeof value.revision === 'string' && Array.isArray(value.items) && Array.isArray(value.unknownItems), 'Invalid inventory snapshot')
    return value
  })
  const contextBinding = context => Object.fromEntries(['environmentId', 'hostRevision', 'catalogRevision', 'inventoryRevision', 'catalogStale'].map(key => [key, context[key]]))
  const resultFields = ['packageName', 'includePrerelease', 'context', 'hostCore', 'installed', 'coverage', 'latestPublished', 'latestCompatible',
    'latestPublishedCandidates', 'latestCompatibleCandidates', 'publishedAmbiguous', 'compatibleAmbiguous', 'releases', 'issues', 'pagination']
  const releaseFields = ['identity', 'hostRequirements', 'compatibility', 'publication', 'artifact', 'verification', 'selectable',
    'blockers', 'relation', 'confirmationRequirements', 'exclusionReason', 'sources']
  const captured = []
  if (hello && hostCore && catalog && inventory) {
    const count = name => catalog.plugins.filter(plugin => plugin.packageName === name).length
    const declarations = name => catalog.plugins.some(plugin => plugin.packageName === name && plugin.hostRequirements?.declarations?.length > 0)
    const packages = [...catalog.packages].sort((left, right) => count(right) - count(left)
      || Number(declarations(right)) - Number(declarations(left)) || left.localeCompare(right)).slice(0, 3)
    for (const packageName of packages) {
      const evidence = await check(`release-options-facts:${packageName}`, async () => {
        const pages = []
        const identities = new Set()
        let cursor
        let first
        for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
          const page = await api.releaseOptions({ packageName, includePrerelease: false, limit: 1, ...(cursor ? { cursor } : {}) })
          keys(page, resultFields, 'releaseOptions')
          assert(resultFields.every(field => Object.hasOwn(page, field)), 'Release result lacks required business facts')
          assert(page.packageName === packageName && page.includePrerelease === false, 'Release request binding mismatch')
          keys(page.context, ['environmentId', 'hostRevision', 'catalogRevision', 'inventoryRevision', 'checkedAt', 'catalogStale'], 'release context')
          assert(page.context.environmentId === hello.environmentId && page.context.hostRevision === hostCore.hostRevision, 'Release environment/core mismatch')
          assert(page.context.catalogRevision === catalog.revision && page.context.catalogStale === catalog.stale, 'Catalog changed or release context mismatched')
          assert(page.context.inventoryRevision === inventory.revision, 'Inventory changed or release context mismatched')
          assert(Number.isFinite(Date.parse(page.context.checkedAt)), 'Invalid checkedAt')
          const { unknown: ignoredUnknown, desktopVersionUsedForCompatibility: ignoredDesktop, independentGetterVerification: ignoredGetter, ...coreFact } = hostCore
          assert(canonical(page.hostCore) === canonical(coreFact), 'Release core snapshot mismatch')
          if (first) {
            assert(canonical(contextBinding(page.context)) === canonical(contextBinding(first.context)), 'Pagination context changed')
            for (const field of ['hostCore', 'installed', 'coverage', 'latestPublished', 'latestCompatible', 'latestPublishedCandidates',
              'latestCompatibleCandidates', 'publishedAmbiguous', 'compatibleAmbiguous', 'issues']) {
              assert(canonical(page[field]) === canonical(first[field]), `Pagination fact changed: ${field}`)
            }
          } else first = page
          keys(page.installed, ['status', 'version', 'reason'], 'installed fact')
          const targetItems = inventory.items.filter(item => item.packageName === packageName && item.installed)
          assert(['known', 'unknown', 'absent'].includes(page.installed.status), 'Invalid installed status')
          if (page.installed.status === 'known') {
            assert(targetItems.length === 1 && targetItems[0].version === page.installed.version, 'Installed version does not match actual inventory')
          } else {
            assert(page.installed.version === null, 'Unknown/absent installed fact must not invent a version')
            if (page.installed.status === 'absent') assert(targetItems.length === 0, 'Absent fact contradicts actual inventory')
            else assert(typeof page.installed.reason === 'string', 'Unknown inventory lacks reason')
          }
          keys(page.coverage, ['historyCoverage', 'obtainedRecords', 'evaluatedRecords', 'totalKnownRecords', 'reasons'], 'coverage fact')
          assert(['complete', 'partial', 'latest-only', 'unknown'].includes(page.coverage.historyCoverage) && Array.isArray(page.coverage.reasons), 'Invalid history coverage')
          if (page.coverage.historyCoverage !== 'complete') {
            assert(page.coverage.totalKnownRecords === null && page.coverage.reasons.includes('release-history-incomplete'), 'Incomplete history must remain explicitly unknown')
          }
          assert(Array.isArray(page.releases) && page.releases.length <= 1, 'Release pagination limit ignored')
          assert(page.releases.length > 0 || pageIndex === 0, 'Empty continuation page')
          for (const release of page.releases) {
            keys(release, releaseFields, 'release fact')
            keys(release.identity, ['pluginId', 'packageName', 'version', 'metadataDigest', 'artifactDigest', 'releaseId'], 'release identity')
            assert(release.identity.packageName === packageName && typeof release.identity.version === 'string', 'Wrong release identity')
            const identity = canonical({ identity: release.identity, sources: release.sources })
            assert(!identities.has(identity), 'Repeated release identity across pages')
            identities.add(identity)
            keys(release.compatibility, ['status', 'reason', 'declaredRanges'], 'compatibility fact')
            assert(['compatible', 'incompatible', 'unknown', 'conflict'].includes(release.compatibility.status)
              && Array.isArray(release.compatibility.declaredRanges), 'Invalid compatibility fact')
            const missingRange = release.compatibility.declaredRanges.length === 0
            if (missingRange) assert(release.compatibility.status !== 'compatible', 'Undeclared core range falsely marked compatible')
            if (release.compatibility.status === 'unknown') assert(typeof release.compatibility.reason === 'string', 'Unknown compatibility lacks reason')
            assert(typeof release.selectable === 'boolean' && Array.isArray(release.blockers), 'Invalid selectable/blockers')
            assert(release.selectable === (release.blockers.length === 0), 'Selectable contradicts blockers')
            if (release.selectable) {
              assert(!['incompatible', 'conflict'].includes(release.compatibility.status), 'Blocked compatibility is selectable')
              assert(release.publication === 'active' && release.artifact.status === 'available', 'Selectable release has no active available artifact')
            }
            assert(Array.isArray(release.sources), 'Missing source facts')
            for (const source of release.sources) {
              keys(source, ['sourceId', 'revision'], 'release source')
              assert(typeof source.sourceId === 'string' && typeof source.revision === 'string', 'Invalid source identity')
            }
          }
          keys(page.pagination, ['cursor', 'hasMore'], 'pagination')
          assert(typeof page.pagination.hasMore === 'boolean', 'Invalid pagination flag')
          assert(page.pagination.hasMore ? typeof page.pagination.cursor === 'string' && page.pagination.cursor.length > 0 : page.pagination.cursor === null, 'Invalid pagination cursor')
          if (page.pagination.hasMore) assert(page.pagination.cursor !== cursor, 'Cursor did not advance')
          pages.push(page)
          cursor = page.pagination.cursor
          if (!page.pagination.hasMore) break
        }
        return { packageName, pagesRead: pages.length, pageLimit: 3, boundedPageSize: 1, context: first.context, installed: first.installed,
          coverage: first.coverage, paginationTested: pages.length > 1, unreadKnownPages: pages[pages.length - 1].pagination.hasMore,
          latestPublished: first.latestPublished, latestCompatible: first.latestCompatible,
          releases: pages.flatMap(page => page.releases), noUiIntermediateFields: true }
      })
      if (!evidence) continue
      captured.push(evidence)
      await check(`release-history-knowledge:${packageName}`, async () => ({ packageName,
        unknown: evidence.coverage.historyCoverage !== 'complete' || evidence.unreadKnownPages,
        historyCoverage: evidence.coverage.historyCoverage, totalKnownRecords: evidence.coverage.totalKnownRecords,
        unreadKnownPages: evidence.unreadKnownPages, reasons: evidence.coverage.reasons }))
      await check(`release-compatibility-knowledge:${packageName}`, async () => {
        const unknownReleases = evidence.releases.filter(release => release.compatibility.status === 'unknown'
          || release.compatibility.declaredRanges.length === 0)
        return { packageName, unknown: evidence.coverage.historyCoverage !== 'complete' || evidence.unreadKnownPages
            || evidence.releases.length === 0 || unknownReleases.length > 0,
          observedCompatibleRecords: evidence.releases.filter(release => release.compatibility.status === 'compatible').length,
          completeCompatibleHistoryEstablished: evidence.coverage.historyCoverage === 'complete' && !evidence.unreadKnownPages,
          unknownReleases: unknownReleases.map(release => ({ identity: release.identity, compatibility: release.compatibility,
            selectable: release.selectable, countedAsCompatible: false })),
          noAutomaticSelectionPerformed: true }
      })
      await check(`release-pagination-coverage:${packageName}`, async () => ({ packageName, unknown: !evidence.paginationTested,
        pagesRead: evidence.pagesRead, reason: evidence.paginationTested ? 'same-context-validated' : 'actual-package-has-no-continuation-page' }))
    }
  } else {
    checks.push({ id: 'release-options-facts', status: 'unknown', evidence: { reason: 'snapshot-prerequisite-failed' } })
  }

  const recoverOriginal = async input => {
    const output = []
    const original = input?.kind === 'install' ? 'taskStartRecover' : input?.kind === 'management' ? 'pluginActionRecover' : null
    try {
      assert(original, 'Specify kind=install or management and the exact original request')
      keys(input, ['kind', 'request'], 'original recovery input')
      keys(input.request, input.kind === 'install' ? ['planId', 'planDigest', 'idempotencyKey']
        : ['packageName', 'expectedVersion', 'action', 'idempotencyKey'], 'original recovery request')
      const result = await api[original](input.request)
      assert(['found', 'not-found'].includes(result.status), 'Invalid recovery status')
      if (result.status === 'not-found') keys(result, ['status'], 'not-found receipt')
      if (result.status === 'found' && input.kind === 'install') {
        keys(result, ['status', 'task'], 'installation recovery')
        assert(hello && result.task.environmentId === hello.environmentId && result.task.planId === input.request.planId
          && result.task.planDigest === input.request.planDigest, 'Recovered task does not match original identity')
      }
      if (result.status === 'found' && input.kind === 'management') {
        keys(result, ['status', 'stage', 'result', 'receipt'], 'management recovery')
        assert(['dispatched', 'settled', 'unknown'].includes(result.stage), 'Invalid durable management stage')
      }
      output.push({ id: 'original-operation-readonly-recovery', status: 'passed', evidence: {
        method: original, result, replayed: false, notFoundProvesNoWrite: false,
        managementWholeBusinessCompletion: input.kind === 'management' ? 'not-inferred-from-official-receipt' : 'not-applicable' } })
    } catch (error) {
      output.push({ id: 'original-operation-readonly-recovery', status: 'failed', error: { name: error?.name ?? 'Error', message: String(error?.message ?? error) } })
    }
    return { readOnly: true, checks: output }
  }
  window.__marketAcceptanceOriginalRecovery = recoverOriginal
  const missingIdentity = `acceptance-absent-20261005-${crypto.randomUUID()}`
  await check('install-recovery-explicitly-absent-identity', async () => {
    const request = { planId: missingIdentity, planDigest: `sha256:${'0'.repeat(64)}`, idempotencyKey: `${missingIdentity}-install` }
    const result = await api.taskStartRecover(request)
    keys(result, ['status'], 'absent install recovery')
    assert(result.status === 'not-found', 'Never-submitted random installation identity was found')
    return { request, result, neverSubmittedByProbe: true, notFoundProvesNoWrite: false, replayed: false }
  })
  await check('management-recovery-explicitly-absent-key', async () => {
    const packageName = captured[0]?.packageName ?? catalog?.packages[0]
    assert(packageName, 'No actual catalog package for management read-only lookup')
    const request = { packageName, action: 'enable', idempotencyKey: `${missingIdentity}-management` }
    const result = await api.pluginActionRecover(request)
    keys(result, ['status'], 'absent management recovery')
    assert(result.status === 'not-found', 'Never-submitted random management key was found')
    return { request, result, neverSubmittedByProbe: true, notFoundProvesNoWrite: false, replayed: false }
  })
  await check('readonly-final-snapshot-consistency', async () => {
    assert(inventory && catalog, 'Snapshot prerequisite failed')
    const afterInventory = await api.inventory()
    const afterCatalog = await api.catalog()
    assert(afterInventory.environmentId === inventory.environmentId && afterInventory.revision === inventory.revision, 'Inventory changed during probe; compare main-controller activity')
    assert(afterCatalog.revision === catalog.revision && afterCatalog.stale === catalog.stale, 'Catalog changed during probe; compare scheduled/background activity')
    return { inventoryRevision: afterInventory.revision, catalogRevision: afterCatalog.revision,
      snapshotUnchanged: true, callsRestrictedToReadApis: true }
  })
  return report()
})().catch(error => ({ testOnly: true, probe: 'installed-market-release-api-20261005', readOnly: true,
  checkedAt: new Date().toISOString(), summary: { passed: 0, failed: 1, unknown: 0 },
  checks: [{ id: 'unexpected-probe-error', status: 'failed', error: { name: error?.name ?? 'Error', message: String(error?.message ?? error) } }],
}))
