import assert from 'node:assert/strict'
import { lookup } from 'node:dns/promises'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, relative, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSafeRemoteUrl, readLimitedResponse, safeFetch, withAbort } from '../../packages/market-core/src/delivery/security.ts'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const outputRoot = resolve(workspace, '.verify/management-business-20261005/source-audit')
const limits = Object.freeze({ wallMs: 240000, attemptMs: 10000, dnsMs: 5000, attempts: 2, requestReservations: 220, redirects: 3, totalBytes: 64 * 1024 * 1024, jsonBytes: 3 * 1024 * 1024, indexBytes: 20 * 1024 * 1024, imageBytes: 2 * 1024 * 1024, artifactBytes: 6 * 1024 * 1024, recordsPerSource: 10, images: 4, artifacts: 2 })
const manifestUrl = 'https://metaone01.github.io/agent-forge/data/manifest.json'
const historicalRefs = { main: 'c3c1bbbd24a04212086cdea2b212d78721f85769', packages: '3022bd1b898093d8aa90f76ebe0989b517195aa2' }
const headers = { 'user-agent': 'eac-market-bounded-source-audit/20261005', accept: '*/*', 'accept-encoding': 'identity' }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function publicHttps(input) {
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('audit/https-without-credentials-required')
  return url
}

export function indexedUrl(path, base) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.includes('?') || path.includes('#') || path.split('/').some(part => !part || part === '.' || part === '..') || /^[a-z]+:/i.test(path)) throw new Error('audit/unsafe-index-path')
  const url = new URL(path, base)
  if (url.origin !== new URL(base).origin || !url.href.startsWith(base)) throw new Error('audit/path-outside-source')
  return publicHttps(url).href
}

function errorFacts(error) {
  return { name: error?.name, code: error?.code ?? error?.cause?.code, message: String(error?.message ?? error).slice(0, 700), status: error?.status }
}

export function retryableError(error) {
  return !String(error?.code ?? '').startsWith('delivery/private') && !/budget|over-limit|unsafe|credentials/.test(error?.message ?? '') && (!error?.status || [408, 429, 500, 502, 503, 504].includes(error.status))
}

