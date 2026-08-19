import { useCallback, useRef } from 'react'
import {
  IMPORT_FILE_ACCEPT,
  IMPORT_FORMAT_LABELS,
  type ImportProgress,
} from '../stream-importer'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { Icon } from './Icon'

export function ImportDialog({ nativeFilePicker, pasteText, error, progress, onPasteChange, onFile, onNativeFile, onPaste, onCancel, onAbort }: {
  nativeFilePicker: boolean
  pasteText: string
  error: string
  progress: ImportProgress | null
  onPasteChange: (value: string) => void
  onFile: (file?: File) => void
  onNativeFile: () => void
  onPaste: () => void
  onCancel: () => void
  onAbort: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const dismiss = useCallback(() => progress ? onAbort() : onCancel(), [onAbort, onCancel, progress])
  const dialogRef = useDialogFocus(dismiss)
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !progress) onCancel() }}>
    <section ref={dialogRef} tabIndex={-1} className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" aria-describedby="import-boundary">
      <button className="modal-close" onClick={dismiss} aria-label={progress ? '取消导入' : '关闭'}><Icon name="close" /></button>
      <h2 id="import-title">导入记忆快照</h2>
      <p className="modal-lead" id="import-boundary">只选择你有权使用的内容。导入前先脱敏，分析和索引均在本地完成。</p>
      <div className="formats" aria-label="支持的导入格式">{IMPORT_FORMAT_LABELS.map((format) => <span key={format}><Icon name="file" />{format}</span>)}</div>
      {progress ? <div className="import-progress">
        <Icon name="database" size={28} /><strong>正在增量读取与脱敏…</strong><progress max={100} value={progress.percent} aria-label="导入进度" /><span aria-live="polite">{progress.percent}% · 已规范化 {progress.recordsParsed} 条</span><button className="button" onClick={onAbort}>取消导入</button>
      </div> : <>
        {nativeFilePicker ? (
          <button className="dropzone" onClick={onNativeFile}><Icon name="upload" size={26} /><strong>使用系统窗口选择文件</strong><span>桌面应用只接收文件名与通过原生安全预检的内容，不接收绝对路径</span></button>
        ) : (
          <>
            <button className="dropzone" onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onFile(event.dataTransfer.files[0]) }}><Icon name="upload" size={26} /><strong>拖拽文件到此处，或点击选择文件</strong><span>大文件按数据流增量处理，不执行文件内脚本</span></button>
            <input ref={fileRef} hidden type="file" accept={IMPORT_FILE_ACCEPT} onChange={(event) => onFile(event.target.files?.[0])} />
          </>
        )}
        <div className="divider"><span>或者粘贴文本</span></div>
        <textarea value={pasteText} onChange={(event) => onPasteChange(event.target.value)} placeholder="粘贴可见的记忆摘要、规则或聊天摘要…" />
      </>}
      {error && <p className="import-error" role="alert">{error}</p>}
      <div className="privacy-points"><span>✓ 不读取浏览器 Cookie 或已登录网页</span><span>✓ 每次导入生成本地快照，可与已有快照比较</span><span>✓ 不声称展示 AI 厂商的全部隐性记忆</span></div>
      {!progress && <div className="modal-actions"><button className="button" onClick={onCancel}>取消</button><button className="button primary" disabled={!pasteText.trim()} onClick={onPaste}>检查粘贴内容</button></div>}
    </section>
  </div>
}
