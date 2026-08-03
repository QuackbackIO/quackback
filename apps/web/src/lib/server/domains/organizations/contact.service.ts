/**
 * Contacts domain — humans associated with a customer organization.
 *
 * Permission checks are the caller's responsibility.
 */

import {
  db,
  eq,
  and,
  isNull,
  ilike,
  or,
  sql,
  asc,
  desc,
  contacts,
  contactUserLinks,
  user,
  type Contact,
  type ContactUserLink,
} from '@/lib/server/db'
import type {
  ContactId,
  ContactUserLinkId,
  OrganizationId,
  PrincipalId,
  UserId,
} from '@quackback/ids'
import type { OrgMetadata } from '@/lib/server/db'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { normalizeEmail } from './normalize'

/**
 * Identity of the operator (or system caller) performing the mutation.
 * Required so CRM webhook events carry a meaningful actor. For internal /
 * system calls (ticket intake, portal-user link), pass `{ principalId: null }`.
 */
export interface ContactActorContext {
  principalId: PrincipalId | null
  userId?: UserId | null
}

const SERVICE_ACTOR: ContactActorContext = { principalId: null }

async function fireContactEvent(
  kind: 'created' | 'updated' | 'archived' | 'linked' | 'unlinked',
  actor: ContactActorContext,
  contact: Contact,
  extra?: { changedFields?: string[]; userId?: UserId; linkedByPrincipalId?: PrincipalId | null }
): Promise<void> {
  try {
    const {
      buildEventActor,
      dispatchContactCreated,
      dispatchContactUpdated,
      dispatchContactArchived,
      dispatchContactLinked,
      dispatchContactUnlinked,
    } = await import('@/lib/server/events/dispatch')
    const eventActor = actor.principalId
      ? buildEventActor({
          principalId: actor.principalId,
          userId: actor.userId ?? undefined,
          displayName: 'contacts-system',
        })
      : { type: 'service' as const, displayName: 'contacts-system' }
    if (kind === 'created') await dispatchContactCreated(eventActor, contact as never)
    else if (kind === 'updated')
      await dispatchContactUpdated(eventActor, contact as never, extra?.changedFields ?? [])
    else if (kind === 'archived') await dispatchContactArchived(eventActor, contact as never)
    else if (kind === 'linked')
      await dispatchContactLinked(
        eventActor,
        contact as never,
        String(extra?.userId ?? ''),
        extra?.linkedByPrincipalId ?? null
      )
    else await dispatchContactUnlinked(eventActor, contact as never, String(extra?.userId ?? ''))
  } catch (err) {
    console.warn(`[contacts] dispatchContact${kind} failed`, err)
  }
}

export interface CreateContactInput {
  name?: string | null
  email?: string | null
  phone?: string | null
  title?: string | null
  externalId?: string | null
  organizationId?: OrganizationId | null
  avatarUrl?: string | null
  metadata?: OrgMetadata
}

export async function createContact(
  input: CreateContactInput,
  actor: ContactActorContext = SERVICE_ACTOR
): Promise<Contact> {
  const email = input.email ? normalizeEmail(input.email) : null
  if (input.email && !email) {
    throw new ValidationError('CONTACT_EMAIL_INVALID', 'Contact email is invalid')
  }
  if (!input.name?.trim() && !email) {
    throw new ValidationError(
      'CONTACT_NAME_OR_EMAIL_REQUIRED',
      'Contact must have at least a name or email'
    )
  }
  if (email) {
    const existing = await db.query.contacts.findFirst({
      where: and(eq(contacts.email, email), isNull(contacts.archivedAt)),
    })
    if (existing) {
      throw new ConflictError('CONTACT_EMAIL_TAKEN', `Contact with email "${email}" already exists`)
    }
  }
  if (input.externalId) {
    const existing = await db.query.contacts.findFirst({
      where: eq(contacts.externalId, input.externalId),
    })
    if (existing) {
      throw new ConflictError('CONTACT_EXTERNAL_ID_TAKEN', 'externalId already in use')
    }
  }
  const [created] = await db
    .insert(contacts)
    .values({
      name: input.name?.trim() ?? null,
      email,
      phone: input.phone ?? null,
      title: input.title ?? null,
      externalId: input.externalId ?? null,
      organizationId: input.organizationId ?? null,
      avatarUrl: input.avatarUrl ?? null,
      metadata: input.metadata ?? {},
    })
    .returning()
  await fireContactEvent('created', actor, created)
  await autoLinkVerifiedUsersForContact(created, actor)
  return created
}

export interface UpdateContactInput {
  name?: string | null
  email?: string | null
  phone?: string | null
  title?: string | null
  externalId?: string | null
  organizationId?: OrganizationId | null
  avatarUrl?: string | null
  metadata?: OrgMetadata
}

