/**
 * CLI script to get OTP code from database for E2E tests
 *
 * Better-auth stores OTP codes in the 'verification' table:
 * - identifier: the email address
 * - value: the OTP code
 * - expires_at: expiration timestamp
 *
 * Usage: bun get-otp.ts <email> [host]
 * Note: host parameter is kept for backwards compatibility but not used
 */
import postgres from 'postgres'

const email = process.argv[2]
// host parameter kept for backwards compatibility (not used with Better-auth)
const _host = process.argv[3]

if (!email) {
  console.error('Usage: bun get-otp.ts <email> [host]')
  process.exit(1)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

const sql = postgres(connectionString)

async function getOtpCode(): Promise<string> {
  // Better-auth stores OTP with identifier format: ${type}-otp-${email}
  // The 'sign-in' type is used for authentication
  const identifier = `sign-in-otp-${email}`

  // Query verification table for the most recent non-expired OTP
  const result = await sql`
    SELECT value, expires_at
    FROM verification
    WHERE identifier = ${identifier}
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `

  if (result.length === 0) {
    throw new Error(`No valid OTP found for email: ${email} (identifier: ${identifier})`)
  }

  // Better-auth stores value as "otp:attempts" format, extract just the OTP
  const value = result[0].value as string
  const otp = value.split(':')[0]

  return otp
}

try {
  const code = await getOtpCode()
  console.log(code)
  await sql.end()
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unknown error')
  await sql.end()
  process.exit(1)
}
