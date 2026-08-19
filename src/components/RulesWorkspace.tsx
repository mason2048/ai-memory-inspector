import { useCallback } from 'react'
import type { CleanupChecklist } from '../cleanup'
import type { CustomRuleSet } from '../custom-rules'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { Icon } from './Icon'

const severityLabels = { blocker: '阻断', high: '高风险', medium: '中风险', low: '低风险' }

export function RulesWorkspace({ ruleSet, checklist, ruleImportOpen, ruleText, ruleError, onToggle, onOpenImport, onCloseImport, onRuleText, onImport, onExportChecklist }: {
  ruleSet: CustomRuleSet
  checklist: CleanupChecklist
  ruleImportOpen: boolean
  ruleText: string
  ruleError: string
  onToggle: (id: string) => void
  onOpenImport: () => void
  onCloseImport: () => void
  onRuleText: (value: string) => void
  onImport: () => void
  onExportChecklist: () => void
}) {
  const enabled = ruleSet.rules.filter((rule) => rule.enabled).length
  const dismiss = useCallback(() => onCloseImport(), [onCloseImport])
  const dialogRef = useDialogFocus(dismiss, ruleImportOpen)
  return <div className="workspace rules-workspace" id="workspace-rules" role="tabpanel" aria-labelledby="tab-rules">
    <aside className="workspace-sidebar rules-sidebar"><h2>规则概览</h2><div className="rules-stat"><strong>{enabled}</strong><span>已启用规则</span></div><div className="rules-stat"><strong>{ruleSet.rules.length - enabled}</strong><span>已停用规则</span></div><div className="rules-stat"><strong>{checklist.totalSteps}</strong><span>人工清理步骤</span></div><section><h2>安全边界</h2><p>规则只匹配标准化文本、日期和来源字段；不执行脚本、函数或导入内容中的指令。</p></section></aside>
    <main className="rules-main"><div className="rules-heading"><div><h1>本地规则</h1><p>数据规则在离线环境运行，所有命中均显示为“规则命中”。</p></div><button className="button" onClick={onOpenImport}><Icon name="upload" />导入规则 JSON</button></div><div className="rules-table-head"><span>状态</span><span>规则</span><span>匹配条件</span><span>风险与类型</span></div><div className="rules-list">{ruleSet.rules.map((rule) => <article className="rule-row" key={rule.id}><label className="switch"><span className="sr-only">{rule.title}</span><input type="checkbox" aria-label={`${rule.title}：${rule.enabled ? '已启用' : '已停用'}`} checked={rule.enabled} onChange={() => onToggle(rule.id)} /><span aria-hidden="true" /></label><div><strong>{rule.title}</strong><small>{rule.explanation}</small></div><code>{rule.match.operator} · {rule.match.field} · {'value' in rule.match ? rule.match.value : rule.match.pattern}</code><div><i className={`severity-tag ${rule.severity}`}>{severityLabels[rule.severity]}</i><small>{rule.kind}</small></div></article>)}</div><div className="rule-safety"><Icon name="shield" /><div><strong>规则不执行脚本</strong><p>导入时仅接受白名单字段；正则表达式限制长度和复杂度，并禁止无界重复、回溯引用和前后查找。</p></div></div></main>
    <aside className="checklist-panel"><div className="checklist-heading"><div><h2>平台清理清单</h2><p>仅生成人工步骤，未操作任何平台。</p></div><button className="text-button" onClick={onExportChecklist}>导出</button></div>{checklist.groups.length ? <div className="platform-groups">{checklist.groups.map((group) => <section key={group.platform}><header><strong>{group.label}</strong><span>{group.steps.length} 项</span></header>{group.steps.map((step) => <article key={step.id}><i className={`cleanup-action ${step.action}`}>{step.action === 'delete' ? '删除' : step.action === 'correct' ? '修正' : '复核'}</i><div><strong>{step.issueTitle}</strong><p>{step.source.locator} · {step.source.revision}</p><small>{step.instruction}</small></div></article>)}</section>)}</div> : <div className="empty"><Icon name="check" size={30} /><strong>当前没有清理步骤</strong><span>保留和忽略的问题不会进入清单。</span></div>}<div className="warning checklist-boundary"><strong>清单 ≠ 已执行</strong><p>{checklist.boundary}</p></div></aside>
    {ruleImportOpen && <div className="modal-backdrop"><section ref={dialogRef} tabIndex={-1} className="rule-import-modal" role="dialog" aria-modal="true" aria-labelledby="rule-import-title" aria-describedby="rule-import-boundary"><button className="modal-close" onClick={onCloseImport} aria-label="关闭"><Icon name="close" /></button><h2 id="rule-import-title">导入本地规则 JSON</h2><p id="rule-import-boundary">只接受声明式白名单格式。导入内容不会作为代码执行。</p><pre>{`{"schemaVersion":"1","rules":[{"id":"example","enabled":true,"match":{"operator":"contains","field":"content","value":"已归档"},"severity":"medium","kind":"stale","title":"旧记录","explanation":"请人工核实"}]}`}</pre><textarea data-autofocus value={ruleText} onChange={(event) => onRuleText(event.target.value)} placeholder="粘贴规则 JSON…" />{ruleError && <p className="import-error" role="alert">{ruleError}</p>}<div className="modal-actions"><button className="button" onClick={onCloseImport}>取消</button><button className="button primary" disabled={!ruleText.trim()} onClick={onImport}>验证并导入</button></div></section></div>}
  </div>
}
