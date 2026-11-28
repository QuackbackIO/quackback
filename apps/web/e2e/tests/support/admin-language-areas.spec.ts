/**
 * Admin strings by area (area ADM-LANG-A): a non-English admin page carries
 * the strings of its own area and not the rest of the admin's. The People
 * page seeds the People strings, so it opens translated, and the Inbox does
 * not carry them. A move between pages in the browser (from another area's
 * page) brings the next page's strings with it. English pages carry no strings at all.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { clickUntil } from '../../support/inbox'

function catalogue(locale: string): Record<string, string> {
  const here = dirname(fileURLToPath(import.meta.url))
  return JSON.parse(readFileSync(join(here, '../../../src/locales', `${locale}.json`), 'utf8'))
}

/** A People string no other admin page shows. */
const PEOPLE_KEY = 'admin.people.new.verifiedHelp'

async function documentOf(context: BrowserContext, path: string): Promise<string> {
  const response = await context.request.get(path)
  expect(response.status()).toBe(200)
  return response.text()
}

test.describe('admin pages load their own strings', () => {
  test(
    'ADM-LANG-A1 a German teammate: People opens translated with its strings, the Inbox does not carry them',
    { tag: '@core' },
    async ({ browser, newTeammate }) => {
      const de = catalogue('de')
      const mate = await newTeammate({ roleKey: 'admin' })
      await supportDb()`UPDATE "user" SET preferred_language = 'de'
        WHERE id = ${toUuid(mate.userId as `user_${string}`)}`
      const context = await browser.newContext({
        storageState: mate.storageState,
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
      })
      try {
        expect(await documentOf(context, '/admin/users')).toContain(PEOPLE_KEY)
        expect(await documentOf(context, '/admin/inbox')).not.toContain(PEOPLE_KEY)

        const page = await context.newPage()
        await page.goto('/admin/users')
        await expect(
          page.getByRole('button', { name: de['admin.people.new.trigger'], exact: true })
        ).toBeVisible({ timeout: 20_000 })
      } finally {
        await context.close()
      }
    }
  )

  test(
    "ADM-LANG-A2 moving from the Roadmap to People in the browser brings People's strings",
    { tag: '@core' },
    async ({ browser, newTeammate }) => {
      const de = catalogue('de')
      const mate = await newTeammate({ roleKey: 'admin' })
      await supportDb()`UPDATE "user" SET preferred_language = 'de'
        WHERE id = ${toUuid(mate.userId as `user_${string}`)}`
      const context = await browser.newContext({
        storageState: mate.storageState,
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
      })
      try {
        const page = await context.newPage()
        await page.goto('/admin/roadmap')
        await expect(page.locator('html')).toHaveAttribute('lang', 'en', { timeout: 20_000 })
        // A move inside the app, not a new document.
        await page.evaluate(() => {
          ;(window as { sameDocument?: boolean }).sameDocument = true
        })
        // The rail is server-rendered: click until a click lands after hydration.
        await clickUntil(page.getByRole('link', { name: de['admin.nav.users'] }).first(), () =>
          expect(page).toHaveURL(/\/admin\/users/, { timeout: 3_000 })
        )
        await expect(
          page.getByRole('button', { name: de['admin.people.new.trigger'], exact: true })
        ).toBeVisible({ timeout: 20_000 })
        expect(await page.evaluate(() => (window as { sameDocument?: boolean }).sameDocument)).toBe(
          true
        )
      } finally {
        await context.close()
      }
    }
  )

  test(
    'ADM-LANG-A3 an English teammate: People reads English and the page carries no strings',
    { tag: '@core' },
    async ({ browser, newTeammate }) => {
      const en = catalogue('en')
      const mate = await newTeammate({ roleKey: 'admin' })
      const context = await browser.newContext({
        storageState: mate.storageState,
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
      })
      try {
        expect(await documentOf(context, '/admin/users')).not.toContain(PEOPLE_KEY)
        const page = await context.newPage()
        await page.goto('/admin/users')
        await expect(
          page.getByRole('button', { name: en['admin.people.new.trigger'], exact: true })
        ).toBeVisible({ timeout: 20_000 })
      } finally {
        await context.close()
      }
    }
  )
})
