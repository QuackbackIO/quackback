#!/usr/bin/env bun

import { db, eq, principal } from '@/lib/server/db'
import { createApiKey } from '@/lib/server/domains/api-keys/api-key.service'

if (process.env.CI !== 'true') {
  throw new Error('create-ci-api-key.ts may only run in CI')
}

const administrator = await db.query.principal.findFirst({
  where: eq(principal.role, 'admin'),
  columns: { id: true },
})

if (!administrator) throw new Error('Seed data did not create an administrator')

const { plainTextKey } = await createApiKey(
  { name: `CI live API ${process.env.GITHUB_RUN_ID ?? 'local'}` },
  administrator.id
)

process.stdout.write(plainTextKey)
process.exit(0)
