#!/usr/bin/env bun
/**
 * License Key Generator
 *
 * This script generates signed JWT license keys for enterprise customers.
 * IMPORTANT: Keep the private key secure. Never share it or commit it.
 *
 * Usage:
 *   bun ee/scripts/internal/generate-license/index.ts --licensee "Acme Corp" --seats 100 --expires 2025-12-31
 *
 * Options:
 *   --licensee  (required) Customer name/organization
 *   --seats     (optional) Number of seats
 *   --expires   (optional) Expiration date (YYYY-MM-DD)
 */

import * as jose from 'jose'
import { parseArgs } from 'util'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PRIVATE_KEY_PATH = join(
  __dirname,
  '../../../..',
  'apps/web/src/lib/license/keys/license.private.pem'
)

async function generateLicense(options: { licensee: string; seats?: number; expires?: string }) {
  // Read private key
  let privateKeyPem: string
  try {
    privateKeyPem = readFileSync(PRIVATE_KEY_PATH, 'utf-8')
  } catch {
    console.error('Error: Private key not found at', PRIVATE_KEY_PATH)
    console.error('Make sure you have the license.private.pem file.')
    process.exit(1)
  }

  const privateKey = await jose.importPKCS8(privateKeyPem, 'RS256')

  // Build JWT claims
  const now = Math.floor(Date.now() / 1000)

  const claims: Record<string, unknown> = {
    sub: options.licensee,
    tier: 'enterprise',
    iat: now,
  }

  if (options.seats) {
    claims.seats = options.seats
  }

  if (options.expires) {
    const expiresDate = new Date(options.expires)
    if (isNaN(expiresDate.getTime())) {
      console.error('Error: Invalid expiration date format. Use YYYY-MM-DD.')
      process.exit(1)
    }
    claims.exp = Math.floor(expiresDate.getTime() / 1000)
  }

  // Sign the JWT
  const jwt = await new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .sign(privateKey)

  return jwt
}

// Parse command line arguments
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    licensee: { type: 'string' },
    seats: { type: 'string' },
    expires: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help) {
  console.log(`
License Key Generator

Usage:
  bun ee/scripts/internal/generate-license/index.ts --licensee "Acme Corp" [options]

Options:
  --licensee  (required) Customer name/organization
  --seats     (optional) Number of seats
  --expires   (optional) Expiration date (YYYY-MM-DD)
  --help, -h  Show this help message

Example:
  bun ee/scripts/internal/generate-license/index.ts --licensee "Acme Corp" --seats 100 --expires 2027-12-31
`)
  process.exit(0)
}

if (!values.licensee) {
  console.error('Error: --licensee is required')
  console.error('Run with --help for usage information')
  process.exit(1)
}

const license = await generateLicense({
  licensee: values.licensee,
  seats: values.seats ? parseInt(values.seats, 10) : undefined,
  expires: values.expires,
})

console.log('\n=== License Key Generated ===\n')
console.log('Licensee:', values.licensee)
if (values.seats) console.log('Seats:', values.seats)
if (values.expires) console.log('Expires:', values.expires)
console.log('\nLicense Key (set as ENTERPRISE_LICENSE_KEY):\n')
console.log(license)
console.log('')
