/**
 * The canonical role seeder for real-DB tests: teammates with a real role
 * assignment (custom keys through the role tables), teams, conversations and
 * tickets. Reach for this when a test needs a scoped teammate; the visibility
 * matrices' world (conversation-visibility-world.ts) seeds only legacy roles.
 * Writes through `testDb`, so callers run inside the db-test-fixture rollback
 * transaction.
 *
 * Legacy `admin` and `member` both resolve to a preset with `view_all`, so a
 * scoped teammate needs a custom role through the role tables, which
 * `seedPerson(..., { keys })` writes.
 */
import { createId, type PrincipalId, type TeamId, type UserId } from '@quackback/ids'
import { testDb } from './db-test-fixture'
import { suffix } from './conversation-visibility-world'
import {
  conversations,
  permissions,
  principal,
  principalRoleAssignments,
  rolePermissions,
  roles,
  teamMembers,
  teams,
  tickets,
  ticketStatuses,
  user,
  inArray,
} from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

/** The keys of a custom role that sees only its holder's and their teams' items. */
export const SCOPED_KEYS: readonly PermissionKey[] = [
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.CONVERSATION_REPLY,
  PERMISSIONS.TICKET_VIEW,
]

/** A custom role carrying exactly `keys` (none for an empty role). */
export async function seedRole(keys: readonly PermissionKey[]) {
  const id = createId('role')
  await testDb.insert(roles).values({ id, key: `custom_${suffix()}`, name: 'Custom' })
  if (keys.length > 0) {
    const rows = await testDb
      .select({ id: permissions.id })
      .from(permissions)
      .where(inArray(permissions.key, [...keys]))
    if (rows.length !== keys.length) throw new Error('scope-seed: unknown permission key')
    await testDb
      .insert(rolePermissions)
      .values(rows.map((r) => ({ roleId: id, permissionId: r.id })))
  }
  return id
}

export interface SeededPerson {
  id: PrincipalId
  email: string
}

/**
 * A `user` principal with an account. `keys` gives it a workspace-wide custom
 * role assignment; without it the legacy role decides (admin and member see
 * everything, user sees nothing).
 */
export async function seedPerson(
  label: string,
  role: 'admin' | 'member' | 'user',
  opts: { keys?: readonly PermissionKey[]; type?: 'user' | 'service' } = {}
): Promise<SeededPerson> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  const email = `${label}-${suffix()}@example.com`
  await testDb.insert(user).values({ id: userId, name: label, email })
  await testDb.insert(principal).values({
    id,
    userId,
    role,
    type: opts.type ?? 'user',
    displayName: label,
    createdAt: new Date(),
  })
  if (opts.keys) {
    const roleId = await seedRole(opts.keys)
    await testDb.insert(principalRoleAssignments).values({ principalId: id, roleId })
  }
  return { id, email }
}

/** A team with these members. */
export async function seedTeam(name: string, members: readonly PrincipalId[]): Promise<TeamId> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `${name} ${suffix()}` })
    .returning()
  if (members.length > 0) {
    await testDb
      .insert(teamMembers)
      .values(members.map((principalId) => ({ teamId: team.id, principalId })))
  }
  return team.id as TeamId
}

/** A conversation owned by a fresh visitor, with this assignee and team. */
export async function seedConversation(opts: {
  assignee?: PrincipalId | null
  team?: TeamId | null
}) {
  const visitor = createId('principal') as PrincipalId
  await testDb.insert(principal).values({
    id: visitor,
    type: 'anonymous',
    role: 'user',
    displayName: 'Visitor',
    createdAt: new Date(),
  })
  const [row] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: visitor,
      channel: 'messenger',
      status: 'open',
      customAttributes: {},
      assignedAgentPrincipalId: opts.assignee ?? null,
      assignedTeamId: opts.team ?? null,
    })
    .returning()
  return { conversation: row, visitor }
}

/** A ticket with this requester, assignee and team. */
export async function seedTicket(opts: {
  requester: PrincipalId
  assignee?: PrincipalId | null
  team?: TeamId | null
  type?: 'customer' | 'back_office' | 'tracker'
  deleted?: boolean
}) {
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Open', slug: `open_${suffix()}`, category: 'open', position: 300 })
    .returning()
  const [row] = await testDb
    .insert(tickets)
    .values({
      type: opts.type ?? 'customer',
      title: 'Cannot log in',
      statusId: status.id,
      requesterPrincipalId: opts.requester,
      assigneePrincipalId: opts.assignee ?? null,
      assigneeTeamId: opts.team ?? null,
      deletedAt: opts.deleted ? new Date() : null,
    })
    .returning()
  return row
}
