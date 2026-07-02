/**
 * Ticket statuses — admin CRUD over the workflow state catalogue.
 *
 * Permission gating happens at the server-fn / REST layer
 * (`ADMIN_MANAGE_SETTINGS`); this service stays pure.
 */
import {
  db,
  eq,
  and,
  isNull,
  asc,
  ticketStatuses,
  TICKET_STATUS_CATEGORIES,
  type TicketStatusEntity,
  type TicketStatusCategory,
} from '@/lib/server/db'
import type { TicketStatusId, PrincipalId, UserId } from '@quackback/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'

/**
 * Identity of the operator (or system caller) performing the mutation.
 * Required so configuration-plane webhook events carry a meaningful actor.
 */
export interface TicketStatusActorContext {
  principalId: PrincipalId | null
  userId?: UserId | null
}

async function fireStatusEvent(
  kind: 'created' | 'updated',
  actor: TicketStatusActorContext,
  status: TicketStatusEntity,
  changedFields?: string[]
): Promise<void> {
  try {
    const { buildEventActor, dispatchTicketStatusCreated, dispatchTicketStatusUpdated } =
      await import('@/lib/server/events/dispatch')
    const eventActor = actor.principalId
      ? buildEventActor({
          principalId: actor.principalId,
          userId: actor.userId ?? undefined,
          displayName: 'ticket-status-system',
        })
      : { type: 'service' as const, displayName: 'ticket-status-system' }
    if (kind === 'created') await dispatchTicketStatusCreated(eventActor, status as never)
    else await dispatchTicketStatusUpdated(eventActor, status as never, changedFields ?? [])
  } catch (err) {
    console.warn(`[ticket-statuses] dispatchTicketStatus${kind} failed`, err)
  }
}

const SLUG_RE = /^[a-z0-9_-]+$/

export interface CreateTicketStatusInput {
  name: string
  slug: string
  color?: string
  category: TicketStatusCategory
  position?: number
  isDefault?: boolean
}

export async function listTicketStatuses(
  opts: { includeDeleted?: boolean } = {}
): Promise<TicketStatusEntity[]> {
  const where = opts.includeDeleted ? undefined : isNull(ticketStatuses.deletedAt)
  return db
    .select()
    .from(ticketStatuses)
    .where(where)
    .orderBy(asc(ticketStatuses.position), asc(ticketStatuses.name))
}

export async function getTicketStatus(id: TicketStatusId): Promise<TicketStatusEntity | null> {
  const row = await db.query.ticketStatuses.findFirst({
    where: eq(ticketStatuses.id, id),
  })
  return row ?? null
}

export async function getDefaultTicketStatus(): Promise<TicketStatusEntity | null> {
  const row = await db.query.ticketStatuses.findFirst({
    where: and(eq(ticketStatuses.isDefault, true), isNull(ticketStatuses.deletedAt)),
  })
  return row ?? null
}

export async function createTicketStatus(
  input: CreateTicketStatusInput,
  actor: TicketStatusActorContext
): Promise<TicketStatusEntity> {
  const name = input.name?.trim()
  const slug = input.slug?.trim().toLowerCase()
  if (!name) throw new ValidationError('TICKET_STATUS_NAME_REQUIRED', 'name is required')
  if (!slug || !SLUG_RE.test(slug)) {
    throw new ValidationError('TICKET_STATUS_SLUG_INVALID', 'slug must match [a-z0-9_-]+')
  }
  if (!TICKET_STATUS_CATEGORIES.includes(input.category)) {
    throw new ValidationError('TICKET_STATUS_CATEGORY_INVALID', 'invalid category')
  }
  const dup = await db.query.ticketStatuses.findFirst({
    where: eq(ticketStatuses.slug, slug),
  })
  if (dup) throw new ConflictError('TICKET_STATUS_SLUG_TAKEN', `slug "${slug}" already exists`)

  // Only one default at a time.
  if (input.isDefault) {
    await db
      .update(ticketStatuses)
      .set({ isDefault: false })
      .where(eq(ticketStatuses.isDefault, true))
  }

  const [row] = await db
    .insert(ticketStatuses)
    .values({
      name,
      slug,
      color: input.color ?? '#6b7280',
      category: input.category,
      position: input.position ?? 0,
      isDefault: input.isDefault ?? false,
      isSystem: false,
    })
    .returning()
  await fireStatusEvent('created', actor, row)
  return row
}

export interface UpdateTicketStatusInput {
  name?: string
  color?: string
  category?: TicketStatusCategory
  position?: number
  isDefault?: boolean
}

export async function updateTicketStatus(
  id: TicketStatusId,
  input: UpdateTicketStatusInput,
  actor: TicketStatusActorContext
): Promise<TicketStatusEntity> {
  const existing = await getTicketStatus(id)
  if (!existing) throw new NotFoundError('TICKET_STATUS_NOT_FOUND', `status ${id} not found`)

  if (input.category && !TICKET_STATUS_CATEGORIES.includes(input.category)) {
    throw new ValidationError('TICKET_STATUS_CATEGORY_INVALID', 'invalid category')
  }
  if (input.isDefault) {
    await db
      .update(ticketStatuses)
      .set({ isDefault: false })
      .where(eq(ticketStatuses.isDefault, true))
  }

  const patch: Partial<typeof existing> = {}
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.color !== undefined) patch.color = input.color
  if (input.category !== undefined) patch.category = input.category
  if (input.position !== undefined) patch.position = input.position
  if (input.isDefault !== undefined) patch.isDefault = input.isDefault

  if (Object.keys(patch).length === 0) return existing

  const [row] = await db
    .update(ticketStatuses)
    .set(patch)
    .where(eq(ticketStatuses.id, id))
    .returning()
  await fireStatusEvent('updated', actor, row, Object.keys(patch))
  return row
}

export async function archiveTicketStatus(
  id: TicketStatusId,
  actor: TicketStatusActorContext
): Promise<TicketStatusEntity> {
  const existing = await getTicketStatus(id)
  if (!existing) throw new NotFoundError('TICKET_STATUS_NOT_FOUND', `status ${id} not found`)
  if (existing.isSystem) {
    throw new ValidationError('TICKET_STATUS_SYSTEM', 'system statuses cannot be archived')
  }
  const [row] = await db
    .update(ticketStatuses)
    .set({ deletedAt: new Date(), isDefault: false })
    .where(eq(ticketStatuses.id, id))
    .returning()
  await fireStatusEvent('updated', actor, row, ['deletedAt'])
  return row
}
