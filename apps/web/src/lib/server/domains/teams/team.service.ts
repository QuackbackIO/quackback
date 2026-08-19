/**
 * Teams service (support platform §4.12): CRUD for teams, membership, and the
 * default-team + assignment-method helpers the inbox routing leans on.
 *
 * Invariants enforced here:
 * - At most one `is_default` team among non-deleted rows (single-holder). There
 *   is no DB unique constraint; a transaction clears the old holder first.
 * - The default team cannot be deleted (it is the workspace-wide fallback).
 * - Membership is teammates only (type 'user', role admin/member).
 * - Delete is soft (`deleted_at`); a removed team's set-null'd conversation
 *   assignments survive.
 */
import {
  db,
  eq,
  ne,
  and,
  isNull,
  inArray,
  count,
  teams,
  teamMembers,
  principal,
  user,
} from '@/lib/server/db'
import type { Transaction } from '@/lib/server/db'
import type { PrincipalId, TeamId } from '@quackback/ids'
import { isTeamMember } from '@/lib/shared/roles'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import type {
  Team,
  CreateTeamInput,
  UpdateTeamInput,
  TeamWithMemberCount,
  TeamMemberSummary,
} from './team.types'

const log = logger.child({ component: 'teams' })

type Executor = typeof db | Transaction

/** Trim to a value or null so empty strings never persist. */
function nullableTrim(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Non-deleted teams, newest first, with a member count for the list views. */
export async function listTeams(): Promise<TeamWithMemberCount[]> {
  const rows = await db
    .select({
      team: teams,
      memberCount: count(teamMembers.id),
    })
    .from(teams)
    .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .where(isNull(teams.deletedAt))
    .groupBy(teams.id)
    .orderBy(teams.createdAt)
  return rows.map((r) => ({ ...r.team, memberCount: Number(r.memberCount) }))
}

/** Load a non-deleted team or throw NotFound. */
export async function getTeam(id: TeamId): Promise<Team> {
  const [row] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, id), isNull(teams.deletedAt)))
    .limit(1)
  if (!row) throw new NotFoundError('TEAM_NOT_FOUND', 'Team not found')
  return row
}

/** Clear the default flag on every non-deleted team except `keepId`. */
async function clearOtherDefaults(exec: Executor, keepId: TeamId | null): Promise<void> {
  const where = keepId
    ? and(eq(teams.isDefault, true), ne(teams.id, keepId))
    : eq(teams.isDefault, true)
  await exec.update(teams).set({ isDefault: false }).where(where)
}

export async function createTeam(input: CreateTeamInput): Promise<Team> {
  const name = input.name?.trim()
  if (!name) throw new ValidationError('VALIDATION_ERROR', 'Team name is required')
  log.info({ name }, 'create team')
  const [row] = await db
    .insert(teams)
    .values({
      name,
      icon: nullableTrim(input.icon),
      color: nullableTrim(input.color),
      description: nullableTrim(input.description),
      assignmentMethod: input.assignmentMethod ?? 'manual',
    })
    .returning()
  return row
}

export async function updateTeam(id: TeamId, input: UpdateTeamInput): Promise<Team> {
  const patch: Partial<typeof teams.$inferInsert> = { updatedAt: new Date() }
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new ValidationError('VALIDATION_ERROR', 'Team name is required')
    patch.name = name
  }
  if (input.icon !== undefined) patch.icon = nullableTrim(input.icon)
  if (input.color !== undefined) patch.color = nullableTrim(input.color)
  if (input.description !== undefined) patch.description = nullableTrim(input.description)
  if (input.assignmentMethod !== undefined) patch.assignmentMethod = input.assignmentMethod
  log.info({ team_id: id }, 'update team')
  const [row] = await db
    .update(teams)
    .set(patch)
    .where(and(eq(teams.id, id), isNull(teams.deletedAt)))
    .returning()
  if (!row) throw new NotFoundError('TEAM_NOT_FOUND', 'Team not found')
  return row
}

/**
 * Promote a team to the workspace default, demoting the previous holder in the
 * same transaction (single-holder invariant).
 */
export async function setDefaultTeam(id: TeamId): Promise<Team> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), isNull(teams.deletedAt)))
      .limit(1)
    if (!target) throw new NotFoundError('TEAM_NOT_FOUND', 'Team not found')
    await clearOtherDefaults(tx, id)
    const [row] = await tx
      .update(teams)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(teams.id, id))
      .returning()
    return row
  })
}

