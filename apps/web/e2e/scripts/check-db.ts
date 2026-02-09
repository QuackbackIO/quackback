/**
 * Debug script to check database contents
 */
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

const sql = postgres(connectionString)

async function main() {
  const users = await sql`SELECT id, name, email FROM "user" WHERE email = 'demo@example.com'`
  console.log('Users with demo@example.com:', JSON.stringify(users, null, 2))

  const allUsers = await sql`SELECT id, name, email FROM "user" LIMIT 10`
  console.log('All users:', JSON.stringify(allUsers, null, 2))

  const principals =
    await sql`SELECT p.*, u.email FROM principal p JOIN "user" u ON p.user_id = u.id`
  console.log('Principals:', JSON.stringify(principals, null, 2))

  await sql.end()
}

main().catch(console.error)
