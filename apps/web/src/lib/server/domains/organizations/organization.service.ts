/**
 * Organizations domain — CRUD for B2B customer companies.
 *
 * Permission checks are the caller's responsibility; this layer is a pure
 * service.
 *
 * `findOrCreateByDomain` is the Phase 3 ticket-intake helper: when a new
 * ticket arrives by email and no contact yet exists, the pipeline
 * synthesises an organization for the sender's domain and attaches the
 * contact to it.
 */

import {
  db,
  eq,
  and,
  isNull,
  ilike,
  or,
  asc,
  desc,
  organizations,
  type Organization,
  type OrgMetadata,
} from '@/lib/server/db'
import type { OrganizationId, PrincipalId, UserId } from '@quackback/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { normalizeDomain } from './normalize'

/**
 * Identity of the operator (or system caller) performing the mutation.
 * For internal/system calls (e.g. ticket-intake `findOrCreateByDomain`),
 * pass `{ principalId: null }`.
 */
export interface OrganizationActorContext {
  principalId: PrincipalId | null
  userId?: UserId | null
}

const SERVICE_ACTOR: OrganizationActorContext = { principalId: null }

async function fireOrganizationEvent(
  kind: 'created' | 'updated' | 'archived' | 'unarchived',
  actor: OrganizationActorContext,
  org: Organization,
  changedFields?: string[]
): Promise<void> {
  try {
    const {
      buildEventActor,
      dispatchOrganizationCreated,
      dispatchOrganizationUpdated,
      dispatchOrganizationArchived,
      dispatchOrganizationUnarchived,
    } = await import('@/lib/server/events/dispatch')
    const eventActor = actor.principalId
      ? buildEventActor({
          principalId: actor.principalId,
          userId: actor.userId ?? undefined,
          displayName: 'organizations-system',
        })
      : { type: 'service' as const, displayName: 'organizations-system' }
    if (kind === 'created') await dispatchOrganizationCreated(eventActor, org as never)
    else if (kind === 'updated')
      await dispatchOrganizationUpdated(eventActor, org as never, changedFields ?? [])
    else if (kind === 'archived') await dispatchOrganizationArchived(eventActor, org as never)
    else await dispatchOrganizationUnarchived(eventActor, org as never)
  } catch (err) {
    console.warn(`[organizations] dispatchOrganization${kind} failed`, err)
  }
}

const NAME_MAX = 200

export interface CreateOrganizationInput {
  name: string
  domain?: string | null
  externalId?: string | null
  website?: string | null
  notes?: string | null
  metadata?: OrgMetadata
}

export async function createOrganization(
  input: CreateOrganizationInput,
  actor: OrganizationActorContext = SERVICE_ACTOR
): Promise<Organization> {
  const name = input.name?.trim()
  if (!name) {
    throw new ValidationError('ORG_NAME_REQUIRED', 'Organization name is required')
  }
  if (name.length > NAME_MAX) {
    throw new ValidationError('ORG_NAME_TOO_LONG', `Organization name exceeds ${NAME_MAX} chars`)
  }

  const domain = input.domain ? normalizeDomain(input.domain) : null
  if (input.domain && !domain) {
    throw new ValidationError('ORG_DOMAIN_INVALID', 'Organization domain is invalid')
  }
  if (domain) {
    const existing = await db.query.organizations.findFirst({
      where: eq(organizations.domain, domain),
    })
    if (existing) {
      throw new ConflictError(
        'ORG_DOMAIN_TAKEN',
        `Organization with domain "${domain}" already exists`
      )
    }
  }
  if (input.externalId) {
    const existing = await db.query.organizations.findFirst({
      where: eq(organizations.externalId, input.externalId),
    })
    if (existing) {
      throw new ConflictError('ORG_EXTERNAL_ID_TAKEN', 'externalId already in use')
    }
  }

  const [created] = await db
    .insert(organizations)
    .values({
      name,
      domain,
      externalId: input.externalId ?? null,
      website: input.website ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? {},
    })
    .returning()
  await fireOrganizationEvent('created', actor, created)
  return created
}

export interface UpdateOrganizationInput {
  name?: string
  domain?: string | null
  externalId?: string | null
  website?: string | null
  notes?: string | null
  metadata?: OrgMetadata
}

