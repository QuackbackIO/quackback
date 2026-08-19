/**
 * The customer-facing copy a workflow's "show expected reply time" block posts
 * (Phase C conversational block layer). It is office-hours-derived, honest,
 * and has no per-workspace configurability in v1. Returns both the resolved
 * `status` (for the block payload widgets key off) and the `content` line.
 */
import { officeHoursSnapshot } from '@/lib/shared/office-hours'
import type { OfficeHoursSchedule } from '@/lib/shared/office-hours'

export interface ReplyTimeMessage {
  status: 'online' | 'away'
  content: string
}

export function buildReplyTimeMessage(
  schedule: OfficeHoursSchedule | null | undefined,
  now: Date = new Date()
): ReplyTimeMessage {
  // `withinOfficeHours` is null for a disabled (24/7) schedule → treat as open.
  const { withinOfficeHours } = officeHoursSnapshot(schedule, now)
  if (withinOfficeHours === false) {
    return {
      status: 'away',
      content: "We're away right now. We'll get back to you as soon as we're back online.",
    }
  }
  return { status: 'online', content: "We're online — typically replies in under an hour." }
}
