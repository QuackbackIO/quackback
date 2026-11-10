/**
 * Sample content for Support: the conversations a signed-in visitor has with
 * the team, so its page can be styled whoever is looking. Part of the
 * designer's sample content (see sample-content.ts); nothing here touches the
 * database.
 */

export interface SampleConversation {
  id: string
  status: 'open' | 'closed'
  subject: string | null
  lastMessagePreview: string | null
  lastMessageAt: string
  unreadCount: number
}

export interface SampleTicket {
  reference: string
  title: string
  stage: { slot: string; label: string; closed: boolean }
}

export interface SampleSupport {
  conversations: SampleConversation[]
  linkedTickets: Record<string, SampleTicket>
}

const HOUR = 3_600_000

/** Subject, status, hours since the last message, unread replies. */
const CONVERSATIONS: Array<[string, SampleConversation['status'], number, number]> = [
  ['Invoice shows the wrong company name', 'open', 2, 1],
  ['How do I move a project to another team?', 'open', 26, 0],
  ['Calendar sync stopped working', 'open', 75, 0],
  ['Adding more seats to our plan', 'closed', 24 * 9, 0],
]

export function sampleSupport(now: Date): SampleSupport {
  const conversations = CONVERSATIONS.map(([subject, status, hoursAgo, unreadCount], index) => ({
    id: `sample_conversation_${index}`,
    status,
    subject,
    lastMessagePreview: null,
    lastMessageAt: new Date(now.getTime() - hoursAgo * HOUR).toISOString(),
    unreadCount,
  }))
  return {
    conversations,
    // The third is tracked as a ticket, so its row shows the ticket's stage.
    linkedTickets: {
      [conversations[2]!.id]: {
        reference: '#1042',
        title: 'Calendar sync stopped working',
        stage: { slot: 'in_progress', label: 'In progress', closed: false },
      },
    },
  }
}
