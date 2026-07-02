/**
 * Inboxes domain — CRUD for the named queues that own incoming tickets.
 *
 * Permission checks are the caller's responsibility; this layer is pure.
 */

import {
  db,
  eq,
  and,
  isNull,
  ilike,
  or,
  asc,
  inboxes,
  inboxMemberships,
  type Inbox,
  type TicketPriority,
  type TicketVisibilityScope,
} from '@/lib/server/db'
import type { InboxId, TeamId, TicketStatusId, PrincipalId, UserId } from '@quackback/ids'
import type { EventInboxRef } from '@/lib/server/events/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'

/**
 * Identity of the operator (or system caller) performing the mutation.
 * Required so configuration-plane webhook events carry a meaningful actor.
 * For internal/system calls, pass `{ principalId: null }`.
 */
export interface InboxActorContext {
  principalId: PrincipalId | null
  userId?: UserId | null
}

async function fireInboxEvent(
  kind: 'created' | 'updated' | 'archived' | 'unarchived',
  actor: InboxActorContext,
  inbox: Inbox,
  changedFields?: string[]
): Promise<void> {
  try {
    const {
      buildEventActor,
      dispatchInboxCreated,
      dispatchInboxUpdated,
      dispatchInboxArchived,
      dispatchInboxUnarchived,
    } = await import('@/lib/server/events/dispatch')
    const eventActor = actor.principalId
      ? buildEventActor({
          principalId: actor.principalId,
          userId: actor.userId ?? undefined,
          displayName: 'inbox-system',
        })
      : { type: 'service' as const, displayName: 'inbox-system' }
    if (kind === 'created')
      await dispatchInboxCreated(eventActor, inbox as unknown as EventInboxRef)
    else if (kind === 'updated')
      await dispatchInboxUpdated(eventActor, inbox as unknown as EventInboxRef, changedFields ?? [])
    else if (kind === 'archived')
      await dispatchInboxArchived(eventActor, inbox as unknown as EventInboxRef)
    else await dispatchInboxUnarchived(eventActor, inbox as unknown as EventInboxRef)
  } catch (err) {
    console.warn(`[inboxes] dispatchInbox${kind} failed`, err)
  }
}

const NAME_MAX = 200
const SLUG_MAX = 100
const SLUG_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase()
}

function validateSlug(slug: string): void {
  if (!slug) throw new ValidationError('INBOX_SLUG_REQUIRED', 'slug is required')
  if (slug.length > SLUG_MAX)
    throw new ValidationError('INBOX_SLUG_TOO_LONG', `slug exceeds ${SLUG_MAX} chars`)
  if (!SLUG_REGEX.test(slug))
    throw new ValidationError(
      'INBOX_SLUG_INVALID',
      'slug must be lowercase letters/digits separated by - or _'
    )
}

export interface CreateInboxInput {
  name: string
  slug: string
  description?: string | null
  primaryTeamId?: TeamId | null
  defaultVisibilityScope?: TicketVisibilityScope
  defaultPriority?: TicketPriority
  defaultStatusId?: TicketStatusId | null
  color?: string | null
  icon?: string | null
}

export async function createInbox(
  input: CreateInboxInput,
  actor: InboxActorContext
): Promise<Inbox> {
  const name = input.name?.trim()
  if (!name) throw new ValidationError('INBOX_NAME_REQUIRED', 'Inbox name is required')
  if (name.length > NAME_MAX)
    throw new ValidationError('INBOX_NAME_TOO_LONG', `Inbox name exceeds ${NAME_MAX} chars`)

  const slug = normalizeSlug(input.slug)
  validateSlug(slug)

  const dup = await db.query.inboxes.findFirst({ where: eq(inboxes.slug, slug) })
  if (dup) throw new ConflictError('INBOX_SLUG_TAKEN', `Inbox slug "${slug}" already exists`)

  const created = await db.transaction(async (tx) => {
    const [createdInbox] = await tx
      .insert(inboxes)
      .values({
        name,
        slug,
        description: input.description ?? null,
        primaryTeamId: input.primaryTeamId ?? null,
        defaultVisibilityScope: input.defaultVisibilityScope ?? 'team',
        defaultPriority: input.defaultPriority ?? 'normal',
        defaultStatusId: input.defaultStatusId ?? null,
        color: input.color ?? null,
        icon: input.icon ?? null,
      })
      .returning()

    if (actor.principalId) {
      await tx.insert(inboxMemberships).values({
        inboxId: createdInbox.id,
        principalId: actor.principalId,
        role: 'owner',
      })
    }

    return createdInbox
  })

  await fireInboxEvent('created', actor, created)
  return created
}

