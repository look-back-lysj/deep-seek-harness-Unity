(async () => {
  const api = window.__marketAcceptanceRemote
  const checks = []
  const visible = element => element.getBoundingClientRect().width > 0
  const text = () => document.querySelector('.eac-market')?.innerText ?? ''
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  const waitFor = async (condition, message) => {
    const deadline = Date.now() + 10000
    while (!condition()) {
      if (Date.now() >= deadline) throw new Error(message)
      await new Promise(done => setTimeout(done, 100))
    }
  }
  const click = label => {
    const button = [...document.querySelectorAll('.eac-market button')].find(element => visible(element) && element.innerText.trim() === label)
    assert(button && !button.disabled, `Actual UI action unavailable: ${label}`)
    button.click()
  }
  const check = async (id, operation) => {
    try {
      const evidence = await operation()
      checks.push({ id, status: evidence?.blocked ? 'blocked' : 'passed', evidence })
    } catch (error) { checks.push({ id, status: 'failed', error: String(error?.message ?? error) }) }
  }
  assert(api?.taskList && api?.authorDraftList, 'Expected real installed namespace')
  const taskIdsBefore = (await api.taskList()).map(task => task.taskId)
  await check('official-home-navigation', async () => {
    click('发现')
    await waitFor(() => text().includes('发现适合你的插件'), 'Actual home did not render')
    return { rendered: true }
  })
  await check('official-catalog-search', async () => {
    click('全部插件')
    await waitFor(() => !!document.querySelector('.eac-market input[type=search]'), 'Search did not render')
    const input = document.querySelector('.eac-market input[type=search]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'dsh-settings-scroll-fix')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => text().includes('1 个插件符合当前条件') && text().includes('当前筛选：搜索：dsh-settings-scroll-fix'), 'Search filtering failed')
    return { matchingPackage: 'dsh-settings-scroll-fix', exactFilteredCount: 1 }
  })
  await check('official-plan-stale-unknown-and-cancel', async () => {
    const card = [...document.querySelectorAll('.eac-market article')].find(element => element.innerText.includes('dsh-settings-scroll-fix'))
    assert(card, 'Real catalog target is absent')
    const open = [...card.querySelectorAll('button')].find(element => element.innerText === '查看安装方案')
    assert(open && !open.disabled, 'Real plan entry unavailable')
    open.click()
    await waitFor(() => document.querySelector('[role=dialog] select')?.options.length > 1, 'Actual version facts did not render')
    const dialog = document.querySelector('[role=dialog]')
    const select = dialog.querySelector('select')
    const confirm = [...dialog.querySelectorAll('button')].find(element => element.innerText === '确认安装')
    const release = await api.releaseOptions({ packageName: 'dsh-settings-scroll-fix', limit: 1 })
    const evidence = { text: dialog.innerText, selected: select.value, disabled: select.disabled, confirmDisabled: confirm?.disabled,
      catalogStale: release.context.catalogStale, compatibility: release.releases[0]?.compatibility.status }
    assert(!dialog.innerText.includes('核心版本过旧'), 'Unknown range incorrectly diagnosed old core')
    if (release.context.catalogStale) assert(select.disabled && select.value === '' && confirm?.disabled, 'Stale catalog permits selection or installation')
    dialog.querySelector('button[aria-label="关闭安装确认"]').click()
    await waitFor(() => !document.querySelector('[role=dialog]'), 'Plan cancel did not close')
    return { ...evidence, cancelledBeforeWrite: true, positiveInstall: 'not-exercised' }
  })
  await check('official-inventory-system-protection', async () => {
    click('我的插件')
    await waitFor(() => text().includes('这里只显示官方插件管理器返回的真实安装和启停状态。'), 'Actual inventory page did not render')
    const systemGroup = document.querySelector('.eac-market__system-group')
    if (systemGroup && !systemGroup.open) systemGroup.querySelector('summary').click()
    await waitFor(() => text().includes('@dsh-eac/market'), 'Actual inventory did not render market')
    return { rendered: true, text: text().slice(0, 2200), systemWritesAttempted: false }
  })
  await check('official-task-drawer', async () => {
    click('任务')
    await waitFor(() => !!document.querySelector('[role=dialog]'), 'Task drawer did not render')
    const dialog = document.querySelector('[role=dialog]')
    const evidence = dialog.innerText
    const close = [...dialog.querySelectorAll('button')].find(element => /关闭/.test(element.getAttribute('aria-label') ?? element.innerText))
    assert(close, 'Task close unavailable')
    close.click()
    await waitFor(() => !document.querySelector('[role=dialog]'), 'Task drawer did not close')
    return { text: evidence, taskWritesAttempted: false }
  })
  await check('official-help-and-settings', async () => {
    click('帮助')
    await waitFor(() => text().includes('安装') && text().includes('官方'), 'Help did not render')
    click('更多')
    await waitFor(() => [...document.querySelectorAll('.eac-market button')].some(element => visible(element) && element.innerText === '设置'), 'Settings entry did not render')
    click('设置')
    await waitFor(() => text().includes('目录来源'), 'Settings did not render')
    return { rendered: true, text: text().slice(-2600), updatePolicyWritesAttempted: false }
  })
  await check('official-persisted-author-draft', async () => {
    const drafts = await api.authorDraftList()
    assert(drafts.length > 0, 'Previously saved isolated draft did not survive cold start')
    click('更多')
    await waitFor(() => [...document.querySelectorAll('.eac-market button')].some(element => visible(element) && element.innerText === '作者工具'), 'Author entry did not render')
    click('作者工具')
    await waitFor(() => text().includes(drafts[0].title), 'Persisted author draft did not render')
    return { draftId: drafts[0].id, rendered: true, edited: false }
  })
  await check('official-skin-positive-prerequisite', async () => {
    click('发现')
    await waitFor(() => text().includes('发现适合你的插件') || [...document.querySelectorAll('[role=dialog]')].some(element => element.innerText.includes('当前草稿尚未保存')), 'Home navigation neither rendered nor requested dirty-edit confirmation')
    const leaveDialog = [...document.querySelectorAll('[role=dialog]')].find(element => element.innerText.includes('当前草稿尚未保存'))
    if (leaveDialog) {
      const preserve = [...leaveDialog.querySelectorAll('button')].find(element => element.innerText === '离开并保留编辑')
      assert(preserve, 'Dirty author navigation lacks preserve-edit confirmation')
      preserve.click()
      await waitFor(() => !document.querySelector('[role=dialog]'), 'Preserve-edit navigation did not close')
    }
    await waitFor(() => text().includes('进入皮肤中心'), 'Skin entry did not render')
    click('进入皮肤中心')
    await waitFor(() => text().includes('皮肤') && !text().includes('发现适合你的插件'), 'Skin center did not render')
    return { blocked: true, rendered: true, text: text().slice(0, 2000), reason: 'positive-switching-not-exercised-no-authorized-loader-fixtures' }
  })
  await check('official-return-home-no-new-tasks', async () => {
    click('发现')
    await waitFor(() => text().includes('发现适合你的插件'), 'Return home failed')
    const taskIdsAfter = (await api.taskList()).map(task => task.taskId)
    assert(JSON.stringify(taskIdsAfter) === JSON.stringify(taskIdsBefore), 'UI smoke created a task')
    return { taskIdsBefore, taskIdsAfter, installOrManagementWritesAttempted: false }
  })
  return { testOnly: true, officialDesktop: true, realDom: true, checkedAt: new Date().toISOString(), checks,
    summary: Object.fromEntries(['passed', 'failed', 'blocked'].map(status => [status, checks.filter(check => check.status === status).length])),
    unverified: ['compatible-upgrade-downgrade-and-version-history', 'network-artifact-installation', 'ai-positive', 'screen-reader-dpi-and-theme-matrix'] }
})().catch(error => ({ testOnly: true, officialDesktop: true, status: 'failed', error: String(error?.message ?? error) }))
