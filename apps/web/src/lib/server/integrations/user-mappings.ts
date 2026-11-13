/**
 * Accounts on a provider matched to teammates (`integration_user_mappings`).
 * A mapping belongs to the connection, not to one of its destinations: a
 * GitHub account is the same teammate in every repository. Inbound assignee
 * sync reads it to turn an issue's assignee into the ticket's assignee
 * (`principalForExternalUser`); outbound sync reads it the other way
 * (`externalUserForPrincipal`).
 *
 * Accounts are keyed by the provider's immutable user id. The login is kept
 * for display and refreshed whenever a delivery shows the account under a new
 * one; it is matched only when a delivery names no id.
 */
import {
  db,
  eq,
  and,
  asc,
  sql,
  integrations,
  integrationUserMappings,
  principal,
  user,
} from '@/lib/server/db'
import type { IntegrationId, IntegrationUserMappingId, PrincipalId } from '@quackback/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { isTeamMember } from '@/lib/shared/roles'
import { isUniqueViolation } from '@/lib/server/utils'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'integration-user-mappings' })

export type IntegrationUserMapping = typeof integrationUserMappings.$inferSelect

/** One mapping as the settings page shows it, with the teammate's name. */
export interface IntegrationUserMappingSummary {
  id: IntegrationUserMappingId
  externalUserId: string
  externalLogin: string
  externalDisplayName: string | null
  principalId: PrincipalId
  teammateName: string | null
  teammateEmail: string | null
}

/** An account on the provider, as a delivery or the provider's API names it. */
export interface ExternalUserRef {
  externalUserId?: string | null
  login?: string | null
}

export async function listUserMappings(
  integrationId: IntegrationId
): Promise<IntegrationUserMappingSummary[]> {
  const rows = await db
    .select({
      id: integrationUserMappings.id,
      externalUserId: integrationUserMappings.externalUserId,
      externalLogin: integrationUserMappings.externalLogin,
      externalDisplayName: integrationUserMappings.externalDisplayName,
      principalId: integrationUserMappings.principalId,
      teammateName: sql<string | null>`coalesce(${user.name}, ${principal.displayName})`,
      teammateEmail: user.email,
    })
    .from(integrationUserMappings)
    .innerJoin(principal, eq(principal.id, integrationUserMappings.principalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(integrationUserMappings.integrationId, integrationId))
    .orderBy(asc(sql`lower(${integrationUserMappings.externalLogin})`))
  return rows
}

/**
 * Match an account to a teammate, or move an existing match of that account
 * to another teammate. The connection must exist and the principal must be a
 * teammate (a user who is an admin or a member). A teammate already matched
 * to another account is refused: one account per teammate, so an outbound
 * assignment always names one account. Returns the stored mapping and the one
 * it replaced, if any.
 */
export async function upsertUserMapping(input: {
  integrationId: IntegrationId
  externalUserId: string
  externalLogin: string
  externalDisplayName?: string | null
  principalId: PrincipalId
  createdByPrincipalId?: PrincipalId | null
}): Promise<{ mapping: IntegrationUserMapping; previous: IntegrationUserMapping | null }> {
  const externalUserId = input.externalUserId.trim()
  const externalLogin = input.externalLogin.trim()
  if (!externalUserId || !externalLogin)
    throw new ValidationError('INVALID_EXTERNAL_USER', 'Name the account to match')

  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.id, input.integrationId),
    columns: { id: true },
  })
  if (!integration) throw new NotFoundError('INTEGRATION_NOT_FOUND', 'Integration not found')

  const [teammate] = await db
    .select({ type: principal.type, role: principal.role })
    .from(principal)
    .where(eq(principal.id, input.principalId))
    .limit(1)
  if (!teammate || teammate.type !== 'user' || !isTeamMember(teammate.role))
    throw new ValidationError('INVALID_TEAMMATE', 'Choose a teammate')

  const [previous] = await db
    .select()
    .from(integrationUserMappings)
    .where(
      and(
        eq(integrationUserMappings.integrationId, input.integrationId),
        eq(integrationUserMappings.externalUserId, externalUserId)
      )
    )
    .limit(1)

  try {
    const [mapping] = await db
      .insert(integrationUserMappings)
      .values({
        integrationId: input.integrationId,
        externalUserId,
        externalLogin,
        externalDisplayName: input.externalDisplayName?.trim() || null,
        principalId: input.principalId,
        createdByPrincipalId: input.createdByPrincipalId ?? null,
      })
      .onConflictDoUpdate({
        target: [integrationUserMappings.integrationId, integrationUserMappings.externalUserId],
        set: {
          externalLogin,
          externalDisplayName: input.externalDisplayName?.trim() || null,
          principalId: input.principalId,
          updatedAt: new Date(),
        },
      })
      .returning()
    return { mapping, previous: previous ?? null }
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ConflictError(
        'TEAMMATE_ALREADY_MAPPED',
        'That teammate is already matched to another account'
      )
    throw error
  }
}

