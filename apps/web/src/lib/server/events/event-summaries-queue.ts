/**
 * `event-summaries` job handler: the conversation and ticket close summaries
 * (see `event-reactions.ts`). Slow AI calls, so they run concurrently, off the
 * serial `event-reactions` queue. Each summary is bound to the close that
 * queued it, the job's own event (its id and time): it skips when that close
 * is no longer the current one, and never overwrites a newer close's summary
 * (see domains/assistant/close-summary.ts).
 */
import type { ConversationId, TicketId } from '@quackback/ids'
import { summarizeConversationOnClose } from '@/lib/server/domains/assistant/conversation-summary.service'
import { summarizeTicketOnClose } from '@/lib/server/domains/assistant/ticket-summary.service'
import type { TriggeringClose } from '@/lib/server/domains/assistant/close-summary'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import type { EventData } from './types'
import { EVENT_SUMMARIES_QUEUE, runReactionJob } from './event-reactions'

/** The close an event records: its id and when it happened. */
const triggeringClose = (event: EventData): TriggeringClose => ({
  eventId: event.id,
  at: new Date(event.timestamp),
})

export function runEventSummaries(job: ClaimedJob): Promise<void> {
  return runReactionJob(EVENT_SUMMARIES_QUEUE, job, {
    'conversation-summary': (event, signal) => {
      if (event.type !== 'conversation.status_changed' || event.data.newStatus !== 'closed') {
        return undefined
      }
      return summarizeConversationOnClose(
        event.data.conversation.id as ConversationId,
        triggeringClose(event),
        { signal }
      )
    },
    // Ticket status is a category ('open' | 'pending' | 'closed').
    'ticket-summary': (event, signal) => {
      if (event.type !== 'ticket.status_changed' || event.data.newStatus !== 'closed') {
        return undefined
      }
      return summarizeTicketOnClose(event.data.ticket.id as TicketId, triggeringClose(event), {
        signal,
      })
    },
  })
}
