import { afterEach, describe, expect, it } from 'vitest'
import { convertSchemaToJsonSchema, parseWithStandardSchema, type SchemaInput } from '@tanstack/ai'
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
  it('keeps area enums and nested patch validation in the model-facing tool schemas', async () => {
    const opened = await openWorkspaceMcp({
      principalId: generateId('principal'),
      name: 'Acme',
      role: 'admin',
      authMethod: 'oauth',
      scopes: [...API_KEY_SCOPES],
    })
    close = opened.close
    const schema = (name: string) =>
      opened.specs.find((spec) => spec.name === name)!.definition.inputSchema as SchemaInput
    const propose = schema('propose_settings_change')
    const validate = (input: SchemaInput, value: unknown) => () =>
      parseWithStandardSchema(input, value)
    expect(
      validate(propose, {
        changes: [
          { area: 'modules', patch: { supportInbox: true, supportTickets: true } },
          { area: 'branding', patch: { light: { primary: '#0F766E' } } },
        ],
      })
    ).not.toThrow()
    for (const change of [
      { area: 'billing', patch: { plan: 'business' } },
      { area: 'modules', patch: { supportTickets: 'yes' } },
      { area: 'messenger', patch: { supportTickets: true } },
      { area: 'portal', patch: { deletedAt: '2026-10-03' } },
    ])
      expect(validate(propose, { changes: [change] })).toThrow()
    expect(validate(propose, { changes: [] })).toThrow()
    expect(validate(schema('get_settings'), { area: 'messenger' })).not.toThrow()
    expect(validate(schema('get_settings'), { area: 'billing' })).toThrow()
    expect(validate(schema('navigate_workspace'), { destination: 'members' })).not.toThrow()
    expect(validate(schema('navigate_workspace'), { destination: 'invented' })).toThrow()
    const modelSchema = JSON.stringify(convertSchemaToJsonSchema(propose))
    expect(modelSchema).toContain('supportTickets')
    expect(modelSchema).toContain('modules')
    expect(modelSchema).toContain('primary')
    expect(modelSchema).not.toContain('\\p{L}')
    expect(modelSchema).not.toContain('\\p{N}')
    expect(modelSchema).toContain('oklch')
    expect(
      validate(propose, {
        changes: [{ area: 'branding', patch: { light: { fontSans: 'Équipe, sans-serif' } } }],
      })
    ).not.toThrow()
    expect(
      validate(propose, {
        changes: [{ area: 'branding', patch: { light: { fontSans: 'Acme 🦆' } } }],
      })
    ).toThrow()
  })
})
