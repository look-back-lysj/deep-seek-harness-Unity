/** HTTPS reader for desktop Node. Use the runtime AND operating-system trust
 * stores, as browsers do, without changing global TLS settings or disabling
 * certificate/hostname verification. Each call retains its own AbortSignal.
 * This adapter serves GET requests only; redirects remain in safeFetch. */
import { request } from 'node:https'
import { Readable } from 'node:stream'
import { getCACertificates } from 'node:tls'

let trustedRoots: readonly string[] | undefined
export const desktopHttpsFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.protocol !== 'https:' || (init?.method ?? 'GET') !== 'GET') throw new Error('Desktop reader only accepts HTTPS GET')
  trustedRoots ??= [...new Set([...getCACertificates('default'), ...getCACertificates('system')])]
  const headers = Object.fromEntries(new Headers(init?.headers).entries())
  return new Promise<Response>((resolve, reject) => {
    const req = request(url, { method: 'GET', headers, ca: [...trustedRoots!], ...(init?.signal ? { signal: init.signal } : {}) }, response => {
      const resultHeaders = new Headers()
      for (const [key, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) for (const part of value) resultHeaders.append(key, part)
        else if (value !== undefined) resultHeaders.set(key, value)
      }
      const status = response.statusCode ?? 502
      const body = [204, 205, 304].includes(status) ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>
      if (body === null) response.resume()
      resolve(new Response(body, { status, headers: resultHeaders }))
    })
    req.on('error', reject)
    req.end()
  })
}