export async function updateOrganization(
  organizationId: OrganizationId,
  input: UpdateOrganizationInput,
  actor: OrganizationActorContext = SERVICE_ACTOR
): Promise<Organization> {
  const org = await getOrganization(organizationId)
  if (!org) throw new NotFoundError('ORG_NOT_FOUND', `Organization ${organizationId} not found`)

  let domain: string | null | undefined = undefined
  if (input.domain !== undefined) {
    domain = input.domain ? normalizeDomain(input.domain) : null
    if (input.domain && !domain) {
      throw new ValidationError('ORG_DOMAIN_INVALID', 'Organization domain is invalid')
    }
    if (domain && domain !== org.domain) {
      const dup = await db.query.organizations.findFirst({
        where: eq(organizations.domain, domain),
      })
      if (dup && dup.id !== organizationId) {
        throw new ConflictError(
          'ORG_DOMAIN_TAKEN',
          `Organization with domain "${domain}" already exists`
        )
      }
    }
  }

  if (input.externalId !== undefined && input.externalId && input.externalId !== org.externalId) {
    const dup = await db.query.organizations.findFirst({
      where: eq(organizations.externalId, input.externalId),
    })
    if (dup && dup.id !== organizationId) {
      throw new ConflictError('ORG_EXTERNAL_ID_TAKEN', 'externalId already in use')
    }
  }

  const name = input.name?.trim()
  if (name !== undefined && name.length > NAME_MAX) {
    throw new ValidationError('ORG_NAME_TOO_LONG', `Organization name exceeds ${NAME_MAX} chars`)
  }

  const [updated] = await db
    .update(organizations)
    .set({
      name: name !== undefined ? name : org.name,
      domain: domain !== undefined ? domain : org.domain,
      externalId: input.externalId !== undefined ? input.externalId : org.externalId,
      website: input.website !== undefined ? input.website : org.website,
      notes: input.notes !== undefined ? input.notes : org.notes,
      metadata: input.metadata !== undefined ? input.metadata : org.metadata,
    })
    .where(eq(organizations.id, organizationId))
    .returning()
  const changedFields: string[] = []
  for (const key of ['name', 'domain', 'externalId', 'website', 'notes'] as const) {
    if (input[key] !== undefined && (org[key] ?? null) !== (updated[key] ?? null)) {
      changedFields.push(key)
    }
  }
  if (changedFields.length > 0)
    await fireOrganizationEvent('updated', actor, updated, changedFields)
  return updated
}

export async function archiveOrganization(
  organizationId: OrganizationId,
  actor: OrganizationActorContext = SERVICE_ACTOR
): Promise<void> {
  const [archived] = await db
    .update(organizations)
    .set({ archivedAt: new Date() })
    .where(eq(organizations.id, organizationId))
    .returning()
  if (archived) await fireOrganizationEvent('archived', actor, archived)
}

export async function unarchiveOrganization(
  organizationId: OrganizationId,
  actor: OrganizationActorContext = SERVICE_ACTOR
): Promise<void> {
  const [unarchived] = await db
    .update(organizations)
    .set({ archivedAt: null })
    .where(eq(organizations.id, organizationId))
    .returning()
  if (unarchived) await fireOrganizationEvent('unarchived', actor, unarchived)
}

export async function getOrganization(
  organizationId: OrganizationId
): Promise<Organization | null> {
  const row = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  })
  return row ?? null
}

export async function getOrganizationByDomain(domain: string): Promise<Organization | null> {
  const normalized = normalizeDomain(domain)
  if (!normalized) return null
  const row = await db.query.organizations.findFirst({
    where: eq(organizations.domain, normalized),
  })
  return row ?? null
}

export interface ListOrganizationsInput {
  search?: string
  includeArchived?: boolean
  limit?: number
  offset?: number
}

export async function listOrganizations(
  input: ListOrganizationsInput = {}
): Promise<Organization[]> {
  const limit = Math.min(input.limit ?? 50, 200)
  const offset = Math.max(input.offset ?? 0, 0)
  const conditions = []
  if (!input.includeArchived) conditions.push(isNull(organizations.archivedAt))
  if (input.search?.trim()) {
    const q = `%${input.search.trim()}%`
    conditions.push(or(ilike(organizations.name, q), ilike(organizations.domain, q)))
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined
  return db
    .select()
    .from(organizations)
    .where(where)
    .orderBy(asc(organizations.name), desc(organizations.createdAt))
    .limit(limit)
    .offset(offset)
}

/**
 * Concurrency-safe upsert by domain. Used by Phase 3 ticket intake when
 * routing inbound email — if two requests race on the same domain, the
 * unique partial index on `organizations.domain` ensures one of them
 * succeeds and the other reads the existing row.
 */
export async function findOrCreateByDomain(
  domain: string,
  fallbackName?: string,
  actor: OrganizationActorContext = SERVICE_ACTOR
): Promise<Organization> {
  const normalized = normalizeDomain(domain)
  if (!normalized) {
    throw new ValidationError('ORG_DOMAIN_INVALID', `Domain "${domain}" is invalid`)
  }
  const existing = await getOrganizationByDomain(normalized)
  if (existing) return existing
  try {
    const [created] = await db
      .insert(organizations)
      .values({
        name: fallbackName?.trim() || normalized,
        domain: normalized,
        metadata: {},
      })
      .returning()
    await fireOrganizationEvent('created', actor, created)
    return created
  } catch (err) {
    // Race: another request created the row first.
    const after = await getOrganizationByDomain(normalized)
    if (after) return after
    throw err
  }
}
