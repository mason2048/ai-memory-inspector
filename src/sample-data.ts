import { parseImport } from './importer'
import type { MemorySnapshot } from './types'
import type { CustomRuleSet } from './custom-rules'

const sample = {
  memories: [
    { id: 'sample-key', type: 'sensitive', title: 'OpenAI 调试密钥', content: '临时调试 Key：sk-' + 'test_abcdefghijklmnopqrstuvwxyz7Qx', scope: 'project', source: { uri: 'file:///fictional/chatgpt-export.json', revision: 'sha256:demo-a1', locator: '对话 #32', platform: 'ChatGPT 导出' }, observedAt: '2026-07-03T10:24:00+08:00', confidence: 0.98 },
    { id: 'sample-email', type: 'sensitive', title: '联系邮箱', content: '联系邮箱是 user@example.com', scope: 'global', source: { uri: 'file:///fictional/claude-memory.json', revision: 'sha256:demo-b2', locator: '记忆 #7', platform: 'Claude 导出' }, observedAt: '2026-06-18T09:18:00+08:00', confidence: 0.96 },
    { id: 'sample-shanghai', type: 'fact', title: '居住城市', content: '小林住在上海。', scope: 'global', source: { uri: 'file:///fictional/memory-2025.md', revision: 'sha256:demo-c3', locator: '第 8 行', platform: '本地 Markdown' }, observedAt: '2025-04-01T08:00:00+08:00', confidence: 0.9 },
    { id: 'sample-hangzhou', type: 'fact', title: '居住城市更新', content: '小林已搬到杭州居住。', scope: 'global', source: { uri: 'file:///fictional/memory-2026.md', revision: 'sha256:demo-d4', locator: '第 3 行', platform: '本地 Markdown' }, observedAt: '2026-06-01T08:00:00+08:00', confidence: 0.94 },
    { id: 'sample-project-old', type: 'project-status', title: '翻译项目状态', content: '翻译项目正在进行中，等待最终校对。', scope: 'project', source: { uri: 'file:///fictional/codex-context.md', revision: 'sha256:demo-e5', locator: '项目状态', platform: 'Codex 上下文包' }, observedAt: '2025-08-01T11:30:00+08:00', confidence: 0.7 },
    { id: 'sample-preference-a', type: 'preference', title: '回答偏好', content: '回答请尽量简洁，并优先给出结论。', scope: 'global', source: { uri: 'file:///fictional/preferences.txt', revision: 'sha256:demo-f6', locator: '片段 1', platform: '本地 TXT' }, observedAt: '2026-07-01T12:00:00+08:00', confidence: 0.88 },
    { id: 'sample-preference-b', type: 'preference', title: '回答偏好副本', content: '回答请尽量简洁，并优先给出结论。', scope: 'global', source: { uri: 'file:///fictional/chat-summary.md', revision: 'sha256:demo-g7', locator: '偏好', platform: '聊天摘要' }, observedAt: '2026-07-02T12:00:00+08:00', confidence: 0.82 }
  ]
}

export const sampleRecords = parseImport(JSON.stringify(sample), 'fictional-memory-export.json')

const snapshotRecord = (value: Record<string, unknown>) => parseImport(JSON.stringify([value]), 'fictional-snapshot.json')[0]

export const sampleSnapshots: MemorySnapshot[] = [
  {
    id: 'snapshot-2026-07-01',
    name: '2026-07-01 导出',
    capturedAt: '2026-07-01T09:00:00+08:00',
    records: [
      snapshotRecord({ id: 'profile-city', type: 'fact', title: '居住城市', content: '小林住在上海。', source: { uri: 'file:///fictional/profile.md', revision: 'v1', locator: '居住城市', platform: 'ChatGPT 导出' }, observedAt: '2026-06-20T14:22:00+08:00', confidence: 0.9 }),
      snapshotRecord({ id: 'project-status', type: 'project-status', title: '翻译项目状态', content: '翻译项目正在进行中。', scope: 'project', source: { uri: 'file:///fictional/project.md', revision: 'v1', locator: '项目状态', platform: 'Codex 上下文包' }, observedAt: '2026-06-28T11:00:00+08:00', confidence: 0.82 }),
      snapshotRecord({ id: 'obsolete-rule', type: 'instruction', title: '旧邮箱规则', content: '所有通知发送到旧邮箱。', source: { uri: 'file:///fictional/rules.md', revision: 'v1', locator: '旧邮箱', platform: 'Claude 导出' }, observedAt: '2026-05-10T08:00:00+08:00', confidence: 0.75 }),
      snapshotRecord({ id: 'language', type: 'preference', title: '语言偏好', content: '使用简体中文回答。', source: { uri: 'file:///fictional/preferences.md', revision: 'v1', locator: '语言', platform: '本地 Markdown' }, observedAt: '2026-06-01T08:00:00+08:00', confidence: 0.92 }),
    ],
  },
  {
    id: 'snapshot-2026-08-12',
    name: '2026-08-12 导出',
    capturedAt: '2026-08-12T09:15:00+08:00',
    records: [
      snapshotRecord({ id: 'profile-city', type: 'fact', title: '居住城市', content: '小林已搬到杭州居住。', source: { uri: 'file:///fictional/profile.md', revision: 'v2', locator: '居住城市', platform: 'ChatGPT 导出' }, observedAt: '2026-08-12T09:15:00+08:00', confidence: 0.97 }),
      snapshotRecord({ id: 'project-status', type: 'project-status', title: '翻译项目状态', content: '翻译项目已完成并归档。', scope: 'project', source: { uri: 'file:///fictional/project.md', revision: 'v2', locator: '项目状态', platform: 'Codex 上下文包' }, observedAt: '2026-08-10T18:00:00+08:00', confidence: 0.96 }),
      snapshotRecord({ id: 'theme', type: 'preference', title: '界面主题偏好', content: '偏好使用深色主题。', source: { uri: 'file:///fictional/preferences.md', revision: 'v2', locator: '主题', platform: '本地 Markdown' }, observedAt: '2026-08-01T08:00:00+08:00', confidence: 0.86 }),
      snapshotRecord({ id: 'language', type: 'preference', title: '语言偏好', content: '使用简体中文回答。', source: { uri: 'file:///fictional/preferences.md', revision: 'v1', locator: '语言', platform: '本地 Markdown' }, observedAt: '2026-06-01T08:00:00+08:00', confidence: 0.92 }),
    ],
  },
]

export const defaultCustomRuleSet: CustomRuleSet = {
  schemaVersion: '1',
  rules: [
    { id: 'financial-information', enabled: true, match: { operator: 'contains', field: 'content', value: '银行卡', caseSensitive: false }, severity: 'high', kind: 'sensitive', title: '可能包含财务信息', explanation: '本地规则命中“银行卡”，请回到来源人工核实并决定是否清理。' },
    { id: 'medical-information', enabled: true, match: { operator: 'regex', field: 'content', pattern: '(病历|诊断|处方)', flags: '' }, severity: 'high', kind: 'sensitive', title: '可能包含医疗信息', explanation: '本地规则命中医疗相关词语，请人工确认敏感级别。' },
    { id: 'old-observation', enabled: true, match: { operator: 'date-before', field: 'observedAt', value: '2025-01-01' }, severity: 'medium', kind: 'stale', title: '观察时间早于 2025 年', explanation: '记录观察时间较早，需要回到来源核实是否仍然有效。' },
  ],
}
