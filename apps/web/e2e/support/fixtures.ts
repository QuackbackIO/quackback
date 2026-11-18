/**
 * The support suite's Playwright `test`. Import it instead of @playwright/test:
 *
 *   import { test, expect } from '../../support/fixtures'
 *
 *   test('…', { tag: '@core' }, async ({ people, asPerson, marker }) => {
 *     const admin = await asPerson('admin')         // a signed-in Page
 *     ...
 *   })
 *
 * Fixtures:
 * - `people`      the seeded people and team ids (people.ts)
 * - `asPerson`    a new browser context signed in as a person; returns its Page
 * - `marker`      a string unique to this test, for subjects, emails, AI rules,
 *                 sink channels (the stand-ins are shared by every worker)
 * - `customerEmail` a fresh customer address on a domain nobody receives
 */
import { readFileSync } from 'node:fs'
import { test as base, expect, type Page } from '@playwright/test'
import { closeSupportDb } from './db'
import {
  SEEDED_PEOPLE_FILE,
  personStatePath,
  type SeededPeople,
  type SupportPersonName,
} from './people'

interface SupportFixtures {
  marker: string
  customerEmail: string
  asPerson: (name: SupportPersonName) => Promise<Page>
}

interface SupportWorkerFixtures {
  people: SeededPeople
  workerDb: void
}

export const test = base.extend<SupportFixtures, SupportWorkerFixtures>({
  people: [
    async ({}, use) => {
      await use(JSON.parse(readFileSync(SEEDED_PEOPLE_FILE, 'utf8')) as SeededPeople)
    },
    { scope: 'worker' },
  ],

  // Closes the worker's postgres client once the worker is done.
  workerDb: [
    async ({}, use) => {
      await use()
      await closeSupportDb()
    },
    { scope: 'worker', auto: true },
  ],

  marker: async ({}, use, testInfo) => {
    const slug = testInfo.titlePath
      .slice(-1)[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 24)
      .replace(/-+$/, '')
    await use(`e2e-${slug}-${Date.now().toString(36)}-${testInfo.workerIndex}${testInfo.retry}`)
  },

  customerEmail: async ({ marker }, use) => {
    await use(`${marker}@customers.example`)
  },

  asPerson: async ({ browser }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = []
    await use(async (name) => {
      const context = await browser.newContext({ storageState: personStatePath(name) })
      contexts.push(context)
      return context.newPage()
    })
    for (const context of contexts) await context.close()
  },
})

export { expect }
