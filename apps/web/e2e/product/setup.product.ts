/**
 * The product suite's setup project: runs once per shard before any product
 * test, against the database that shard's app uses.
 *
 * Turns on every product the suite covers (a fresh seed has Help center and
 * Status off), makes sure the storage bucket exists, and creates the people
 * and mints their sessions. The people are the support suite's
 * (e2e/support/people.ts), so a test written for either suite can act as the
 * same admin, teammates and customer. All idempotent, so a local re-run
 * against the same database is fine.
 */
import { test as setup, expect } from '@playwright/test'
import {
  ensureStorageBucket,
  mintSupportSessions,
  seedSupportPeople,
  setFeatureFlag,
} from '../utils/db-helpers'
import { closeSupportDb, supportDb } from '../support/db'
import { SUPPORT_RUN_DIR } from '../support/env'
import { bustSettingsCache } from '../support/isolated-settings'

/** Products the suite covers, switched on before any test runs. */
const PRODUCT_FLAGS = ['feedback', 'changelog', 'helpCenter', 'statusPage'] as const

setup('prepare the product suite', async ({ request }) => {
  for (const flag of PRODUCT_FLAGS) setFeatureFlag(flag, true)
  // Turning Status on in Settings also publishes the page
  // (settings.service updateFeatureFlags); the raw flag write above does not.
  await supportDb()`
    UPDATE settings
    SET metadata = (
      coalesce(nullif(metadata, '')::jsonb, '{}'::jsonb)
      || jsonb_build_object('statusSettings',
           coalesce(nullif(metadata, '')::jsonb -> 'statusSettings', '{}'::jsonb)
           || '{"enabled": true}'::jsonb)
    )::text`
  await bustSettingsCache()
  // The seed's published and scheduled changelog entries were never announced
  // (notified_at NULL). The changelog reconciler, armed 25 s after boot, would
  // email them to every subscriber while tests read Mailpit. Mark them done.
  await supportDb()`
    UPDATE changelog_entries SET notified_at = now()
    WHERE notified_at IS NULL AND published_at IS NOT NULL`
  ensureStorageBucket()
  const people = seedSupportPeople()
  mintSupportSessions(SUPPORT_RUN_DIR, people)

  // The app is up and is the production build the suite expects.
  const ready = await request.get('/api/health/ready')
  expect(ready.status()).toBe(200)
  await closeSupportDb()
})
