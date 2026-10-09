import { describe, expect, it } from 'vitest'
import { createIntl } from 'react-intl'
import type { SerializedNotification } from '@/lib/client/hooks/use-notifications-queries'
import pl from '@/locales/pl.json'
import { notificationText } from '../notification-text'

const en = createIntl({ locale: 'en', defaultLocale: 'en' })
const polish = createIntl({ locale: 'pl', defaultLocale: 'en', messages: pl })

function notification(overrides: Partial<SerializedNotification>): SerializedNotification {
  return {
    id: 'notification_1' as SerializedNotification['id'],
    principalId: 'principal_1',
    type: 'chat_message',
    title: 'stored title',
    body: 'stored body',
    postId: null,
    commentId: null,
    conversationId: null,
    ticketId: null,
    changelogId: null,
    incidentId: null,
    actorName: null,
    actorAvatarUrl: null,
    audience: null,
    params: {},
    readAt: null,
    archivedAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

describe('notificationText', () => {
  it('words a message notification in the reader language and keeps the preview', () => {
    const n = notification({ type: 'chat_message', actorName: 'Demo User', body: 'hello' })
    expect(notificationText(n, en)).toEqual({ title: 'New message from Demo User', body: 'hello' })
    expect(notificationText(n, polish)).toEqual({
      title: 'Nowa wiadomość od Demo User',
      body: 'hello',
    })
  })

  it('words a status change and its body from the recorded statuses', () => {
    const n = notification({
      type: 'post_status_changed',
      params: { postTitle: 'Dark mode', previousStatus: 'Open', newStatus: 'Planned' },
    })
    expect(notificationText(n, en)).toEqual({
      title: 'Status changed to Planned',
      body: '"Dark mode" moved from Open to Planned',
    })
    expect(notificationText(n, polish).title).toBe('Nowy status: Planned')
  })

  it('tells maintenance from an incident by its kind', () => {
    const maintenance = notification({
      type: 'status_incident',
      params: { incidentTitle: 'Database upgrade', kind: 'maintenance' },
    })
    const incident = notification({
      type: 'status_incident',
      params: { incidentTitle: 'API errors', kind: 'incident' },
    })
    expect(notificationText(maintenance, en).title).toBe('Scheduled maintenance: Database upgrade')
    expect(notificationText(incident, en).title).toBe('New incident: API errors')
  })

  it('words a ticket stage change, with a generic body when there was no prior stage', () => {
    const n = notification({
      type: 'ticket_status_changed',
      params: { ticketTitle: 'Cannot log in', stageLabel: 'Resolved' },
    })
    expect(notificationText(n, en)).toEqual({
      title: 'Cannot log in is now Resolved',
      body: 'Open the ticket to see the latest update.',
    })
  })

  it('keeps the stored text when a value it needs was never recorded', () => {
    const olderTicketRow = notification({ type: 'ticket_status_changed', params: {} })
    const anonymousMessage = notification({ type: 'chat_message', actorName: null })
    const noParams = notification({ type: 'changelog_published', params: undefined })
    for (const n of [olderTicketRow, anonymousMessage, noParams]) {
      expect(notificationText(n, polish)).toEqual({ title: 'stored title', body: 'stored body' })
    }
  })

  it('leaves agent-only types as stored', () => {
    const n = notification({ type: 'ticket_assigned', actorName: 'Sarah' })
    expect(notificationText(n, polish)).toEqual({ title: 'stored title', body: 'stored body' })
  })
})
