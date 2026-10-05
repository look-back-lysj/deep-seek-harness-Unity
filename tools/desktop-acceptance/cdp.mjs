import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [batchInput, command = 'list', input = '', targetInput = ''] = process.argv.slice(2)
const batch = resolve(batchInput ?? '')
const session = JSON.parse(readFileSync(join(batch, 'session.json'), 'utf8'))
if (!session.testOnly || session.batch !== batch) throw new Error('Expected a recorded isolated Desktop session')
const port = command === 'host' ? session.inspectPort : session.cdpPort
const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10000) }).then(response => response.json())
if (command === 'list') {
  console.log(JSON.stringify(targets.map(({ id, type, title, url }) => ({ id, type, title, url: url.replace(/([?&](?:token|key|secret)=)[^&]*/gi, '$1[redacted]') })), null, 2))
} else {
  const target = targetInput ? targets.find(target => target.id === targetInput) : targets.find(target => command === 'host' || target.type === 'page' && !/devtools:/.test(target.url))
  if (!target?.webSocketDebuggerUrl) throw new Error('No matching isolated target')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let serial = 0
  const pending = new Map()
  socket.addEventListener('close', () => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer)
      if (waiter.method === 'Browser.close') waiter.done({ closed: true })
      else waiter.reject(new Error('Isolated CDP target closed'))
    }
    pending.clear()
  })
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    const waiter = pending.get(result.id)
    if (waiter) { pending.delete(result.id); clearTimeout(waiter.timer); result.error ? waiter.reject(new Error(JSON.stringify(result.error))) : waiter.done(result.result) }
  })
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++serial
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)) }, 120000)
    pending.set(id, { done, reject, timer, method }); socket.send(JSON.stringify({ id, method, params }))
  })
  try {
    if (command === 'shot') {
      await send('Page.enable')
      const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const path = resolve(batch, input || 'desktop.png')
      if (!path.startsWith(batch + '\\')) throw new Error('Screenshot outside batch')
      writeFileSync(path, Buffer.from(result.data, 'base64')); console.log(path)
    } else if (command === 'call') {
      const { method, params } = JSON.parse(input)
      console.log(JSON.stringify(await send(method, params), null, 2))
    } else {
      const expression = input.startsWith('@') ? readFileSync(input.slice(1), 'utf8') : input
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      console.log(JSON.stringify(result.result?.value ?? { type: result.result?.type, description: result.result?.description }, null, 2))
    }
  } finally { socket.close() }
}
