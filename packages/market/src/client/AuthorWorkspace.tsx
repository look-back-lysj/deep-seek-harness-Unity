import { useEffect, useRef, useState } from 'react'
import type { AuthorDraft, AuthorDraftInput, ReadmePreviewView } from '../types.ts'
import { boundedRequest } from './data-controller.ts'
import type { MarketRemote } from './model.ts'
import { decodeBase64, readTransfer, saveBytes, sha256Hex, uploadBytes } from './transfer.ts'
import { Button, Input, MarkdownText, Modal } from './ui.tsx'
import { ActionFeedback } from './action-feedback.tsx'
import { completedActionFeedback, failedActionFeedback, idleActionFeedback, preparingActionFeedback, runningActionFeedback, type ActionFeedbackState } from './action-state.ts'
import type { ExtensionDraftChange, ExtensionDraftRef } from './extensions/contract.ts'

const blank = (): AuthorDraftInput => ({ title: '', summary: '', markdown: '', mediaIds: [] })
export function draftInput(draft: AuthorDraft): AuthorDraftInput {
  const { revision, updatedAt, ...content } = draft
  void updatedAt
  return { ...content, expectedRevision: revision }
}
type Candidate = { content: AuthorDraftInput; warnings: readonly string[]; readme?: ReadmePreviewView }

/** Local editing has no fallback storage with a fake saved status. A revision from
 * the Host is the sole authority for saved/overwritten state. */
