import { describe, expect, it } from 'vitest'
import { resolveEffectiveToolMode } from '../assistant.tools'
import type { AssistantToolContext } from '../assistant.toolspec'
import type { AssistantToolSpec } from '../assistant.toolspec'

function ctx(policy: AssistantToolContext['writeToolPolicy'] = 'execute'): AssistantToolContext {
  return { writeToolPolicy: policy } as AssistantToolContext
}

function spec(partial: Partial<AssistantToolSpec>): AssistantToolSpec {
  return {
    name: 'connector_acme__issue_refund',
    label: 'Issue refund',
    description: 'Refund',
    promptGuidance: 'Refund',
    risk: 'write',
    permissions: [],
    parents: ['conversation', 'ticket'],
    definition: {} as AssistantToolSpec['definition'],
    execute: async () => ({}),
    summarize: () => 'Issue refund',
    ...partial,
  }
}

describe('connector approvalPolicy', () => {
  it('maps always to autonomous even on a propose surface', () => {
    expect(resolveEffectiveToolMode(spec({ approvalPolicy: 'always' }), ctx('propose'))).toBe(
      'autonomous'
    )
  })

  it('maps approval to propose even on an execute surface', () => {
    expect(resolveEffectiveToolMode(spec({ approvalPolicy: 'approval' }), ctx('execute'))).toBe(
      'propose'
    )
  })

  it('leaves built-ins (no override) on the role policy', () => {
    expect(resolveEffectiveToolMode(spec({ approvalPolicy: undefined }), ctx('propose'))).toBe(
      'propose'
    )
    expect(resolveEffectiveToolMode(spec({ approvalPolicy: undefined }), ctx('execute'))).toBe(
      'autonomous'
    )
  })

  it('workspace create/assign feedback with always runs as the asking teammate', () => {
    const workspace = {
      role: 'workspace_assistant',
      writeToolPolicy: 'propose',
    } as AssistantToolContext
    expect(
      resolveEffectiveToolMode(spec({ name: 'create_post', approvalPolicy: 'always' }), workspace)
    ).toBe('autonomous')
    expect(
      resolveEffectiveToolMode(spec({ name: 'delete_post', approvalPolicy: 'approval' }), workspace)
    ).toBe('propose')
  })
})
