/** Desktop transport: one Node WHATWG Fetch/Undici path for direct and proxied GETs. */
type FetchInitWithDispatcher = RequestInit & { readonly dispatcher?: unknown }

export const desktopHttpsFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.protocol !== 'https:' || (init?.method ?? 'GET') !== 'GET') {
    throw new Error('Desktop reader only accepts HTTPS GET')
  }
  // Node's fetch honors a per-request Undici dispatcher. Keeping it on RequestInit
  // avoids mutating process-global dispatcher/proxy/TLS settings.
  return globalThis.fetch(url, init as FetchInitWithDispatcher)
}
