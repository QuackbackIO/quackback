/**
 * CLI: create an API key for a teammate through the app's own service, and print
 * the plain-text key. Personal keys act as their creator; pass `workspace` for
 * a workspace key.
 *
 * Usage: bun create-support-api-key.ts <creator-email> [personal|workspace]
 */
import { db, eq, principal, roles, user } from '@/lib/server/db'
import { createApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import { ALL_PERMISSIONS } from '@/lib/shared/permissions'
import type { RoleId } from '@quackback/ids'

const [email, kindArg] = process.argv.slice(2)
const kind = kindArg === 'workspace' ? 'workspace' : 'personal'
if (!email) {
  console.error('Usage: bun create-support-api-key.ts <creator-email> [personal|workspace]')
  process.exit(1)
}

try {
  const [creator] = await db
    .select({ id: principal.id })
    .from(principal)
    .innerJoin(user, eq(user.id, principal.userId))
    .where(eq(user.email, email))
    .limit(1)
  if (!creator) throw new Error(`No principal for ${email} (seed the support people first)`)
  // A workspace key holds a role: the built-in Admin role, granted with the
  // admin creator's full authority (createApiKeyFn passes the same shape).
  let roleId: RoleId | undefined
  if (kind === 'workspace') {
    const [adminRole] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'admin'))
      .limit(1)
    roleId = adminRole?.id as RoleId | undefined
  }
  const { plainTextKey } = await createApiKey(
    { name: `support e2e ${kind} key ${Date.now()}`, kind, roleId },
    creator.id,
    kind === 'workspace' ? { permissions: ALL_PERMISSIONS, role: 'admin' } : undefined
  )
  process.stdout.write(plainTextKey)
  process.exit(0)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
