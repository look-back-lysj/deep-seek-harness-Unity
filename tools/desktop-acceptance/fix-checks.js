(async () => {
  const api = window.__marketAcceptanceRemote
  if (!api?.authorDraftSave) throw new Error('Expected actual installed MarketPage namespace')
  const results = []
  const wait = milliseconds => new Promise(done => setTimeout(done, milliseconds))
  const visible = element => element.getBoundingClientRect().width > 0
  const button = label => [...document.querySelectorAll('button')].find(element => visible(element) && element.innerText.trim() === label)
  const check = async (id, operation) => {
    try { const evidence = await operation(); results.push({ id, status: evidence?.networkPassed === false ? 'blocked' : 'passed', evidence }) }
    catch (error) { results.push({ id, status: 'failed', error: error.message }) }
  }
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  await check('cold-start-installed-market', async () => {
    const hello = await api.hello()
    assert(hello.marketVersion === '0.1.0-mvp.17', 'Wrong installed adapter')
    assert(document.body.innerText.includes('发现适合你的插件'), 'Actual market was not mounted after cold start')
    return { marketVersion: hello.marketVersion, coreVersion: hello.coreVersion, hostCore: hello.hostCore }
  })
  await check('author-missing-redacted', async () => {
    for (const operation of [() => api.authorDraftGet('acceptance-missing'), () => api.authorMediaRead({ draftId: 'acceptance-missing', mediaId: 'img_missing' })]) {
      let rejected = false
      try { await operation() } catch (error) {
        rejected = true
        assert(!/eac-market-verify|[A-Za-z]:[\\/]|ENOENT|node:fs/i.test(error.message), 'Profile or storage error leaked')
        assert(error.message.includes('草稿已不存在'), 'Domain error was not preserved')
      }
      assert(rejected, 'Missing draft unexpectedly accepted')
    }
    return { rejected: 2, redacted: true }
  })
  await check('author-visible-refresh-dirty-preserved', async () => {
    button('更多')?.click(); await wait(150); button('作者工具')?.click(); await wait(500)
    const title = document.querySelector('#draft-title')
    assert(title, 'Author editor not visible')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(title, '本地未保存内容')
    title.dispatchEvent(new Event('input', { bubbles: true })); await wait(100)
    button('发现')?.click(); await wait(150); button('离开并保留编辑')?.click(); await wait(200)
    const saved = await api.authorDraftSave({ title: '20261004 可见刷新实机草稿', summary: '隔离验收', markdown: '# 实机验收\n前端刷新列表，不覆盖本地草稿。', mediaIds: [] })
    window.__marketAcceptanceSavedDraft = saved
    button('更多')?.click(); await wait(100); button('作者工具')?.click(); await wait(600)
    assert([...document.querySelectorAll('.eac-market__draft-list button')].some(element => element.innerText.includes(saved.title)), 'New backend draft not refreshed on return')
    assert(document.querySelector('#draft-title').value === '本地未保存内容', 'Returning overwrote unsaved edits')
    return { draftId: saved.id, refreshed: true, unsavedPreserved: true }
  })
  await check('author-missing-media-redacted', async () => {
    const saved = window.__marketAcceptanceSavedDraft
    assert(saved, 'Draft prerequisite failed')
    try { await api.authorMediaRead({ draftId: saved.id, mediaId: 'img_missing' }) }
    catch (error) {
      assert(!/eac-market-verify|[A-Za-z]:[\\/]|ENOENT|node:fs/i.test(error.message), 'Storage error leaked')
      return { rejected: true, message: error.message }
    }
    throw new Error('Unbound media unexpectedly accepted')
  })
  await check('actual-catalog-refresh', async () => {
    const result = await api.catalogRefresh({})
    return { status: result.status, revision: result.current?.revision, stale: result.current?.stale, reason: result.reason, networkPassed: result.status === 'refreshed' }
  })
  await check('actual-readme-network', async () => {
    try {
      const result = await api.authorReadmePreview({ repositoryUrl: 'https://github.com/look-back-lysj/deep-seek-harness-Unity' })
      return { networkPassed: true, previewId: result.previewId }
    } catch (error) { return { networkPassed: false, message: error.message } }
  })
  return { testOnly: true, officialDesktop: true, results }
})()
