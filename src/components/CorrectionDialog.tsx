import { useCallback, useEffect, useState } from 'react'
import type { CorrectionInput } from '../corrections'
import { useDialogFocus } from '../hooks/useDialogFocus'
import type { MemoryRecord, Scope } from '../types'
import { Icon } from './Icon'

export function CorrectionDialog({ record, onCancel, onSave }: {
  record: MemoryRecord
  onCancel: () => void
  onSave: (input: CorrectionInput) => void
}) {
  const [title, setTitle] = useState(record.title)
  const [content, setContent] = useState(record.content)
  const [scope, setScope] = useState<Scope>(record.scope)
  const [reason, setReason] = useState('')
  const dismiss = useCallback(() => onCancel(), [onCancel])
  const dialogRef = useDialogFocus(dismiss)

  useEffect(() => {
    setTitle(record.title)
    setContent(record.content)
    setScope(record.scope)
    setReason('')
  }, [record])

  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onCancel() }}>
    <section ref={dialogRef} tabIndex={-1} className="correction-drawer" role="dialog" aria-modal="true" aria-labelledby="correction-title" aria-describedby="correction-boundary">
      <button className="modal-close" onClick={onCancel} aria-label="关闭"><Icon name="close" /></button>
      <div className="drawer-title"><Icon name="edit" /><div><h2 id="correction-title">编辑修正</h2><p id="correction-boundary">原记录将保留在修改历史中，来源平台不会被自动修改。</p></div></div>
      <label>标题<input data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>内容<textarea value={content} onChange={(event) => setContent(event.target.value)} /></label>
      <label>作用域<select value={scope} onChange={(event) => setScope(event.target.value as Scope)}><option value="global">全局</option><option value="project">项目</option><option value="task">任务</option></select></label>
      <label>修正原因 <em>必填</em><textarea className="reason-input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="说明事实发生了什么变化，以及如何核实…" /></label>
      <div className="correction-preview"><strong>修正预览</strong><p>{content || '尚未填写新内容'}</p><span>原内容：{record.content}</span></div>
      <div className="modal-actions"><button className="button" onClick={onCancel}>取消</button><button className="button primary" disabled={!title.trim() || !content.trim() || !reason.trim()} onClick={() => onSave({ title, content, scope, reason })}>保存修正</button></div>
    </section>
  </div>
}
