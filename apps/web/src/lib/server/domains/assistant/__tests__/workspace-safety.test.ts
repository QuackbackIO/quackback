import { describe, expect, it } from 'vitest'
import {
  agentKindForTurn,
  isHomeTurn,
  isWorkspaceToolAllowed,
  workspaceProposalMode,
} from '../workspace-safety'

describe('workspace proposal boundary', () => {
  it('permits reading Messenger installation status while refusing installation writes', () => {
    expect(isWorkspaceToolAllowed('widget_install_status', 'read')).toBe(true)
    expect(isWorkspaceToolAllowed('widget_install_status', 'write')).toBe(false)
    expect(isWorkspaceToolAllowed('install_snippet', 'write')).toBe(false)
  })
  it('detects Home from the persisted thread key the same way the runtime does', () => {
    expect(agentKindForTurn('workspace_assistant', 'workspace:owned')).toBe('copilot')
    expect(agentKindForTurn('workspace_assistant', JSON.stringify(['T', 'C', '1']))).toBe(
      'workspace'
    )
    expect(agentKindForTurn('copilot_qa', 'workspace:owned')).toBe('copilot')
    expect(isHomeTurn({ role: 'copilot_qa', agentKind: 'copilot' })).toBe(false)
    expect(isHomeTurn({ role: 'workspace_assistant', agentKind: 'copilot' })).toBe(true)
  })
  it('proposes every Home write and connector call, and nothing on Slack', () => {
    const home = { role: 'workspace_assistant', agentKind: 'copilot' } as const
    expect(workspaceProposalMode({ ...home, name: 'propose_settings_change', risk: 'write' })).toBe(
      'propose'
    )
    expect(workspaceProposalMode({ ...home, name: 'connector_acme__find', risk: 'read' })).toBe(
      'propose'
    )
    expect(workspaceProposalMode({ ...home, name: 'search_posts', risk: 'read' })).toBeNull()
    expect(
      workspaceProposalMode({
        role: 'workspace_assistant',
        agentKind: 'workspace',
        name: 'connector_acme__find',
        risk: 'write',
      })
    ).toBeNull()
  })
  it('omits high radius, destructive and unknown write tools', () => {
    for (const name of [
      'delete_post',
      'delete_comment',
      'delete_article',
      'delete_conversation',
      'delete_ticket',
      'manage_members',
      'install_snippet',
      'connector_delete',
      'unknown_write',
    ])
      expect(isWorkspaceToolAllowed(name, 'write')).toBe(false)
    expect(isWorkspaceToolAllowed('search', 'read')).toBe(true)
    expect(isWorkspaceToolAllowed('navigate_workspace', 'read')).toBe(true)
    expect(isWorkspaceToolAllowed('propose_settings_change', 'write')).toBe(true)
    expect(isWorkspaceToolAllowed('create_post', 'write')).toBe(false)
  })
})
