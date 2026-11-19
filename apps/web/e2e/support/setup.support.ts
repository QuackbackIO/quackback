/**
 * The support suite's setup project: runs once per shard before any support
 * test, against the database that shard's app uses.
 *
 * Turns the support surfaces and tickets on (fresh seeds have them off), makes sure the
 * storage bucket exists, creates the people and mints their sessions. All
 * idempotent, so a local re-run against the same database is fine.
 */
import { test as setup, expect } from '@playwright/test'
import {
  ensureStorageBucket,
  mintSupportSessions,
  seedSupportPeople,
  setFeatureFlag,
  setSupportSurfaces,
} from '../utils/db-helpers'
import { SUPPORT_RUN_DIR } from './env'

setup('prepare the support suite', async ({ request }) => {
  setSupportSurfaces(true)
  // Tickets are part of the support module the suite covers; turned on here,
  // before any test, so every shard sees the same inbox and widget.
  setFeatureFlag('supportTickets', true)
  ensureStorageBucket()
  const people = seedSupportPeople()
  mintSupportSessions(SUPPORT_RUN_DIR, people)

  // The app is up and is the production build the suite expects.
  const ready = await request.get('/api/health/ready')
  expect(ready.status()).toBe(200)
})
