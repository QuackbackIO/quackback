/**
 * The shared backfill check: every registered startup backfill and follow-up
 * runs on its own fixture, then must pass the fixture's `verify` and must have
 * kept `updated_at` on every ticket it walked.
 *
 * `tickets.updated_at` drives the "recent" ticket list, search ranking, the
 * REST `updatedAfter` sync and the retention clock, so a backfill that bumps it
 * makes every old ticket look new. A step that changes nothing would keep
 * `updated_at` too, which is why the fixture's `verify` is checked as well.
 *
 * The registry may be empty in a build, so a sample backfill with a sample
 * follow-up always runs alongside it, and the check is shown to catch each way
 * a backfill can get this wrong.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { closeHarness } from '@/lib/server/jobs/__tests__/harness'

vi.mock('@/lib/server/db', async (importOriginal) => {
  const { testDb } = await import('@/lib/server/jobs/__tests__/harness')
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: new Proxy(
      {},
      {
        get(_t, prop) {
          const handle = testDb()
          const value = Reflect.get(handle as object, prop, handle)
          return typeof value === 'function' ? value.bind(handle) : value
        },
      }
    ),
  }
})

import { __setBackfillsForTests, registeredBackfills, type BatchedBackfill } from '../batched'
import { checkBackfill, cleanupBackfill, sampleBackfill, sampleWalk, uniqueName } from './harness'

/** The newest migration this build bundles; any migrated test database has it. */
const NEWEST = (
  JSON.parse(
    readFileSync(
      path.resolve(__dirname, '../../../../../../../packages/db/drizzle/meta/_journal.json'),
      'utf8'
    )
  ) as { entries: Array<{ tag: string }> }
).entries.at(-1)!.tag
const names: string[] = []
function named(label: string): string {
  const name = uniqueName(label)
  names.push(name)
  return name
}

afterEach(() => {
  __setBackfillsForTests(null)
})

afterAll(async () => {
  for (const name of names) await cleanupBackfill(name)
  await closeHarness()
})

describe('every registered backfill and follow-up', () => {
  it('passes its verify and keeps updated_at on the tickets it walks', async () => {
    const sample = sampleBackfill(named('sample'), { requiresMigration: NEWEST })
    const entries: BatchedBackfill[] = [...registeredBackfills(), sample]
    __setBackfillsForTests(entries)

    for (const entry of entries) {
      expect(await checkBackfill(entry), entry.name).toEqual([])
    }
  })
})

describe('the check', () => {
  it('fails a step that lets updated_at move', async () => {
    const name = named('bumps')
    const entry = sampleBackfill(name, {
      requiresMigration: NEWEST,
      walk: { keepUpdatedAt: false },
      followUp: false,
    })
    __setBackfillsForTests([entry])

    const problems = await checkBackfill(entry)
    expect(problems).toEqual([`${name} changed updated_at on 5 ticket(s)`])
  })

  it('fails a follow-up that lets updated_at move', async () => {
    const name = named('follow-bumps')
    const entry = sampleBackfill(name, {
      requiresMigration: NEWEST,
      followUp: { keepUpdatedAt: false },
    })
    __setBackfillsForTests([entry])

    const problems = await checkBackfill(entry)
    expect(problems).toEqual([`${name} follow-up changed updated_at on 5 ticket(s)`])
  })

  it('fails a step that changes nothing', async () => {
    const name = named('idle')
    const entry = sampleBackfill(name, {
      requiresMigration: NEWEST,
      walk: { changesNothing: true },
      followUp: false,
    })
    __setBackfillsForTests([entry])

    expect(await checkBackfill(entry)).toEqual([`${name} did not pass its verify`])
  })

  it('fails an entry without a fixture, or whose fixture returns no verify', async () => {
    const name = named('no-fixture')
    const walk = sampleWalk({ marker: name, flag: 'walked' })
    const noFixture = {
      name,
      requiresMigration: NEWEST,
      ...walk,
      fixture: undefined,
    } as unknown as BatchedBackfill
    const noVerify: BatchedBackfill = {
      name: named('no-verify'),
      requiresMigration: NEWEST,
      ...walk,
      fixture: async () => undefined as never,
    }

    expect(await checkBackfill(noFixture)).toEqual([`${name} has no fixture`])
    expect(await checkBackfill(noVerify)).toEqual([`${noVerify.name} fixture returns no verify`])
  })
})
