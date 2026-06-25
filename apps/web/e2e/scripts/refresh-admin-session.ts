/**
 * CLI: refresh e2e/.auth/admin.json with a current session token for
 * demo@example.com. Uses the most recent valid session row directly from the
 * DB and constructs the signed cookie (HMAC-SHA256(token, SECRET_KEY)) so the
 * stored auth-state works without navigating through the magic-link flow.
 *
 * Run this instead of global-setup when the admin session has expired and
 * magic-link sign-in is blocked by twoFactor.required (or any other 2FA gate).
 *
 * Usage: bun refresh-admin-session.ts
 */
import postgres from 'postgres'
import { createHmac } from 'crypto'
import { writeFileSync } from 'fs'
import { resolve } from 'path'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}
const secret = process.env.SECRET_KEY
if (!secret) {
  console.error('SECRET_KEY environment variable is required')
  process.exit(1)
}

const sql = postgres(connectionString)

try {
  // Get the most recent valid session for the admin user.
  const rows = await sql`
    SELECT s.token, s.expires_at
    FROM session s
    JOIN "user" u ON u.id = s.user_id
    WHERE u.email = 'demo@example.com'
      AND s.expires_at > NOW()
    ORDER BY s.created_at DESC
    LIMIT 1
  `

  if (rows.length === 0) {
    console.error(
      'No valid session found for demo@example.com. ' +
        'Run the global-setup project (bun run test:e2e --project=setup) first.'
    )
    await sql.end()
    process.exit(1)
  }

  const token = rows[0].token as string
  const expiresAt = rows[0].expires_at as Date

  // Reproduce better-auth's setSignedCookie format: token.HMAC-SHA256(token, secret)
  const sig = createHmac('sha256', secret).update(token).digest('base64')
  const cookieValue = `${token}.${sig}`

  // Write the storageState JSON that Playwright understands.
  const state = {
    cookies: [
      {
        name: '__Secure-better-auth.session_token',
        value: cookieValue,
        domain: 'acme.localhost',
        path: '/',
        expires: expiresAt.getTime() / 1000,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  }

  const outPath = resolve(import.meta.dirname, '../.auth/admin.json')
  writeFileSync(outPath, JSON.stringify(state, null, 2))
  console.log(
    JSON.stringify({ action: 'refresh-admin-session', token: token.slice(0, 8) + '…', expiresAt })
  )
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
