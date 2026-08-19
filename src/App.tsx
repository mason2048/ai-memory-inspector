import { useEffect, useMemo, useRef, useState } from 'react'
import { analyzeMemories } from './analyzer'
import { buildCleanupChecklist, buildCleanupChecklistMarkdown } from './cleanup'
import { applyCorrection, type CorrectionInput } from './corrections'
import {
  parseCustomRuleSet,
  runCustomRules,
  validateCustomRuleSet,
  type CustomRuleSet,
} from './custom-rules'
import { buildContextPackage, buildMigrationMarkdown } from './exporter'
import { parseImport } from './importer'
import { createSecureId } from './ids'
import { redactText } from './redaction'
import { defaultCustomRuleSet, sampleRecords, sampleSnapshots } from './sample-data'
import { parseImportFile, type ImportProgress } from './stream-importer'
import {
  buildSearchIndex,
  clearAllLocalData,
  clearSearchIndex,
  createVolatileStorage,
  loadProjectWithStatus,
  loadSearchIndex,
  resolveBrowserStorage,
  sanitizeProjectState,
  saveProject,
  saveSearchIndex,
  wasProjectCleared,
} from './storage'
import { loadNativeProject } from './desktop/native-project-store'
import { SafeError, toSafeError } from './desktop/safe-error'
import type {
  Disposition,
  IssueKind,
  MemoryIssue,
  MemoryRecord,
  MemoryRevision,
  MemorySnapshot,
  ProjectState,
  SearchIndexEntry,
} from './types'
import { CorrectionDialog } from './components/CorrectionDialog'
import { BackupDialog, type BackupDialogMode } from './components/BackupDialog'
import { Icon } from './components/Icon'
import { ImportDialog } from './components/ImportDialog'
import { MemoryWorkspace } from './components/MemoryWorkspace'
import { ReportWorkspace } from './components/ReportWorkspace'
import { RulesWorkspace } from './components/RulesWorkspace'
import { SnapshotWorkspace } from './components/SnapshotWorkspace'
import { useDesktopGateway } from './components/ProductionShell'
import { useNativeProjectSession } from './components/VaultGate'
import {
  resolveWorkspaceTabKey,
  WORKSPACE_TABS,
  type WorkspaceView,
} from './workspace-tabs'

function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

const uniqueRecords = (records: MemoryRecord[]) => [
  ...new Map(records.map((record) => [record.id, record])).values(),
]
const createLocalId = createSecureId
const issueSeverityRank = { blocker: 0, high: 1, medium: 2, low: 3 } as const