export async function limitedBody(response, maximum, signal, charge = () => {}) {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > maximum) {
    await response.body?.cancel()
    throw new Error('audit/content-length-over-limit')
  }
  const reader = response.body?.getReader()
  const chunks = []
  let bytes = 0
  if (!reader) return Buffer.alloc(0)
  try {
    while (true) {
      const chunk = await withAbort(reader.read(), signal)
      if (chunk.done) return Buffer.concat(chunks, bytes)
      charge(chunk.value.byteLength)
      bytes += chunk.value.byteLength
      if (bytes > maximum) throw new Error('audit/body-over-limit')
      chunks.push(Buffer.from(chunk.value))
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
}

function mediaReferences(media) {
  const result = []
  for (const [role, values] of [['icon', media?.icon ? [media.icon] : []], ['preview', media?.previews ?? []]]) {
    for (const value of values) {
      if (typeof value === 'string') result.push({ role, url: value })
      else if (value?.url) result.push({ role, ...value })
    }
  }
  return result
}

function indexFacts(index) {
  const entries = Object.entries(index.packages ?? {})
  return { sourceId: index.sourceId, agentId: index.agentId, type: index.type, revision: index.revision, packageCount: entries.length, mediaEntries: entries.filter(([, entry]) => mediaReferences(entry.media).length > 0).length, multiVersionEntries: entries.filter(([, entry]) => entry.versions?.length > 1).length, unversionedEntries: entries.filter(([, entry]) => entry.latest === 'unversioned').length, versionDeclarations: entries.map(([name, entry]) => ({ name, latest: entry.latest, versions: entry.versions, path: entry.path, recordRevision: entry.recordRevision, media: entry.media })) }
}

function selectedEntries(index) {
  return Object.entries(index.packages ?? {}).map(([name, entry], position) => ({ name, entry, position, score: (mediaReferences(entry.media).length ? 1000 : 0) + (entry.versions?.length > 1 ? 500 : 0) + (entry.latest !== 'unversioned' ? 100 : 0) + (/skin|theme|sidebar|market|whale/i.test(name) ? 10 : 0) })).sort((left, right) => right.score - left.score || left.position - right.position).slice(0, limits.recordsPerSource)
}

export async function selfTest() {
  assert.equal(indexedUrl('dsh/plugin/index.json', 'https://example.com/data/'), 'https://example.com/data/dsh/plugin/index.json')
  for (const path of ['../index.json', '/index.json', 'https://example.com/index.json', 'folder\\record.json', '%2e%2e/index.json', 'record.json?token=bad']) assert.throws(() => indexedUrl(path, 'https://example.com/data/'))
  assert.throws(() => publicHttps('http://example.com'))
  assert.throws(() => publicHttps('https://user:password@example.com'))
  assert.equal((await limitedBody(new Response('abc'), 3, AbortSignal.timeout(1000))).toString(), 'abc')
  await assert.rejects(limitedBody(new Response('abcd'), 3, AbortSignal.timeout(1000)), /body-over-limit/)
  await assert.rejects(limitedBody(new Response('a', { headers: { 'content-length': '20' } }), 3, AbortSignal.timeout(1000)), /content-length-over-limit/)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('self-test timeout')), 20)
  try { await assert.rejects(limitedBody(new Response(new ReadableStream({ start() {} })), 3, controller.signal), /timeout/) }
  finally { clearTimeout(timeout) }
  assert.equal(await assertSafeRemoteUrl('https://localhost').then(() => false, error => error.code), 'delivery/private-host')
  assert.equal(retryableError(new DOMException('timeout', 'TimeoutError')), true)
  assert.equal(retryableError({ code: 'delivery/private-address' }), false)
  assert.equal(retryableError({ status: 404 }), false)
  assert.equal(indexFacts({ packages: { one: { latest: 'unversioned', versions: ['unversioned'] }, two: { latest: '2.0.0', versions: ['1.0.0', '2.0.0'], media: { icon: { url: 'https://example.com/icon.png' } } } } }).multiVersionEntries, 1)
  console.log(JSON.stringify({ selfTest: 'passed', synthetic: true, networkRequests: 0 }))
}

