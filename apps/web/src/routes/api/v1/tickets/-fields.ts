import { ValidationError } from '@/lib/shared/errors'
import { validateTicketIntakeValues } from '@/lib/shared/tickets'
import type { TicketTypeId } from '@quackback/ids'

/**
 * Validate ticket-type field values sent on an API create and return them as
 * the ticket's customAttributes.
 *
 * An API key acts as the team, so internal (non-customer-visible) fields are
 * writable too. Unlike portal intake, which silently drops unknown answers, an
 * unknown key is rejected: an integration with a mistyped key would otherwise
 * lose that value with a 201.
 */
export async function resolveApiTicketFields(
  ticketTypeId: TicketTypeId | undefined,
  fields: Record<string, unknown> | undefined
): Promise<Record<string, unknown> | undefined> {
  if (!fields) return undefined
  if (!ticketTypeId) {
    throw new ValidationError('INVALID_TICKET_FIELDS', 'fields requires ticketTypeId')
  }

  const { getTicketType } = await import('@/lib/server/domains/tickets/ticket-type.service')
  const type = await getTicketType(ticketTypeId)

  const known = new Set(type.fields.map((f) => f.key))
  const unknown = Object.keys(fields).filter((key) => !known.has(key))
  if (unknown.length > 0) {
    throw new ValidationError(
      'INVALID_TICKET_FIELDS',
      `Unknown field(s) for this ticket type: ${unknown.join(', ')}`
    )
  }

  const result = validateTicketIntakeValues(type.fields, fields, { includeInternal: true })
  if (!result.ok) {
    throw new ValidationError(
      'INVALID_TICKET_FIELDS',
      result.errors.map((e) => e.message).join('; ')
    )
  }
  return Object.keys(result.values).length > 0 ? result.values : undefined
}