function App() {
  const desktopGateway = useDesktopGateway()
  const nativeSession = useNativeProjectSession()
  const nativeMode = desktopGateway?.kind === 'tauri'
  const storageAccess = useMemo(
    () => (nativeMode ? createVolatileStorage() : resolveBrowserStorage()),
    [nativeMode],
  )
  const browserStorage = storageAccess.storage
  const initial = useMemo(() => {
    const cleared = nativeMode ? false : wasProjectCleared(browserStorage)
    const loaded = nativeMode
      ? {
          status: nativeSession?.project ? ('ok' as const) : ('empty' as const),
          project: nativeSession?.project ?? null,
        }
      : loadProjectWithStatus(browserStorage)
    const stored = loaded.project
    const unavailable = !nativeMode && !storageAccess.persistent
    const storageMessage =
      loaded.status === 'corrupt'
        ? loaded.message
        : unavailable
          ? '持久化存储不可用：本次数据只保留到关闭应用前，请及时导出。'
          : ''
    const maySeedDemo = !nativeMode && import.meta.env.DEV && loaded.status === 'empty' && !cleared
    const records = stored?.records ?? (maySeedDemo ? sampleRecords : [])
    const snapshots = stored?.snapshots?.length
      ? stored.snapshots
      : maySeedDemo
        ? sampleSnapshots
        : []
    const savedRules = validateCustomRuleSet(stored?.customRuleSet)
    const ruleSet = savedRules.ok
      ? savedRules.value
      : maySeedDemo
        ? defaultCustomRuleSet
        : { schemaVersion: '1' as const, rules: [] }
    const loadedIndex = nativeMode ? (stored?.searchIndex ?? []) : loadSearchIndex(browserStorage)
    return {
      name: stored?.name ?? '本地记忆检查',
      importedAt: stored?.importedAt ?? new Date().toISOString(),
      records,
      snapshots,
      revisions: stored?.revisions ?? [],
      dispositions: stored?.dispositions ?? {},
      manualCleanupIds: stored?.manualCleanupIds ?? [],
      ruleSet,
      index: loadedIndex.length || !records.length ? loadedIndex : buildSearchIndex(records),
      storageMessage,
    }
  }, [browserStorage, nativeMode, nativeSession, storageAccess.persistent])

  const [records, setRecords] = useState<MemoryRecord[]>(initial.records)
  const [projectName, setProjectName] = useState(initial.name)
  const [projectImportedAt, setProjectImportedAt] = useState(initial.importedAt)
  const [snapshots, setSnapshots] = useState<MemorySnapshot[]>(initial.snapshots)
  const [revisions, setRevisions] = useState<MemoryRevision[]>(initial.revisions)
  const [dispositions, setDispositions] = useState<Record<string, Disposition>>(
    initial.dispositions,
  )
  const [manualCleanupIds, setManualCleanupIds] = useState<string[]>(initial.manualCleanupIds)
  const [ruleSet, setRuleSet] = useState<CustomRuleSet>(initial.ruleSet)
  const [searchIndex, setSearchIndex] = useState<SearchIndexEntry[]>(initial.index)
  const [activeView, setActiveView] = useState<WorkspaceView>('report')
  const [selectedIssueId, setSelectedIssueId] = useState('')
  const [reportFilter, setReportFilter] = useState<'all' | IssueKind>('all')
  const [reportSearch, setReportSearch] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [importError, setImportError] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [toast, setToast] = useState('')
  const [storageWarning, setStorageWarning] = useState(initial.storageMessage)
  const [editingRecord, setEditingRecord] = useState<MemoryRecord | null>(null)
  const [beforeSnapshotId, setBeforeSnapshotId] = useState(
    initial.snapshots.at(-2)?.id ?? initial.snapshots[0]?.id ?? '',
  )
  const [afterSnapshotId, setAfterSnapshotId] = useState(
    initial.snapshots.at(-1)?.id ?? initial.snapshots[0]?.id ?? '',
  )
  const [selectedDiffKey, setSelectedDiffKey] = useState('')
  const [diffSearch, setDiffSearch] = useState('')
  const [ruleImportOpen, setRuleImportOpen] = useState(false)
  const [ruleText, setRuleText] = useState('')
  const [ruleError, setRuleError] = useState('')
  const [backupMode, setBackupMode] = useState<BackupDialogMode | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupError, setBackupError] = useState('')
  const abortController = useRef<AbortController | null>(null)
  const workspaceTabRefs = useRef<Partial<Record<WorkspaceView, HTMLButtonElement | null>>>({})

  const builtInIssues = useMemo(
    () => analyzeMemories(records, dispositions),
    [records, dispositions],
  )
  const customIssues = useMemo(
    () => runCustomRules(records, ruleSet, dispositions),
    [records, ruleSet, dispositions],
  )
  const issues = useMemo(
    () =>
      [...builtInIssues, ...customIssues].sort(
        (left, right) => issueSeverityRank[left.severity] - issueSeverityRank[right.severity],
      ),
    [builtInIssues, customIssues],
  )
  const checklistRecords = useMemo(
    () => uniqueRecords([...records, ...snapshots.flatMap((snapshot) => snapshot.records)]),
    [records, snapshots],
  )
  const manualIssues = useMemo<MemoryIssue[]>(
    () =>
      manualCleanupIds.map((recordId) => ({
        id: `manual-cleanup-${recordId}`,
        kind: 'duplicate',
        severity: 'low',
        title: `手动加入清理清单：${checklistRecords.find((record) => record.id === recordId)?.title ?? recordId}`,
        explanation: '用户从快照差异中手动加入，需回到来源人工复核。',
        sourceIds: [recordId],
        detection: 'rule',
        disposition: 'unreviewed',
      })),
    [manualCleanupIds, checklistRecords],
  )
  const correctedIssues = useMemo<MemoryIssue[]>(
    () =>
      [...new Set(revisions.map((revision) => revision.recordId))].map((recordId) => ({
        id: `corrected-sync-${recordId}`,
        kind: 'conflict',
        severity: 'medium',
        title: `同步本地修正：${checklistRecords.find((record) => record.id === recordId)?.title ?? recordId}`,
        explanation: '本地副本已修正，来源平台仍需人工同步。',
        sourceIds: [recordId],
        detection: 'rule',
        disposition: 'corrected',
      })),
    [revisions, checklistRecords],
  )
  const cleanupIssues = useMemo(
    () => [...issues, ...manualIssues, ...correctedIssues],
    [issues, manualIssues, correctedIssues],
  )
  const checklist = useMemo(
    () => buildCleanupChecklist(checklistRecords, cleanupIssues),
    [checklistRecords, cleanupIssues],
  )
  const projectState = useMemo<ProjectState>(
    () => ({
      version: 2,
      name: projectName,
      importedAt: projectImportedAt,
      records,
      dispositions,
      revisions,
      snapshots,
      manualCleanupIds,
      customRuleSet: ruleSet,
      searchIndex,
    }),
    [
      projectName,
      projectImportedAt,
      records,
      dispositions,
      revisions,
      snapshots,
      manualCleanupIds,
      ruleSet,
      searchIndex,
    ],
  )

  useEffect(() => {
    if (!selectedIssueId || !issues.some((issue) => issue.id === selectedIssueId))
      setSelectedIssueId(issues[0]?.id ?? '')
  }, [issues, selectedIssueId])

  useEffect(() => {
    if (!records.length && !snapshots.length && !revisions.length && !ruleSet.rules.length) return
    if (nativeMode) {
      if (!nativeSession) return
      void nativeSession.writer
        .save(projectState)
        .then(() => setStorageWarning(''))
        .catch(() => setStorageWarning('加密项目未能保存，请重新载入资料库后再继续编辑。'))
      return
    }
    try {
      saveProject(browserStorage, projectState)
      setStorageWarning(storageAccess.persistent ? '' : initial.storageMessage)
    } catch {
      setStorageWarning('数据超过浏览器持久化容量，本次会话仍可继续；导出后再清理可避免丢失。')
    }
  }, [
    projectState,
    records.length,
    snapshots.length,
    revisions.length,
    ruleSet.rules.length,
    browserStorage,
    storageAccess.persistent,
    initial.storageMessage,
    nativeMode,
    nativeSession,
  ])

  useEffect(() => {
    if (nativeMode) return
    try {
      if (searchIndex.length) saveSearchIndex(browserStorage, searchIndex)
      else clearSearchIndex(browserStorage)
    } catch {
      setStorageWarning('搜索索引无法持久化；本次会话仍可继续。')
    }
  }, [searchIndex, browserStorage, nativeMode])

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2800)
  }

  const commitImportedRecords = (next: MemoryRecord[], name: string) => {
    if (!next.length) throw new Error('没有找到可导入的记录。')
    const capturedAt = new Date().toISOString()
    const beforeSnapshot: MemorySnapshot | null = records.length
      ? {
          id: createLocalId('snapshot-before'),
          name: `导入前 · ${new Date().toLocaleString('zh-CN')}`,
          capturedAt,
          records,
        }
      : null
    const afterSnapshot: MemorySnapshot = {
      id: createLocalId('snapshot'),
      name: redactText(name).text,
      capturedAt,
      records: next,
    }
    setSnapshots((current) => [
      ...current,
      ...(beforeSnapshot ? [beforeSnapshot] : []),
      afterSnapshot,
    ])
    setProjectName(redactText(name).text)
    setProjectImportedAt(capturedAt)
    if (beforeSnapshot) setBeforeSnapshotId(beforeSnapshot.id)
    setAfterSnapshotId(afterSnapshot.id)
    setRecords(next)
    setSearchIndex(buildSearchIndex(next))
    setDispositions({})
    setSelectedDiffKey('')
    setActiveView('report')
    setImportOpen(false)
    setPasteText('')
    setImportError('')
    setImportProgress(null)
    showToast(`已在本地导入并脱敏 ${next.length} 条记录，同时保存快照`)
  }

  const importPasted = () => {
    try {
      commitImportedRecords(
        parseImport(pasteText, 'pasted.txt'),
        `粘贴内容 · ${new Date().toLocaleDateString('zh-CN')}`,
      )
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '导入失败。')
      setPasteText('')
    }
  }

  const importFile = async (file?: File) => {
    if (!file) return
    setImportError('')
    setImportProgress({ bytesRead: 0, totalBytes: file.size, recordsParsed: 0, percent: 0 })
    const controller = new AbortController()
    abortController.current = controller
    try {
      const next = await parseImportFile(file, setImportProgress, controller.signal)
      commitImportedRecords(next, `${file.name} · ${new Date().toLocaleDateString('zh-CN')}`)
    } catch (error) {
      setImportProgress(null)
      setImportError(error instanceof Error ? error.message : '导入失败。')
    } finally {
      abortController.current = null
    }
  }

  const importNativeFile = async () => {
    if (!desktopGateway || !nativeMode) return
    setImportError('')
    setImportProgress({ bytesRead: 0, totalBytes: 0, recordsParsed: 0, percent: 0 })
    const controller = new AbortController()
    abortController.current = controller
    try {
      const selected = await desktopGateway.pickAndReadImport()
      if (selected.cancelled) {
        setImportProgress(null)
        return
      }
      const { file } = selected
      setImportProgress({
        bytesRead: file.sizeBytes,
        totalBytes: file.sizeBytes,
        recordsParsed: 0,
        percent: 100,
      })
      const localFile = new Blob([file.content], { type: 'text/plain;charset=utf-8' }) as Blob & {
        name: string
      }
      localFile.name = file.basename
      const next = await parseImportFile(localFile, setImportProgress, controller.signal)
      commitImportedRecords(
        next,
        `${file.basename} · ${new Date().toLocaleDateString('zh-CN')}`,
      )
    } catch (error) {
      setImportProgress(null)
      const safe = toSafeError(error, 'import-native-file')
      setImportError(error instanceof SafeError ? safe.message : error instanceof Error ? error.message : safe.message)
    } finally {
      abortController.current = null
    }
  }

  const saveCorrection = (input: CorrectionInput) => {
    if (!editingRecord) return
    try {
      const result = applyCorrection(editingRecord, input)
      setRecords((current) => {
        const next = current.some((record) => record.id === result.record.id)
          ? current.map((record) => (record.id === result.record.id ? result.record : record))
          : [...current, result.record]
        setSearchIndex(buildSearchIndex(next))
        return next
      })
      setRevisions((current) => [...current, result.revision])
      setDispositions((current) => {
        const next = { ...current }
        issues
          .filter((issue) => issue.sourceIds.includes(editingRecord.id))
          .forEach((issue) => {
            next[issue.id] = 'corrected'
          })
        return next
      })
      setEditingRecord(null)
      showToast('本地修正已保存，原记录已写入修改历史；来源平台未被修改')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '无法保存修正。')
    }
  }

  const adoptSnapshotRecord = (record: MemoryRecord, previous?: MemoryRecord) => {
    const currentBefore = records.find((item) => item.id === record.id)
    const before = currentBefore ?? previous
    const next = currentBefore
      ? records.map((item) => (item.id === record.id ? record : item))
      : [...records, record]
    setRecords(next)
    if (before && JSON.stringify(before) !== JSON.stringify(record))
      setRevisions((history) => [
        ...history,
        {
          id: createLocalId('revision'),
          recordId: record.id,
          changedAt: new Date().toISOString(),
          reason: '从快照对比采用较新版本',
          before,
          after: record,
        },
      ])
    setSearchIndex(buildSearchIndex(next))
    showToast('已采用较新版本到本地副本，来源平台未被修改')
  }

  const setDisposition = (issue: MemoryIssue, value: Disposition) => {
    setDispositions((current) => ({ ...current, [issue.id]: value }))
    showToast(
      value === 'suggest-delete'
        ? '已加入人工删除建议，未修改任何平台数据'
        : `已标记为“${value === 'keep' ? '保留' : '忽略'}”`,
    )
  }

  const importRules = () => {
    try {
      const next = parseCustomRuleSet(ruleText)
      setRuleSet(next)
      setRuleImportOpen(false)
      setRuleText('')
      setRuleError('')
      showToast(`已验证并导入 ${next.rules.length} 条本地规则；没有执行脚本`)
    } catch (error) {
      setRuleError(error instanceof Error ? error.message : '规则无法导入。')
    }
  }

  const clearEverything = async () => {
    if (
      !window.confirm(
        '这会清除本应用保存的原始记录、快照、修改历史、自定义规则和搜索索引。不会影响任何 AI 平台，是否继续？',
      )
    )
      return
    if (nativeMode) {
      if (!nativeSession) return
      try {
        await nativeSession.writer.clear()
      } catch {
        showToast('加密项目清除失败，现有项目仍保留。')
        return
      }
    } else {
      try {
        clearAllLocalData(browserStorage)
      } catch {
        showToast('本地数据清除失败，现有项目仍保留。')
        return
      }
    }
    setRecords([])
    setSnapshots([])
    setRevisions([])
    setDispositions({})
    setManualCleanupIds([])
    setSearchIndex([])
    setRuleSet({ schemaVersion: '1', rules: [] })
    setSelectedIssueId('')
    setBeforeSnapshotId('')
    setAfterSnapshotId('')
    showToast('全部本地数据已清除，平台数据未发生变化')
  }

  const exportPackage = () => {
    downloadFile(
      'memory-inspector-redacted.context.json',
      JSON.stringify(buildContextPackage(records, issues), null, 2),
      'application/json',
    )
    showToast('脱敏包已导出，secret 记录已默认排除')
  }

  const runBackup = async (passphrase: string) => {
    if (
      !desktopGateway ||
      desktopGateway.kind !== 'tauri' ||
      !nativeSession ||
      !backupMode
    )
      return
    const mode = backupMode
    setBackupBusy(true)
    setBackupError('')
    try {
      if (mode === 'export') {
        const result = await nativeSession.writer.runExclusive('export-backup', async () => {
          const exported = await desktopGateway.exportBackup(passphrase)
          if (exported.completed && exported.revision !== nativeSession.writer.currentRevision) {
            throw new SafeError('INVALID_RESPONSE', 'export-backup')
          }
          return exported
        })
        if (result.cancelled) return
        setBackupMode(null)
        showToast('完整加密备份已创建；恢复口令未被保存')
        return
      }

      const restoredTransaction = await nativeSession.writer.runExclusive(
        'restore-backup',
        async (adoptRevision) => {
          const result = await desktopGateway.restoreBackup(passphrase)
          if (result.cancelled) return { result, safeProject: null, cancelled: true as const }
          const restored = await loadNativeProject(desktopGateway)
          if (restored.status === 'corrupt' || restored.revision !== result.revision) {
            throw new SafeError('INVALID_RESPONSE', 'restore-backup')
          }
          const safeProject = restored.project ? sanitizeProjectState(restored.project) : null
          if (restored.project !== null && !safeProject) {
            throw new SafeError('BACKUP_RESTORE_FAILED', 'restore-backup')
          }
          adoptRevision(result.revision, safeProject)
          return { result, safeProject, cancelled: false as const }
        },
      )
      if (restoredTransaction.cancelled) return
      const { safeProject } = restoredTransaction
      setProjectName(safeProject?.name ?? '本地记忆检查')
      setProjectImportedAt(safeProject?.importedAt ?? new Date().toISOString())
      setRecords(safeProject?.records ?? [])
      setSnapshots(safeProject?.snapshots ?? [])
      setRevisions(safeProject?.revisions ?? [])
      setDispositions(safeProject?.dispositions ?? {})
      setManualCleanupIds(safeProject?.manualCleanupIds ?? [])
      setSearchIndex(
        safeProject?.searchIndex ?? (safeProject?.records ? buildSearchIndex(safeProject.records) : []),
      )
      const restoredRules = validateCustomRuleSet(safeProject?.customRuleSet)
      setRuleSet(restoredRules.ok ? restoredRules.value : { schemaVersion: '1', rules: [] })
      setSelectedIssueId('')
      setBeforeSnapshotId(safeProject?.snapshots?.at(-2)?.id ?? '')
      setAfterSnapshotId(safeProject?.snapshots?.at(-1)?.id ?? '')
      setBackupMode(null)
      showToast('完整加密备份已验证并恢复；来源平台未发生变化')
    } catch (error) {
      const safe = toSafeError(error, mode === 'export' ? 'export-backup' : 'restore-backup')
      setBackupError(safe.message)
    } finally {
      setBackupBusy(false)
    }
  }

  const clearOnlySearchIndex = async () => {
    if (!searchIndex.length) return
    if (nativeMode) {
      if (!nativeSession) return
      try {
        await nativeSession.writer.save({ ...projectState, searchIndex: [] })
      } catch {
        showToast('加密搜索索引清除失败，现有索引仍保留。')
        return
      }
    } else {
      try {
        clearSearchIndex(browserStorage)
      } catch {
        showToast('搜索索引清除失败，现有索引仍保留。')
        return
      }
    }
    setSearchIndex([])
    setReportSearch('')
    showToast('搜索索引已清除，原始记录仍保留')
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="shield" size={22} />
          </span>
          <strong>记忆清理台</strong>
          <span className="brand-note">仅检查你主动导入的内容</span>
        </div>
        <div className="top-actions">
          <button className="button primary" onClick={() => setImportOpen(true)}>
            <Icon name="upload" />
            导入记忆
          </button>
          <button className="button" onClick={exportPackage} disabled={!records.length}>
            <Icon name="download" />
            导出脱敏包
          </button>
        </div>
      </header>
      <nav className="workspace-tabs" aria-label="产品工作区" role="tablist">
        {WORKSPACE_TABS.map(({ view, icon, label }) => (
          <button
            ref={(node) => { workspaceTabRefs.current[view] = node }}
            role="tab"
            aria-selected={activeView === view}
            aria-controls={`workspace-${view}`}
            id={`tab-${view}`}
            tabIndex={activeView === view ? 0 : -1}
            className={activeView === view ? 'active' : ''}
            key={view}
            onClick={() => {
              setActiveView(view)
              setMobileNav(false)
            }}
            onKeyDown={(event) => {
              const nextView = resolveWorkspaceTabKey(view, event.key)
              if (!nextView) return
              event.preventDefault()
              setActiveView(nextView)
              setMobileNav(false)
              workspaceTabRefs.current[nextView]?.focus()
            }}
          >
            <Icon name={icon} />
            {label}
          </button>
        ))}
      </nav>
      {activeView === 'report' && (
        <ReportWorkspace
          records={records}
          issues={issues}
          searchIndex={searchIndex}
          selectedId={selectedIssueId}
          filter={reportFilter}
          search={reportSearch}
          mobileNav={mobileNav}
          revisions={revisions}
          onSelect={setSelectedIssueId}
          onFilter={setReportFilter}
          onSearch={setReportSearch}
          onMobileNav={setMobileNav}
          onDisposition={setDisposition}
          onEdit={setEditingRecord}
          onExportMarkdown={() =>
            downloadFile(
              'memory-migration.md',
              buildMigrationMarkdown(records, issues),
              'text/markdown',
            )
          }
          onRebuildIndex={() => {
            setSearchIndex(buildSearchIndex(records))
            showToast('搜索索引已在本地重建')
          }}
        />
      )}
      {activeView === 'memories' && (
        <MemoryWorkspace
          records={records}
          revisions={revisions}
          snapshots={snapshots}
          importedAt={projectImportedAt}
          onEdit={setEditingRecord}
        />
      )}
      {activeView === 'compare' && (
        <SnapshotWorkspace
          snapshots={snapshots}
          beforeId={beforeSnapshotId}
          afterId={afterSnapshotId}
          selectedKey={selectedDiffKey}
          search={diffSearch}
          revisions={revisions}
          manualCleanupIds={manualCleanupIds}
          onBefore={(id) => {
            setBeforeSnapshotId(id)
            setSelectedDiffKey('')
          }}
          onAfter={(id) => {
            setAfterSnapshotId(id)
            setSelectedDiffKey('')
          }}
          onSwap={() => {
            setBeforeSnapshotId(afterSnapshotId)
            setAfterSnapshotId(beforeSnapshotId)
            setSelectedDiffKey('')
          }}
          onSelect={setSelectedDiffKey}
          onSearch={setDiffSearch}
          onAdopt={adoptSnapshotRecord}
          onEdit={setEditingRecord}
          onAddCleanup={(recordId) => {
            setManualCleanupIds((current) =>
              current.includes(recordId)
                ? current.filter((id) => id !== recordId)
                : [...current, recordId],
            )
            showToast(
              manualCleanupIds.includes(recordId) ? '已从人工清理清单移除' : '已加入人工复核清单',
            )
          }}
        />
      )}
      {activeView === 'rules' && (
        <RulesWorkspace
          ruleSet={ruleSet}
          checklist={checklist}
          ruleImportOpen={ruleImportOpen}
          ruleText={ruleText}
          ruleError={ruleError}
          onToggle={(id) =>
            setRuleSet((current) => ({
              ...current,
              rules: current.rules.map((rule) =>
                rule.id === id ? { ...rule, enabled: !rule.enabled } : rule,
              ),
            }))
          }
          onOpenImport={() => setRuleImportOpen(true)}
          onCloseImport={() => {
            setRuleImportOpen(false)
            setRuleError('')
            setRuleText('')
          }}
          onRuleText={setRuleText}
          onImport={importRules}
          onExportChecklist={() =>
            downloadFile(
              'platform-cleanup-checklist.md',
              buildCleanupChecklistMarkdown(checklistRecords, cleanupIssues),
              'text/markdown',
            )
          }
        />
      )}
      <footer className="privacy-bar">
        <span>
          <Icon name="lock" />
          原始记录与搜索索引仅保存在本机；不会上传或自动修改平台数据。
        </span>
        <div>
          {nativeMode ? (
            <>
              <button
                onClick={() => {
                  setBackupError('')
                  setBackupMode('export')
                }}
              >
                <Icon name="download" />
                完整加密备份
              </button>
              <button
                onClick={() => {
                  setBackupError('')
                  setBackupMode('restore')
                }}
              >
                <Icon name="upload" />
                恢复备份
              </button>
            </>
          ) : null}
          {storageWarning && <em role="status">{storageWarning}</em>}
          <button
            onClick={() => void clearOnlySearchIndex()}
            disabled={!searchIndex.length || backupBusy}
          >
            <Icon name="trash" />
            仅清除搜索索引
          </button>
          <button
            className="danger-text"
            onClick={() => void clearEverything()}
            disabled={!records.length && !snapshots.length && !ruleSet.rules.length}
          >
            <Icon name="trash" />
            清除全部本地数据
          </button>
        </div>
      </footer>
      {importOpen && (
        <ImportDialog
          nativeFilePicker={nativeMode}
          pasteText={pasteText}
          error={importError}
          progress={importProgress}
          onPasteChange={setPasteText}
          onFile={(file) => void importFile(file)}
          onNativeFile={() => void importNativeFile()}
          onPaste={importPasted}
          onCancel={() => {
            setImportOpen(false)
            setImportError('')
            setPasteText('')
          }}
          onAbort={() => abortController.current?.abort()}
        />
      )}
      {editingRecord && (
        <CorrectionDialog
          record={editingRecord}
          onCancel={() => setEditingRecord(null)}
          onSave={saveCorrection}
        />
      )}
      {backupMode ? (
        <BackupDialog
          mode={backupMode}
          busy={backupBusy}
          error={backupError}
          onCancel={() => {
            if (backupBusy) return
            setBackupMode(null)
            setBackupError('')
          }}
          onSubmit={(passphrase) => void runBackup(passphrase)}
        />
      ) : null}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  )
}

export default App
