/**
 * Bells (in-app notifications) and @mentions for the team-access specs.
 * Read one person's bells about one conversation or ticket, so parallel
 * tests never see each other's rows.
 */
import { toUuid } from '@quackback/ids'
import { pollFor, supportDb } from './db'

export interface Bell {
  type: string
  title: string
  /** The preview (a new-message bell carries the message text). */
  body: string | null
  created_at: Date
}

/** A person's bells whose metadata names this conversation or ticket (TypeIDs). */
export async function bellsFor(principalId: string, itemId: string): Promise<Bell[]> {
  const key = itemId.startsWith('ticket_') ? 'ticketId' : 'conversationId'
  return supportDb()<Bell[]>`
    SELECT type, title, body, created_at FROM in_app_notifications
    WHERE principal_id = ${toUuid(principalId as `principal_${string}`)}
      AND metadata ->> ${key} = ${itemId}
    ORDER BY created_at`
}

/**
 * Wait until the notification hook has run for the event of the message with
 * this exact text (its job in the `events` queue succeeded), so a test can
 * assert that the hook rang no bell, then change presence safely.
 */
export async function waitForNotificationHook(
  messageContent: string,
  timeoutMs = 15_000
): Promise<void> {
  await pollFor(
    `the notification hook for "${messageContent}"`,
    async () => {
      const [row] = await supportDb()`
        SELECT status FROM job_queue
        WHERE queue = 'events' AND dedupe_key LIKE '%:notification:%'
          AND payload -> 'event' -> 'data' -> 'message' ->> 'content' LIKE ${`%${messageContent}%`}
        LIMIT 1`
      return row?.status === 'succeeded' ? true : null
    },
    { timeoutMs }
  )
}

/** A note body (TipTap doc) that mentions these teammates after `text`. */
export function mentionDoc(
  text: string,
  people: Array<{ principalId: string; name: string }>
): Record<string, unknown> {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `${text} ` },
          ...people.flatMap((p) => [
            { type: 'mention', attrs: { id: p.principalId, label: p.name } },
            { type: 'text', text: ' ' },
          ]),
        ],
      },
    ],
  }
}
