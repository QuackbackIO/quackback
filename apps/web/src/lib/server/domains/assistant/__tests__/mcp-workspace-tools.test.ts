import { afterEach, describe, expect, it } from 'vitest'
import { generateId } from '@quackback/ids'
import { API_KEY_SCOPES } from '@/lib/shared/api-key-scopes'
import { openWorkspaceMcp } from '../mcp-workspace-tools'
import type { McpAuthContext } from '@/lib/server/mcp/types'

describe('workspace MCP tools', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('exposes the first-party MCP catalogue, not the old workspace list built-ins', async () => {
    const auth: McpAuthContext = {
      principalId: generateId('principal'),
      name: 'Test',
      role: 'admin',
      authMethod: 'oauth',
      scopes: [...API_KEY_SCOPES],
    }
    const opened = await openWorkspaceMcp(auth)
    close = opened.close
    const names = opened.specs.map((spec) => spec.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'search',
        'get_details',
        'list_tickets',
        'create_post',
        'triage_post',
        'add_comment',
      ])
    )
    expect(names).not.toContain('list_feedback')
    expect(names).not.toContain('feedback_stats')
    expect(opened.specs.find((spec) => spec.name === 'search')?.risk).toBe('read')
    expect(opened.specs.find((spec) => spec.name === 'create_post')?.risk).toBe('write')
    expect(opened.specs.find((spec) => spec.name === 'create_post')?.approvalPolicy).toBe('always')
    expect(opened.specs.find((spec) => spec.name === 'triage_post')?.approvalPolicy).toBe('always')
    expect(opened.specs.find((spec) => spec.name === 'triage_post')?.promptGuidance).toContain(
      'ownerPrincipalId "me"'
    )
    expect(opened.specs.find((spec) => spec.name === 'search')?.promptGuidance).toContain(
      'authorPrincipalId "me"'
    )
    expect(opened.specs.find((spec) => spec.name === 'delete_post')?.approvalPolicy).toBe(
      'approval'
    )
  })
})
