import { useCallback, useState } from 'react'
import { useDialogFocus } from '../hooks/useDialogFocus'

export type BackupDialogMode = 'export' | 'restore'

export function BackupDialog({
  mode,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  mode: BackupDialogMode
  busy: boolean
  error: string
  onCancel: () => void
  onSubmit: (passphrase: string) => void
}) {
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const dismiss = useCallback(() => {
    if (!busy) onCancel()
  }, [busy, onCancel])
  const dialogRef = useDialogFocus(dismiss)
  const exporting = mode === 'export'
  const valid =
    passphrase.length >= 12 && passphrase.length <= 1024 && (!exporting || passphrase === confirmation)

  return (
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="import-modal backup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-dialog-title"
        aria-describedby="backup-dialog-boundary"
      >
        <h2 id="backup-dialog-title">{exporting ? '创建完整加密备份' : '恢复完整加密备份'}</h2>
        <p id="backup-dialog-boundary" className="modal-lead">
          {exporting
            ? '选择一个独立恢复口令。系统钥匙串密钥不会写入备份，口令遗失后无法恢复。'
            : '先完整验证备份格式、口令和完整性，全部通过后才会原子替换当前本地项目。'}
        </p>
        <label className="backup-field">
          恢复口令（至少 12 个字符）
          <input
            data-autofocus
            type="password"
            autoComplete="new-password"
            value={passphrase}
            disabled={busy}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </label>
        {exporting ? (
          <label className="backup-field">
            再次输入恢复口令
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        ) : null}
        {exporting && confirmation && passphrase !== confirmation ? (
          <p className="import-error" role="alert">
            两次输入的恢复口令不一致。
          </p>
        ) : null}
        {error ? (
          <p className="import-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="backup-warning">
          应用不会保存恢复口令。恢复会替换本应用资料库，不会修改 ChatGPT、Claude、Codex
          或任何来源平台的数据。
        </p>
        <div className="modal-actions">
          <button className="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            className={`button ${mode === 'restore' ? 'danger' : 'primary'}`}
            disabled={busy || !valid}
            onClick={() => onSubmit(passphrase)}
          >
            {busy ? '正在处理…' : exporting ? '选择位置并导出' : '选择备份并恢复'}
          </button>
        </div>
      </section>
    </div>
  )
}
