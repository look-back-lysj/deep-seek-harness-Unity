(async () => {
  const wait = milliseconds => new Promise(done => setTimeout(done, milliseconds))
  const visible = element => element.getBoundingClientRect().width > 0
  const results = []
  const button = label => [...document.querySelectorAll('button')].find(button => button.innerText.trim() === label && visible(button))
  const draft = [...document.querySelectorAll('.eac-market__draft-list button')].find(button => button.innerText.includes('官方 Desktop 验收草稿'))
  if (!draft) throw new Error('Saved draft is not visible after actual page reopen')
  draft.click(); await wait(900)
  const editor = document.querySelector('#draft-markdown')
  const markdown = editor?.value
  const preview = document.querySelector('.eac-market__author')?.innerText ?? document.querySelector('.eac-market')?.innerText
  results.push({ id: 'UI-author-reopen-actual-draft', status: /实机验收/.test(markdown ?? '') ? 'passed' : 'failed', markdown, preview: preview?.slice(-1300) })
  const title = document.querySelector('#draft-title')
  if (title) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(title, '官方 Desktop 页面保存验收')
    title.dispatchEvent(new Event('input', { bubbles: true })); await wait(200)
    button('保存草稿')?.click(); await wait(1000)
    const saved = await window.__marketAcceptanceRemote.listDrafts()
    results.push({ id: 'UI-author-save-real-service', status: saved.some(draft => draft.title === '官方 Desktop 页面保存验收') ? 'passed' : 'failed', titles: saved.map(draft => draft.title) })
  }
  button('任务')?.click(); await wait(400)
  const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible)
  const details = dialog?.querySelector('details.eac-market__task-history')
  if (details) { details.open = true; details.dispatchEvent(new Event('toggle')); await wait(600) }
  results.push({ id: 'UI-failed-task-history-real', status: dialog?.innerText.includes('制品获取或校验失败') ? 'passed' : 'failed', text: dialog?.innerText.slice(-2500) })
  const close = [...(dialog?.querySelectorAll('button') ?? [])].find(button => /关闭/.test(button.innerText + button.getAttribute('aria-label')))
  close?.focus()
  window.__marketAcceptanceKeyboardModal = { beforeFocus: document.activeElement?.getAttribute('aria-label'), opened: !!dialog }
  return { results }
})()
