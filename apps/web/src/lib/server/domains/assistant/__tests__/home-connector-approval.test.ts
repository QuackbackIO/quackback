import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import type { Actor } from '@/lib/server/policy/types'
import type { AssistantToolSpec } from '../assistant.toolspec'
import { fakePendingActionRow } from './assistant-tool-fixtures'

vi.mock('@/lib/server/config', () => ({ config: {} }))

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  specs: new Map<string, unknown>(),
  decisions: [] as Array<[string, string]>,
  executed: [] as unknown[],
}))

vi.mock('../pending-actions.service', () => ({
  getPendingActionById: async (id: string) => (state.row?.id === id ? state.row : null),
  decidePendingAction: async (id: string, decision: string) => {
    if (state.row?.id !== id || state.row.status !== 'proposed') return null
    state.decisions.push([id, decision])
    state.row = { ...state.row, status: decision }
    return state.row
  },
  markPendingActionExecuted: async (id: string, result: unknown) => {
    if (state.row?.id !== id) return null
    state.row = { ...state.row, status: 'executed', result }
    return state.row
  },
  markPendingActionFailed: async (id: string, error: string) => {
    if (state.row?.id !== id) return null
    state.row = { ...state.row, status: 'failed', result: { error } }
    return state.row
  },
}))
vi.mock('../pending-action-parent', () => ({
  assertPendingWorkspaceParent: async (pending: { workspaceThreadKey: string }, actor: Actor) => {
    if (pending.workspaceThreadKey !== 'workspace:owned' || actor.principalId !== 'principal_owner')
      throw new Error('Pending action not found')
  },
}))
vi.mock('../connectors/connector-tools', () => ({
  // Copilot's connector catalogue is the only one Home resolves against.
  getConnectorSpecByToolName: async (name: string, agent: string) =>
    agent === 'copilot' ? (state.specs.get(name) ?? null) : null,
}))
vi.mock('../mcp-workspace-tools', () => ({ getWorkspaceMcpSpecByName: async () => null }))
vi.mock('../assistant.principal', () => ({
  ensureAssistantPrincipal: async () => ({ id: 'principal_assistant', displayName: 'Quinn' }),
}))
vi.mock('../tool-audit', () => ({
  claimToolCall: async (input: { pendingActionId: string }) => ({
    id: `call_${input.pendingActionId}`,
  }),
  finalizeToolCall: async () => undefined,
  recordDeniedToolCall: async () => undefined,
}))

import { decideAssistantAction } from '../assistant-actions.service'

const owner: Actor = {
  principalId: 'principal_owner' as never,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
  permissions: new Set(),
}

function connector(risk: 'read' | 'write', name: string): AssistantToolSpec {
  return {
    name,
    label: 'Find order',
    description: 'Acme orders',
    promptGuidance: 'Acme orders',
    risk,
    permissions: [],
    parents: ['conversation', 'ticket'],
    connector: { name: 'Acme', initials: 'AC' },
    definition: toolDefinition({
      name,
      description: 'Acme orders',
      inputSchema: z.object({ order: z.string() }),
      outputSchema: z.unknown(),
    }),
    execute: async (args) => {
      state.executed.push(args)
      return { order: (args as { order: string }).order, total: 42 }
    },
    summarize: () => 'Find order',
  }
}

function proposed(toolName: string) {
  state.row = fakePendingActionRow({
    id: 'assistant_action_home',
    conversationId: null,
    involvementId: null,
    workspaceThreadKey: 'workspace:owned',
    originRole: 'workspace_assistant',
    toolName,
    args: { order: 'A-1' },
  }) as unknown as Record<string, unknown>
}

beforeEach(() => {
  state.row = null
  state.specs.clear()
  state.decisions = []
  state.executed = []
})

describe('Home connector calls', () => {
  it('runs an allowed read once and stores its result', async () => {
    state.specs.set('connector_acme__find_order', connector('read', 'connector_acme__find_order'))
    proposed('connector_acme__find_order')
    const settled = await decideAssistantAction(
      'assistant_action_home' as never,
      'approved',
      owner.principalId!,
      owner
    )
    expect(state.executed).toEqual([{ order: 'A-1' }])
    expect(state.decisions).toEqual([['assistant_action_home', 'approved']])
    expect(settled).toMatchObject({ status: 'executed', result: { order: 'A-1', total: 42 } })
  })

  it('sends nothing to the connector on Skip', async () => {
    state.specs.set('connector_acme__find_order', connector('read', 'connector_acme__find_order'))
    proposed('connector_acme__find_order')
    const settled = await decideAssistantAction(
      'assistant_action_home' as never,
      'rejected',
      owner.principalId!,
      owner
    )
    expect(settled.status).toBe('rejected')
    expect(state.executed).toEqual([])
  })

  it('never runs a connector write from Home, even when allowed', async () => {
    state.specs.set(
      'connector_acme__refund_order',
      connector('write', 'connector_acme__refund_order')
    )
    proposed('connector_acme__refund_order')
    await expect(
      decideAssistantAction('assistant_action_home' as never, 'approved', owner.principalId!, owner)
    ).rejects.toMatchObject({ code: 'ASSISTANT_ACTION_POLICY_CHANGED' })
    expect(state.executed).toEqual([])
    expect(state.decisions).toEqual([])
  })

  it('refuses any other Home proposal than settings and connector reads', async () => {
    proposed('create_post')
    await expect(
      decideAssistantAction('assistant_action_home' as never, 'approved', owner.principalId!, owner)
    ).rejects.toMatchObject({ code: 'ASSISTANT_ACTION_POLICY_CHANGED' })
    expect(state.decisions).toEqual([])
  })
})
