/**
 * Whether the team should read as "available" to a visitor — drives the online
 * dot and copy on the conversation thread and the support surface's message CTA (via
 * ConversationPresenceBadge), so the two never contradict each other.
 *
 * A live agent always counts as available. When office hours are configured
 * (`withinOfficeHours` is non-null) the schedule also marks the team available;
 * a present agent still overrides closed hours.
 */
export function conversationAvailable(
  agentsOnline: boolean,
  withinOfficeHours: boolean | null
): boolean {
  return withinOfficeHours === null ? agentsOnline : withinOfficeHours || agentsOnline
}

/**
 * The team's availability verdict: live-agent presence plus the office-hours
 * snapshot. Computed server-side and shared between the polled presence endpoint
 * and the widget loader's SSR seed, so the first paint matches what the poll
 * reports (no "away" flash before the first fetch). `withinOfficeHours`: null =
 * no schedule; `nextOpenAt`: ISO instant the team is next back (only when closed).
 */
export interface ConversationPresence {
  agentsOnline: boolean
  withinOfficeHours: boolean | null
  nextOpenAt: string | null
}

/**
 * How often the open widget re-polls presence to keep the online/offline strip
 * fresh (e.g. an agent going offline). Comfortably under the server's presence
 * TTL so a gone agent is reflected promptly. The SSR seed covers first paint.
 */
export const CONVERSATION_PRESENCE_POLL_MS = 30_000
