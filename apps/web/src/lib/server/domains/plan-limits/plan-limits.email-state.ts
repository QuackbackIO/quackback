/**
 * The plan limits emails' part of the stored state: which emails are complete
 * and, per email, who has had it. The state is replaced when a new grace
 * starts, so each email is sent at most once per recipient per grace. The
 * sending logic lives in plan-limits.emails.ts.
 */

export const PLAN_LIMITS_EMAIL_KINDS = ['start', 'reminder', 'enforced'] as const
export type PlanLimitsEmailKind = (typeof PLAN_LIMITS_EMAIL_KINDS)[number]

export type PlanLimitsEmailRecipients = Partial<
  Record<PlanLimitsEmailKind, Record<string, { status: 'claimed' | 'sent'; at: string }>>
>

export interface PlanLimitsEmailState {
  /** Emails complete for this grace: every recipient has had them. */
  emailsSent?: PlanLimitsEmailKind[]
  /**
   * Per email, who it went to or is being sent to, so a retry sends only to
   * recipients that have not had it. A recipient is claimed before the send
   * and marked sent after; an unfinished claim lapses. A kind in `emailsSent`
   * is complete and needs no entry.
   */
  emailRecipients?: PlanLimitsEmailRecipients
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function parseRecipients(value: unknown): PlanLimitsEmailRecipients | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: PlanLimitsEmailRecipients = {}
  for (const kind of PLAN_LIMITS_EMAIL_KINDS) {
    const entries = (value as Record<string, unknown>)[kind]
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue
    const kept: Record<string, { status: 'claimed' | 'sent'; at: string }> = {}
    for (const [id, entry] of Object.entries(entries)) {
      const e = entry as { status?: unknown; at?: unknown } | null
      if ((e?.status === 'claimed' || e?.status === 'sent') && isIso(e.at)) {
        kept[id] = { status: e.status, at: e.at }
      }
    }
    if (Object.keys(kept).length > 0) out[kind] = kept
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** The email part of a stored state, read leniently from its raw JSON. */
export function parseEmailState(raw: Record<string, unknown>): PlanLimitsEmailState {
  const state: PlanLimitsEmailState = {}
  if (Array.isArray(raw.emailsSent)) {
    const sent = raw.emailsSent.filter((k): k is PlanLimitsEmailKind =>
      (PLAN_LIMITS_EMAIL_KINDS as readonly string[]).includes(k as string)
    )
    if (sent.length > 0) state.emailsSent = sent
  }
  const recipients = parseRecipients(raw.emailRecipients)
  if (recipients) state.emailRecipients = recipients
  return state
}
