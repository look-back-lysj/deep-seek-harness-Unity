(async () => {
  const visible = element => element.getBoundingClientRect().width > 0
  const wait = () => new Promise(done => setTimeout(done, 350))
  if (!document.querySelector('input[aria-label="Package name or address"]')) {
    const edit = [...document.querySelectorAll('button')].find(button => button.innerText === 'Edit' && visible(button))
    const add = [...document.querySelectorAll('button')].find(button => button.innerText === 'Add plugin' && visible(button))
    ;(edit ?? add)?.click()
    await wait()
  }
  const registry = [...document.querySelectorAll('button')].find(button => button.innerText.startsWith('Registry') && visible(button))
  if (!registry) throw new Error('Official registry chooser is unavailable')
  registry.click()
  await wait()
  const custom = [...document.querySelectorAll('input')].find(input => input.getAttribute('aria-label') === 'Custom address')
  if (!custom) return { stage: 'registry-chooser', text: document.body.innerText.slice(-2500), inputs: [...document.querySelectorAll('input')].map(input => ({ type: input.type, aria: input.getAttribute('aria-label'), text: input.outerHTML.slice(0,500) })) }
  custom.focus()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  const registryUrl = new URL(window.__marketAcceptanceRegistry)
  if (registryUrl.protocol !== 'http:' || registryUrl.hostname !== '127.0.0.1' || !registryUrl.port || registryUrl.username || registryUrl.password) throw new Error('Expected an explicit isolated loopback Registry')
  setter.call(custom, registryUrl.href)
  custom.dispatchEvent(new Event('input', { bubbles: true }))
  await wait()
  const input = document.querySelector('input[aria-label="Package name or address"]')
  if (!input) throw new Error('Official install input is unavailable')
  const adapterVersion = window.__marketAcceptanceAdapterVersion ?? '0.1.0-mvp.17'
  if (typeof adapterVersion !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(adapterVersion)) throw new Error('Expected an exact candidate adapter version from registry.json')
  input.focus()
  setter.call(input, window.__marketAcceptanceNoopInstall ? 'eac-market-acceptance-noop@1.0.0' : `@dsh-eac/market@${adapterVersion}`)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await wait()
  const install = [...document.querySelectorAll('button')].find(button => button.innerText === 'Install' && visible(button))
  if (!install || install.disabled) return { stage: 'ready-check', text: document.body.innerText.slice(-2500) }
  install.click()
  await new Promise(done => setTimeout(done, 4000))
  return { stage: 'submitted', text: document.body.innerText.slice(-5000) }
})()