async function audit(directHints = false) {
  const startedAt = new Date().toISOString()
  const output = resolve(outputRoot, startedAt.replace(/[:.]/g, '-'))
  if (relative(outputRoot, output).startsWith('..')) throw new Error('audit/output-outside-owned-root')
  await mkdir(output, { recursive: true })
  const wallSignal = AbortSignal.timeout(limits.wallMs)
  const evidence = { schemaVersion: 1, startedAt, output, limits, historicalRefs, transport: { ordinary: 'Node global fetch; HTTPS, no credentials, manual redirects; not a market-security pass', safe: 'Current Core safeFetch with default DNS/SSRF; no injected fetch/lookup/proxy/dispatcher; no Host/Profile access', dns: 'OS lookup(all:true) plus current Core assertSafeRemoteUrl; observation only' }, requests: [], dns: [], references: {}, sources: [], records: [], media: [], artifacts: [], gaps: [], bytesRead: 0 }
  const securityPath = resolve(workspace, 'packages/market-core/src/delivery/security.ts')
  evidence.securityModule = { path: securityPath, sha256Before: sha256(await readFile(securityPath)) }
  const persist = async (name, value) => writeFile(resolve(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  const dnsSeen = new Set()
  evidence.mode = directHints ? 'published-records-from-untrusted-local-path-hints' : 'published-index-discovery'
  let reservations = 0
  const reserve = count => { if (reservations + count > limits.requestReservations) throw new Error('audit/request-budget'); reservations += count }
  const charge = size => { evidence.bytesRead += size; if (evidence.bytesRead > limits.totalBytes) throw new Error('audit/total-byte-budget') }
  async function dnsEvidence(input) {
    const url = publicHttps(input)
    if (dnsSeen.has(url.hostname)) return
    dnsSeen.add(url.hostname)
    const began = Date.now()
    const signal = AbortSignal.any([wallSignal, AbortSignal.timeout(limits.dnsMs)])
    const item = { hostname: url.hostname, observedAt: new Date().toISOString() }
    try { item.addresses = await withAbort(lookup(url.hostname, { all: true }), signal) } catch (error) { item.lookupError = errorFacts(error) }
    try { await withAbort(assertSafeRemoteUrl(url), signal); item.gate = 'allowed' } catch (error) { item.gate = 'blocked'; item.gateError = errorFacts(error) }
    item.elapsedMs = Date.now() - began
    evidence.dns.push(item)
  }
  async function ordinaryFetch(input, signal, request) {
    let url = publicHttps(input)
    for (let hop = 0; hop <= limits.redirects; hop += 1) {
      reserve(1)
      const response = await fetch(url, { signal, headers, redirect: 'manual' })
      request.hops.push({ url: url.href, status: response.status })
      if (![301, 302, 303, 307, 308].includes(response.status)) return response
      await response.body?.cancel()
      if (hop === limits.redirects || !response.headers.get('location')) throw new Error('audit/redirect-budget-or-missing-location')
      url = publicHttps(new URL(response.headers.get('location'), url))
    }
  }
  async function probe(url, lane, purpose, maximum = limits.jsonBytes) {
    await dnsEvidence(url)
    for (let attempt = 1; attempt <= limits.attempts; attempt += 1) {
      wallSignal.throwIfAborted()
      const began = Date.now()
      const request = { url, lane, purpose, attempt, observedAt: new Date().toISOString(), maximumBytes: maximum, hops: [] }
      evidence.requests.push(request)
      const signal = AbortSignal.any([wallSignal, AbortSignal.timeout(limits.attemptMs)])
      try {
        let response
        if (lane === 'safeFetch') {
          reserve(limits.redirects + 1)
          response = await safeFetch(url, { signal, headers, timeoutMs: limits.attemptMs, headersTimeoutMs: limits.attemptMs, bodyIdleTimeoutMs: limits.attemptMs, maxRedirects: limits.redirects })
        } else response = await ordinaryFetch(url, signal, request)
        request.status = response.status
        request.actualUrl = response.url || url
        request.headers = Object.fromEntries(['content-type', 'content-length', 'etag', 'last-modified', 'retry-after', 'x-ratelimit-remaining', 'x-github-request-id'].map(name => [name, response.headers.get(name)]))
        if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`audit/http-${response.status}`), { status: response.status }) }
        const bytes = await limitedBody(response, maximum, signal, charge)
        Object.assign(request, { bytes: bytes.length, sha256: sha256(bytes), result: 'received', elapsedMs: Date.now() - began })
        return { bytes, request }
      } catch (error) {
        Object.assign(request, { result: 'blocked', error: errorFacts(error), elapsedMs: Date.now() - began })
        if (!retryableError(error) || attempt === limits.attempts || wallSignal.aborted) return undefined
        await withAbort(new Promise(done => setTimeout(done, 250)), wallSignal)
      }
    }
  }
  async function pair(url, purpose, maximum) {
    const ordinary = await probe(url, 'ordinaryHttps', purpose, maximum)
    const safe = await probe(url, 'safeFetch', purpose, maximum)
    return { ordinary, safe, available: safe ?? ordinary, sameDigest: ordinary && safe ? ordinary.request.sha256 === safe.request.sha256 : null }
  }
  async function jsonPair(url, purpose, name, maximum = limits.jsonBytes) {
    const result = await pair(url, purpose, maximum)
    if (!result.available) return { ...result, data: undefined }
    try {
      const data = JSON.parse(result.available.bytes.toString('utf8'))
      await persist(name, { url, capturedThrough: result.safe ? 'safeFetch' : 'ordinaryHttps', sha256: result.available.request.sha256, sameDigestAcrossLanes: result.sameDigest, data })
      return { ...result, data }
    } catch (error) { evidence.gaps.push({ purpose, url, reason: 'invalid-json-or-persistence', error: errorFacts(error) }); return { ...result, data: undefined } }
  }
  try {
    const top = await jsonPair(manifestUrl, 'published-manifest', 'manifest.json')
    evidence.manifest = { url: manifestUrl, revision: top.data?.revision, generatedAt: top.data?.generatedAt, cutoff: top.data?.cutoff, safeFetchReceived: Boolean(top.safe), sameDigestAcrossLanes: top.sameDigest }
    if (!top.data) evidence.gaps.push({ reason: 'published-manifest-unavailable' })
    for (const source of (top.data?.sources ?? []).filter(source => source.agentId === 'dsh' && (directHints ? source.type === 'plugin' : ['plugin', 'general'].includes(source.type))).sort((left, right) => left.type === 'plugin' ? -1 : right.type === 'plugin' ? 1 : 0).slice(0, 2)) {
      const sourceIndexUrl = indexedUrl(source.path, new URL('./', manifestUrl).href)
      const base = new URL('./', sourceIndexUrl).href
      const sourceManifest = await jsonPair(new URL('manifest.json', base).href, `source-${source.type}-manifest`, `${source.type}-manifest.json`)
      const sourceDescription = await jsonPair(new URL('source.json', base).href, `source-${source.type}-description`, `${source.type}-source.json`)
      let index
      if (directHints) {
        const localRoot = 'G:/Code/sourcerepo/agent-forge'
        for (const path of ['sources/plugin/index.json', 'data/dsh/plugin/index.json']) if ((await stat(resolve(localRoot, path))).size > limits.indexBytes) throw new Error('audit/local-hint-size-limit')
        const canonicalBytes = await readFile(resolve(localRoot, 'sources/plugin/index.json'))
        const projectionBytes = await readFile(resolve(localRoot, 'data/dsh/plugin/index.json'))
        const canonical = JSON.parse(canonicalBytes.toString('utf8'))
        const projection = JSON.parse(projectionBytes.toString('utf8'))
        const hints = Object.entries(canonical.packages ?? {}).filter(([, entry]) => mediaReferences(entry.media).length).slice(0, 6).flatMap(([name]) => projection.packages?.[name]?.path ? [[name, { path: projection.packages[name].path }]] : [])
        await persist('local-path-hints.json', { authority: 'NOT publication evidence; may be dirty; URLs only; no checksum/version/media inherited', root: localRoot, canonicalSha256: sha256(canonicalBytes), projectionSha256: sha256(projectionBytes), canonicalLocalRevision: canonical.revision, projectionLocalRevision: projection.revision, hints })
        index = { data: { sourceId: sourceDescription.data?.sourceId, agentId: 'dsh', type: 'plugin', revision: sourceDescription.data?.revision, packages: Object.fromEntries(hints) }, localHintsOnly: true }
        evidence.sources.push({ sourceId: sourceDescription.data?.sourceId, url: sourceIndexUrl, revision: sourceDescription.data?.revision, description: sourceDescription.data, discovery: 'untrusted-local-path-hints; index not fetched; counts/history unknown' })
      } else index = await jsonPair(sourceIndexUrl, `source-${source.type}-index`, `${source.type}-index.json`, limits.indexBytes)
      if (!index.data) { evidence.gaps.push({ reason: 'source-index-unavailable', url: sourceIndexUrl }); continue }
      if (!index.localHintsOnly) {
        const facts = indexFacts(index.data)
        evidence.sources.push({ ...facts, url: sourceIndexUrl, manifestRevision: sourceManifest.data?.revision, manifest: sourceManifest.data, description: sourceDescription.data, revisionMatchesTop: index.data.revision === top.data.revision, safeFetchReceived: Boolean(index.safe), sameDigestAcrossLanes: index.sameDigest, indexBytes: index.available.bytes.length, indexChecksumMatches: sourceDescription.data?.indexChecksum?.sha256 === index.available.request.sha256, productDefaultByteLimit: 8 * 1024 * 1024, exceedsProductDefaultByteLimit: index.available.bytes.length > 8 * 1024 * 1024 })
      }
      for (const selected of selectedEntries(index.data)) {
        if (!selected.entry.path) continue
        const url = indexedUrl(selected.entry.path, base)
        const recordResult = await jsonPair(url, 'complete-published-record', `${source.type}-record-${evidence.records.length + 1}.json`)
        if (!recordResult.data) continue
        const record = recordResult.data
        const declaredDigest = selected.entry.checksum?.sha256
        evidence.records.push({ sourceType: source.type, name: selected.name, url, sourceRevision: index.data.revision, recordRevision: selected.entry.recordRevision, receivedSha256: recordResult.available.request.sha256, indexDeclaredSha256: declaredDigest, checksumMatches: declaredDigest ? declaredDigest === recordResult.available.request.sha256 : null, safeFetchReceived: Boolean(recordResult.safe), sameDigestAcrossLanes: recordResult.sameDigest, id: record.id, version: record.version, versionsDeclared: selected.entry.versions, licenseDeclaration: record.license, targets: record.targets, distributions: record.distributions, media: record.media, indexMedia: selected.entry.media, links: record.links, lifecycle: record.lifecycle, metadata: record._meta })
        console.log(JSON.stringify({ record: selected.name, version: record.version, media: mediaReferences(record.media).length, targets: record.targets, distributions: record.distributions?.length }))
      }
    }
    const images = evidence.records.flatMap(record => mediaReferences(record.media).map(image => ({ ...image, package: record.name, recordUrl: record.url })))
    const imageUrls = new Set()
    for (const image of images) {
      if (imageUrls.has(image.url) || imageUrls.size >= limits.images) continue
      imageUrls.add(image.url)
      const result = await pair(image.url, 'declared-published-media', limits.imageBytes)
      evidence.media.push({ ...image, ordinary: result.ordinary?.request, safe: result.safe?.request, sameDigestAcrossLanes: result.sameDigest, firstBytesHex: result.available?.bytes.subarray(0, 24).toString('hex'), bodySaved: false, visuallyDecoded: false, rightsVerified: false })
    }
    if (!images.length) evidence.gaps.push({ reason: 'no-media-in-bounded-published-record-sample', sampledRecords: evidence.records.length })
    const candidates = evidence.records.flatMap(record => (record.distributions ?? []).map(distribution => ({ record: record.name, version: record.version, license: record.licenseDeclaration, distribution })))
    const artifacts = candidates.filter(candidate => candidate.distribution.url && /\.(tgz|tar\.gz|zip)(\?|$)/i.test(candidate.distribution.url)).slice(0, limits.artifacts)
    for (const candidate of artifacts) {
      const result = await pair(candidate.distribution.url, 'declared-artifact', limits.artifactBytes)
      const expected = candidate.distribution.checksum?.sha256 ?? candidate.distribution.integrity?.sha256
      evidence.artifacts.push({ ...candidate, ordinary: result.ordinary?.request, safe: result.safe?.request, actualSha256: result.available?.request.sha256, declaredSha256: expected, checksumMatches: expected && result.available ? expected === result.available.request.sha256 : null, archiveFirstBytesHex: result.available?.bytes.subarray(0, 8).toString('hex'), installed: false, executed: false, legalAuthorizationVerified: false })
    }
    if (!artifacts.length) evidence.gaps.push({ reason: 'no-direct-declared-archive-in-bounded-sample', note: 'repository/npm/listing identity is not a verified legal install artifact' })
    const readmeRecord = evidence.records.find(record => typeof record.links?.readme === 'string' && record.links.readme.startsWith('https://'))
    if (readmeRecord && !directHints) evidence.readme = { package: readmeRecord.name, ...(await pair(readmeRecord.links.readme, 'declared-readme')).available?.request }
    for (const branch of ['main', 'packages']) {
      const result = await jsonPair(`https://api.github.com/repos/metaone01/agent-forge/branches/${branch}`, `current-branch-${branch}`, `branch-${branch}.json`)
      evidence.references[branch] = { observedSha: result.data?.commit?.sha ?? null, historicalSha: historicalRefs[branch], liveVerified: Boolean(result.data?.commit?.sha), url: `https://github.com/metaone01/agent-forge/tree/${branch}` }
    }
    evidence.releaseHistory = (await jsonPair('https://api.github.com/repos/metaone01/agent-forge/releases?per_page=3', 'published-release-history', 'releases.json')).data
    for (const source of evidence.sources) if (source.multiVersionEntries === 0) evidence.gaps.push({ reason: 'source-index-has-no-multiple-version-declarations', sourceId: source.sourceId, packageCount: source.packageCount })
  } catch (error) { evidence.gaps.push({ reason: 'bounded-audit-stopped', error: errorFacts(error) }) }
  evidence.finishedAt = new Date().toISOString()
  evidence.requestReservations = reservations
  evidence.securityModule.sha256After = sha256(await readFile(securityPath))
  evidence.securityModule.unchangedDuringAudit = evidence.securityModule.sha256Before === evidence.securityModule.sha256After
  evidence.acceptance = { officialDesktopStarted: false, profileWritten: false, installed: false, fullHistoryVerified: false, sourceConfigApplied: false, coreOrClientModified: false }
  await persist('audit.json', evidence)
  await persist('evidence-summary.json', { output, auditSha256: sha256(await readFile(resolve(output, 'audit.json'))), startedAt, finishedAt: evidence.finishedAt, manifest: evidence.manifest, sourceCount: evidence.sources.length, records: evidence.records.length, mediaProbed: evidence.media.length, artifactsProbed: evidence.artifacts.length, references: evidence.references, gaps: evidence.gaps, requests: evidence.requests.length, bytesRead: evidence.bytesRead })
  console.log(JSON.stringify({ output, manifest: evidence.manifest, sources: evidence.sources.map(source => ({ sourceId: source.sourceId, packages: source.packageCount, media: source.mediaEntries, multiversion: source.multiVersionEntries })), records: evidence.records.length, media: evidence.media.length, artifacts: evidence.artifacts.length, references: evidence.references, gaps: evidence.gaps, bytes: evidence.bytesRead }))
}

