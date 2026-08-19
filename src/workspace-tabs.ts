export type WorkspaceView = 'report' | 'memories' | 'compare' | 'rules'

export const WORKSPACE_TABS = [
  { view: 'report', icon: 'report', label: '检查报告' },
  { view: 'memories', icon: 'database', label: '全部记忆' },
  { view: 'compare', icon: 'compare', label: '快照对比' },
  { view: 'rules', icon: 'rules', label: '规则与清单' },
] as const satisfies ReadonlyArray<{
  view: WorkspaceView
  icon: string
  label: string
}>

export function resolveWorkspaceTabKey(
  current: WorkspaceView,
  key: string,
): WorkspaceView | undefined {
  const currentIndex = WORKSPACE_TABS.findIndex(({ view }) => view === current)
  if (key === 'Home') return WORKSPACE_TABS[0].view
  if (key === 'End') return WORKSPACE_TABS.at(-1)?.view
  if (key !== 'ArrowRight' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowUp') {
    return undefined
  }
  const direction = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1
  const nextIndex = (currentIndex + direction + WORKSPACE_TABS.length) % WORKSPACE_TABS.length
  return WORKSPACE_TABS[nextIndex].view
}