export function AuthorWorkspace({ remote, supplemental, onDraftSnapshot, onDirtyChange, draftChange }: { remote: MarketRemote; supplemental?: React.ReactNode; onDraftSnapshot?: ((draft: ExtensionDraftRef | undefined) => void) | undefined; onDirtyChange?: ((dirty: boolean) => void) | undefined; draftChange?: ExtensionDraftChange | undefined }): React.JSX.Element {
  const [drafts, setDrafts] = useState<readonly AuthorDraft[]>([])
  const [saved, setSaved] = useState<AuthorDraft>()
  const [form, setForm] = useState<AuthorDraftInput>(blank)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [feedback, setFeedback] = useState<ActionFeedbackState>(idleActionFeedback())
  const [notice, setNotice] = useState('')
  const [repo, setRepo] = useState('')
  const [candidate, setCandidate] = useState<Candidate>()
  const [switchTo, setSwitchTo] = useState<string>()
  const [media, setMedia] = useState<Readonly<Record<string, string>>>({})
  const generation = useRef(0)
  const lock = useRef(false)
  const retryRef = useRef<{ readonly label: string; readonly action: () => Promise<void> }>()

  async function currentRequest<T>(request: Promise<T>, label: string, timeoutMs?: number): Promise<T> {
    const token = generation.current
    const result = await boundedRequest(request, label, timeoutMs)
    if (token !== generation.current) throw new Error('草稿请求已失效，请重新读取。')
    return result
  }

  useEffect(() => { onDraftSnapshot?.(saved ? { id: saved.id, revision: saved.revision, title: saved.title, summary: saved.summary, markdown: saved.markdown } : undefined) }, [saved, onDraftSnapshot])
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!draftChange) return
    if (!saved || draftChange.draftId !== saved.id || draftChange.expectedRevision !== saved.revision) { setNotice('扩展建议引用的草稿已变化，请重新读取。'); return }
    setCandidate({ content: { ...form, ...(draftChange.title === undefined ? {} : { title: draftChange.title }), ...(draftChange.summary === undefined ? {} : { summary: draftChange.summary }), ...(draftChange.markdown === undefined ? {} : { markdown: draftChange.markdown }) }, warnings: ['这是扩展建议，尚未保存。'] })
    // Each new request is a deliberate preview; form edits do not automatically reapply it.
  }, [draftChange])

  useEffect(() => {
    const token = ++generation.current
    setSaved(undefined); setForm(blank()); setDirty(false); setCandidate(undefined); setBusy(''); setFeedback(idleActionFeedback()); retryRef.current = undefined; lock.current = false
    if (remote.listDrafts) void boundedRequest(remote.listDrafts(), '读取草稿列表').then((list) => { if (token === generation.current) setDrafts(list) }).catch((error: unknown) => { if (token === generation.current) setNotice(String(error instanceof Error ? error.message : error)) })
    return () => { generation.current += 1 }
  }, [remote])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent): void => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  useEffect(() => {
    let disposed = false
    const urls: string[] = []
    setMedia({})
    if (saved && remote.readMedia) void (async () => {
      const resolved: Record<string, string> = {}
      for (const mediaId of saved.mediaIds) {
        if (disposed) break
        try {
          const result = await boundedRequest(remote.readMedia!({ draftId: saved.id, mediaId }), '读取草稿图片')
          if (disposed) break
          if (result.id !== mediaId || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(result.mediaType) || result.data.length > 16 * 1024 * 1024) throw new Error('图片身份、类型或大小不正确。')
          const bytes = decodeBase64(result.data)
          if (`sha256:${await sha256Hex(bytes)}` !== result.sha256) throw new Error('图片校验失败。')
          if (disposed) break
          const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: result.mediaType }))
          urls.push(url); resolved[mediaId] = url; setMedia({ ...resolved })
        } catch (error) { if (!disposed) setNotice(`部分图片未能读取：${error instanceof Error ? error.message : String(error)}`) }
      }
    })()
    return () => { disposed = true; urls.forEach((url) => URL.revokeObjectURL(url)) }
  }, [saved, remote])

  function adopt(draft: AuthorDraft): void {
    setSaved(draft); setForm(draftInput(draft)); setDirty(false)
    setDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)])
  }
  async function run(label: string, action: () => Promise<void>, successMessage?: string): Promise<void> {
    if (lock.current) return
    lock.current = true; retryRef.current = { label, action }; setBusy(label); setNotice(''); setFeedback(preparingActionFeedback(label))
    const token = generation.current
    await Promise.resolve()
    if (token === generation.current) setFeedback(runningActionFeedback(label))
    try {
      await action()
      if (token === generation.current) setFeedback(completedActionFeedback(label, successMessage ?? `${label}已完成。`, '后台版本是保存状态的唯一依据；如需继续编辑，请先确认当前草稿版本。'))
    } catch (error) {
      if (token === generation.current) {
        const message = error instanceof Error ? error.message : String(error)
        setNotice(message)
        setFeedback(failedActionFeedback(label, error, '保留当前编辑，确认宿主状态后再重试；失败不会伪造为已保存。'))
      }
    } finally { if (token === generation.current) { lock.current = false; setBusy('') } }
  }
  async function save(): Promise<AuthorDraft> {
    if (!remote.saveDraft) throw new Error('当前宿主不能保存作者草稿。')
    const { id: unusedId, expectedRevision: unusedRevision, ...content } = form
    void unusedId; void unusedRevision
    const input = saved ? { ...content, id: saved.id, expectedRevision: saved.revision } : content
    const result = await currentRequest(remote.saveDraft(input), '保存草稿')
    adopt(result)
    return result
  }
  async function open(id: string): Promise<void> {
    if (id === 'new') { setSaved(undefined); setForm(blank()); setDirty(false); setNotice(''); return }
    if (!remote.getDraft) throw new Error('当前宿主不能重开草稿。')
    adopt(await currentRequest(remote.getDraft(id), '重开草稿'))
    setNotice('已读取后台保存的草稿。')
  }
  function choose(id: string): void { if (dirty) setSwitchTo(id); else void run('读取草稿', () => open(id)) }
  function edit(patch: Partial<AuthorDraftInput>): void { setForm((current) => ({ ...current, ...patch })); setDirty(true) }
  async function previewReadme(): Promise<void> {
    if (!remote.previewReadme || !remote.applyReadmePreview) throw new Error('当前宿主尚未提供 README 差异预览，请先使用本地 Markdown 导入。')
    const readme = await currentRequest(remote.previewReadme({ repositoryUrl: repo.trim(), ...(saved ? { targetDraftId: saved.id, expectedRevision: saved.revision } : {}) }), 'README 预览', 45_000)
    setCandidate({ content: readme.candidate, warnings: readme.mediaWarnings, readme })
  }
  async function applyCandidate(): Promise<void> {
    if (!candidate || !remote.saveDraft) return
    let result: AuthorDraft
    if (candidate.readme) {
      if (!remote.applyReadmePreview) throw new Error('当前宿主不能确认 README 预览。')
      const applied = await currentRequest(remote.applyReadmePreview({ previewId: candidate.readme.previewId, ...(candidate.readme.before ? { expectedRevision: candidate.readme.before.revision } : {}) }), '确认 README 差异')
      result = applied.draft
    } else {
      result = await currentRequest(remote.saveDraft({ ...candidate.content, ...(saved ? { id: saved.id, expectedRevision: saved.revision } : {}) }), '确认覆盖草稿')
    }
    adopt(result); setCandidate(undefined); setNotice('差异已确认并保存。来源和提交信息已保留。')
  }
  async function exportZip(): Promise<void> {
    if (!remote.exportDraft) throw new Error('当前宿主不能导出介绍 ZIP。')
    const draft = dirty || !saved ? await save() : saved
    const transfer = await currentRequest(remote.exportDraft({ draftId: draft.id }), '生成资料 ZIP')
    const bytes = await currentRequest(readTransfer(remote, transfer), '读取介绍 ZIP', 120_000)
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw new Error('后台未返回 ZIP 文件，已阻止下载。')
    saveBytes(bytes, `${draft.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 90) || '插件介绍'}.eac-market-presentation.zip`, 'application/zip')
    setNotice('介绍 ZIP 已交给浏览器下载，包含正文、来源和已保存媒体。下载不代表已上架。')
  }
  async function upload(file: File, purpose: 'draft-media' | 'author-import'): Promise<void> {
    if (file.size > (purpose === 'draft-media' ? 8 : 32) * 1024 * 1024) throw new Error('文件过大，请缩小后重试。')
    const target = purpose === 'draft-media' ? (dirty || !saved ? await save() : saved) : undefined
    const result = await currentRequest(uploadBytes(remote, new Uint8Array(await file.arrayBuffer()), {
      purpose, filename: file.name, mediaType: purpose === 'author-import' ? 'application/zip' : file.type,
      ...(target ? { targetId: target.id, expectedRevision: target.revision } : {}),
    }), '上传文件', 120_000)
    if (!result.resultId) throw new Error('后台没有返回完成对象，请重新读取草稿核对。')
    if (purpose === 'draft-media') {
      if (!remote.getDraft || !target) throw new Error('上传后无法核对草稿。')
      adopt(await currentRequest(remote.getDraft(target.id), '核对已上传图片'))
      setNotice('图片已保存。可点击图片下方按钮插入正文。')
    } else {
      if (!remote.getDraft) throw new Error('资料 ZIP 已导入，但当前宿主无法重开，请刷新草稿列表。')
      const imported = await currentRequest(remote.getDraft(result.resultId), '读取导入草稿')
      setDrafts((list) => [imported, ...list.filter((item) => item.id !== imported.id)])
      if (dirty) { setNotice('资料 ZIP 已作为独立草稿导入，当前未保存正文已保留。'); return }
      adopt(imported); setNotice('介绍 ZIP 已导入并重新读取。')
    }
  }
  return <section aria-label="作者草稿工作区">
    <header className="eac-market__page-head"><div><h1>作者工具</h1><p>编辑介绍并导出资料 ZIP，交给团队接收。</p></div><span role="status">{dirty ? '有未保存修改' : saved ? '已保存' : '新草稿'}</span></header>
    <div className="eac-market__author-layout">
      <aside aria-label="已保存草稿"><Button variant="outline" disabled={!!busy} onClick={() => choose('new')}>新建草稿</Button>
        <ul className="eac-market__draft-list">{drafts.map((item) => <li key={item.id}><button type="button" disabled={!!busy || !remote.getDraft} aria-current={saved?.id === item.id ? 'true' : undefined} onClick={() => choose(item.id)}>{item.title || '未命名草稿'}<small>{new Date(item.updatedAt).toLocaleString('zh-CN')}</small></button></li>)}</ul>
        {drafts.length === 0 && <p>还没有保存的草稿。</p>}
      </aside>
      <div className="eac-market__form">
        <div className="eac-market__button-row"><Button variant="primary" disabled={!!busy || !remote.saveDraft} onClick={() => void run('保存', async () => { await save(); setNotice('草稿已保存在当前 DSH 环境。') })}>保存草稿</Button><Button variant="outline" disabled={!!busy || !remote.exportDraft || !remote.transferRead} onClick={() => void run('导出', exportZip)}>保存并导出介绍 ZIP</Button></div>
        <div className="eac-market__field"><label htmlFor="author-zip">导入介绍 ZIP</label><input id="author-zip" type="file" accept=".zip,application/zip" disabled={!!busy || !remote.transferBegin} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void run('导入资料', () => upload(file, 'author-import')) }} /><small>这里只接收市场介绍资料，不接收可执行插件安装包。</small></div>
        <div className="eac-market__split"><div className="eac-market__form">
          <div className="eac-market__field"><label htmlFor="draft-title">标题</label><Input id="draft-title" value={form.title} disabled={!!busy} onChange={(event) => edit({ title: event.currentTarget.value })} /></div>
          <div className="eac-market__field"><label htmlFor="draft-summary">一句话简介</label><Input id="draft-summary" value={form.summary} disabled={!!busy} onChange={(event) => edit({ summary: event.currentTarget.value })} /></div>
          <div className="eac-market__field"><label htmlFor="draft-markdown">正文</label><textarea id="draft-markdown" value={form.markdown} disabled={!!busy} onChange={(event) => edit({ markdown: event.currentTarget.value })} /></div>
          <div className="eac-market__field"><label htmlFor="draft-image">上传图片</label><input id="draft-image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={!!busy || !remote.transferBegin} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void run('上传图片', () => upload(file, 'draft-media')) }} /></div>
          {form.mediaIds.length > 0 && <ul className="eac-market__media-list">{form.mediaIds.map((id) => <li key={id}>{media[id] && <img src={media[id]} alt="已保存的草稿图片" />}<span>{id}</span><Button disabled={!!busy} onClick={() => edit({ markdown: `${form.markdown}\n\n![图片说明](media://${id})\n` })}>插入正文</Button></li>)}</ul>}
          <div className="eac-market__field"><label htmlFor="repo-url">GitHub README 地址</label><Input id="repo-url" value={repo} disabled={!!busy} placeholder="https://github.com/owner/repository" onChange={(event) => setRepo(event.currentTarget.value)} /><Button variant="outline" disabled={!!busy || !remote.previewReadme || !remote.applyReadmePreview || !repo.trim()} onClick={() => void run('读取 README', previewReadme)}>读取并预览差异</Button>{(!remote.previewReadme || !remote.applyReadmePreview) && <small>当前宿主尚未提供 README 预览，可先导入本地 Markdown。</small>}</div>
          <div className="eac-market__field"><label htmlFor="local-markdown">导入本地 Markdown</label><input id="local-markdown" type="file" accept=".md,text/markdown" disabled={!!busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void run('读取正文', async () => { if (file.size > 512 * 1024) throw new Error('正文超过 512 KiB。'); setCandidate({ content: { ...form, markdown: await file.text() }, warnings: [] }) }) }} /></div>
        </div><section><h2>阅读预览</h2><div className="eac-market__preview eac-market__prose"><h3>{form.title || '未命名介绍'}</h3><p>{form.summary}</p><MarkdownText text={form.markdown} labels={{}} mediaUrls={media} /></div></section></div>
        <ActionFeedback state={feedback} onRetry={() => { const retry = retryRef.current; if (retry) void run(retry.label, retry.action) }} onDismiss={() => { setFeedback(idleActionFeedback()); setNotice('') }} />
        {notice && feedback.status === 'idle' && <div className="eac-market__notice" role="status">{notice}</div>}
      </div>
    </div>
    {supplemental}
    <Modal open={candidate !== undefined} onClose={() => { if (!busy) setCandidate(undefined) }} title="确认正文差异" closeLabel="取消导入">
      <p>确认后保存到当前草稿。若其他窗口已修改草稿，后台会拒绝覆盖并保留你的编辑。</p>
      <div className="eac-market__split"><section><h3>当前内容</h3><p>标题：{form.title} · 简介：{form.summary}</p><pre className="eac-market__diff">{form.markdown || '（空）'}</pre></section><section><h3>导入内容</h3><p>标题：{candidate?.content.title} · 简介：{candidate?.content.summary}</p><pre className="eac-market__diff">{candidate?.content.markdown}</pre></section></div>
      {candidate?.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      <p role="status">{notice}</p><Button variant="primary" disabled={!!busy || !remote.saveDraft} onClick={() => void run('保存差异', applyCandidate)}>确认差异并保存</Button>
    </Modal>
    <Modal open={switchTo !== undefined} onClose={() => setSwitchTo(undefined)} title="当前草稿尚未保存" closeLabel="继续编辑"><p>切换会丢弃当前未保存修改。</p><Button variant="outline" onClick={() => setSwitchTo(undefined)}>继续编辑</Button><Button variant="primary" onClick={() => { const id = switchTo; setSwitchTo(undefined); if (id) void run('切换草稿', () => open(id)) }}>放弃修改并切换</Button></Modal>
  </section>
}