async function followUp(input, artifactsOnly = false) {
  const inputPath = resolve(input)
  const inputRelative = relative(outputRoot, inputPath)
  if (inputRelative.startsWith('..') || isAbsolute(inputRelative) || !inputRelative) throw new Error('audit/input-outside-owned-evidence')
  if ((await stat(inputPath)).size > limits.indexBytes) throw new Error('audit/input-size-limit')
  const previousBytes = await readFile(inputPath)
  const previous = JSON.parse(previousBytes.toString('utf8'))
  const packagesSha = artifactsOnly ? previous.input?.packagesSha : previous.references?.packages?.observedSha
  if ((!artifactsOnly && !previous.references?.packages?.liveVerified) || !/^[a-f0-9]{40}$/.test(packagesSha ?? '')) throw new Error('audit/missing-live-verified-packages-sha')
  const startedAt = new Date().toISOString()
  const output = resolve(outputRoot, startedAt.replace(/[:.]/g, '-') + (artifactsOnly ? '-artifacts' : '-follow-up'))
  await mkdir(output, { recursive: true })
  const wallSignal = AbortSignal.timeout(160000)
  const facts = { startedAt, output, input: { path: inputPath, sha256: sha256(previousBytes), referenceObservedIn: previous.startedAt, packagesSha }, limits: { wallMs: 160000, attemptMs: 10000, attempts: 2, probeAttempts: 32, transportRequestsUpperBound: 128, perResponseBytes: 1024 * 1024, totalBytes: 8 * 1024 * 1024, maxRedirects: 3 }, requests: [], dns: [], documents: [], bytesRead: 0, profileWritten: false, installed: false }
  const hosts = new Set()
  async function document(url, purpose, lane) {
    publicHttps(url)
    if (!hosts.has(new URL(url).hostname)) {
      hosts.add(new URL(url).hostname)
      const signal = AbortSignal.any([wallSignal, AbortSignal.timeout(5000)])
      const dns = { host: new URL(url).hostname }
      try { dns.addresses = await withAbort(lookup(dns.host, { all: true }), signal) } catch (error) { dns.lookupError = errorFacts(error) }
      try { await withAbort(assertSafeRemoteUrl(url), signal); dns.gate = 'allowed' } catch (error) { dns.gateError = errorFacts(error) }
      facts.dns.push(dns)
    }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      wallSignal.throwIfAborted()
      if (facts.requests.length >= facts.limits.probeAttempts) throw new Error('audit/request-budget')
      const request = { url, purpose, lane, attempt, observedAt: new Date().toISOString() }
      facts.requests.push(request)
      const began = Date.now()
      try {
        const signal = AbortSignal.any([wallSignal, AbortSignal.timeout(10000)])
        let response
        if (lane === 'safeFetch') response = await safeFetch(url, { headers, signal, timeoutMs: 10000, maxRedirects: facts.limits.maxRedirects })
        else {
          let current = publicHttps(url)
          request.hops = []
          for (let hop = 0; hop <= facts.limits.maxRedirects; hop += 1) {
            response = await fetch(current, { headers, signal, redirect: 'manual' })
            request.hops.push({ hostname: current.hostname, status: response.status })
            if (![301, 302, 303, 307, 308].includes(response.status)) break
            await response.body?.cancel()
            if (hop === facts.limits.maxRedirects || !response.headers.get('location')) throw new Error('audit/redirect-budget-or-missing-location')
            current = publicHttps(new URL(response.headers.get('location'), current))
          }
        }
        request.actualHost = response.url ? new URL(response.url).hostname : new URL(url).hostname
        request.status = response.status
        request.contentLength = response.headers.get('content-length')
        request.contentType = response.headers.get('content-type')
        if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`audit/http-${response.status}`), { status: response.status }) }
        if (purpose === 'real-Core-default-size-gate') {
          await readLimitedResponse(response, 8 * 1024 * 1024, signal)
          throw new Error('audit/unexpected-Core-size-pass')
        }
        const bytes = await limitedBody(response, 1024 * 1024, signal, size => { facts.bytesRead += size; if (facts.bytesRead > facts.limits.totalBytes) throw new Error('audit/total-byte-budget') })
        Object.assign(request, { bytes: bytes.length, sha256: sha256(bytes), result: 'received', elapsedMs: Date.now() - began })
        return { request, bytes }
      } catch (error) {
        Object.assign(request, { result: 'blocked', error: errorFacts(error), elapsedMs: Date.now() - began })
        if (purpose === 'real-Core-default-size-gate' || !retryableError(error) || attempt === 2 || wallSignal.aborted) return undefined
      }
    }
  }
  try {
    if (!artifactsOnly) await document('https://metaone01.github.io/agent-forge/data/dsh/plugin/index.json', 'real-Core-default-size-gate', 'safeFetch')
    const folder = 'sources/plugin/packages/0928OYX--dsh-free-skins--skin-gallery--9fce7ab402ff'
    const publicationJobs = [
      { purpose: 'pinned-canonical-record', url: `https://raw.githubusercontent.com/metaone01/agent-forge/${packagesSha}/${folder}/unversioned--d01383c373dd.json`, json: true },
      { purpose: 'pinned-canonical-version-directory', url: `https://api.github.com/repos/metaone01/agent-forge/contents/${folder}?ref=${packagesSha}`, json: true },
      { purpose: 'pinned-upstream-package-metadata', url: 'https://raw.githubusercontent.com/0928OYX/dsh-free-skins/60bed2182f79e7a62d89d770d5461e3da981547b/skin-gallery/package.json', json: true },
      { purpose: 'pinned-upstream-readme', url: 'https://raw.githubusercontent.com/0928OYX/dsh-free-skins/60bed2182f79e7a62d89d770d5461e3da981547b/README.md', json: false },
      { purpose: 'upstream-release-history-bounded', url: 'https://api.github.com/repos/0928OYX/dsh-free-skins/releases?per_page=3', json: true },
      { purpose: 'upstream-tag-history-bounded', url: 'https://api.github.com/repos/0928OYX/dsh-free-skins/tags?per_page=5', json: true },
      { purpose: 'upstream-license-metadata', url: 'https://api.github.com/repos/0928OYX/dsh-free-skins', json: true },
    ]
    const releaseAssets = (previous.documents?.find(document => document.purpose === 'upstream-release-history-bounded')?.data ?? []).flatMap(release => (release.assets ?? []).map(asset => ({ purpose: 'declared-upstream-release-asset', url: asset.browser_download_url, binary: true, tag: release.tag_name, declaredDigest: asset.digest, declaredSize: asset.size }))).slice(0, 2)
    const jobs = artifactsOnly ? [
      { purpose: 'pinned-upstream-license-text', url: 'https://raw.githubusercontent.com/0928OYX/dsh-free-skins/60bed2182f79e7a62d89d770d5461e3da981547b/LICENSE', json: false },
      { purpose: 'pinned-upstream-notice-text', url: 'https://raw.githubusercontent.com/0928OYX/dsh-free-skins/60bed2182f79e7a62d89d770d5461e3da981547b/NOTICE', json: false },
      ...releaseAssets,
    ] : publicationJobs
    for (const job of jobs) {
      const ordinary = await document(job.url, job.purpose, 'ordinaryHttps')
      const safe = await document(job.url, job.purpose, 'safeFetch')
      const available = safe ?? ordinary
      const entry = { purpose: job.purpose, url: job.url, safeReceived: Boolean(safe), ordinaryReceived: Boolean(ordinary), sameDigestAcrossLanes: safe && ordinary ? safe.request.sha256 === ordinary.request.sha256 : null }
      if (available) {
        entry.sha256 = available.request.sha256
        if (job.binary) Object.assign(entry, { tag: job.tag, declaredDigest: job.declaredDigest, declaredSize: job.declaredSize, actualSize: available.bytes.length, checksumMatches: job.declaredDigest === `sha256:${entry.sha256}`, sizeMatches: job.declaredSize === available.bytes.length, firstBytesHex: available.bytes.subarray(0, 24).toString('hex'), bodySaved: false, archiveStructureVerified: false, installed: false, executed: false })
        else if (job.json) entry.data = JSON.parse(available.bytes.toString('utf8'))
        else entry.text = available.bytes.toString('utf8')
      }
      if (job.binary && !available) Object.assign(entry, { tag: job.tag, declaredDigest: job.declaredDigest, declaredSize: job.declaredSize, installed: false, executed: false })
      facts.documents.push(entry)
    }
  } catch (error) { facts.stopped = errorFacts(error) }
  facts.finishedAt = new Date().toISOString()
  await writeFile(resolve(output, 'follow-up.json'), JSON.stringify(facts, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output, requests: facts.requests.length, bytesRead: facts.bytesRead, coreGate: facts.requests.find(request => request.purpose === 'real-Core-default-size-gate'), documents: facts.documents.map(document => ({ purpose: document.purpose, safeReceived: document.safeReceived })), stopped: facts.stopped }))
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) await selfTest()
  else if (process.argv.length === 3 && process.argv[2] === '--direct-hints') await audit(true)
  else if (process.argv.length === 4 && process.argv[2] === '--follow-up') await followUp(process.argv[3])
  else if (process.argv.length === 4 && process.argv[2] === '--artifacts') await followUp(process.argv[3], true)
  else if (process.argv.length === 2) await audit()
  else throw new Error('Usage: node tools/desktop-acceptance/source-audit-20261005.mjs [--self-test|--direct-hints|--follow-up <owned audit.json>|--artifacts <owned follow-up.json>]')
}
