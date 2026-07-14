/**
 * Golden eval set entry point (QUINN-TWO-AGENT-SPEC §7). One Vitest case per
 * (scenario × applicable role). Each case runs inside the db-test-fixture
 * rollback transaction — the global `db` is rebound to it so the runtime's own
 * reads see the seeded fixtures and every write vanishes at rollback.
 *
 * This file uses the `.eval.ts` suffix specifically so the repo's default
 * vitest configs (which glob `**\/*.test.ts`) never pick it up: the golden set
 * runs ONLY under evals/vitest.config.ts, never in `bun run test`.
 *
 * Run it (from the repo root, with the app env file so AI + DB config load):
 *   bun --env-file=.env vitest run --config apps/web/evals/vitest.config.ts
 * Filter with -t, e.g. -t "09" or -t "toolset" or -t "customer_support".
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'

// Rebind the global db to the rollback transaction (README pattern #1).
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'
import {
  settings,
  helpCenterArticles,
  assistantGuidanceRules,
  conversationAttributeDefinitions,
  assistantInvolvements,
  ticketSummaries,
  changelogEntries,
} from '@/lib/server/db'
import { assertEvalEnv } from './harness/env'
import { runScenario } from './harness/run'
import { writeTranscript, appendSummary, resultsDir } from './harness/transcript'
import { scenarios } from './scenarios'
import { surfaceForRole } from './types'

const fixture = await createDbTestFixture({
  // Skip (never fail) if the test DB is missing the tables the harness seeds.
  probe: async (db) => {
    await db.select({ id: settings.id }).from(settings).limit(0)
    await db.select({ id: helpCenterArticles.id }).from(helpCenterArticles).limit(0)
    await db.select({ id: assistantGuidanceRules.id }).from(assistantGuidanceRules).limit(0)
    await db
      .select({ id: conversationAttributeDefinitions.id })
      .from(conversationAttributeDefinitions)
      .limit(0)
    await db.select({ id: assistantInvolvements.id }).from(assistantInvolvements).limit(0)
    await db.select({ id: ticketSummaries.id }).from(ticketSummaries).limit(0)
    await db.select({ id: changelogEntries.id }).from(changelogEntries).limit(0)
  },
})

describe.skipIf(!fixture.available)('Quinn golden eval set (§7)', () => {
  beforeAll(() => {
    assertEvalEnv()
    // A settings singleton must exist for the runtime's config read.
    // (The probe only checks the table shape, not that a row is present.)
  })
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  for (const scenario of scenarios) {
    for (const role of scenario.roles) {
      const surface = surfaceForRole(scenario, role)
      const name = `${scenario.id} [${role}/${surface}] ${scenario.title}`
      it(name, async () => {
        const outcome = await runScenario(scenario, role)

        if (outcome.failures.length > 0) {
          const status = outcome.errored ? 'error' : 'failed'
          const file = writeTranscript({
            id: scenario.id,
            role,
            title: scenario.title,
            status,
            failures: outcome.failures,
            detail: outcome.detail,
          })
          appendSummary(`FAIL ${name} :: ${outcome.failures.join(' | ')} :: ${file}`)
        } else {
          appendSummary(`PASS ${name}`)
        }

        // A harness/runtime error (config/DB/provider) is distinct from a
        // genuine scenario failure; both fail the case, but the transcript and
        // the message make the difference legible.
        expect(
          outcome.failures,
          `${outcome.errored ? 'HARNESS ERROR' : 'SCENARIO FAILED'} — transcript in ${resultsDir}`
        ).toEqual([])
      })
    }
  }
})
