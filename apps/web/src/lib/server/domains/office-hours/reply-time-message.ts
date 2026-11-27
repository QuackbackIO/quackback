/**
 * The customer-facing copy a workflow's "show expected reply time" block posts
 * (Phase C conversational block layer). It is office-hours-derived and worded
 * from the messenger's usual reply time. Returns both the resolved `status`
 * (for the block payload widgets key off) and the English `content` line the
 * transcript and email fallback carry; the widget localizes from `status`.
 */
import { officeHoursSnapshot } from '@/lib/shared/office-hours'
import type { OfficeHoursSchedule } from '@/lib/shared/office-hours'
import { resolveReplyTime, type ReplyTime } from '@/lib/shared/widget/reply-time'

export interface ReplyTimeMessage {
  status: 'online' | 'away'
  content: string
}

const ONLINE_CONTENT: Record<ReplyTime, string> = {
  minutes: "We're online, typically replies in a few minutes.",
  hour: "We're online, typically replies in under an hour.",
  hours: "We're online, typically replies in a few hours.",
  day: "We're online, typically replies within a day.",
  off: "We're online.",
}

export function buildReplyTimeMessage(
  schedule: OfficeHoursSchedule | null | undefined,
  replyTime?: ReplyTime,
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
  return { status: 'online', content: ONLINE_CONTENT[resolveReplyTime(replyTime)] }
}
