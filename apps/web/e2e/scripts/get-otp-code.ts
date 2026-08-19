/**
 * CLI: get the most recent live sign-in OTP code for an email.
 *
 * The combined sign-in flow stores OTP rows in the verification table as
 *   { identifier: 'sign-in-otp-<email>', value: '<code>:<attempts>' }
 * (see get-magic-link-token.ts, which excludes these rows). This prints the
 * bare code for e2e specs that complete the OTP form.
 *
 * Usage: bun get-otp-code.ts <email>
 */
import { openDb } from './_lib'

const email = process.argv[2]

if (!email) {
  console.error('Usage: bun get-otp-code.ts <email>')
  process.exit(1)
}

const sql = openDb()

try {
  const result = await sql`
    SELECT value
    FROM verification
    WHERE identifier = ${'sign-in-otp-' + email}
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `
  if (result.length === 0) {
    throw new Error(`No live OTP verification row found for email: ${email}`)
  }
  const value = result[0].value as string
  // value is '<code>:<attempts>'; the code may itself never contain ':'.
  console.log(value.split(':')[0])
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
