import { z } from 'zod'

/**
 * How quickly the team usually replies, as set on the messenger config. The
 * widget shows it under the team name in the conversation header and in the
 * reply-time caption a workflow posts. `off` shows no expectation.
 */
export const REPLY_TIMES = ['minutes', 'hour', 'hours', 'day', 'off'] as const

export type ReplyTime = (typeof REPLY_TIMES)[number]

/** "Under an hour": what an absent setting shows. */
export const DEFAULT_REPLY_TIME: ReplyTime = 'hour'

/** The stored value when it is a known option, else the default. */
export function resolveReplyTime(value: unknown): ReplyTime {
  return (REPLY_TIMES as readonly unknown[]).includes(value)
    ? (value as ReplyTime)
    : DEFAULT_REPLY_TIME
}

/** Write-side validation for the messenger setting. */
export const replyTimeSchema = z.enum(REPLY_TIMES)