export interface UpdateInboxInput {
  name?: string
  description?: string | null
  primaryTeamId?: TeamId | null
  defaultVisibilityScope?: TicketVisibilityScope
  defaultPriority?: TicketPriority
  defaultStatusId?: TicketStatusId | null
  color?: string | null
  icon?: string | null
}

export async function updateInbox(
  inboxId: InboxId,
  input: UpdateInboxInput,
  actor: InboxActorContext
): Promise<Inbox> {
  const existing = await getInbox(inboxId)
  if (!existing) throw new NotFoundError('INBOX_NOT_FOUND', `Inbox ${inboxId} not found`)

  const patch: Partial<typeof inboxes.$inferInsert> = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new ValidationError('INBOX_NAME_REQUIRED', 'Inbox name is required')
    if (name.length > NAME_MAX)
      throw new ValidationError('INBOX_NAME_TOO_LONG', `Inbox name exceeds ${NAME_MAX} chars`)
    patch.name = name
  }
  if (input.description !== undefined) patch.description = input.description
  if (input.primaryTeamId !== undefined) patch.primaryTeamId = input.primaryTeamId
  if (input.defaultVisibilityScope !== undefined)
    patch.defaultVisibilityScope = input.defaultVisibilityScope
  if (input.defaultPriority !== undefined) patch.defaultPriority = input.defaultPriority
  if (input.defaultStatusId !== undefined) patch.defaultStatusId = input.defaultStatusId
  if (input.color !== undefined) patch.color = input.color
  if (input.icon !== undefined) patch.icon = input.icon

  if (Object.keys(patch).length === 0) return existing

  const [updated] = await db.update(inboxes).set(patch).where(eq(inboxes.id, inboxId)).returning()
  await fireInboxEvent('updated', actor, updated, Object.keys(patch))
  return updated
}

export async function archiveInbox(inboxId: InboxId, actor: InboxActorContext): Promise<Inbox> {
  const existing = await getInbox(inboxId)
  if (!existing) throw new NotFoundError('INBOX_NOT_FOUND', `Inbox ${inboxId} not found`)
  if (existing.archivedAt) return existing
  const [updated] = await db
    .update(inboxes)
    .set({ archivedAt: new Date() })
    .where(eq(inboxes.id, inboxId))
    .returning()
  await fireInboxEvent('archived', actor, updated)
  return updated
}

export async function unarchiveInbox(inboxId: InboxId, actor: InboxActorContext): Promise<Inbox> {
  const existing = await getInbox(inboxId)
  if (!existing) throw new NotFoundError('INBOX_NOT_FOUND', `Inbox ${inboxId} not found`)
  if (!existing.archivedAt) return existing
  const [updated] = await db
    .update(inboxes)
    .set({ archivedAt: null })
    .where(eq(inboxes.id, inboxId))
    .returning()
  await fireInboxEvent('unarchived', actor, updated)
  return updated
}

export async function getInbox(inboxId: InboxId): Promise<Inbox | undefined> {
  return db.query.inboxes.findFirst({ where: eq(inboxes.id, inboxId) })
}

export async function getInboxBySlug(slug: string): Promise<Inbox | undefined> {
  return db.query.inboxes.findFirst({ where: eq(inboxes.slug, normalizeSlug(slug)) })
}

export interface ListInboxesParams {
  search?: string
  primaryTeamId?: TeamId
  includeArchived?: boolean
  limit?: number
  offset?: number
}

export async function listInboxes(params: ListInboxesParams = {}): Promise<Inbox[]> {
  const filters = []
  if (!params.includeArchived) filters.push(isNull(inboxes.archivedAt))
  if (params.primaryTeamId) filters.push(eq(inboxes.primaryTeamId, params.primaryTeamId))
  if (params.search) {
    const q = `%${params.search}%`
    filters.push(or(ilike(inboxes.name, q), ilike(inboxes.slug, q))!)
  }
  return db
    .select()
    .from(inboxes)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(inboxes.name))
    .limit(params.limit ?? 100)
    .offset(params.offset ?? 0)
}
