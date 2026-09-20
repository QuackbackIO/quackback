import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'
import { canViewConversation } from '@/lib/server/policy/conversation'
import type { Actor } from '@/lib/server/policy/types'
import { fakePendingActionRow } from '@/lib/server/domains/assistant/__tests__/assistant-tool-fixtures'

// Exercise the real requireAuth, including its session audience and permission
// checks. Only the session store and domain IO are replaced.
const state = vi.hoisted(() => ({
  scope: 'portal',
  permissions: [] as string[],
  action: {} as ReturnType<typeof fakePendingActionRow>,
  receipt: {
    id: 'receipt_1',
    conversationId: 'conversation_1',
    pendingActionId: 'assistant_action_1',
  } as {
    id: string
    conversationId: string | null
    pendingActionId: string | null
  },
}))
vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    let schema: { parse: (v: unknown) => unknown } | undefined
    const builder = {
      validator(next: typeof schema) {
        schema = next
        return builder
      },
      handler(fn: (args: { data: unknown }) => unknown) {
        return (args?: { data: unknown }) =>
          fn({ data: schema ? schema.parse(args?.data) : args?.data })
      },
    }
    return builder
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))
vi.mock('@/lib/server/auth', () => ({
  auth: {
    api: {
      getSession: async () => ({
        session: { scope: state.scope },
        user: { id: 'user_1', email: 'visitor@example.com', name: 'Visitor' },
      }),
    },
  },
}))
vi.mock('../auth-request-cache', () => ({
  memoizePerRequest: (_key: string, fn: () => unknown) => fn(),
}))
vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: async () => ({ id: 'principal_1', role: 'member', type: 'user' }) },
    },
  },
  principal: {},
  eq: (a: unknown, b: unknown) => [a, b],
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  requireSettingsCached: async () => ({ id: 'workspace_1', slug: 'test', name: 'Test' }),
}))
vi.mock('@/lib/server/domains/principals/principal.factory', () => ({
  ensurePrincipalForUser: vi.fn(),
}))
vi.mock('@/lib/server/policy/permissions', () => ({
  permissionsForPrincipal: async () => new Set(state.permissions),
}))
vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: async () => new Set(),
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: async (id: string, actor: Actor) => {
    if (
      id !== 'conversation_1' ||
      !canViewConversation(actor, {
        visitorPrincipalId: 'principal_1' as never,
        status: 'open',
      }).allowed
    )
      throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
  },
}))
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  assertTicketVisible: async (id: string, actor: Actor) => {
    if (id !== 'ticket_visible' || !actor.permissions?.has(PERMISSIONS.TICKET_VIEW)) {
      throw new NotFoundError('TICKET_NOT_FOUND', 'Ticket not found')
    }
  },
}))
vi.mock('@/lib/server/domains/assistant/run-inspection', () => ({
  findAssistantRunParent: async (id: string) =>
    id === 'run_1' ? { conversationId: 'conversation_1', ticketId: null } : null,
  getAssistantRunInspection: async (id: string) => ({ id, evidence: ['internal'] }),
  listAssistantRunsForConversation: async (id: string) => [{ id: 'run_1', conversationId: id }],
  listAssistantRunsForTicket: vi.fn(),
}))
vi.mock('@/lib/server/domains/assistant/assistant-recovery', () => ({
  cancelAssistantRun: vi.fn(),
  retryFailedAssistantRun: vi.fn(),
}))
vi.mock('@/lib/server/domains/assistant/pending-actions.service', () => ({
  getPendingActionById: async (id: string) => (id === state.action.id ? state.action : null),
  listDecidablePendingActions: async () => [state.action],
  listUnconfirmedPendingActions: async () => [],
  decidePendingAction: async (id: string, status: string) =>
    id === state.action.id ? { ...state.action, status } : null,
  decideAndEnqueuePendingAction: async (input: { id: string; decision: string }) =>
    input.id === state.action.id
      ? { action: { ...state.action, status: input.decision, executionState: 'queued' } }
      : null,
  settleReconciledPendingAction: vi.fn(),
}))
vi.mock('@/lib/server/domains/assistant/tool-audit', () => ({
  getToolCallById: async (id: string) => (id === state.receipt.id ? state.receipt : null),
  findReceiptForPendingAction: async (id: string) =>
    id === state.receipt.pendingActionId ? state.receipt : null,
  listUnreconciledToolCalls: async () => [],
  reconcileToolCall: async (id: string, input: { verdict: string }) =>
    id === state.receipt.id ? { ...state.receipt, reconciliationState: input.verdict } : null,
}))
vi.mock('@/lib/server/domains/assistant/assistant.toolspec', () => ({
  getToolSpecByName: () => null,
}))
vi.mock('@/lib/server/domains/assistant/mcp-workspace-tools', () => ({
  getWorkspaceMcpSpecByName: async () => null,
}))
vi.mock('@/lib/server/domains/assistant/connectors/connector-tools', () => ({
  resolveConnectorApprovalSpec: async ({ toolName }: { toolName: string }) =>
    toolName === 'connector_acme__write'
      ? {
          status: 'ok',
          spec: {
            name: toolName,
            risk: 'write',
            permissions: [],
            parents: ['conversation', 'ticket'],
            definition: { inputSchema: z.object({ reason: z.string() }) },
          },
        }
      : { status: 'absent' },
}))

