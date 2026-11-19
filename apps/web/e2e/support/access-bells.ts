/**
 * Bells (in-app notifications) and @mentions for the team-access specs.
 * Read one person's bells about one conversation or ticket, so parallel
 * tests never see each other's rows.
 */
import { toUuid } from '@quackback/ids'
import { supportDb } from './db'

export interface Bell {
  type: string
  title: string
  created_at: Date
}

/** A person's bells whose metadata names this conversation or ticket (TypeIDs). */
export async function bellsFor(principalId: string, itemId: string): Promise<Bell[]> {
  const key = itemId.startsWith('ticket_') ? 'ticketId' : 'conversationId'
  return supportDb()<Bell[]>`
    SELECT type, title, created_at FROM in_app_notifications
    WHERE principal_id = ${toUuid(principalId as `principal_${string}`)}
      AND metadata ->> ${key} = ${itemId}
    ORDER BY created_at`
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