export async function updateContact(
  contactId: ContactId,
  input: UpdateContactInput,
  actor: ContactActorContext = SERVICE_ACTOR
): Promise<Contact> {
  const existing = await getContact(contactId)
  if (!existing) throw new NotFoundError('CONTACT_NOT_FOUND', `Contact ${contactId} not found`)

  let email: string | null | undefined = undefined
  if (input.email !== undefined) {
    email = input.email ? normalizeEmail(input.email) : null
    if (input.email && !email) {
      throw new ValidationError('CONTACT_EMAIL_INVALID', 'Contact email is invalid')
    }
    if (email && email !== existing.email) {
      const dup = await db.query.contacts.findFirst({
        where: and(eq(contacts.email, email), isNull(contacts.archivedAt)),
      })
      if (dup && dup.id !== contactId) {
        throw new ConflictError(
          'CONTACT_EMAIL_TAKEN',
          `Contact with email "${email}" already exists`
        )
      }
    }
  }

  if (
    input.externalId !== undefined &&
    input.externalId &&
    input.externalId !== existing.externalId
  ) {
    const dup = await db.query.contacts.findFirst({
      where: eq(contacts.externalId, input.externalId),
    })
    if (dup && dup.id !== contactId) {
      throw new ConflictError('CONTACT_EXTERNAL_ID_TAKEN', 'externalId already in use')
    }
  }

  const [updated] = await db
    .update(contacts)
    .set({
      name: input.name !== undefined ? (input.name?.trim() ?? null) : existing.name,
      email: email !== undefined ? email : existing.email,
      phone: input.phone !== undefined ? input.phone : existing.phone,
      title: input.title !== undefined ? input.title : existing.title,
      externalId: input.externalId !== undefined ? input.externalId : existing.externalId,
      organizationId:
        input.organizationId !== undefined ? input.organizationId : existing.organizationId,
      avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : existing.avatarUrl,
      metadata: input.metadata !== undefined ? input.metadata : existing.metadata,
    })
    .where(eq(contacts.id, contactId))
    .returning()
  // Compute changed fields by comparing input keys whose final value differs
  // from the previous row. Only fields explicitly present in `input` count.
  const changedFields: string[] = []
  for (const key of [
    'name',
    'email',
    'phone',
    'title',
    'externalId',
    'organizationId',
    'avatarUrl',
  ] as const) {
    if (input[key] !== undefined && (existing[key] ?? null) !== (updated[key] ?? null)) {
      changedFields.push(key)
    }
  }
  if (changedFields.length > 0) await fireContactEvent('updated', actor, updated, { changedFields })
  if (changedFields.includes('email')) {
    await autoLinkVerifiedUsersForContact(updated, actor)
  }
  return updated
}

async function autoLinkVerifiedUsersForContact(
  contact: Contact,
  actor: ContactActorContext
): Promise<void> {
  if (!contact.email || contact.archivedAt) return

  try {
    const rows = await db
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          sql`LOWER(${user.email}) = ${contact.email}`,
          eq(user.emailVerified, true),
          eq(user.isAnonymous, false)
        )
      )

    for (const row of rows) {
      await linkContactToUser(
        {
          contactId: contact.id as ContactId,
          userId: row.id as UserId,
          linkedByPrincipalId: actor.principalId,
        },
        actor
      )
    }
  } catch (err) {
    console.warn('[contacts] auto-link verified users failed', {
      contactId: contact.id,
      error: err instanceof Error ? err.message : err,
    })
  }
}

export async function archiveContact(
  contactId: ContactId,
  actor: ContactActorContext = SERVICE_ACTOR
): Promise<void> {
  const [archived] = await db
    .update(contacts)
    .set({ archivedAt: new Date() })
    .where(eq(contacts.id, contactId))
    .returning()
  if (archived) await fireContactEvent('archived', actor, archived)
}

export async function getContact(contactId: ContactId): Promise<Contact | null> {
  const row = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) })
  return row ?? null
}

export async function getContactByEmail(email: string): Promise<Contact | null> {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const row = await db.query.contacts.findFirst({
    where: and(eq(contacts.email, normalized), isNull(contacts.archivedAt)),
  })
  return row ?? null
}

export async function listContactsForOrganization(
  organizationId: OrganizationId,
  opts: { includeArchived?: boolean; limit?: number; offset?: number } = {}
): Promise<Contact[]> {
  const limit = Math.min(opts.limit ?? 50, 200)
  const offset = Math.max(opts.offset ?? 0, 0)
  const conditions = [eq(contacts.organizationId, organizationId)]
  if (!opts.includeArchived) conditions.push(isNull(contacts.archivedAt))
  return db
    .select()
    .from(contacts)
    .where(and(...conditions))
    .orderBy(asc(contacts.name), desc(contacts.createdAt))
    .limit(limit)
    .offset(offset)
}