/** Soft-delete a team. The default team is protected (it is the fallback). */
export async function deleteTeam(id: TeamId): Promise<void> {
  const team = await getTeam(id)
  if (team.isDefault) {
    throw new ValidationError('TEAM_IS_DEFAULT', 'The default team cannot be deleted')
  }
  log.info({ team_id: id }, 'delete team')
  await db.update(teams).set({ deletedAt: new Date() }).where(eq(teams.id, id))
}

// --- Membership -----------------------------------------------------------

/** Members of a team, joined to display fields for the picker + inbox. */
export async function listTeamMembers(teamId: TeamId): Promise<TeamMemberSummary[]> {
  const rows = await db
    .select({
      principalId: teamMembers.principalId,
      name: user.name,
      email: user.email,
    })
    .from(teamMembers)
    .innerJoin(principal, eq(principal.id, teamMembers.principalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(teamMembers.createdAt)
  return rows
}

/** Every teammate (type 'user', role admin/member) — the membership picker set. */
export async function listAssignableTeammates(): Promise<TeamMemberSummary[]> {
  const rows = await db
    .select({
      principalId: principal.id,
      name: user.name,
      email: user.email,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(and(eq(principal.type, 'user'), inArray(principal.role, ['admin', 'member'])))
    .orderBy(user.name)
  return rows
}

/** Count one team's members (for the update DTO, without re-listing every team). */
export async function countTeamMembers(teamId: TeamId): Promise<number> {
  const [row] = await db
    .select({ n: count(teamMembers.id) })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId))
  return Number(row?.n ?? 0)
}

/** The principal ids of a team's members (for routing distribution). */
export async function listTeamMemberPrincipalIds(teamId: TeamId): Promise<PrincipalId[]> {
  const rows = await db
    .select({ principalId: teamMembers.principalId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId))
  return rows.map((r) => r.principalId)
}

/** Replace a team's membership set with exactly `principalIds`. */
export async function setTeamMembers(teamId: TeamId, principalIds: PrincipalId[]): Promise<void> {
  const desired = Array.from(new Set(principalIds))
  await db.transaction(async (tx) => {
    const [team] = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
      .limit(1)
    if (!team) throw new NotFoundError('TEAM_NOT_FOUND', 'Team not found')
    // Validate the whole desired set in one query (reject if any id is not a
    // teammate), rather than a SELECT per member.
    if (desired.length > 0) {
      const rows = await tx
        .select({ id: principal.id, type: principal.type, role: principal.role })
        .from(principal)
        .where(inArray(principal.id, desired))
      const teammates = new Set(
        rows.filter((r) => r.type === 'user' && isTeamMember(r.role)).map((r) => r.id)
      )
      if (desired.some((id) => !teammates.has(id))) {
        throw new ValidationError('INVALID_TEAM_MEMBER', 'Only teammates can be team members')
      }
    }
    const existing = await tx
      .select({ principalId: teamMembers.principalId })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId))
    const current = new Set(existing.map((r) => r.principalId))
    const toAdd = desired.filter((id) => !current.has(id))
    const toRemove = [...current].filter((id) => !desired.includes(id))
    if (toRemove.length > 0) {
      await tx
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), inArray(teamMembers.principalId, toRemove)))
    }
    if (toAdd.length > 0) {
      await tx
        .insert(teamMembers)
        .values(toAdd.map((principalId) => ({ teamId, principalId })))
        .onConflictDoNothing()
    }
  })
}

/**
 * Enroll a new teammate in the default team. Best-effort: called from the
 * principal factory when a team-tier principal is created, so a missing default
 * team (mid-switch) or a duplicate must never break principal creation.
 */
export async function addPrincipalToDefaultTeam(
  principalId: PrincipalId,
  exec: Executor = db
): Promise<void> {
  const [dflt] = await exec
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.isDefault, true), isNull(teams.deletedAt)))
    .limit(1)
  if (!dflt) return
  await exec.insert(teamMembers).values({ teamId: dflt.id, principalId }).onConflictDoNothing()
}

/** Persist the round-robin rotation cursor after picking a member. */
export async function setRoundRobinCursor(
  teamId: TeamId,
  principalId: PrincipalId | null
): Promise<void> {
  await db.update(teams).set({ rrCursorPrincipalId: principalId }).where(eq(teams.id, teamId))
}