import { listAssistantRunsFn, getAssistantRunFn } from '../assistant-runs'
import {
  getAssistantPendingActionFn,
  listAssistantReviewQueueFn,
  reconcileAssistantActionFn,
} from '../assistant-pending-actions'
import {
  approveAssistantActionFn,
  rejectAssistantActionFn,
  decideAssistantAction,
} from '../assistant-actions'

beforeEach(() => {
  state.scope = 'portal'
  state.permissions = [
    PERMISSIONS.CONVERSATION_VIEW,
    PERMISSIONS.CONVERSATION_REPLY,
    PERMISSIONS.TICKET_VIEW,
  ]
  state.action = fakePendingActionRow({ toolName: 'connector_acme__write' })
  state.receipt = {
    id: 'receipt_1',
    conversationId: 'conversation_1',
    pendingActionId: state.action.id,
  }
})

const surfaces = [
  [
    'listAssistantRunsFn',
    () => listAssistantRunsFn({ data: { conversationId: 'conversation_1' } }),
  ],
  ['getAssistantRunFn', () => getAssistantRunFn({ data: { runId: 'run_1' } })],
  [
    'getAssistantPendingActionFn',
    () => getAssistantPendingActionFn({ data: { pendingActionId: state.action.id } }),
  ],
  ['listAssistantReviewQueueFn', () => listAssistantReviewQueueFn()],
  [
    'reconcileAssistantActionFn',
    () =>
      reconcileAssistantActionFn({
        data: { receiptId: 'receipt_1', verdict: 'resolved', note: 'Confirmed' },
      }),
  ],
  [
    'approveAssistantActionFn',
    () => approveAssistantActionFn({ data: { pendingActionId: state.action.id } }),
  ],
  [
    'rejectAssistantActionFn',
    () => rejectAssistantActionFn({ data: { pendingActionId: state.action.id } }),
  ],
] as const

describe.each(surfaces)(
  '%s requires team authority in addition to parent visibility',
  (_name, invoke) => {
    it('refuses the portal session owning the conversation, including a promoted principal', async () => {
      await expect(invoke()).rejects.toThrow(
        /Access denied: Requires permission 'conversation.view'/
      )
    })
    it('refuses a dashboard session without the declared baseline', async () => {
      state.scope = 'dashboard'
      state.permissions = [PERMISSIONS.CONVERSATION_REPLY]
      await expect(invoke()).rejects.toThrow(
        /Access denied: Requires permission 'conversation.view'/
      )
    })
    it('admits the authorized teammate for the same parent', async () => {
      state.scope = 'dashboard'
      expect(await invoke()).toBeDefined()
    })
  }
)

it('a connector write with no declared permissions still refuses a visitor at the domain decision', async () => {
  await expect(
    decideAssistantAction(state.action.id, 'approved', 'principal_1' as never, {
      principalId: 'principal_1' as never,
      role: 'user',
      principalType: 'user',
      permissions: new Set(),
      segmentIds: new Set(),
    })
  ).rejects.toMatchObject({ statusCode: 403 })
})

it.each(['ticket_hidden', null])(
  'reconciliation refuses an inaccessible proposal parent %s',
  async (ticketId) => {
    state.scope = 'dashboard'
    state.action = { ...state.action, conversationId: null, ticketId: ticketId as never }
    state.receipt.conversationId = null
    await expect(surfaces[4][1]()).rejects.toMatchObject({ statusCode: 404 })
  }
)

it('reconciliation resolves the ticket from the receipt proposal', async () => {
  state.scope = 'dashboard'
  state.action = { ...state.action, conversationId: null, ticketId: 'ticket_visible' as never }
  state.receipt.conversationId = null
  expect(await surfaces[4][1]()).toMatchObject({ reconciliationState: 'resolved' })
})

it('refuses reading a workspace proposal through the inbox endpoint', async () => {
  state.scope = 'dashboard'
  state.action = { ...state.action, conversationId: null, ticketId: null }
  await expect(surfaces[2][1]()).rejects.toMatchObject({ statusCode: 404 })
})
