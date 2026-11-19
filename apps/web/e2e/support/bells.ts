/**
 * In-app notifications (bells) as the app wrote them: rows in
 * in_app_notifications for one person, optionally about one conversation or
 * ticket. Bells are written by the queued event job, so poll for arrival and
 * prove an absence against a later bell the same person must get.
 */
import { fromUuid, toUuid } from '@quackback/ids'
import { pollFor, supportDb } from './db'

export interface BellRow {
  /** TypeID (notification_...), what the notification server functions take. */
  id: string
  type: string
  title: string
  body: string | null
  metadata: Record<string, unknown> | null
  read_at: Date | null
  archived_at: Date | null
}

/** Bells for a person (principal TypeID), about `aboutId` when given. */
export async function bellsFor(principalId: string, aboutId?: string): Promise<BellRow[]> {
  const sql = supportDb()
  const pid = toUuid(principalId as `principal_${string}`)
  const rows = await (aboutId
    ? sql<BellRow[]>`SELECT id, type, title, body, metadata, read_at, archived_at
        FROM in_app_notifications
        WHERE principal_id = ${pid} AND metadata::text LIKE ${`%${aboutId}%`}
        ORDER BY created_at`
    : sql<BellRow[]>`SELECT id, type, title, body, metadata, read_at, archived_at
        FROM in_app_notifications WHERE principal_id = ${pid} ORDER BY created_at`)
  return rows.map((r) => ({ ...r, id: fromUuid('notification', r.id) }))
}

/**
 * Wait until the app has fully handled the event whose payload contains
 * `text` (a message id, say): its dispatch job ran and every sink job it
 * queued (bells, emails, webhooks) finished. After this, a bell that is not
 * there is never coming. Returns the event's type.
 */
export async function waitForEventHandled(
  text: string,
  opts: { type?: string; timeoutMs?: number } = {}
): Promise<string> {
  const sql = supportDb()
  return pollFor(
    `the event about ${text} to be handled`,
    async () => {
      const [event] = await sql<{ event_id: string; type: string }[]>`
        SELECT event_id, type FROM events
        WHERE payload::text LIKE ${`%${text}%`} ${opts.type ? sql`AND type = ${opts.type}` : sql``}
        ORDER BY id DESC LIMIT 1`
      if (!event) return null
      const [dispatch] = await sql`SELECT status FROM job_queue
        WHERE dedupe_key = ${`event-dispatch:${event.event_id}`}`
      if (dispatch?.status !== 'succeeded') return null
      const open = await sql`SELECT 1 FROM job_queue
        WHERE dedupe_key LIKE ${`${event.event_id}:%`} AND status NOT IN ('succeeded', 'failed')`
      return open.length === 0 ? event.type : null
    },
    { timeoutMs: opts.timeoutMs ?? 20_000, intervalMs: 250 }
  )
}

/** Wait until `match` holds for a person's bells about `aboutId`; returns them. */
export async function waitForBells(
  principalId: string,
  aboutId: string | undefined,
  match: (rows: BellRow[]) => boolean,
  timeoutMs = 15_000
): Promise<BellRow[]> {
  return pollFor(
    `bells for ${principalId}${aboutId ? ` about ${aboutId}` : ''}`,
    async () => {
      const rows = await bellsFor(principalId, aboutId)
      return match(rows) ? rows : null
    },
    { timeoutMs, intervalMs: 300 }
  )
}
