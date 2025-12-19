#!/usr/bin/env bun
/**
 * CLI script to retrieve OTP code from database
 *
 * Usage: bun e2e/scripts/get-otp.ts <email> <host>
 * Output: The 6-digit OTP code (or error message to stderr)
 *
 * This script is used by E2E tests to retrieve OTP codes
 * without exposing an API endpoint.
 */

import { db, verification, workspaceDomain, eq, desc } from '@quackback/db'

async function main() {
  const [email, host] = process.argv.slice(2)

  if (!email || !host) {
    console.error('Usage: bun e2e/scripts/get-otp.ts <email> <host>')
    process.exit(1)
  }

  const normalizedEmail = email.toLowerCase().trim()

  try {
    // Look up workspace from workspace_domain table
    const domainRecord = await db.query.workspaceDomain.findFirst({
      where: eq(workspaceDomain.domain, host),
      with: { workspace: true },
    })

    if (!domainRecord?.workspace) {
      console.error(`Workspace not found for host: ${host}`)
      process.exit(1)
    }

    const org = domainRecord.workspace
    const identifier = `tenant-otp:${org.id}:${normalizedEmail}`

    // Find the most recent verification record
    const verificationRecord = await db.query.verification.findFirst({
      where: eq(verification.identifier, identifier),
      orderBy: desc(verification.createdAt),
    })

    if (!verificationRecord) {
      console.error(`No OTP found for email: ${email}`)
      process.exit(1)
    }

    // Check if expired
    if (new Date(verificationRecord.expiresAt) < new Date()) {
      console.error(`OTP has expired for email: ${email}`)
      process.exit(1)
    }

    // Output just the code
    console.log(verificationRecord.value)
    process.exit(0)
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main()
