import { useState } from 'react'
import type { CatalogListing } from '../types.ts'
import { normalize } from './model.ts'
import { CatalogMediaIcon, ScreenshotGallery } from './media.tsx'

export function filterListings(listings: readonly CatalogListing[], query: string): readonly CatalogListing[] {
  const needle = normalize(query)
  return listings.filter((entry) => normalize(`${entry.name} ${entry.packageName} ${entry.summary}`).includes(needle))
}

function sourceLink(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined }
  catch { return undefined }
}

/** Registration records are not installable releases. Never convert them into
 * CatalogPlugin or infer a version; retain this boundary even after searching.
 */
export function PendingListings({ listings, query }: { readonly listings: readonly CatalogListing[]; readonly query: string }): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  if (listings.length === 0) return null
  const matches = filterListings(listings, query)
  return <details className="eac-market__system-group eac-market__pending-listings" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><span>待适配与待补资料（{query.trim() ? `${matches.length} / ${listings.length}` : listings.length}）</span><span className="eac-market__group-action">查看登记清单</span></summary>
    <p className="eac-market__system-note">这些项目只有收录登记，尚缺可核对的包资料。可搜索名称、说明或包名；补齐并核验前不提供安装。</p>
    {matches.length === 0 ? <p>没有匹配的登记项目，可以更换关键词或清除搜索。</p> : <ul className="eac-market__pending-list">
      {matches.map((entry) => {
        const href = sourceLink(entry.sourceUrl)
        return <li key={entry.id} className="eac-market__setting">
          <div><div className="eac-market__plugin-top"><CatalogMediaIcon name={entry.name} media={expanded ? entry.media?.icon : undefined} /><h3>{entry.name}</h3></div><p>{entry.summary}</p><p>{entry.packageName}</p><p>待补原因：{entry.reason || '登记中尚未说明'}</p>
            {entry.requestedVersion && <p>申请版本：{entry.requestedVersion}（未核实）</p>}
            {expanded && <ScreenshotGallery screenshots={entry.media?.previews ?? []} title="上游声明预览" />}
          </div>
          {href ? <a href={href} target="_blank" rel="noreferrer">查看来源</a> : <span>来源链接待补充</span>}
        </li>
      })}
    </ul>}
  </details>
}
