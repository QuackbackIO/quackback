/**
 * Each person's own language (area CUS-LANG-P): the Language row under Theme
 * in Preferences saves on select and turns the page into that language at
 * once, with the toast in the new language; "Automatic" goes back to the
 * browser. A teammate's chosen language reaches the admin pages that are
 * translated. In the widget, an identified person's chosen language shows
 * unless the host page set a locale, and the identify records the detected
 * language for emails.
 *
 * Set E2E_GALLERY_DIR to also save a screenshot of each result there.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  mintCustomer,
  openWidget,
  portalContext,
  signSsoToken,
  widgetSecret,
} from '../../support/widget-portal'

async function snap(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_GALLERY_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: join(dir, `${name}.png`) })
}

function catalogue(locale: string): Record<string, string> {
  const here = dirname(fileURLToPath(import.meta.url))
  return JSON.parse(readFileSync(join(here, '../../../src/locales', `${locale}.json`), 'utf8'))
}

async function storedLanguage(userUuid: string): Promise<{
  preferred_language: string | null
  detected_locale: string | null
}> {
  const [row] = await supportDb()`SELECT preferred_language, detected_locale FROM "user"
    WHERE id = ${userUuid}`
  return row as { preferred_language: string | null; detected_locale: string | null }
}

test.describe('a person chooses their own language', () => {
  test(
    'CUS-LANG-P1 a customer with an English browser picks Deutsch: the page and toast turn German; Automatic goes back',
    { tag: '@core' },
    async ({ browser, customerEmail }) => {
      const en = catalogue('en')
      const de = catalogue('de')
      const customer = await mintCustomer({ email: customerEmail })
      const context = await portalContext(browser, customer)
      await context.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
      const page = await context.newPage()
      try {
        await page.goto('/settings/preferences')
        await expect(
          page.getByRole('heading', { name: en['portal.settings.preferences.title'] })
        ).toBeVisible({ timeout: 20_000 })
        await expect(page.getByText('Theme and language')).toBeVisible()
        const select = page.getByRole('button', { name: 'Language' })
        await expect(select).toHaveText(/Automatic \(English\)/)

        await select.click()
        await expect(
          page.getByRole('menuitemradio', { name: /Automatic.*English, from your browser/ })
        ).toBeVisible()
        await expect(page.getByRole('menuitemradio', { name: /Deutsch\s*German/ })).toBeVisible()
        await snap(page, '01-language-list')
        // The page changes in place: the Appearance card is the same element
        // before and after, never mounted again behind a blank frame.
        await page
          .getByText('Theme and language')
          .evaluate((node) => ((window as { appearanceCard?: Node }).appearanceCard = node))
        await page.getByRole('menuitemradio', { name: /Deutsch/ }).click()
        await snap(page, '01b-right-after-choice')

        // The toast reads in the new language, and the page follows at once.
        await expect(
          page.getByText(de['portal.settings.preferences.appearance.languageSaved'])
        ).toBeVisible({ timeout: 15_000 })
        await expect(
          page.getByRole('heading', { name: de['portal.settings.preferences.title'] })
        ).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('lang', 'de')
        await snap(page, '02-german-after-choice')
        expect(
          await page.evaluate(
            () => (window as { appearanceCard?: Node }).appearanceCard?.isConnected ?? false
          )
        ).toBe(true)
        expect((await storedLanguage(customer.userUuid)).preferred_language).toBe('de')

        // Still German on the next page load, whatever the browser asks for.
        await page.goto('/')
        await expect(page.locator('html')).toHaveAttribute('lang', 'de')

        await page.goto('/settings/preferences')
        const german = page.getByRole('button', {
          name: de['portal.settings.preferences.appearance.languageLabel'],
        })
        await expect(german).toHaveText('Deutsch')
        await german.click()
        const automatic = page.getByRole('menuitemradio', {
          name: new RegExp(de['portal.settings.preferences.appearance.languageAutomatic']),
        })
        await expect(automatic).toBeVisible()
        await snap(page, '02b-german-menu')
        await automatic.click()
        await expect(
          page.getByText(en['portal.settings.preferences.appearance.languageSaved'])
        ).toBeVisible({ timeout: 15_000 })
        await expect(
          page.getByRole('heading', { name: en['portal.settings.preferences.title'] })
        ).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('lang', 'en')
        expect((await storedLanguage(customer.userUuid)).preferred_language).toBeNull()
      } finally {
        await context.close()
      }
    }
  )

  test(
    "CUS-LANG-P2 a teammate's chosen language reaches the translated admin pages, before the browser's",
    { tag: '@core' },
    async ({ browser, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'admin' })
      await supportDb()`UPDATE "user" SET preferred_language = 'fr'
        WHERE id = ${toUuid(mate.userId as `user_${string}`)}`
      const context = await browser.newContext({
        storageState: mate.storageState,
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
      })
      const page = await context.newPage()
      try {
        await page.goto('/admin/settings/agent')
        await expect(page.locator('html')).toHaveAttribute('lang', 'fr', { timeout: 20_000 })
      } finally {
        await context.close()
      }
    }
  )

  test(
    "CUS-LANG-P3 the widget shows an identified person's chosen language unless the host page set one, and records the detected language",
    { tag: '@core' },
    async ({ browser, request, customerEmail }) => {
      const customer = await mintCustomer({ email: customerEmail })
      await supportDb()`UPDATE "user" SET preferred_language = 'nl' WHERE id = ${customer.userUuid}`
      const secret = await widgetSecret(request)
      const ssoToken = signSsoToken({ id: customer.email, email: customer.email }, secret)

      const plain = await browser.newContext({
        extraHTTPHeaders: { 'Accept-Language': 'pl-PL,pl;q=0.9' },
      })
      try {
        const widget = await openWidget(await plain.newPage(), { ssoToken })
        // The person chose Dutch: the widget turns Dutch after the identify.
        await expect(widget.locator('html')).toHaveAttribute('lang', 'nl', { timeout: 20_000 })
        // The browser asked for Polish, which is what the identify records.
        await expect
          .poll(async () => (await storedLanguage(customer.userUuid)).detected_locale)
          .toBe('pl')
      } finally {
        await plain.close()
      }

      const hosted = await browser.newContext({
        extraHTTPHeaders: { 'Accept-Language': 'pl-PL,pl;q=0.9' },
      })
      try {
        const page = await hosted.newPage()
        const widget = await openWidget(page, { ssoToken, locale: 'es' })
        // The host page's locale wins over the person's own choice.
        await expect(widget.locator('html')).toHaveAttribute('lang', 'es', { timeout: 20_000 })
        await expect
          .poll(async () => (await storedLanguage(customer.userUuid)).detected_locale)
          .toBe('es')
        await snap(page, '03-widget-host-locale')
      } finally {
        await hosted.close()
      }
    }
  )
})
