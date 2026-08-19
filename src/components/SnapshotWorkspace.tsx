import { useDeferredValue, useMemo } from 'react'
import { compareSnapshots, summarizeSnapshotRecord, type SnapshotDiff, type SnapshotModifiedRecord } from '../snapshot'
import type { MemoryRecord, MemoryRevision, MemorySnapshot } from '../types'
import { Icon } from './Icon'

type DiffStatus = 'added' | 'deleted' | 'modified' | 'unchanged'
type DiffRow = { key: string; status: DiffStatus; before?: MemoryRecord; after?: MemoryRecord; modified?: SnapshotModifiedRecord }
const statusLabel: Record<DiffStatus, string> = { added: '新增', deleted: '删除', modified: '修改', unchanged: '未变化' }
const fieldLabels: Record<string, string> = { id: '记录 ID', type: '类型', title: '标题', content: '内容', scope: '作用域', 'source.uri': '来源 URI', 'source.revision': '来源版本', 'source.locator': '来源位置', 'source.platform': '平台', observedAt: '观察时间', expiresAt: '失效时间', confidence: '置信度', sensitivity: '敏感级别', tags: '标签' }

const rowsFromDiff = (diff: SnapshotDiff): DiffRow[] => [
  ...diff.modified.map((entry) => ({ key: `modified:${entry.after.id}`, status: 'modified' as const, before: entry.before, after: entry.after, modified: entry })),
  ...diff.added.map((entry) => ({ key: `added:${entry.after.id}`, status: 'added' as const, after: entry.after })),
  ...diff.deleted.map((entry) => ({ key: `deleted:${entry.before.id}`, status: 'deleted' as const, before: entry.before })),
  ...diff.unchanged.map((entry) => ({ key: `unchanged:${entry.after.id}`, status: 'unchanged' as const, before: entry.before, after: entry.after })),
]

const resolveOriginal = (snapshot: MemorySnapshot | undefined, safeRecord: MemoryRecord | undefined) => {
  if (!snapshot || !safeRecord) return safeRecord
  if (safeRecord.sensitivity !== 'secret') return snapshot.records.find((record) => record.id === safeRecord.id) ?? safeRecord
  return snapshot.records.find((record) => summarizeSnapshotRecord(record).id === safeRecord.id) ?? safeRecord
}

