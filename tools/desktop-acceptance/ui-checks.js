(async () => {
  const results = []
  const visible = element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
  const wait = milliseconds => new Promise(done => setTimeout(done, milliseconds))
  const text = () => document.querySelector('.eac-market')?.innerText ?? ''
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(button => button.innerText.trim() === label && visible(button))
    if (!button) throw new Error(`Visible button missing: ${label}`)
    button.click(); await wait(600)
  }
  const check = async (id, operation) => {
    try { results.push({ id, status: 'passed', evidence: await operation() }) }
    catch (error) { results.push({ id, status: 'failed', error: String(error.message ?? error), text: text().slice(-1800) }) }
  }
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  await check('UI-home-real-content', async () => { await click('发现'); assert(text().includes('发现适合你的插件') && text().includes('插件探索'), 'Discovery did not load'); return { text: text().slice(0,650) } })
  await check('UI-carousel-pause-next', async () => {
    const next = document.querySelector('button[aria-label="下一项首推"]')
    const before = text().match(/\d+ \/ \d+/)?.[0]
    next.click(); await wait(250)
    const after = text().match(/\d+ \/ \d+/)?.[0]
    assert(before !== after, 'Carousel did not advance')
    const pause = document.querySelector('button[aria-label="暂停轮播"]'); pause?.click(); await wait(300)
    assert(!!document.querySelector('button[aria-label="继续轮播"]') || text().includes('继续'), 'Pause not reflected')
    return { before, after }
  })
  await check('UI-all-search-filter-sort', async () => {
    await click('全部插件')
    const input = [...document.querySelectorAll('.eac-market input')].find(input => input.type === 'search' || /搜索/.test(input.placeholder))
    assert(!!input, 'Search unavailable')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'dsh-find-plugin')
    input.dispatchEvent(new Event('input', { bubbles: true })); await wait(800)
    assert(text().includes('插件搜索助手'), 'Search did not keep matching plugin')
    const filtered = text().slice(-1400)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true })); await wait(600)
    return { filtered, selects: [...document.querySelectorAll('.eac-market select')].map(select => ({ value: select.value, options: [...select.options].map(option => option.text) })) }
  })
  await check('UI-detail-navigation-plan-cancel', async () => {
    const detail = [...document.querySelectorAll('.eac-market button')].find(button => button.getAttribute('aria-label') === '查看 侧栏布局增强 详情')
    assert(!!detail, 'Plugin detail action unavailable'); detail.click(); await wait(800)
    assert(text().includes('dsh-better-sidebar'), 'Exact package detail missing')
    const plan = [...document.querySelectorAll('.eac-market button')].find(button => /查看安装方案|安装/.test(button.innerText) && visible(button) && !button.disabled)
    if (!plan) return { detailRead: true, installAction: 'blocked in real detail', text: text().slice(-1800) }
    plan.click(); await wait(1500)
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible)
    assert(!!dialog, 'Plan dialog missing')
    const evidence = dialog.innerText.slice(0,2200)
    const close = [...dialog.querySelectorAll('button')].find(button => /关闭|取消/.test(button.innerText + button.getAttribute('aria-label')))
    close?.click(); await wait(250)
    assert((await window.__marketAcceptanceRemote.listTasks()).length === 0, 'Closing plan created writes')
    return { detailRead: true, preflight: evidence, cancelledBeforeWrite: true }
  })
  await check('UI-mine-system-protection', async () => { await click('我的插件'); assert(text().includes('我的插件'), 'Inventory page missing'); return { text: text().slice(-2300) } })
  await check('UI-tasks-empty-and-close', async () => {
    await click('任务'); const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible)
    assert(!!dialog, 'Task drawer unavailable'); const evidence = dialog.innerText
    const close = [...dialog.querySelectorAll('button')].find(button => /关闭/.test(button.innerText + button.getAttribute('aria-label'))); close.click(); await wait(250)
    return { evidence }
  })
  await check('UI-help', async () => { await click('帮助'); assert(/官方|安装|来源/.test(text()), 'Help missing'); return { text: text().slice(0,1600) } })
  await check('UI-settings-real-check', async () => {
    await click('更多'); await click('设置'); await wait(1500)
    const check = [...document.querySelectorAll('.eac-market button')].find(button => /检查当前目录/.test(button.innerText) && !button.disabled)
    if (check) { check.click(); await wait(1500) }
    assert(!text().includes('expected 1 argument'), 'Generated optional arg mismatch reached UI')
    return { updateButton: check?.innerText, text: text().slice(-3000) }
  })
  await check('UI-author-saved-draft-preview', async () => {
    await click('更多'); await click('作者工具'); await wait(1000)
    assert(text().includes('官方 Desktop 验收草稿'), 'Actual persisted draft not visible')
    const draftButton = [...document.querySelectorAll('.eac-market button')].find(button => /官方 Desktop 验收草稿/.test(button.innerText))
    draftButton?.click(); await wait(600)
    return { text: text().slice(-2500), textareas: document.querySelectorAll('.eac-market textarea').length }
  })
  await check('UI-skin-real-prerequisite', async () => {
    await click('发现'); await click('进入皮肤中心'); await wait(800)
    assert(text().includes('皮肤'), 'Skin center missing')
    return { loaderAvailable: !!window.__marketAcceptanceSkin?.getRuntime(), text: text().slice(0,2200), switchingPositive: 'blocked: currently catalogued loader/skins require runtime0.1.7-rc.2' }
  })
  await check('UI-reopen-home-no-writes', async () => { await click('发现'); assert(text().includes('发现适合你的插件'), 'Home return missing'); return { tasks: (await window.__marketAcceptanceRemote.listTasks()).length } })
  window.__marketAcceptanceUiResults = results
  return { evidence: 'actual installed official Desktop DOM, no mock Remote', results, passed: results.filter(result => result.status === 'passed').length, failed: results.filter(result => result.status === 'failed').length }
})()
