import { describe, expect, it } from 'vitest'
import { resolveWorkspaceTabKey, WORKSPACE_TABS } from './workspace-tabs'

describe('workspace tab keyboard navigation', () => {
  it('includes all memories between report and comparison', () => {
    expect(WORKSPACE_TABS.map(({ view }) => view)).toEqual([
      'report',
      'memories',
      'compare',
      'rules',
    ])
  })

  it('moves with arrow keys, wraps, and supports Home and End', () => {
    expect(resolveWorkspaceTabKey('report', 'ArrowRight')).toBe('memories')
    expect(resolveWorkspaceTabKey('memories', 'ArrowDown')).toBe('compare')
    expect(resolveWorkspaceTabKey('report', 'ArrowLeft')).toBe('rules')
    expect(resolveWorkspaceTabKey('rules', 'ArrowRight')).toBe('report')
    expect(resolveWorkspaceTabKey('compare', 'Home')).toBe('report')
    expect(resolveWorkspaceTabKey('report', 'End')).toBe('rules')
    expect(resolveWorkspaceTabKey('report', 'Tab')).toBeUndefined()
  })
})