export interface SearchContactsInput {
  query?: string
  email?: string
  organizationId?: OrganizationId
  includeArchived?: boolean
  limit?: number
  offset?: number
}

export async function searchContacts(input: SearchContactsInput = {}): Promise<Contact[]> {
  const limit = Math.min(input.limit ?? 25, 100)
  const offset = Math.max(input.offset ?? 0, 0)
  const conditions = []
  if (!input.includeArchived) conditions.push(isNull(contacts.archivedAt))
  if (input.email) {
    const normalized = normalizeEmail(input.email)
    if (normalized) conditions.push(eq(contacts.email, normalized))
  }
  if (input.organizationId) conditions.push(eq(contacts.organizationId, input.organizationId))
  if (input.query?.trim()) {
    const q = `%${input.query.trim()}%`
    conditions.push(or(ilike(contacts.name, q), ilike(contacts.email, q)))
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined
  return db
    .select()
    .from(contacts)
    .where(where)
    .orderBy(asc(contacts.name), desc(contacts.createdAt))
    .limit(limit)
    .offset(offset)
}

export interface FindOrCreateByEmailInput {
  email: string
  name?: string | null
  organizationId?: OrganizationId | null
}

/**
 * Concurrency-safe upsert by email. Used by Phase 3 ticket intake.
 * The partial unique index on `contacts.email` (where archived_at IS NULL)
 * makes the race recoverable.
 */
export async function findOrCreateByEmail(
  input: FindOrCreateByEmailInput,
  actor: ContactActorContext = SERVICE_ACTOR
): Promise<Contact> {
  const normalized = normalizeEmail(input.email)
  if (!normalized) {
    throw new ValidationError('CONTACT_EMAIL_INVALID', `Email "${input.email}" is invalid`)
  }
  const existing = await getContactByEmail(normalized)
  if (existing) return existing
  try {
    const [created] = await db
      .insert(contacts)
      .values({
        name: input.name?.trim() ?? null,
        email: normalized,
        organizationId: input.organizationId ?? null,
        metadata: {},
      })
      .returning()
    await fireContactEvent('created', actor, created)
    return created
  } catch (err) {
    const after = await getContactByEmail(normalized)
    if (after) return after
    throw err
  }
}

// ---------------------------------------------------------------------------
// Contact ↔ portal user links (N:M)
// ---------------------------------------------------------------------------

export interface LinkContactToUserInput {
  contactId: ContactId
  userId: UserId
  linkedByPrincipalId?: PrincipalId | null
}

export async function linkContactToUser(
  input: LinkContactToUserInput,
  actor: ContactActorContext = SERVICE_ACTOR
): Promise<ContactUserLink> {
  const existing = await db.query.contactUserLinks.findFirst({
    where: and(
      eq(contactUserLinks.contactId, input.contactId),
      eq(contactUserLinks.userId, input.userId)
    ),
  })
  if (existing) return existing
  const [created] = await db
    .insert(contactUserLinks)
    .values({
      contactId: input.contactId,
      userId: input.userId,
      linkedByPrincipalId: input.linkedByPrincipalId ?? null,
    })
    .returning()
  // Fire only on actual insert (not on idempotent hit above).
  const contact = await getContact(input.contactId)
  if (contact) {
    await fireContactEvent('linked', actor, contact, {
      userId: input.userId,
      linkedByPrincipalId: input.linkedByPrincipalId ?? null,
    })
  }
  return created
}

export async function unlinkContactFromUser(
  contactId: ContactId,
  userId: UserId,
  actor: ContactActorContext = SERVICE_ACTOR
): Promise<void> {
  const deleted = await db
    .delete(contactUserLinks)
    .where(and(eq(contactUserLinks.contactId, contactId), eq(contactUserLinks.userId, userId)))
    .returning()
  if (deleted.length === 0) return
  const contact = await getContact(contactId)
  if (contact) await fireContactEvent('unlinked', actor, contact, { userId })
}

export async function unlinkById(linkId: ContactUserLinkId): Promise<void> {
  await db.delete(contactUserLinks).where(eq(contactUserLinks.id, linkId))
}

export async function listLinksForContact(contactId: ContactId): Promise<ContactUserLink[]> {
  return db.query.contactUserLinks.findMany({
    where: eq(contactUserLinks.contactId, contactId),
  })
}

export async function listLinksForUser(userId: UserId): Promise<ContactUserLink[]> {
  return db.query.contactUserLinks.findMany({
    where: eq(contactUserLinks.userId, userId),
  })
}
