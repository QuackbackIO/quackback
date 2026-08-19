/**
 * Widget ticket-stage unread tracking.
 *
 * The visitor's "seen" marker is a map of ticket id -> the public stage slot
 * they last had on screen, kept in window.localStorage (visitor-scoped — the
 * widget's visitor identity already lives client-side). A ticket whose current
 * stage slot differs from its marker badges the launcher until the requester
 * opens the Tickets tab, which advances the markers for everything listed.
 *
 * A visitor with no marker map yet gets a silent baseline (every current stage
 * is read): the first list load stamps the map, so only stage moves AFTER the
 * visitor's first contact badge as new. A ticket absent from the map (filed
 * after the baseline, e.g. one the requester just created themselves) never
 * badges — only CHANGES to a stage the visitor was baselined on do.
 */

const SEEN_KEY = 'quackback:ticket-stages-seen'

/** Event name dispatched on window after markers advance, so open widget
 *  views re-read them without a reload. */
export const TICKET_STAGES_SEEN_EVENT = 'quackback:ticket-stages-seen'

/** ticket id -> the stage slot the visitor last saw (null = internal-only). */
export type TicketStageSeenMap = Record<string, string | null>

/** The shape the marker reads off a ticket summary row. */
export interface TicketStageSeenInput {
  ticketId: string
  stage: { slot: string | null }
}

export function getTicketStagesSeen(storage?: Storage): TicketStageSeenMap | null {
  try {
    const raw = (storage ?? window.localStorage).getItem(SEEN_KEY)
    if (!raw) return null
    // Guard against a corrupted value: an unparseable or non-map marker
    // behaves as no marker rather than poisoning every comparison.
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as TicketStageSeenMap
  } catch {
    return null // corrupted JSON or storage unavailable (private mode etc.)
  }
}

/**
 * Advance the markers for the given tickets to their current stages. Merges
 * into the existing map so a paginated/limited list never drops markers for
 * tickets it didn't happen to load.
 */
export function markTicketStagesSeen(tickets: readonly TicketStageSeenInput[]): void {
  const next: TicketStageSeenMap = { ...getTicketStagesSeen() }
  for (const t of tickets) next[t.ticketId] = t.stage.slot
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable — the badge returns next load; never break the view.
  }
  window.dispatchEvent(new Event(TICKET_STAGES_SEEN_EVENT))
}

/**
 * Tickets whose current stage slot differs from their marker are unread. A
 * null map means the visitor has never seen the list, so nothing badges until
 * the first load stamps the baseline (see module doc). Tickets absent from
 * the map are not counted — they were filed after the baseline, not changed.
 */
export function countTicketStageChanges(
  tickets: readonly TicketStageSeenInput[],
  seen: TicketStageSeenMap | null
): number {
  if (!seen) return 0
  return tickets.filter((t) => t.ticketId in seen && seen[t.ticketId] !== t.stage.slot).length
}
