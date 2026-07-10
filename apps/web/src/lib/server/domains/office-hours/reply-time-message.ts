/**
 * The customer-facing copy a workflow's "show expected reply time" block posts
 * (Phase C conversational block layer). Mirrors assistant.handover.ts's shape —
 * office-hours-derived, honest, no per-workspace configurability in v1 (that
 * mirrors the existing handover message precedent, which is also a fixed
 * English string) — but returns both the resolved `status` (for the block
 * payload widgets key off) and the `content` line itself.
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
  // `withinOfficeHours` is null for a disabled (24/7) schedule → treat as open,
  // same convention as buildAssistantHandoverMessage.
  const { withinOfficeHours } = officeHoursSnapshot(schedule, now)
  if (withinOfficeHours === false) {
    return {
      status: 'away',
      content: "We're away right now. We'll get back to you as soon as we're back online.",
    }
  }
  return { status: 'online', content: "We're online — typically replies in under an hour." }
}
