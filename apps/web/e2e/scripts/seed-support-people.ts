/**
 * CLI: idempotently create the support suite's people, teams and custom roles
 * (definitions in e2e/support/people.ts), and print their ids as JSON.
 *
 * Raw SQL like the other e2e scripts. Every person gets a user row, a principal
 * with the legacy role, and one workspace-wide role assignment (which replaces
 * the legacy preset); team members get team_members rows. Re-running converges
 * on the same state: roles get exactly their listed permissions, people
 * exactly their listed role and teams.
 *
 * Usage: bun seed-support-people.ts
 */
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import {
  SUPPORT_CUSTOM_ROLES,
  SUPPORT_PEOPLE,
  SUPPORT_TEAMS,
  type SeededPeople,
  type SupportPersonName,
  type SupportTeam,
} from '../support/people'
import { deleteCacheKeys, openDb } from './_lib'

const sql = openDb()

async function ensureTeam(name: string): Promise<string> {
  const found = await sql`SELECT id FROM teams WHERE name = ${name} AND deleted_at IS NULL LIMIT 1`
  if (found.length > 0) return found[0].id as string
  const id = toUuid(generateId('team'))
  await sql`INSERT INTO teams (id, name, description) VALUES (${id}, ${name}, ${'Support e2e team'})`
  return id
}

async function ensureCustomRole(
  key: string,
  def: { name: string; description: string; permissions: readonly string[] }
): Promise<void> {
  const rows = await sql`SELECT id FROM roles WHERE key = ${key} LIMIT 1`
  let roleId = rows[0]?.id as string | undefined
  if (!roleId) {
    roleId = toUuid(generateId('role'))
    await sql`INSERT INTO roles (id, key, name, description, is_system)
              VALUES (${roleId}, ${key}, ${def.name}, ${def.description}, false)`
  }
  const perms = await sql`SELECT id, key FROM permissions WHERE key IN ${sql([...def.permissions])}`
  if (perms.length !== def.permissions.length) {
    const found = new Set(perms.map((p) => p.key as string))
    const missing = def.permissions.filter((p) => !found.has(p))
    throw new Error(`Unknown permission keys for ${key}: ${missing.join(', ')}`)
  }
  await sql`DELETE FROM role_permissions WHERE role_id = ${roleId}`
  for (const perm of perms) {
    await sql`INSERT INTO role_permissions (id, role_id, permission_id)
              VALUES (${toUuid(generateId('role_perm'))}, ${roleId}, ${perm.id as string})`
  }
}

async function ensurePerson(
  personName: SupportPersonName,
  teamIds: Record<SupportTeam, string>
): Promise<SeededPeople['people'][SupportPersonName]> {
  const def = SUPPORT_PEOPLE[personName]
  const users = await sql`SELECT id FROM "user" WHERE email = ${def.email} LIMIT 1`
  let userId = users[0]?.id as string | undefined
  if (!userId) {
    userId = toUuid(generateId('user'))
    await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
              VALUES (${userId}, ${def.name}, ${def.email}, true, NOW(), NOW())`
  }

  const principals = await sql`SELECT id FROM principal WHERE user_id = ${userId} LIMIT 1`
  let principalId = principals[0]?.id as string | undefined
  if (!principalId) {
    principalId = toUuid(generateId('principal'))
    await sql`INSERT INTO principal (id, user_id, role, type, display_name, created_at)
              VALUES (${principalId}, ${userId}, ${def.principalRole}, 'user', ${def.name}, NOW())`
  }
  await sql`UPDATE principal SET role = ${def.principalRole}, display_name = ${def.name},
              chat_availability = 'online'
            WHERE id = ${principalId}`

  // Exactly one workspace-wide role (none for a customer).
  await sql`DELETE FROM principal_role_assignments WHERE principal_id = ${principalId} AND team_id IS NULL`
  if (def.roleKey) {
    const role = await sql`SELECT id FROM roles WHERE key = ${def.roleKey} LIMIT 1`
    if (role.length === 0) throw new Error(`Role not found: ${def.roleKey}`)
    await sql`INSERT INTO principal_role_assignments (id, principal_id, role_id, created_at)
              VALUES (${toUuid(generateId('role_asgn'))}, ${principalId}, ${role[0].id as string}, NOW())`
  }

  // Exactly the listed suite teams (other teams a test added are left alone).
  const suiteTeamIds = Object.values(teamIds)
  await sql`DELETE FROM team_members WHERE principal_id = ${principalId} AND team_id IN ${sql(suiteTeamIds)}`
  for (const team of def.teams as readonly SupportTeam[]) {
    await sql`INSERT INTO team_members (id, team_id, principal_id)
              VALUES (${toUuid(generateId('team_member'))}, ${teamIds[team]}, ${principalId})`
  }

  await deleteCacheKeys(sql, [`principal:user:${fromUuid('user', userId)}`])
  return {
    name: personName,
    email: def.email,
    displayName: def.name,
    userId: fromUuid('user', userId),
    principalId: fromUuid('principal', principalId),
  }
}

try {
  const teamUuids = {} as Record<SupportTeam, string>
  for (const [key, name] of Object.entries(SUPPORT_TEAMS) as [SupportTeam, string][]) {
    teamUuids[key] = await ensureTeam(name)
  }
  for (const [key, def] of Object.entries(SUPPORT_CUSTOM_ROLES)) {
    await ensureCustomRole(key, def)
  }
  const people = {} as SeededPeople['people']
  for (const personName of Object.keys(SUPPORT_PEOPLE) as SupportPersonName[]) {
    people[personName] = await ensurePerson(personName, teamUuids)
  }
  const teams = Object.fromEntries(
    Object.entries(teamUuids).map(([key, uuid]) => [key, fromUuid('team', uuid)])
  ) as Record<SupportTeam, string>
  const out: SeededPeople = { people, teams }
  console.log(JSON.stringify(out))
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
