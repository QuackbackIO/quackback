/**
 * Outbound mail oracles: Mailpit (what a mail client would receive) and the
 * app's own email_log table (what the app says it sent).
 *
 * Mailpit is shared by every test (and, locally, by anything else on the
 * machine), so these helpers never clear the mailbox and never count all
 * messages: they search by a recipient address the test made unique.
 *
 * Same API and message shapes as packages/email/src/__tests__/mailpit-fixture.ts.
 */
import type {
  MailpitMessage,
  MailpitSummary,
} from '../../../../packages/email/src/__tests__/mailpit-fixture'
import { pollFor, supportDb } from './db'
import { supportEnv } from './env'

export type { MailpitMessage, MailpitSummary }

function api(path: string): string {
  return `${supportEnv().mailpitApiUrl}${path}`
}

/** Every message to `address`, newest first. */
export async function mailTo(address: string): Promise<MailpitSummary[]> {
  const query = encodeURIComponent(`to:"${address}"`)
  const res = await fetch(api(`/api/v1/search?query=${query}&limit=50`))
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`)
  const body = (await res.json()) as { messages?: MailpitSummary[] }
  // The search is a text match; keep exact recipients only.
  return (body.messages ?? []).filter((m) =>
    m.To.some((to) => to.Address.toLowerCase() === address.toLowerCase())
  )
}

/**
 * Wait for a message to `to` (optionally whose subject contains `subject`) and
 * return it in full.
 */
export async function waitForMail(opts: {
  to: string
  subject?: string
  timeoutMs?: number
}): Promise<MailpitMessage> {
  const summary = await pollFor(
    `mail to ${opts.to}${opts.subject ? ` with subject "${opts.subject}"` : ''}`,
    async () => {
      const found = await mailTo(opts.to)
      return found.find((m) => !opts.subject || m.Subject.includes(opts.subject)) ?? null
    },
    { timeoutMs: opts.timeoutMs ?? 15_000, intervalMs: 250 }
  )
  return getMail(summary.ID)
}

/** Full message including rendered bodies. */
export async function getMail(id: string): Promise<MailpitMessage> {
  const res = await fetch(api(`/api/v1/message/${id}`))
  if (!res.ok) throw new Error(`Mailpit message ${id}: ${res.status}`)
  return (await res.json()) as MailpitMessage
}

/** Raw headers (Message-ID, In-Reply-To, References, Reply-To live here). */
export async function getMailHeaders(id: string): Promise<Record<string, string[]>> {
  const res = await fetch(api(`/api/v1/message/${id}/headers`))
  if (!res.ok) throw new Error(`Mailpit headers ${id}: ${res.status}`)
  return (await res.json()) as Record<string, string[]>
}

/** Links in a message's HTML body, in order. */
export function linksIn(message: MailpitMessage): string[] {
  return [...message.HTML.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
}

export interface EmailLogRow {
  direction: string
  email_type: string
  provider: string | null
  address: string
  subject: string | null
  status: string
  error: string | null
  conversation_id: string | null
  ticket_id: string | null
  created_at: Date
}

/** The app's email_log rows for an address, newest first. */
export async function emailLogFor(address: string): Promise<EmailLogRow[]> {
  return supportDb()<EmailLogRow[]>`
    SELECT direction, email_type, provider, address, subject, status, error,
           conversation_id, ticket_id, created_at
    FROM email_log WHERE lower(address) = lower(${address})
    ORDER BY created_at DESC`
}

/** Wait for an email_log row for `address` matching `where`. */
export async function waitForEmailLog(
  address: string,
  where: Partial<Pick<EmailLogRow, 'direction' | 'email_type' | 'status'>> = {},
  timeoutMs = 15_000
): Promise<EmailLogRow> {
  return pollFor(
    `email_log row for ${address} ${JSON.stringify(where)}`,
    async () =>
      (await emailLogFor(address)).find((row) =>
        Object.entries(where).every(([k, v]) => row[k as keyof EmailLogRow] === v)
      ) ?? null,
    { timeoutMs }
  )
}
