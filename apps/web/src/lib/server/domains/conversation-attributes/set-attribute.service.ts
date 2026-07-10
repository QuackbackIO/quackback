/**
 * The ONE write path for conversation/ticket attribute values. Every source
 * (teammate inline editor, macro, workflow action, AI, customer forms) goes
 * through here, so validation against the definition and the provenance
 * envelope `{ v, src, at }` can never be skipped. AI writes obey the
 * precedence rule: AI never overwrites a value another source set (including
 * bare legacy values of unknown provenance), only its own.
 */
import {
  db,
  eq,
  sql,
  conversations,
  tickets,
  conversationAttributeDefinitions,
} from '@/lib/server/db'
import type { ConversationAttributeOption } from '@/lib/server/db'
import type { ConversationId, TicketId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import type { JsonValue } from '@/lib/shared/json'
import {
  attributeHasValue,
  readAttributeValue,
  type ConversationAttributeEnvelope,
  type ConversationAttributeSource,
} from '@/lib/shared/conversation/attribute-values'

/** Attributes live on conversations AND tickets; one writer serves both. */
export type SetAttributeTarget = { conversationId: ConversationId } | { ticketId: TicketId }

interface AttributeDefinitionShape {
  key: string
  fieldType: string
  options: ConversationAttributeOption[] | null
  archivedAt: Date | null
}

/**
 * Validate + normalize a value against its definition. Pure. Returns the
 * value to store, or null when the write is an unset ('' and [] normalize to
 * unset so inline editors can clear without a special path).
 */
export function validateAttributeValue(
  def: Pick<AttributeDefinitionShape, 'key' | 'fieldType' | 'options'>,
  value: unknown
): unknown | null {
  if (value === null || value === undefined || value === '') return null
  const fail = (expected: string): never => {
    throw new ValidationError('VALIDATION_ERROR', `Attribute '${def.key}' expects ${expected}`)
  }
  switch (def.fieldType) {
    case 'text':
      return typeof value === 'string' ? value.trim() || null : fail('a text value')
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : fail('a number')
    case 'checkbox':
      return typeof value === 'boolean' ? value : fail('true or false')
    case 'date': {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail('a date')
      return (value as string).trim()
    }
    case 'select': {
      const ids = new Set((def.options ?? []).map((o) => o.id))
      if (typeof value !== 'string' || !ids.has(value)) fail('one of its option ids')
      return value
    }
    case 'multi_select': {
      const ids = new Set((def.options ?? []).map((o) => o.id))
      if (!Array.isArray(value)) fail('an array of option ids')
      const list = value as unknown[]
      if (!list.every((v) => typeof v === 'string' && ids.has(v))) fail('an array of option ids')
      const deduped = [...new Set(list as string[])]
      return deduped.length === 0 ? null : deduped
    }
    default:
      return fail('a supported field type')
  }
}

/** The visible refusal thrown when a customer-sourced write loses the
 *  write-once precedence rule (see setConversationAttribute's doc). Distinct
 *  from the AI rule (a silent no-op): a customer submitting a collect block
 *  is a caller that needs to know its write didn't happen, not one that can
 *  poll for a state change. */
export const CUSTOMER_ATTRIBUTE_LOCKED_CODE = 'ATTRIBUTE_LOCKED'

/**
 * Set (or unset, with null) one attribute on a conversation or ticket.
 * Validates against the registry definition, wraps the value in a
 * `{ v, src, at }` envelope, and merges it into custom_attributes atomically
 * (sibling keys written concurrently are preserved). Returns the row's
 * updated attributes.
 *
 * Two source-specific precedence rules gate the write:
 *   - AI (`src: 'ai'`) onto a slot another source filled is a SILENT no-op
 *     (classifier runs must not error), returning the current state.
 *   - customer (`src: 'customer'`, the conversational-block collect/
 *     collect_reply resume) onto a slot already holding a non-'ai',
 *     non-empty value is a VISIBLE refusal (throws ATTRIBUTE_LOCKED) — a
 *     collect block's write-once semantics ("only our team can change this
 *     now"): teammate/workflow writes always win over the customer, and the
 *     customer may still fill an empty slot or one only AI has touched.
 *     Callers that must proceed regardless (the collect resume path) catch
 *     this and continue without overwriting.
 */
export async function setConversationAttribute(
  target: SetAttributeTarget,
  key: string,
  value: unknown,
  src: ConversationAttributeSource
): Promise<Record<string, JsonValue>> {
  const def = await db.query.conversationAttributeDefinitions.findFirst({
    where: eq(conversationAttributeDefinitions.key, key),
  })
  if (!def) {
    throw new NotFoundError('ATTRIBUTE_NOT_FOUND', `No attribute definition for key '${key}'`)
  }
  if (def.archivedAt) {
    throw new ValidationError('ATTRIBUTE_ARCHIVED', `Attribute '${key}' is archived`)
  }
  const normalized = validateAttributeValue(def, value)

  const table = 'conversationId' in target ? conversations : tickets
  const id = 'conversationId' in target ? target.conversationId : target.ticketId
  const [row] = await db
    .select({ customAttributes: table.customAttributes })
    .from(table)
    .where(eq(table.id, id))
  if (!row) {
    const kind = 'conversationId' in target ? 'Conversation' : 'Ticket'
    throw new NotFoundError('NOT_FOUND', `${kind} ${id} not found`)
  }

  // jsonb is JSON-safe by construction, hence the serializable value type.
  const current = (row.customAttributes ?? {}) as Record<string, JsonValue>
  if (src === 'ai' && attributeHasValue(current[key])) {
    // Occupied by teammate/workflow/customer or a legacy value of unknown
    // provenance: AI only overwrites its own writes.
    if (readAttributeValue(current[key])?.src !== 'ai') return current
  }
  if (src === 'customer' && attributeHasValue(current[key])) {
    // Occupied by teammate/workflow/customer or a legacy value of unknown
    // provenance: a customer write may only fill an empty slot or one only
    // AI has touched. Unlike the AI rule above, this is a VISIBLE refusal —
    // see the doc comment.
    if (readAttributeValue(current[key])?.src !== 'ai') {
      throw new ValidationError(
        CUSTOMER_ATTRIBUTE_LOCKED_CODE,
        `Attribute '${key}' is already set and can no longer be changed by the customer`
      )
    }
  }

  const patch =
    normalized === null
      ? sql`${table.customAttributes} - ${key}::text`
      : sql`${table.customAttributes} || ${JSON.stringify({
          [key]: {
            v: normalized,
            src,
            at: new Date().toISOString(),
          } satisfies ConversationAttributeEnvelope,
        })}::jsonb`

  const [updated] = await db
    .update(table)
    .set({ customAttributes: patch, updatedAt: new Date() })
    .where(eq(table.id, id))
    .returning({ customAttributes: table.customAttributes })
  return updated.customAttributes as Record<string, JsonValue>
}
