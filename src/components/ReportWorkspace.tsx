import { useDeferredValue, useMemo } from 'react'
import type {
  Disposition,
  IssueKind,
  MemoryIssue,
  MemoryRecord,
  MemoryRevision,
  SearchIndexEntry,
  Severity,
} from '../types'
import { revisionsForRecord } from '../corrections'
import { Icon } from './Icon'

const labels: Record<IssueKind, string> = {
  sensitive: '敏感信息',
  conflict: '冲突',
  stale: '可能过期',
  duplicate: '重复',
  unsourced: '无来源',
}
const severityLabels: Record<Severity, string> = {
  blocker: '阻断',
  high: '高',
  medium: '中',
  low: '低',
}
const dispositionLabels: Record<Disposition, string> = {
  unreviewed: '未处理',
  keep: '保留',
  ignore: '忽略',
  'suggest-delete': '建议删除',
  corrected: '已修正',
}

export function ReportWorkspace({
  records,
  issues,
  searchIndex,
  selectedId,
  filter,
  search,
  mobileNav,
  revisions,
  onSelect,
  onFilter,
  onSearch,
  onMobileNav,
  onDisposition,
  onEdit,
  onExportMarkdown,
  onRebuildIndex,
}: {
  records: MemoryRecord[]
  issues: MemoryIssue[]
  searchIndex: SearchIndexEntry[]
  selectedId: string
  filter: 'all' | IssueKind
  search: string
  mobileNav: boolean
  revisions: MemoryRevision[]
  onSelect: (id: string) => void
  onFilter: (filter: 'all' | IssueKind) => void
  onSearch: (search: string) => void
  onMobileNav: (open: boolean) => void
  onDisposition: (issue: MemoryIssue, disposition: Disposition) => void
  onEdit: (record: MemoryRecord) => void
  onExportMarkdown: () => void
  onRebuildIndex: () => void
}) {
  const deferredSearch = useDeferredValue(search)
  const query = deferredSearch.trim().toLocaleLowerCase('zh-CN')
  const indexedIds = useMemo(
    () =>
      new Set(
        searchIndex
          .filter((entry) => !query || `${entry.terms} ${entry.sourceKey}`.includes(query))
          .map((entry) => entry.recordId),
      ),
    [query, searchIndex],
  )
  const filtered = useMemo(
    () =>
      issues.filter((issue) => {
        if (filter !== 'all' && issue.kind !== filter) return false
        if (!query) return true
        return (
          issue.sourceIds.some((id) => indexedIds.has(id)) ||
          `${issue.title} ${issue.explanation}`.toLocaleLowerCase('zh-CN').includes(query)
        )
      }),
    [filter, indexedIds, issues, query],
  )
  const selected = issues.find((issue) => issue.id === selectedId) ?? filtered[0]
  const recordsById = useMemo(
    () => new Map(records.map((record) => [record.id, record])),
    [records],
  )
  const selectedRecords =
    (selected?.sourceIds.map((id) => recordsById.get(id)).filter(Boolean) as MemoryRecord[]) ?? []
  const counts = useMemo(
    () =>
      issues.reduce(
        (summary, issue) => {
          summary.severity[issue.severity] += 1
          summary.kind[issue.kind] += 1
          return summary
        },
        {
          severity: { blocker: 0, high: 0, medium: 0, low: 0 } as Record<Severity, number>,
          kind: { sensitive: 0, conflict: 0, stale: 0, duplicate: 0, unsourced: 0 } as Record<
            IssueKind,
            number
          >,
        },
      ),
    [issues],
  )

  return (
    <div
      className="workspace report-workspace"
      id="workspace-report"
      role="tabpanel"
      aria-labelledby="tab-report"
    >
      <button
        className="workspace-mobile-menu"
        onClick={() => onMobileNav(!mobileNav)}
        aria-label="打开报告筛选"
      >
        <Icon name="menu" />
      </button>
      <aside
        className={`workspace-sidebar report-sidebar ${mobileNav ? 'open' : ''}`}
        aria-label="报告筛选与概览"
      >
        <section>
          <h2>报告概览</h2>
          <div className="severity-list">
            {(['blocker', 'high', 'medium', 'low'] as Severity[]).map((severity) => (
              <div className={`severity-row ${severity}`} key={severity}>
                <span className="severity-dot" />
                {severityLabels[severity]}
                <b>{counts.severity[severity]}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="filters">
          <h2>筛选器</h2>
          <button
            className={filter === 'all' ? 'active' : ''}
            onClick={() => {
              onFilter('all')
              onMobileNav(false)
            }}
          >
            <span>全部问题</span>
            <b>{issues.length}</b>
          </button>
          {(Object.keys(labels) as IssueKind[]).map((kind) => (
            <button
              className={filter === kind ? 'active' : ''}
              key={kind}
              onClick={() => {
                onFilter(kind)
                onMobileNav(false)
              }}
            >
              <span>{labels[kind]}</span>
              <b>{counts.kind[kind]}</b>
            </button>
          ))}
        </section>
        <div className="sidebar-boundary">
          <Icon name="lock" />
          <p>看见的不等于 AI 的全部记忆。本工具不访问厂商内部数据。</p>
        </div>
      </aside>

      <section className="report" aria-labelledby="report-title">
        <div className="report-heading">
          <div>
            <h1 id="report-title">检查报告</h1>
            <p>
              {records.length} 条规范化记录 · {issues.length} 个待核查问题
            </p>
          </div>
          <button className="text-button" onClick={onExportMarkdown}>
            导出迁移 Markdown
          </button>
        </div>
        <div className="search-row">
          <label className="search">
            <Icon name="search" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder={searchIndex.length ? '搜索问题标题、内容或来源…' : '搜索索引已清除'}
              disabled={!searchIndex.length}
            />
          </label>
          {!searchIndex.length && records.length > 0 && (
            <button className="button compact" onClick={onRebuildIndex}>
              重建索引
            </button>
          )}
        </div>
        <div className="table-head">
          <span>严重性</span>
          <span>问题与来源</span>
          <span>观察时间</span>
          <span>范围</span>
          <span>置信度</span>
          <span>处理建议</span>
        </div>
        <div className="issue-list">
          {!filtered.length && (
            <div className="empty">
              <strong>当前筛选下没有问题</strong>
              <span>可切换筛选、重建索引或导入另一份记忆文件。</span>
            </div>
          )}
          {filtered.map((issue) => {
            const source = recordsById.get(issue.sourceIds[0])
            return (
              <button
                className={`issue-row ${selected?.id === issue.id ? 'selected' : ''}`}
                key={issue.id}
                onClick={() => onSelect(issue.id)}
              >
                <span>
                  <i className={`severity-tag ${issue.severity}`}>
                    {severityLabels[issue.severity]}
                  </i>
                  <small>{issue.detection === 'rule' ? '规则命中' : '模型推断'}</small>
                </span>
                <span className="issue-title">
                  <strong>{issue.title}</strong>
                  <small>
                    {source?.source?.platform ?? '来源未知'} ·{' '}
                    {source?.source?.locator ?? '无法定位'}
                  </small>
                </span>
                <span>
                  {source?.observedAt
                    ? new Date(source.observedAt).toLocaleDateString('zh-CN')
                    : '未提供'}
                </span>
                <span>
                  {source?.scope === 'project'
                    ? '项目'
                    : source?.scope === 'task'
                      ? '任务'
                      : '全局'}
                </span>
                <span>{Math.round((source?.confidence ?? 0) * 100)}%</span>
                <span>
                  <i className={`state ${issue.disposition}`}>
                    {dispositionLabels[issue.disposition]}
                  </i>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <aside className="inspector" aria-label="问题详情">
        {selected ? (
          <>
            <div className="inspector-heading">
              <span>问题详情</span>
              <i className={`severity-tag ${selected.severity}`}>
                {severityLabels[selected.severity]}
              </i>
            </div>
            <h2>{selected.title}</h2>
            <div className="rule-label">
              {selected.detection === 'rule' ? '规则命中' : '模型推断 · 需人工确认'}
            </div>
            <section className="why">
              <h3>为什么被标记</h3>
              <p>{selected.explanation}</p>
            </section>
            <section>
              <h3>相关来源（{selectedRecords.length}）</h3>
              <div className="source-list">
                {selectedRecords.map((record, index) => (
                  <article className="source-card" id={`source-${record.id}`} key={record.id}>
                    <div className="source-title">
                      <span>{index + 1}</span>
                      <strong>{record.source?.platform ?? '未知来源'}</strong>
                      <button onClick={() => onEdit(record)} aria-label={`修正 ${record.title}`}>
                        <Icon name="edit" size={15} />
                        修正
                      </button>
                    </div>
                    <dl>
                      <div>
                        <dt>位置</dt>
                        <dd>{record.source?.locator ?? '无法定位'}</dd>
                      </div>
                      <div>
                        <dt>版本</dt>
                        <dd>{record.source?.revision ?? '未提供'}</dd>
                      </div>
                    </dl>
                    <pre>{record.content}</pre>
                    <p className="source-uri" title={record.source?.uri}>
                      {record.source?.uri ?? '无来源 URI'}
                    </p>
                    {revisionsForRecord(revisions, record.id).length > 0 && (
                      <div className="history-summary">
                        <Icon name="history" size={14} />
                        已保留 {revisionsForRecord(revisions, record.id).length} 次修正历史
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
            <div className="warning">
              <strong>建议删除 ≠ 已从平台删除</strong>
              <p>这里只记录处理建议。请回到对应来源人工修正或删除，并自行确认平台结果。</p>
            </div>
            <div className="decision">
              <h3>处理建议</h3>
              <div>
                {(['keep', 'ignore', 'suggest-delete'] as Disposition[]).map((value) => (
                  <button
                    key={value}
                    className={selected.disposition === value ? 'active' : ''}
                    onClick={() => onDisposition(selected, value)}
                  >
                    {dispositionLabels[value]}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="no-selection">
            <Icon name="shield" size={32} />
            <strong>尚无检查结果</strong>
            <span>导入文件或粘贴文本后，问题来源会显示在这里。</span>
          </div>
        )}
      </aside>
    </div>
  )
}
