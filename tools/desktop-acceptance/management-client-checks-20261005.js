(async () => {
  const packageName = 'eac-market-acceptance-noop'
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  const pause = () => new Promise(done => setTimeout(done, 50))
  const until = async check => {
    const end = Date.now() + 45_000
    while (Date.now() < end) { const result = check(); if (result) return result; await pause() }
    throw new Error('Bounded official Client state wait failed; stop without another write')
  }
  const button = (label, parent = document) => [...parent.querySelectorAll('button')].find(item => item.textContent.trim() === label)
  const card = () => [...document.querySelectorAll('article.eac-market__card')].find(item => item.querySelector('h3')?.textContent === packageName)
  const identities = () => {
    const market = document.querySelector('.eac-market')
    let current = market[Object.keys(market).find(key => key.startsWith('__reactFiber'))]
    const found = []
    while (current) {
      for (const node of [current, current.alternate]) {
        let hook = node?.memoizedState
        while (hook && typeof hook === 'object') {
          const value = hook.memoizedState
          if (value?.feedback && value.identity && typeof value.busy === 'boolean') found.push(value.identity)
          hook = hook.next
        }
      }
      current = current.return
    }
    return found
  }
  const element = document.querySelector('.eac-market')
  assert(element, 'Expected actually installed market UI')
  let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber'))]
  while (fiber) { if (fiber.memoizedProps?.remote) { window.__marketAcceptanceRemote = fiber.memoizedProps.remote; break }; fiber = fiber.return }
  const api = window.__marketAcceptanceRemote
  const hello = await api.hello()
  const storageKey = 'eac-market:management:' + encodeURIComponent(hello.environmentId)
  const resumed = window.__marketAcceptanceClientResume
  assert(localStorage.getItem(storageKey) === null && (!window.__marketAcceptanceClientOriginals || resumed), 'Existing or previously tested operation; stop without replay')
  const fixture = (await api.inventory()).items.find(item => item.packageName === packageName)
  assert(fixture?.installed && fixture.version === '1.0.0' && fixture.bundleEnabled === !resumed, 'Safe fixture does not match the verified initial or resumed state')
  button('我的插件')?.click()
  await until(card)
  const originals = []
  window.__marketAcceptanceClientOriginals = originals
  const facts = []
  if (resumed) {
    assert(resumed.environmentId === hello.environmentId && resumed.packageName === packageName && resumed.action === 'disable' && identities().some(item => item.idempotencyKey === resumed.idempotencyKey), 'Cannot resume without preserved exact Client identity')
    const { environmentId: _environmentId, ...request } = resumed
    const recovered = await api.pluginActionRecover(request)
    assert(recovered.status === 'found' && recovered.result?.status === 'applied', 'Original Client disable is not fully completed; do not continue')
    originals.push(resumed)
    facts.push({ action: 'disable', status: 'passed', pointer: resumed, recovered, pointerCleared: true, readOnlyAfterProbeSamplingFailure: true })
    window.__marketAcceptanceClientResume = undefined
  }
  for (const action of resumed ? ['enable', 'remove'] : ['disable', 'enable', 'remove']) {
    const control = button(action === 'remove' ? '卸载' : action === 'enable' ? '启用' : '停用', card())
    assert(control && !control.disabled, 'Fixture management control is unavailable; stop')
    control.click()
    if (action === 'remove') {
      const first = await until(() => button('继续查看卸载影响'))
      assert(localStorage.getItem(storageKey) === null, 'First confirmation unexpectedly submitted a write')
      first.click()
      const second = await until(() => button('已了解影响，再次确认卸载'))
      assert(localStorage.getItem(storageKey) === null, 'Reviewing uninstall impact unexpectedly submitted a write')
      second.click()
    }
    const pointer = await until(() => {
      const saved = localStorage.getItem(storageKey)
      const candidates = saved ? [JSON.parse(saved), ...identities()] : identities()
      return candidates.find(item => item.action === action && !originals.some(original => original.idempotencyKey === item.idempotencyKey))
    })
    assert(pointer.environmentId === hello.environmentId && pointer.packageName === packageName && pointer.expectedVersion === '1.0.0' && pointer.action === action, 'Client did not preserve the exact original intent')
    originals.push(pointer)
    await until(() => localStorage.getItem(storageKey) === null || document.body.textContent.includes('结果未知'))
    if (localStorage.getItem(storageKey) !== null) {
      const recheck = button('核对原操作')
      assert(recheck && !recheck.disabled, 'Original operation is unknown; no safe read-only control is available')
      recheck.click()
      await until(() => localStorage.getItem(storageKey) === null)
    }
    await until(() => action === 'remove' ? !card() : button(action === 'enable' ? '停用' : '启用', card())?.disabled === false)
    const { environmentId: _environmentId, ...request } = pointer
    const recovered = await api.pluginActionRecover(request)
    assert(recovered.status === 'found' && recovered.result?.status === 'applied' && recovered.result.changed === true, 'UI operation did not produce a complete backend result')
    assert(document.body.textContent.includes('原业务结果：applied'), 'Client did not display the complete business result')
    facts.push({ action, status: 'passed', pointer, recovered, pointerCleared: true, uninstallSecondConfirmation: action === 'remove' })
  }
  return { testOnly: true, fixtureOnly: true, officialDesktop: true, realClientControls: true, faultInjected: false,
    checkedAt: new Date().toISOString(), environmentId: hello.environmentId, facts, summary: { passed: facts.length, failed: 0 }, originals }
})().catch(error => ({ testOnly: true, fixtureOnly: true, officialDesktop: true, realClientControls: true,
  status: 'failed', error: String(error?.message ?? error), originalRequests: window.__marketAcceptanceClientOriginals ?? [], replayAllowed: false }))
