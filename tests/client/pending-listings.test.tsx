import { describe, expect, it } from 'vitest'
import { PendingListings, filterListings } from '../../packages/market/src/client/PendingListings.tsx'
import type { CatalogListing } from '../../packages/market/src/types.ts'

const react = await import(new URL('../../packages/market/node_modules/react/index.js', import.meta.url).href)
const server = await import(new URL('../../packages/market/node_modules/react-dom/server.node.js', import.meta.url).href)
const entries: CatalogListing[] = [{ id: 'only-registration', name: '语音整理', packageName: '@test/pending', summary: '整理会议记录', reason: '缺少原始包元数据', sourceUrl: 'https://example.invalid/source' }]

describe('registration-only catalog listings', () => {
  it('searches names, descriptions and packages without synthesizing a release', () => {
    expect(filterListings(entries, '会议')).toEqual(entries)
    expect(filterListings(entries, '  @TEST/PENDING ')).toEqual(entries)
    expect(filterListings(entries, '语音')).toEqual(entries)
    expect(filterListings(entries, 'nothing')).toEqual([])
    expect('version' in entries[0]!).toBe(false)
  })
  it('starts collapsed, preserves the reason/source, and provides no install controls', () => {
    const html = server.renderToStaticMarkup(react.createElement(PendingListings, { listings: entries, query: '' }))
    expect(html).toContain('待适配与待补资料')
    expect(html).toContain('缺少原始包元数据')
    expect(html).toContain('https://example.invalid/source')
    expect(html).not.toMatch(/<details[^>]* open/)
    expect(html).not.toContain('<button')
    expect(html).not.toContain('申请版本')
  })
  it('labels requested versions as unverified and refuses executable source links', () => {
    const html = server.renderToStaticMarkup(react.createElement(PendingListings, { listings: [{ ...entries[0]!, requestedVersion: '2.0.0', sourceUrl: 'javascript:alert(1)' }], query: '' }))
    expect(html).toContain('申请版本：2.0.0（未核实）')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('来源链接待补充')
  })
})