/** Remove a mapping of this connection. Returns the removed row. */
export async function deleteUserMapping(
  integrationId: IntegrationId,
  mappingId: IntegrationUserMappingId
): Promise<IntegrationUserMapping> {
  const [removed] = await db
    .delete(integrationUserMappings)
    .where(
      and(
        eq(integrationUserMappings.id, mappingId),
        eq(integrationUserMappings.integrationId, integrationId)
      )
    )
    .returning()
  if (!removed) throw new NotFoundError('USER_MAPPING_NOT_FOUND', 'Mapping not found')
  return removed
}

/**
 * The teammate an account stands for. By the provider's user id first; a
 * match whose stored login differs takes the new one (the account was
 * renamed). By login, case-insensitively, only when the reference carries no
 * id: an id that matches nothing is another account, even if it now holds a
 * login a mapped account once had.
 */
export async function principalForExternalUser(
  integrationId: IntegrationId,
  ref: ExternalUserRef
): Promise<PrincipalId | null> {
  const login = ref.login?.trim() || null
  const externalUserId = ref.externalUserId?.trim() || null
  if (externalUserId) {
    const [byId] = await db
      .select()
      .from(integrationUserMappings)
      .where(
        and(
          eq(integrationUserMappings.integrationId, integrationId),
          eq(integrationUserMappings.externalUserId, externalUserId)
        )
      )
      .limit(1)
    if (!byId) return null
    if (login && login !== byId.externalLogin)
      await db
        .update(integrationUserMappings)
        .set({ externalLogin: login, updatedAt: new Date() })
        .where(eq(integrationUserMappings.id, byId.id))
        .catch((err) => log.warn({ err, mapping_id: byId.id }, 'could not refresh the login'))
    return byId.principalId
  }
  if (!login) return null
  const [byLogin] = await db
    .select({ principalId: integrationUserMappings.principalId })
    .from(integrationUserMappings)
    .where(
      and(
        eq(integrationUserMappings.integrationId, integrationId),
        sql`lower(${integrationUserMappings.externalLogin}) = lower(${login})`
      )
    )
    .limit(1)
  return byLogin?.principalId ?? null
}

/** The account a teammate is matched to on this connection, if any. */
export async function externalUserForPrincipal(
  integrationId: IntegrationId,
  principalId: PrincipalId
): Promise<{ externalUserId: string; externalLogin: string } | null> {
  const [row] = await db
    .select({
      externalUserId: integrationUserMappings.externalUserId,
      externalLogin: integrationUserMappings.externalLogin,
    })
    .from(integrationUserMappings)
    .where(
      and(
        eq(integrationUserMappings.integrationId, integrationId),
        eq(integrationUserMappings.principalId, principalId)
      )
    )
    .limit(1)
  return row ?? null
}
