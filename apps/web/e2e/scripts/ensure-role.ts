/**
 * CLI script to ensure a user has a specific role for E2E tests
 *
 * This is a test utility that creates or updates the principal record
 * to ensure the test user can access admin functionality.
 *
 * Usage: bun ensure-role.ts <email> [role]
 */
import postgres from 'postgres'
import { randomUUID } from 'crypto'

const email = process.argv[2]
const role = process.argv[3] || 'admin'

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

  // Check if principal record exists
  const principals = await sql`
    SELECT id, role FROM principal WHERE user_id = ${userId}
  `

  if (principals.length === 0) {
    // Create principal record with specified role
    // The database stores TypeIDs as regular UUIDs
    const principalId = randomUUID()
    await sql`
      INSERT INTO principal (id, user_id, role, created_at)
      VALUES (${principalId}, ${userId}, ${role}, NOW())
    `
    console.log(`Created principal record for ${email} with role: ${role}`)
  } else if (principals[0].role !== role) {
    // Update existing principal role
    await sql`
      UPDATE principal SET role = ${role} WHERE user_id = ${userId}
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
