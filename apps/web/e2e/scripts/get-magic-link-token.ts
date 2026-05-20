/**
 * CLI: get the most recent live magic-link verification token for an
 * email. Used by e2e tests.
 *
 * Excludes OTP rows (identifier `sign-in-otp-<email>`, value
 * `<code>:<attempts>`) — those are emitted alongside magic-link rows
 * by the combined sign-in flow but use a different verification path.
 *
 * Usage: bun get-magic-link-token.ts <email>
 */
import postgres from 'postgres'

const email = process.argv[2]

if (!email) {
  console.error('Usage: bun get-magic-link-token.ts <email>')
  process.exit(1)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

const sql = postgres(connectionString)

async function getMagicLinkToken(): Promise<string> {
  // Better-auth's magic-link plugin stores rows as
  //   { identifier: <token>, value: '{"email":"...","attempt":0}' }
  // The token is the row's `identifier`; `value` is a JSON blob carrying
  // the recipient email + attempt counter. (The earlier schema put the
  // email in `identifier`; that was replaced when the OTP+magic-link
  // emails were unified.) We grep by the email embedded in the JSON.
  const result = await sql`
    SELECT identifier, value, expires_at
    FROM verification
    WHERE value::text ILIKE ${'%"email":"' + email + '"%'}
      AND identifier NOT LIKE 'sign-in-otp-%'
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `

  if (result.length === 0) {
    throw new Error(`No live magic-link verification row found for email: ${email}`)
  }

  return result[0].identifier as string
}

try {
  const token = await getMagicLinkToken()
  console.log(token)
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
