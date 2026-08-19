import { useDeferredValue, useMemo, useState } from 'react'
import {
  buildMemoryTimeline,
  formatMemoryTime,
  summarizeMemoryContent,
} from '../memory-timeline'
import { redactText } from '../redaction'
import { sanitizeMemoryRecordForDisplay } from '../snapshot'
import type {
  MemoryRecord,
  MemoryRevision,
  MemorySnapshot,
  MemoryType,
  Scope,
  Sensitivity,
} from '../types'
import { Icon } from './Icon'

const sensitivityLabels: Record<Sensitivity, string> = {
  public: '公开',
  internal: '内部',
  sensitive: '敏感',
  secret: 'secret 已隐藏',
}

const typeLabels: Record<MemoryType, string> = {
  fact: '事实',
  preference: '偏好',
  'project-status': '项目状态',
  instruction: '规则/指令',
  relationship: '关系',
  sensitive: '敏感项',
}

const scopeLabels: Record<Scope, string> = {
  global: '全局',
  project: '项目',
  task: '任务',
}

const confidenceFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'percent',
  maximumFractionDigits: 0,
})

export function MemoryWorkspace({
  records,
  revisions,
  snapshots,
  importedAt,
  onEdit,
}: {
  records: MemoryRecord[]
  revisions: MemoryRevision[]
  snapshots: MemorySnapshot[]
  importedAt: string
  onEdit: (record: MemoryRecord) => void
}) {
  const [selectedId, setSelectedId] = useState(records[0]?.id ?? '')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())
  const safeRecords = useMemo(
    () => records.map((record) => ({ original: record, safe: sanitizeMemoryRecordForDisplay(record) })),
    [records],
  )
  const filteredRecords = useMemo(
    () =>
      deferredSearch
        ? safeRecords.filter(({ safe }) =>
            [
              safe.title,
              safe.content,
              safe.source?.uri,
              safe.source?.locator,
              safe.source?.platform,
              typeLabels[safe.type],
              scopeLabels[safe.scope],
              safe.tags.join(' '),
            ]
              .filter(Boolean)
              .some((value) => value?.toLowerCase().includes(deferredSearch)),
          )
        : safeRecords,
    [deferredSearch, safeRecords],
  )
  const selected =
    safeRecords.find(({ original }) => original.id === selectedId) ?? filteredRecords[0] ?? safeRecords[0]
  const timeline = useMemo(
    () => buildMemoryTimeline(records, revisions, snapshots, importedAt),
    [importedAt, records, revisions, snapshots],
  )
  const selectedSnapshots = selected
    ? snapshots.filter((snapshot) =>
        snapshot.records.some((record) => record.id === selected.original.id),
      )
    : []

  return (
    <section
      className="workspace memory-workspace"
      id="workspace-memories"
      role="tabpanel"
      aria-labelledby="tab-memories"
    >
      <aside className="workspace-sidebar memory-overview" aria-label="记忆库概览">
        <h2>记忆库概览</h2>
        <div className="memory-stat"><span>全部记忆</span><b>{records.length}</b></div>
        <div className="memory-stat"><span>导入快照</span><b>{snapshots.length}</b></div>
        <div className="memory-stat"><span>修正记录</span><b>{revisions.length}</b></div>
        <p className="memory-boundary">
          此处展示所有规范化记录，不会因“0 个问题”而隐藏记忆。secret 级字段始终使用占位符。
        </p>
      </aside>

      <div className="report memory-main">
        <header className="report-heading">
          <div>
            <h1>全部记忆</h1>
            <p>{records.length} 条规范化记录 · 无论是否命中检查问题都在此显示</p>
          </div>
        </header>
        <div className="search-row">
          <label className="search">
            <Icon name="search" />
            <span className="sr-only">搜索全部记忆</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索标题、内容或来源…"
            />
          </label>
        </div>
        <div className="memory-table-head" aria-hidden="true">
          <span>记忆与内容摘要</span><span>来源</span><span>时间</span><span>级别</span>
        </div>
        <div className="memory-list" aria-label="全部规范化记忆">
          {filteredRecords.map(({ original, safe }) => (
            <button
              key={original.id}
              className={`memory-row ${selected?.original.id === original.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(original.id)}
              aria-pressed={selected?.original.id === original.id}
            >
              <span className="memory-record-primary">
                <strong>{safe.title}</strong>
                <small>{summarizeMemoryContent(safe.content)}</small>
              </span>
              <span className="memory-record-source">
                <strong>{safe.source?.platform || '未标注平台'}</strong>
                <small>{safe.source?.uri || '来源 URI 未提供'}</small>
              </span>
              <span>{formatMemoryTime(safe.observedAt || importedAt)}</span>
              <span className={`memory-sensitivity ${safe.sensitivity}`}>
                {sensitivityLabels[safe.sensitivity]}
              </span>
            </button>
          ))}
          {!filteredRecords.length && (
            <div className="empty">
              <Icon name="search" size={26} />
              <strong>{records.length ? '没有匹配记忆' : '尚未导入记忆'}</strong>
              <span>{records.length ? '换一个关键词继续搜索。' : '导入后，包括 0 问题记录在内的所有记忆会显示在此。'}</span>
            </div>
          )}
        </div>
      </div>

      <aside className="inspector memory-inspector" aria-label="记忆详情与时间线">
        {selected ? (
          <>
            <div className="inspector-heading">
              <span>记忆详情</span>
              <button
                className="text-button"
                disabled={selected.original.sensitivity === 'secret'}
                title={selected.original.sensitivity === 'secret' ? 'secret 记录不展开到修正表单' : undefined}
                onClick={() => {
                  if (selected.original.sensitivity !== 'secret') onEdit(selected.original)
                }}
              >
                <Icon name="edit" size={14} />{selected.original.sensitivity === 'secret' ? 'secret 已锁定' : '本地修正'}
              </button>
            </div>
            <h2>{selected.safe.title}</h2>
            <p className="memory-full-content">{selected.safe.content}</p>
            <dl className="memory-metadata">
              <div><dt>类型</dt><dd>{typeLabels[selected.safe.type]}</dd></div>
              <div><dt>作用域</dt><dd>{scopeLabels[selected.safe.scope]}</dd></div>
              <div><dt>置信度</dt><dd>{confidenceFormatter.format(selected.safe.confidence)}</dd></div>
              <div><dt>敏感级别</dt><dd>{sensitivityLabels[selected.safe.sensitivity]}</dd></div>
              <div><dt>标签</dt><dd>{selected.safe.tags.length ? selected.safe.tags.join('、') : '未提供'}</dd></div>
              <div><dt>来源 URI</dt><dd>{selected.safe.source?.uri || '未提供'}</dd></div>
              <div><dt>locator</dt><dd>{selected.safe.source?.locator || '未提供'}</dd></div>
              <div><dt>platform</dt><dd>{selected.safe.source?.platform || '未提供'}</dd></div>
              <div><dt>revision</dt><dd>{selected.safe.source?.revision || '未提供'}</dd></div>
              <div><dt>观察时间</dt><dd>{formatMemoryTime(selected.safe.observedAt)}</dd></div>
              <div><dt>失效时间</dt><dd>{formatMemoryTime(selected.safe.expiresAt)}</dd></div>
              <div><dt>导入时间</dt><dd>{formatMemoryTime(importedAt)}</dd></div>
              <div><dt>导入快照</dt><dd>{selectedSnapshots.length ? selectedSnapshots.map((snapshot) => `${redactText(snapshot.name).text} · ${formatMemoryTime(snapshot.capturedAt)}`).join('；') : '当前项目导入'}</dd></div>
            </dl>
          </>
        ) : (
          <div className="no-selection"><Icon name="database" size={28} /><strong>选择一条记忆</strong></div>
        )}

        <section className="memory-timeline" aria-labelledby="memory-timeline-title">
          <div className="memory-timeline-heading">
            <Icon name="history" />
            <div><h3 id="memory-timeline-title">记忆变更与快照时间线</h3><p>{timeline.length} 个本地历史节点</p></div>
          </div>
          <ol>
            {timeline.map((event) => (
              <li key={event.id} className={`memory-timeline-event ${event.kind}`}>
                <time dateTime={event.at}>{formatMemoryTime(event.at)}</time>
                <strong>{event.title}</strong>
                <p>{event.detail}</p>
                {event.before !== undefined && event.after !== undefined && (
                  <div className="memory-revision-preview">
                    <span><b>修正前</b>{event.before}</span>
                    <span><b>修正后</b>{event.after}</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </section>
  )
}