export function SnapshotWorkspace({ snapshots, beforeId, afterId, selectedKey, search, revisions, manualCleanupIds, onBefore, onAfter, onSwap, onSelect, onSearch, onAdopt, onEdit, onAddCleanup }: {
  snapshots: MemorySnapshot[]
  beforeId: string
  afterId: string
  selectedKey: string
  search: string
  revisions: MemoryRevision[]
  manualCleanupIds: string[]
  onBefore: (id: string) => void
  onAfter: (id: string) => void
  onSwap: () => void
  onSelect: (key: string) => void
  onSearch: (search: string) => void
  onAdopt: (record: MemoryRecord, previous?: MemoryRecord) => void
  onEdit: (record: MemoryRecord) => void
  onAddCleanup: (recordId: string) => void
}) {
  const before = snapshots.find((snapshot) => snapshot.id === beforeId)
  const after = snapshots.find((snapshot) => snapshot.id === afterId)
  const diff = useMemo(() => before && after ? compareSnapshots(before, after) : compareSnapshots([], []), [before, after])
  const allRows = useMemo(() => rowsFromDiff(diff), [diff])
  const deferredSearch = useDeferredValue(search)
  const query = deferredSearch.trim().toLocaleLowerCase('zh-CN')
  const rows = useMemo(() => allRows.filter((row) => !query || `${row.after?.title} ${row.after?.content} ${row.before?.title} ${row.before?.content} ${row.after?.source?.uri} ${row.before?.source?.uri}`.toLocaleLowerCase('zh-CN').includes(query)), [allRows, query])
  const selected = allRows.find((row) => row.key === selectedKey) ?? rows[0]
  const activeRecord = selected?.after ?? selected?.before
  const actionBefore = resolveOriginal(before, selected?.before)
  const actionAfter = resolveOriginal(after, selected?.after)
  const actionRecord = actionAfter ?? actionBefore
  const history = activeRecord ? revisions.filter((revision) => revision.recordId === activeRecord.id || summarizeSnapshotRecord(revision.before).id === activeRecord.id || summarizeSnapshotRecord(revision.after).id === activeRecord.id) : []

  if (snapshots.length < 2) return <div className="workspace centered-workspace" id="workspace-compare" role="tabpanel" aria-labelledby="tab-compare"><div className="empty"><Icon name="compare" size={34} /><strong>至少需要两份快照</strong><span>每次导入都会保存一个本地快照。再导入一份内容后即可比较。</span></div></div>

  return <div className="workspace snapshot-workspace" id="workspace-compare" role="tabpanel" aria-labelledby="tab-compare">
    <aside className="workspace-sidebar diff-sidebar"><h2>差异概览</h2>{(['added', 'deleted', 'modified', 'unchanged'] as DiffStatus[]).map((status) => <div className={`diff-count ${status}`} key={status}><span>{statusLabel[status]}</span><b>{diff.summary[status]}</b></div>)}<section><h2>对比说明</h2><p>优先使用稳定 ID 匹配；若 ID 改变，则尝试以来源 URI 和位置匹配。</p></section></aside>
    <main className="diff-main">
      <div className="snapshot-toolbar"><label>较早快照<select value={beforeId} onChange={(event) => onBefore(event.target.value)}>{snapshots.map((snapshot) => <option value={snapshot.id} key={snapshot.id}>{snapshot.name}</option>)}</select></label><button className="button icon-only" onClick={onSwap} aria-label="交换快照"><Icon name="swap" /></button><label>较新快照<select value={afterId} onChange={(event) => onAfter(event.target.value)}>{snapshots.map((snapshot) => <option value={snapshot.id} key={snapshot.id}>{snapshot.name}</option>)}</select></label></div>
      <label className="search diff-search"><Icon name="search" /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索差异标题、内容或来源…" /></label>
      <div className="diff-table-head"><span>类型</span><span>标题</span><span>较早快照</span><span>变化</span><span>较新快照</span><span>来源</span></div>
      <div className="diff-list">{rows.map((row) => <button className={`diff-row ${selected?.key === row.key ? 'selected' : ''}`} key={row.key} onClick={() => onSelect(row.key)}><i className={`diff-status ${row.status}`}>{statusLabel[row.status]}</i><strong>{row.after?.title ?? row.before?.title}</strong><span>{row.before?.content ?? '—'}</span><Icon name="arrow" size={14} /><span>{row.after?.content ?? '—'}</span><small>{row.after?.source?.platform ?? row.before?.source?.platform ?? '未知来源'}</small></button>)}{!rows.length && <div className="empty"><strong>没有匹配的差异</strong><span>清除搜索条件后查看全部记录。</span></div>}</div>
    </main>
    <aside className="diff-inspector">{selected && activeRecord && actionRecord ? <><div className="inspector-heading"><span>属性差异</span><i className={`diff-status ${selected.status}`}>{statusLabel[selected.status]}</i></div><h2>{activeRecord.title}</h2>
      {selected.modified ? <div className="field-diff"><div className="field-diff-head"><span>字段</span><span>较早快照</span><span>较新快照</span></div>{selected.modified.changes.map((change) => <div key={change.field}><strong>{fieldLabels[change.field] ?? change.field}</strong><span>{Array.isArray(change.before) ? change.before.join('、') : String(change.before ?? '—')}</span><span>{Array.isArray(change.after) ? change.after.join('、') : String(change.after ?? '—')}</span></div>)}</div> : <div className="record-preview"><strong>{statusLabel[selected.status]}记录</strong><p>{activeRecord.content}</p></div>}
      <section className="diff-source"><h3>来源与观察</h3><dl><div><dt>来源 URI</dt><dd>{activeRecord.source?.uri ?? '未提供'}</dd></div><div><dt>定位器</dt><dd>{activeRecord.source?.locator ?? '未提供'}</dd></div><div><dt>观察时间</dt><dd>{activeRecord.observedAt ? new Date(activeRecord.observedAt).toLocaleString('zh-CN') : '未提供'}</dd></div></dl></section>
      <div className="diff-actions">{actionAfter && <button className="button primary" onClick={() => onAdopt(actionAfter, actionBefore)}><Icon name="check" />采用较新版本</button>}<button className="button" onClick={() => onEdit(actionRecord)}><Icon name="edit" />编辑修正</button><button className={`button danger ${manualCleanupIds.includes(actionRecord.id) ? 'active' : ''}`} onClick={() => onAddCleanup(actionRecord.id)}>{manualCleanupIds.includes(actionRecord.id) ? '已加入清单' : '加入清理清单'}</button></div>
      <section className="revision-history"><h3><Icon name="history" size={15} />修改历史（{history.length}）</h3>{history.length ? history.map((revision) => <article key={revision.id}><time>{new Date(revision.changedAt).toLocaleString('zh-CN')}</time><strong>{revision.reason}</strong><p>{revision.before.content} → {revision.after.content}</p></article>) : <p className="muted-copy">当前记录尚无本地修正历史。</p>}</section>
    </> : <div className="no-selection"><Icon name="compare" size={32} /><strong>选择一条差异</strong></div>}</aside>
  </div>
}
