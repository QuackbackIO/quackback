/**
 * CLI: find a stable mention target principal for the @-mention e2e test.
 *
 * Returns JSON `{ principalId, displayName }` for a non-demo, mention-eligible
 * principal (type 'user', role admin|member|user). Seed creates 30 sample
 * users with random names from a fixed name pool; this script just picks
 * the first one that isn't the demo user.
 *
 * Usage: bun get-mention-target.ts [excludeEmail]
 */
import postgres from 'postgres'
import { fromUuid } from '@quackback/ids'

const excludeEmail = process.argv[2] ?? 'demo@example.com'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

const sql = postgres(connectionString)

async function getTarget(): Promise<{ principalId: string; displayName: string }> {
  const rows = await sql`
    SELECT p.id, p.display_name
    FROM principal p
    JOIN "user" u ON p.user_id = u.id
    WHERE u.email != ${excludeEmail}
      AND p.type = 'user'
      AND p.role IN ('admin', 'member', 'user')
      AND p.display_name IS NOT NULL
      AND length(p.display_name) > 0
    ORDER BY u.email ASC
    LIMIT 1
  `

  if (rows.length === 0) {
    throw new Error(
      `No mention-eligible principal found (excluding ${excludeEmail}). Re-run \`bun run setup\`?`
    )
  }
  // DB stores UUIDs; the Drizzle column wrapper exposes them as TypeIDs
  // (e.g. `principal_01jvz4q...`). The mentions API + chip data
  // attributes always use the TypeID form, so we project the raw UUID
  // through the same encoder the application would.
  const principalId = fromUuid('principal', rows[0].id as string)
  return { principalId, displayName: rows[0].display_name as string }
}

try {
  const target = await getTarget()
  console.log(JSON.stringify(target))
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
