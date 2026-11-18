/**
 * CLI: create an API key for a teammate through the app's own service, and print
 * the plain-text key. Personal keys act as their creator; pass `workspace` for
 * a workspace key.
 *
 * Usage: bun create-support-api-key.ts <creator-email> [personal|workspace]
 */
import { db, eq, principal, user } from '@/lib/server/db'
import { createApiKey } from '@/lib/server/domains/api-keys/api-key.service'

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
  const { plainTextKey } = await createApiKey(
    { name: `support e2e ${kind} key ${Date.now()}`, kind },
    creator.id
  )
  process.stdout.write(plainTextKey)
  process.exit(0)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
