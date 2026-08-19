/**
 * Item-scoped request identifier for the Copilot surfaces (unified inbox
 * §2.9): a request is scoped to exactly one item, a conversation OR a ticket,
 * never both and never neither. Sibling to `conversation-id.schema.ts` (which
 * keeps its own `conversationIdSchema` export unchanged — every existing
 * importer of that file is untouched by this one).
 *
 * `withAssistantItemRef` composes the item-ref union with a route's own
 * request fields in one shot: each union branch is `.strict()`, so a payload
 * carrying BOTH `conversationId` and `ticketId` fails every branch (the extra
 * key is unrecognized on whichever branch matched first) instead of one
 * silently winning. A payload carrying neither fails both branches the same
 * way. This is how "exactly one" is enforced — not a `.refine()`, which would
 * have to run after zod's own key-stripping already discarded the evidence of
 * a duplicate key.
 *
 * Every route built on this stays backward compatible with the pre-§2.9
 * client, which only ever sends `conversationId`: that shape is still just
 * the first union branch.
 */
import { z } from 'zod'
import { isValidTypeId } from '@quackback/ids'
import { conversationIdSchema } from './conversation-id.schema'

export const ticketIdSchema = z
  .string()
  .refine((v) => isValidTypeId(v, 'ticket'), { message: 'Invalid ticket ID format' })

/**
 * Merge the item-ref union with a route's own request shape: each union
 * branch gets the same extra fields, so the result parses `{ conversationId,
 * ...fields } | { ticketId, ...fields }`, exactly one item ref alongside
 * whatever else the route needs.
 */
export function withAssistantItemRef<Shape extends z.ZodRawShape>(fields: Shape) {
  return z.union([
    z.object({ conversationId: conversationIdSchema, ...fields }).strict(),
    z.object({ ticketId: ticketIdSchema, ...fields }).strict(),
  ])
}
