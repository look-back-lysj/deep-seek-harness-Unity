(async () => {
  if (!document.querySelector('input[aria-label="Package name or address"]')) {
    const button = [...document.querySelectorAll('button')].find(button => button.innerText === 'Add plugin')
    if (!button) throw new Error('Official Plugins page is not open')
    button.click()
    await new Promise(done => setTimeout(done, 400))
  }
  const input = [...document.querySelectorAll('input')].find(input => input.getAttribute('aria-label') === 'Package name or address')
  if (!input) throw new Error('Official Add plugin dialog is not open')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, 'http://127.0.0.1:61000/artifacts/ac7cb7967f8b5b386bdd04c406d4f17cc0cbb90960fa2a00e6137fc40b1f1e59/dsh-eac-market-0.1.0-mvp.17.tgz')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(done => setTimeout(done, 300))
  const button = [...document.querySelectorAll('button')].find(button => button.innerText === 'Install' && button.getBoundingClientRect().width > 0)
  if (!button || button.disabled) throw new Error('Official install is unavailable')
  button.click()
  await new Promise(done => setTimeout(done, 3000))
  return { officialDialog: true, submitted: true, text: document.body.innerText.slice(-4000) }
})()
