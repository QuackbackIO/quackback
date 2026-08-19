/**
 * Ticket status management (support platform §4.2) for the settings UI. Mirrors
 * the post-statuses service: soft-deleted statuses keep their history, and a
 * status can never be removed out from under the tickets or category that
 * depend on it.
 *
 * Delete guard choice: block-if-in-use (the safer option). A status backing any
 * live ticket cannot be deleted — the caller reassigns those tickets first —
 * rather than silently re-homing them, which would rewrite ticket history.
 */
import {
  db,
  eq,
  and,
  isNull,
  inArray,
  sql,
  asc,
  ticketStatuses,
  tickets,
  type TicketStatusEntity,
  type TicketStatusCategory,
  type TicketStage,
} from '@/lib/server/db'
import type { TicketStatusId } from '@quackback/ids'
import { positionCaseSql } from '@/lib/server/utils'
import { slugify } from '@/lib/shared/utils'
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ticket-statuses' })

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export interface CreateTicketStatusInput {
  name: string
  color: string
  category: TicketStatusCategory
  publicStage?: TicketStage | null
}

export interface UpdateTicketStatusInput {
  name?: string
  color?: string
  category?: TicketStatusCategory
  publicStage?: TicketStage | null
  position?: number
}

/** Ticket-status slugs use underscores (matching the seeded set). */
function toStatusSlug(name: string): string {
  return slugify(name).replace(/-/g, '_')
}

/** A slug unique across all statuses (including soft-deleted, since slug is globally unique). */
async function uniqueSlug(name: string): Promise<string> {
  const base = toStatusSlug(name) || 'status'
  const existing = await db
    .select({ slug: ticketStatuses.slug })
    .from(ticketStatuses)
    .where(sql`${ticketStatuses.slug} = ${base} OR ${ticketStatuses.slug} LIKE ${base + '_%'}`)
  const taken = new Set(existing.map((r) => r.slug))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`
    if (!taken.has(candidate)) return candidate
  }
}

/** All non-deleted ticket statuses, ordered by category then position. */
export async function listTicketStatuses(): Promise<TicketStatusEntity[]> {
  return db.query.ticketStatuses.findMany({
    where: isNull(ticketStatuses.deletedAt),
    orderBy: [
      sql`CASE
        WHEN ${ticketStatuses.category} = 'open' THEN 0
        WHEN ${ticketStatuses.category} = 'pending' THEN 1
        WHEN ${ticketStatuses.category} = 'closed' THEN 2
      END`,
      asc(ticketStatuses.position),
    ],
  })
}

export async function createTicketStatus(
  input: CreateTicketStatusInput
): Promise<TicketStatusEntity> {
  log.debug({ name: input.name }, 'create ticket status')
  const name = input.name?.trim()
  if (!name) throw new ValidationError('VALIDATION_ERROR', 'Name is required')
  if (name.length > 50)
    throw new ValidationError('VALIDATION_ERROR', 'Name must be 50 characters or less')
  if (!HEX_COLOR.test(input.color ?? '')) {
    throw new ValidationError('VALIDATION_ERROR', 'Color must be in hex format (e.g., #3b82f6)')
  }

  const slug = await uniqueSlug(name)
  // Append after the current max position so new statuses land at the end.
  const [{ max }] = await db
    .select({ max: sql<number>`COALESCE(MAX(${ticketStatuses.position}), -1)` })
    .from(ticketStatuses)
    .where(isNull(ticketStatuses.deletedAt))

  try {
    const [status] = await db
      .insert(ticketStatuses)
      .values({
        name,
        slug,
        color: input.color,
        category: input.category,
        position: Number(max) + 1,
        publicStage: input.publicStage ?? null,
        isDefault: false,
      })
      .returning()
    return status
  } catch {
    // The slug unique index is the only constraint a concurrent create can trip.
    throw new ConflictError('DUPLICATE_SLUG', `A status derived from '${name}' already exists`)
  }
}

export async function updateTicketStatusEntity(
  id: TicketStatusId,
  patch: UpdateTicketStatusInput
): Promise<TicketStatusEntity> {
  log.debug({ status_id: id }, 'update ticket status')
  const existing = await db.query.ticketStatuses.findFirst({
    where: and(eq(ticketStatuses.id, id), isNull(ticketStatuses.deletedAt)),
  })
  if (!existing) throw new NotFoundError('STATUS_NOT_FOUND', `Ticket status ${id} not found`)

  const updateData: Partial<TicketStatusEntity> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new ValidationError('VALIDATION_ERROR', 'Name cannot be empty')
    if (name.length > 50)
      throw new ValidationError('VALIDATION_ERROR', 'Name must be 50 characters or less')
    updateData.name = name
  }
  if (patch.color !== undefined) {
    if (!HEX_COLOR.test(patch.color)) {
      throw new ValidationError('VALIDATION_ERROR', 'Color must be in hex format (e.g., #3b82f6)')
    }
    updateData.color = patch.color
  }
  if (patch.category !== undefined) updateData.category = patch.category
  if (patch.publicStage !== undefined) updateData.publicStage = patch.publicStage
  if (patch.position !== undefined) updateData.position = patch.position

  const [updated] = await db
    .update(ticketStatuses)
    .set(updateData)
    .where(and(eq(ticketStatuses.id, id), isNull(ticketStatuses.deletedAt)))
    .returning()
  if (!updated) throw new NotFoundError('STATUS_NOT_FOUND', `Ticket status ${id} not found`)
  return updated
}

/** Reorder statuses by writing each id's index as its new position (single batch UPDATE). */
export async function reorderTicketStatuses(orderedIds: TicketStatusId[]): Promise<void> {
  log.debug({ count: orderedIds?.length ?? 0 }, 'reorder ticket statuses')
  if (!orderedIds || orderedIds.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'Status IDs are required')
  }
  await db
    .update(ticketStatuses)
    .set({ position: positionCaseSql(ticketStatuses.id, orderedIds) })
    .where(inArray(ticketStatuses.id, orderedIds))
}

/**
 * Soft-delete a status. Blocked when it is the default, the last of its
 * category, or backing any live ticket (block-if-in-use — the caller reassigns
 * those tickets first).
 */
export async function softDeleteTicketStatus(id: TicketStatusId): Promise<void> {
  log.debug({ status_id: id }, 'delete ticket status')
  const existing = await db.query.ticketStatuses.findFirst({
    where: and(eq(ticketStatuses.id, id), isNull(ticketStatuses.deletedAt)),
  })
  if (!existing) throw new NotFoundError('STATUS_NOT_FOUND', `Ticket status ${id} not found`)

  if (existing.isDefault) {
    throw new ForbiddenError(
      'CANNOT_DELETE_DEFAULT',
      'Cannot delete the default status. Set another status as default first.'
    )
  }

  const [{ count: categoryCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ticketStatuses)
    .where(and(eq(ticketStatuses.category, existing.category), isNull(ticketStatuses.deletedAt)))
  if (Number(categoryCount) <= 1) {
    throw new ForbiddenError(
      'CANNOT_DELETE_LAST_IN_CATEGORY',
      `Cannot delete the last '${existing.category}' status.`
    )
  }

  const [{ count: usage }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.statusId, id), isNull(tickets.deletedAt)))
  if (Number(usage) > 0) {
    throw new ForbiddenError(
      'CANNOT_DELETE_IN_USE',
      `Cannot delete status. ${Number(usage)} ticket(s) use it. Reassign them first.`
    )
  }

  await db
    .update(ticketStatuses)
    .set({ deletedAt: new Date() })
    .where(and(eq(ticketStatuses.id, id), isNull(ticketStatuses.deletedAt)))
}
