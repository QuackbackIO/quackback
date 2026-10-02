// @vitest-environment happy-dom
/**
 * A deep-linked conversation (/admin/inbox?i=...) server-renders its detail
 * panel, whose "First seen" and "Created" rows show absolute dates. The server
 * and the agent's browser format dates in different locales and time zones;
 * the panel must still hydrate without error, then show the agent's format.
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import { formatIn, restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'

// The controls are stubbed: this test is about the panel's own date rows, and
// several controls fire queries that would otherwise reach server functions.
vi.mock('@/components/admin/conversation/priority-control', () => ({
  PriorityControl: () => null,
}))
vi.mock('@/components/admin/conversation/assignee-control', () => ({
  AssigneeControl: () => null,
}))
vi.mock('@/components/admin/conversation/conversation-tags-editor', () => ({
  ConversationTagsEditor: () => null,
}))
vi.mock('@/components/admin/conversation/conversation-attributes-editor', () => ({
  ConversationAttributesEditor: () => null,
}))
vi.mock('@/components/admin/conversation/status-control', () => ({ StatusControl: () => null }))
vi.mock('@/components/admin/conversation/company-card', () => ({ CompanyCard: () => null }))
vi.mock('@/components/admin/inbox/ticket-links', () => ({ TicketLinks: () => null }))
vi.mock('@/components/admin/users/block-person-control', () => ({
  usePersonBlockStatus: () => ({ blocked: false, isLoading: false }),
}))
vi.mock('@/lib/server/functions/conversation', () => ({
  listConversationsForUserFn: vi.fn().mockResolvedValue({ conversations: [], hasMore: false }),
  getConversationAssistantActivityFn: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/server/functions/admin', () => ({
  getPortalUserFn: vi.fn().mockResolvedValue(null),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouteContext: (opts?: { select?: (context: object) => unknown }) =>
    opts?.select ? opts.select({}) : {},
}))

import { InboxDetailPanel } from '../inbox-detail-panel'

// 20:30 UTC on Oct 1 is already Oct 2 in Kiritimati (UTC+14).
const CREATED_AT = '2026-10-01T20:30:00.000Z'
const DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
const VIEWER = { locale: 'de-DE', timeZone: 'Pacific/Kiritimati' }

const conversation = {
  id: 'conversation_1',
  status: 'open',
  priority: 'none',
  channel: 'messenger',
  subject: null,
  lastMessagePreview: null,
  lastMessageAt: CREATED_AT,
  createdAt: CREATED_AT,
  visitor: { principalId: 'principal_visitor', displayName: 'Vic Visitor', avatarUrl: null },
  assignedAgent: null,
  unreadCount: 0,
  visitorLastReadAt: null,
  agentLastReadAt: null,
  csatRating: null,
  visitorEmail: 'vic@example.com',
  resolvedAt: null,
  snoozedUntil: null,
  assignedTeamId: null,
  endReason: null,
  endNote: null,
  spamReason: null,
  tags: [],
  sla: null,
  customAttributes: {},
  translation: null,
} as unknown as ConversationDTO

function panel(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <InboxDetailPanel
        item={{ kind: 'conversation', id: conversation.id }}
        conversation={conversation}
        onChanged={() => {}}
        onSelectItem={() => {}}
        onTrackAsFeedback={() => {}}
        onCreateTicket={() => {}}
        onInsertFromCopilot={() => {}}
        visible={false}
      />
    </QueryClientProvider>
  )
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

afterEach(restoreRuntimeLocale)

describe('InboxDetailPanel hydration', () => {
  it('hydrates the date rows without error in another locale and zone', async () => {
    // The server: UTC, in a locale other than the agent's.
    setRuntimeLocale('en-US', 'UTC')
    const container = document.createElement('div')
    container.innerHTML = renderToString(panel(newClient()))
    expect(container.textContent).toContain('Created')

    // The agent's browser.
    setRuntimeLocale(VIEWER.locale, VIEWER.timeZone)
    const errors: unknown[] = []
    await act(async () => {
      hydrateRoot(container, panel(newClient()), {
        onRecoverableError: (error) => errors.push(error),
      })
    })

    expect(errors).toEqual([])
    const viewerDate = formatIn(VIEWER.locale, VIEWER.timeZone, CREATED_AT, DAY)
    expect(viewerDate).toBe('2. Okt. 2026')
    // "First seen" (the visitor's earliest date) and "Created" both read it.
    expect(container.textContent?.split(viewerDate).length).toBe(3)
    expect(container.textContent).not.toContain('Oct 1, 2026')
  })
})
