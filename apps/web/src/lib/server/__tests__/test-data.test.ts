import { afterAll, expect, it } from 'vitest'
import { isTestRecord, notTestRecord } from '../test-data'
import { sql } from 'drizzle-orm'
import { createDbTestFixture, testDb } from './db-test-fixture'
const fixture = await createDbTestFixture()
afterAll(fixture.close)

it.each([
  [null, false],
  [{}, false],
  [{ test: false }, false],
  [{ test: true }, true],
  [{ test: 'true' }, true],
  [{ onboardingGenerated: true }, true],
  [{ test: false, onboardingGenerated: true }, true],
  [{ unrelated: true }, false],
])('classifies %j as test data: %s', (attributes, expected) => {
  expect(isTestRecord(attributes)).toBe(expected)
})
it('excludes test and generated rows in real queries while keeping null and false markers', async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  try {
    const attributes = [
      null,
      {},
      { test: false },
      { test: true },
      { test: 'true' },
      { onboardingGenerated: true },
      { unrelated: true },
    ]
    const values = sql.join(
      attributes.map((value) => sql`(${value === null ? null : JSON.stringify(value)}::jsonb)`),
      sql`, `
    )
    const rows = await testDb.execute(
      sql`select ${notTestRecord(sql`record.attributes`)} as real_data from (values ${values}) as record(attributes)`
    )
    expect(rows.map((row) => row.real_data)).toEqual([true, true, true, false, false, false, true])
  } finally {
    await fixture.rollback()
  }
})
