import { describe, expect, it } from 'vitest'
import {
  isWorkspaceToolAllowed,
  isWorkspaceMutationAllowed,
  workspaceProposalMode,
} from '../workspace-safety'

describe('workspace proposal boundary', () => {
  it('overrides every saved write policy for the web surface', () => {
    for (const approvalPolicy of ['always', 'approval', 'never', undefined] as const) {
      expect(
        workspaceProposalMode({
          role: 'workspace_assistant',
          workspaceThreadKey: 'workspace:owned',
          risk: 'write',
          approvalPolicy,
        })
      ).toBe('propose')
    }
    expect(
      workspaceProposalMode({
        role: 'workspace_assistant',
        workspaceThreadKey: 'slack:T:C:1',
        risk: 'write',
        approvalPolicy: 'always',
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
  it('blocks delete branches even when a multiplexed tool is allowed', () => {
    expect(isWorkspaceMutationAllowed('manage_category', { action: 'create', name: 'Acme' })).toBe(
      true
    )
    for (const action of ['delete', 'remove', 'archive'])
      expect(isWorkspaceMutationAllowed('manage_category', { action })).toBe(false)
    expect(
      isWorkspaceMutationAllowed('update_article', { patch: { deletedAt: '2026-10-03' } })
    ).toBe(false)
    expect(isWorkspaceMutationAllowed('create_post', { title: 'Please delete this wording' })).toBe(
      true
    )
  })
})
