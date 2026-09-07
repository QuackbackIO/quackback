import type { WebClient } from '@slack/web-api'
import { db, principal, user, slackUserLinks, eq, and, sql } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'
export type SlackMember = { id: PrincipalId; role: 'admin' | 'member'; displayName: string | null }
const member = (row: typeof principal.$inferSelect | undefined): SlackMember | null =>
  row && row.type === 'user' && row.userId && (row.role === 'admin' || row.role === 'member')
    ? { id: row.id, role: row.role, displayName: row.displayName }
    : null
export interface SlackIdentityDeps {
  linked(team: string, user: string): Promise<SlackMember | null | undefined>
  byEmail(email: string): Promise<SlackMember | null>
  link(team: string, user: string, principalId: PrincipalId): Promise<void>
}
const defaults: SlackIdentityDeps = {
  async linked(team, slackUser) {
    const link = await db.query.slackUserLinks.findFirst({
      where: and(eq(slackUserLinks.slackTeamId, team), eq(slackUserLinks.slackUserId, slackUser)),
    })
    if (!link) return undefined
    return member(await db.query.principal.findFirst({ where: eq(principal.id, link.principalId) }))
  },
  async byEmail(email) {
    const rows = await db
      .select({ principal })
      .from(principal)
      .innerJoin(user, eq(principal.userId, user.id))
      .where(
        and(
          sql`lower(${user.email}) = ${email.toLowerCase()}`,
          eq(user.emailVerified, true),
          eq(principal.type, 'user')
        )
      )
      .limit(2)
    return rows.length === 1 ? member(rows[0]?.principal) : null
  },
  async link(team, slackUser, principalId) {
    await db
      .insert(slackUserLinks)
      .values({ slackTeamId: team, slackUserId: slackUser, principalId, method: 'email' })
      .onConflictDoNothing()
  },
}
export async function resolveSlackPrincipal(
  team: string,
  slackUser: string,
  client: Pick<WebClient, 'users'>,
  deps = defaults
): Promise<SlackMember | null> {
  const linked = await deps.linked(team, slackUser)
  // A former member's existing link must not silently rebind to another user.
  if (linked !== undefined) return linked
  const result = await client.users.info({ user: slackUser })
  if (!result.ok || result.user?.deleted || result.user?.is_bot || !result.user?.profile?.email)
    return null
  const person = await deps.byEmail(result.user.profile.email)
  if (!person) return null
  await deps.link(team, slackUser, person.id)
  return (await deps.linked(team, slackUser)) ?? null
}
export async function slackMemberActor(person: SlackMember): Promise<Actor> {
  return {
    principalId: person.id,
    role: person.role,
    principalType: 'user',
    segmentIds: new Set(),
    permissions: await permissionsForPrincipal(person.id, person.role),
  }
}
