/**
 * Teams domain — CRUD + membership management.
 *
 * Permission checks are the caller's responsibility (server functions /
 * route handlers); this layer is a pure service and does no auth lookups.
 */

import {
  db,
  eq,
  and,
  isNull,
  asc,
  teams,
  teamMemberships,
  type Team,
  type TeamMembership,
} from '@/lib/server/db'
import type { PrincipalId, TeamId, UserId } from '@quackback/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'

/**
 * Identity of the operator (or system caller) performing the mutation.
 * Required so configuration-plane webhook events carry a meaningful actor.
 */
export interface TeamActorContext {
  principalId: PrincipalId | null
  userId?: UserId | null
}

async function fireTeamEvent(
  kind: 'created' | 'updated' | 'archived',
  actor: TeamActorContext,
  team: Team,
  changedFields?: string[]
): Promise<void> {
  try {
    const { buildEventActor, dispatchTeamCreated, dispatchTeamUpdated, dispatchTeamArchived } =
      await import('@/lib/server/events/dispatch')
    const eventActor = actor.principalId
      ? buildEventActor({
          principalId: actor.principalId,
          userId: actor.userId ?? undefined,
          displayName: 'team-system',
        })
      : { type: 'service' as const, displayName: 'team-system' }
    if (kind === 'created') await dispatchTeamCreated(eventActor, team as never)
    else if (kind === 'updated')
      await dispatchTeamUpdated(eventActor, team as never, changedFields ?? [])
    else await dispatchTeamArchived(eventActor, team as never)
  } catch (err) {
    console.warn(`[teams] dispatchTeam${kind} failed`, err)
  }
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export interface CreateTeamInput {
  slug: string
  name: string
  description?: string | null
  shortLabel?: string | null
  color?: string | null
}

export async function createTeam(input: CreateTeamInput, actor: TeamActorContext): Promise<Team> {
  if (!input.name?.trim()) {
    throw new ValidationError('TEAM_NAME_REQUIRED', 'Team name is required')
  }
  if (!SLUG_RE.test(input.slug)) {
    throw new ValidationError(
      'TEAM_SLUG_INVALID',
      'Team slug must be lowercase alphanumeric/dashes (1–64 chars)'
    )
  }
  const existing = await db.query.teams.findFirst({ where: eq(teams.slug, input.slug) })
  if (existing) {
    throw new ConflictError('TEAM_SLUG_TAKEN', `Team with slug "${input.slug}" already exists`)
  }
  const [created] = await db
    .insert(teams)
    .values({
      slug: input.slug,
      name: input.name.trim(),
      description: input.description ?? null,
      shortLabel: input.shortLabel ?? null,
      color: input.color ?? null,
    })
    .returning()
  await fireTeamEvent('created', actor, created)
  return created
}

export interface UpdateTeamInput {
  name?: string
  description?: string | null
  shortLabel?: string | null
  color?: string | null
}

export async function updateTeam(
  teamId: TeamId,
  input: UpdateTeamInput,
  actor: TeamActorContext
): Promise<Team> {
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) })
  if (!team) throw new NotFoundError('TEAM_NOT_FOUND', `Team ${teamId} not found`)
  const changedFields: string[] = []
  const nextName = input.name?.trim() ?? team.name
  if (nextName !== team.name) changedFields.push('name')
  const nextDescription = input.description !== undefined ? input.description : team.description
  if (input.description !== undefined && nextDescription !== team.description)
    changedFields.push('description')
  const nextShortLabel = input.shortLabel !== undefined ? input.shortLabel : team.shortLabel
  if (input.shortLabel !== undefined && nextShortLabel !== team.shortLabel)
    changedFields.push('shortLabel')
  const nextColor = input.color !== undefined ? input.color : team.color
  if (input.color !== undefined && nextColor !== team.color) changedFields.push('color')
  const [updated] = await db
    .update(teams)
    .set({
      name: nextName,
      description: nextDescription,
      shortLabel: nextShortLabel,
      color: nextColor,
    })
    .where(eq(teams.id, teamId))
    .returning()
  await fireTeamEvent('updated', actor, updated, changedFields)
  return updated
}

export async function archiveTeam(teamId: TeamId, actor: TeamActorContext): Promise<void> {
  const [updated] = await db
    .update(teams)
    .set({ archivedAt: new Date() })
    .where(eq(teams.id, teamId))
    .returning()
  if (updated) await fireTeamEvent('archived', actor, updated)
}

export async function unarchiveTeam(teamId: TeamId, actor: TeamActorContext): Promise<void> {
  const [updated] = await db
    .update(teams)
    .set({ archivedAt: null })
    .where(eq(teams.id, teamId))
    .returning()
  if (updated) await fireTeamEvent('updated', actor, updated, ['archivedAt'])
}

export async function getTeam(teamId: TeamId): Promise<Team | null> {
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) })
  return team ?? null
}

export async function listTeams(opts: { includeArchived?: boolean } = {}): Promise<Team[]> {
  return db.query.teams.findMany({
    where: opts.includeArchived ? undefined : isNull(teams.archivedAt),
    orderBy: [asc(teams.name)],
  })
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

export type TeamRole = 'lead' | 'member'

export async function addMember(
  teamId: TeamId,
  principalId: PrincipalId,
  role: TeamRole = 'member'
): Promise<TeamMembership> {
  const existing = await db.query.teamMemberships.findFirst({
    where: and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.principalId, principalId)),
  })
  if (existing) {
    if (existing.role === role) return existing
    const [updated] = await db
      .update(teamMemberships)
      .set({ role })
      .where(eq(teamMemberships.id, existing.id))
      .returning()
    return updated
  }
  const [created] = await db
    .insert(teamMemberships)
    .values({ teamId, principalId, role })
    .returning()
  return created
}

export async function removeMember(teamId: TeamId, principalId: PrincipalId): Promise<void> {
  await db
    .delete(teamMemberships)
    .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.principalId, principalId)))
}

export async function listMembers(teamId: TeamId): Promise<TeamMembership[]> {
  return db.query.teamMemberships.findMany({ where: eq(teamMemberships.teamId, teamId) })
}

export async function listTeamsForPrincipal(principalId: PrincipalId): Promise<TeamId[]> {
  const rows = await db.query.teamMemberships.findMany({
    where: eq(teamMemberships.principalId, principalId),
    columns: { teamId: true },
  })
  return rows.map((r) => r.teamId as TeamId)
}
