/**
 * Customer-intake resolution for the ticket-type registry (convergence Phase
 * 4, scratchpad/convergence-design.md) — split from ticket-type.service.ts
 * (the max-lines budget). The portal + Messenger New-Ticket surfaces read the
 * intake picker set from here and resolve/validate creates through
 * `resolveIntakeCreate`, so both surfaces share one eligibility + validation
 * path: live, CUSTOMER-category, intake-visible types only, answers validated
 * against the type's customer-visible form by the shared
 * `validateTicketIntakeValues`.
 */
import { db, eq, and, isNull, asc, ticketTypes, type TicketTypeEntity } from '@/lib/server/db'
import { isValidTypeId, type TicketTypeId } from '@quackback/ids'
import { validateTicketIntakeValues, type TicketIntakeType } from '@/lib/shared/tickets'
import { ValidationError } from '@/lib/shared/errors'

/** The intake picker's candidate set: live, intake-visible CUSTOMER types. */
export async function listIntakeTypes(): Promise<TicketTypeEntity[]> {
  return db.query.ticketTypes.findMany({
    where: and(
      eq(ticketTypes.category, 'customer'),
      eq(ticketTypes.intakeVisible, true),
      isNull(ticketTypes.deletedAt)
    ),
    orderBy: [asc(ticketTypes.position), asc(ticketTypes.name)],
  })
}

/**
 * Resolve a type a CUSTOMER may file under at intake: live, customer category,
 * intake-visible. Null when the id is unknown or ineligible — the fn layer
 * turns that into a validation error (a requester can never file an internal
 * or archived type by guessing its id).
 */
export async function getIntakeType(id: TicketTypeId): Promise<TicketTypeEntity | null> {
  const row = await db.query.ticketTypes.findFirst({
    where: and(
      eq(ticketTypes.id, id),
      eq(ticketTypes.category, 'customer'),
      eq(ticketTypes.intakeVisible, true),
      isNull(ticketTypes.deletedAt)
    ),
  })
  return row ?? null
}

/** Project a registry row to the intake wire shape (portal + Messenger New-
 *  Ticket forms): customer-visible fields only, order-sorted. */
export function ticketTypeToIntakeDTO(row: TicketTypeEntity): TicketIntakeType {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    isDefault: row.isDefault,
    fields: row.fields.filter((f) => f.visibleToCustomer).sort((a, b) => a.order - b.order),
  }
}

/**
 * Resolve + validate the Phase 4 intake-create inputs shared by the portal and
 * widget fn layers: the chosen type (explicit, else the intake default) and
 * the field answers validated against its customer-visible form (required
 * fields enforced even on an empty submission). An explicit id must name a
 * live, intake-visible CUSTOMER type — a requester can never file an internal
 * or archived type by guessing its id. Answers for keys not on the form (or
 * not customer-visible) are dropped, never trusted. A workspace with no
 * intake types at all files legacy typeless tickets.
 */
export async function resolveIntakeCreate(
  ticketTypeId: string | undefined,
  fieldValues: Record<string, unknown> | undefined
): Promise<{
  ticketTypeId: TicketTypeId | null
  customAttributes: Record<string, unknown> | undefined
}> {
  let type: TicketTypeEntity | null
  if (ticketTypeId) {
    type = isValidTypeId(ticketTypeId, 'ticket_type')
      ? await getIntakeType(ticketTypeId as TicketTypeId)
      : null
    if (!type) {
      throw new ValidationError(
        'INVALID_TICKET_TYPE',
        'That ticket type is not available. Pick one of the offered types.'
      )
    }
  } else {
    // Absent = the intake DEFAULT: the customer-category default when it is
    // intake-visible, else the first intake-visible type (an intake-hidden
    // default must not silently claim customer filings). A workspace with no
    // intake types at all files legacy typeless tickets.
    const intakeTypes = await listIntakeTypes()
    type = intakeTypes.find((t) => t.isDefault) ?? intakeTypes[0] ?? null
  }
  if (!type) return { ticketTypeId: null, customAttributes: undefined }

  const form = type.fields.filter((f) => f.visibleToCustomer)
  const result = validateTicketIntakeValues(form, fieldValues ?? {})
  if (!result.ok) {
    throw new ValidationError(
      'INVALID_TICKET_FIELDS',
      result.errors.map((e) => e.message).join('; ')
    )
  }
  return {
    ticketTypeId: type.id,
    customAttributes: Object.keys(result.values).length > 0 ? result.values : undefined,
  }
}
