/**
 * CLI script to ensure a user has a specific role for E2E tests
 *
 * This is a test utility that creates or updates the member record
 * to ensure the test user can access admin functionality.
 *
 * Usage: bun ensure-role.ts <email> [role]
 */
import postgres from 'postgres'
import { randomUUID } from 'crypto'

const email = process.argv[2]
const role = process.argv[3] || 'owner'

if (!email) {
  console.error('Usage: bun ensure-role.ts <email> [role]')
  process.exit(1)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

const sql = postgres(connectionString)

async function ensureRole(): Promise<void> {
  // Find the user
  const users = await sql`
    SELECT id, name FROM "user" WHERE email = ${email}
  `

  if (users.length === 0) {
    throw new Error(`User not found: ${email}`)
  }

  const userId = users[0].id

  // Check if member record exists
  const members = await sql`
    SELECT id, role FROM member WHERE user_id = ${userId}
  `

  if (members.length === 0) {
    // Create member record with specified role
    // The database stores TypeIDs as regular UUIDs
    const memberId = randomUUID()
    await sql`
      INSERT INTO member (id, user_id, role, created_at)
      VALUES (${memberId}, ${userId}, ${role}, NOW())
    `
    console.log(`Created member record for ${email} with role: ${role}`)
  } else if (members[0].role !== role) {
    // Update existing member role
    await sql`
      UPDATE member SET role = ${role} WHERE user_id = ${userId}
    `
    console.log(`Updated ${email} role to: ${role}`)
  } else {
    console.log(`User ${email} already has role: ${role}`)
  }

  // Also update user name if it's empty (Better-auth creates users with empty name)
  if (!users[0].name || users[0].name.trim() === '') {
    await sql`
      UPDATE "user" SET name = 'Demo User' WHERE id = ${userId}
    `
    console.log(`Updated user name for ${email}`)
  }
}

try {
  await ensureRole()
  await sql.end()
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unknown error')
  await sql.end()
  process.exit(1)
}
