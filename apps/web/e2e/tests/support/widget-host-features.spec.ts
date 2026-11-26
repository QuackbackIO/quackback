/**
 * The widget on a customer's own page (area CUS-W): what the SDK shows above
 * the closed launcher, how the panel opens and closes, and what a visitor in
 * another language sees. Every test loads the real SDK on a host page and
 * leaves the panel closed unless the test opens it.
 *
 * Set E2E_GALLERY_DIR to also save a screenshot of each result there.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { generateId, toUuid } from '@quackback/ids'
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import { ISOLATED } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import { agentApi, mintVisitor, visitorSend } from '../../support/widget-portal'

const FRAME = 'iframe.quackback-widget-iframe'

/** Save a screenshot for the proof gallery when E2E_GALLERY_DIR is set. */
async function snap(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_GALLERY_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: join(dir, `${name}.png`) })
}

/**
 * A host page that loads the real SDK. The panel stays closed unless `open`
 * is given (then it opens with those options). With `visitorToken` the widget
 * starts as that returning anonymous visitor.
 */
async function openHost(
  page: Page,
  opts: { visitorToken?: string; open?: Record<string, unknown> | true } = {}
): Promise<void> {
  const env = supportEnv()
  const path = `/e2e/host-${randomBytes(6).toString('hex')}`
  if (opts.visitorToken) {
    await page.addInitScript(
      ({ origin, token }) => {
        if (window.location.origin !== origin || !window.location.pathname.startsWith('/widget'))
          return
        const key = `quackback:anon-token:${origin}`
        if (!window.localStorage.getItem(key)) {
          window.localStorage.setItem(
            key,
            JSON.stringify({ token, expiresAt: Date.now() + 24 * 60 * 60 * 1000 })
          )
        }
      },
      { origin: new URL(env.baseUrl).origin, token: opts.visitorToken }
    )
  }
  const open =
    opts.open === undefined
      ? ''
      : opts.open === true
        ? "Q('open')"
        : `Q('open', ${JSON.stringify(opts.open)})`
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Acme app</title></head>
<body style="font-family:system-ui;margin:0;padding:32px;background:#f6f7f9">
<h1 style="margin:0 0 8px">Acme app</h1><p style="color:#555">A customer's own page with the widget installed.</p>
<script src="/api/widget/sdk.js"></script>
<script>
  (function () {
    var Q = window.Quackback
    Q('init', ${JSON.stringify({ instanceUrl: env.baseUrl })})
    ${open}
  })()
</script></body></html>`
  await page.route(`${env.baseUrl}${path}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
  )
  await page.goto(path)
}

function launcher(page: Page) {
  return page.getByRole('button', { name: /^Open help/ })
}

test.describe('widget on a host page: replies while the panel is closed', () => {
  test(
    'CUS-W-H1 a teammate reply shows above the closed launcher, counts as unread, and opens its thread',
    { tag: '@core' },
    async ({ page, request, marker }) => {
      const opening = `${marker} where is my order?`
      const visitor = await mintVisitor({ name: 'Rosa' })
      const { conversation } = await visitorSend(request, visitor.token, opening)

      await openHost(page, { visitorToken: visitor.token })
      await expect(launcher(page)).toBeVisible({ timeout: 20_000 })
      // Nothing unread yet: no card, no count on the launcher.
      await expect(page.locator('[data-quackback-reply-preview]')).toHaveCount(0)

      const reply = `${marker} It ships tomorrow morning.`
      await agentApi(request).reply(conversation.id, reply)

      // The frame polls the unread count while the panel is closed.
      const card = page.locator('[data-quackback-reply-preview]')
      await expect(card).toBeVisible({ timeout: 45_000 })
      await expect(card).toContainText(reply)
      await expect(page.getByRole('button', { name: /^Open help, 1 unread$/ })).toBeVisible()
      await snap(page, '01-reply-preview-closed-launcher')

      // Opening from the card lands in that conversation, under the header
      // that says who answers (this workspace runs the AI assistant first).
      await card.getByText(reply).click()
      const widget = page.frameLocator(FRAME)
      await expect(widget.getByText(reply)).toBeVisible({ timeout: 15_000 })
      await expect(widget.getByText(opening)).toBeVisible()
      await expect(widget.getByText('The team can also help')).toBeVisible()
      await snap(page, '02-reply-preview-opens-thread')

      // Read once on screen: closing leaves no unread count behind. The
      // composer holds focus, so the first Escape leaves it and the next closes.
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: /^Open help$/ })).toBeVisible({
        timeout: 15_000,
      })
      await expect(card).toBeHidden()
    }
  )
})

test.describe('widget on a host page: opening and closing', () => {
  test(
    "CUS-W-H2 open({ view: 'feedback' }) opens the feedback list",
    { tag: '@core' },
    async ({ page }) => {
      await openHost(page, { open: { view: 'feedback' } })
      const widget = page.frameLocator(FRAME)
      await expect(widget.getByRole('button', { name: /^Vote \(/ }).first()).toBeVisible({
        timeout: 20_000,
      })
      await snap(page, '03-open-feedback-view')
    }
  )

  test(
    'CUS-W-H3 Escape closes the panel and gives focus back to the launcher',
    { tag: '@core' },
    async ({ page }) => {
      await openHost(page)
      await expect(launcher(page)).toBeVisible({ timeout: 20_000 })
      await launcher(page).focus()
      await page.keyboard.press('Enter')
      const frame = page.locator(FRAME)
      await expect(frame).toBeVisible({ timeout: 15_000 })
      // Keyboard users who asked for the panel land in it.
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.tagName), { timeout: 10_000 })
        .toBe('IFRAME')
      // Wait for the frame's app, which owns the Escape key.
      await expect(
        page.frameLocator(FRAME).getByRole('button', { name: 'Home', exact: true })
      ).toBeVisible({ timeout: 15_000 })
      await snap(page, '04-panel-open-focus-in-frame')

      await page.keyboard.press('Escape')
      await expect(frame).toBeHidden({ timeout: 10_000 })
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
        .toBe('Open help')
    }
  )

  test(
    'CUS-W-H4 on a phone the open panel fills the screen with its tab bar in view',
    { tag: '@core' },
    async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      })
      const page = await context.newPage()
      try {
        await openHost(page, { open: true })
        const frame = page.locator(FRAME)
        await expect(frame).toBeVisible({ timeout: 20_000 })
        const box = await frame.boundingBox()
        expect(box).not.toBeNull()
        expect(Math.round(box!.width)).toBe(390)
        expect(Math.round(box!.height)).toBeGreaterThanOrEqual(800)
        const home = page.frameLocator(FRAME).getByRole('button', { name: 'Home', exact: true })
        await expect(home).toBeInViewport({ timeout: 15_000 })
        await snap(page, '05-phone-full-screen-panel')
      } finally {
        await context.close()
      }
    }
  )
})

/** A published article in a public collection, in the default language. */
async function seedArticle(marker: string): Promise<{ title: string; collection: string }> {
  const sql = supportDb()
  const categoryUuid = toUuid(generateId('kb_category'))
  const articleUuid = toUuid(generateId('article'))
  const [author] = await sql`SELECT id FROM principal WHERE role = 'admin' AND type = 'user'
    ORDER BY created_at LIMIT 1`
  const slug = `${marker}-${randomBytes(3).toString('hex')}`
  const collection = `Getting started ${marker}`
  const title = `Set up your account ${marker}`
  await sql`INSERT INTO kb_categories (id, slug, name, is_public, position, created_at, updated_at)
    VALUES (${categoryUuid}, ${slug}, ${collection}, true, 0, NOW(), NOW())`
  await sql`INSERT INTO kb_articles (id, category_id, slug, title, content, principal_id,
      published_at, created_at, updated_at)
    VALUES (${articleUuid}, ${categoryUuid}, ${slug}, ${title}, ${'Open Settings, then Account.'},
      ${author.id}, NOW() - interval '1 minute', NOW(), NOW())`
  return { title, collection }
}

test.describe('widget on a host page: workspace switches', () => {
  test.skip(!ISOLATED, 'turns on workspace-wide widget settings; runs in support-isolated')

  test(
    'CUS-W-H5 a visitor browsing in German sees the help articles, in German menus',
    { tag: ['@core', '@isolated'] },
    async ({ browser, marker }) => {
      const article = await seedArticle(marker)
      await withSettings(
        { feature_flags: { helpCenter: true }, widget_config: { 'tabs.help': true } },
        async () => {
          // German is not a help center language: the default-language
          // collections show anyway, never "Noch keine Artikel".
          const context = await browser.newContext({
            locale: 'de-DE',
            extraHTTPHeaders: { 'Accept-Language': 'de-DE,de;q=0.9' },
          })
          const page = await context.newPage()
          try {
            await openHost(page, { open: { view: 'help' } })
            const widget = page.frameLocator(FRAME)
            await expect(widget.getByText('Sammlungen durchstöbern')).toBeVisible({
              timeout: 20_000,
            })
            await expect(widget.getByText(article.collection)).toBeVisible()
            await expect(widget.getByText('Noch keine Artikel')).toHaveCount(0)
            await snap(page, '06-help-tab-german-visitor')

            await widget.getByText(article.collection).click()
            await expect(widget.getByText(article.title)).toBeVisible({ timeout: 15_000 })
            await widget.getByText(article.title).click()
            await expect(widget.getByText('Open Settings, then Account.')).toBeVisible({
              timeout: 15_000,
            })
            await snap(page, '06b-help-article-german-visitor')
          } finally {
            await context.close()
          }
        }
      )
    }
  )

  test(
    "CUS-W-H6 an update published after the visitor's first visit shows above the launcher, and an entry kept out of the card does not",
    { tag: ['@core', '@isolated'] },
    async ({ page, marker }) => {
      await withSettings(
        { widget_config: { 'changelog.announceOnLauncher': true, 'tabs.changelog': true } },
        async () => {
          // First visit: what exists now is already seen.
          await openHost(page)
          await expect(launcher(page)).toBeVisible({ timeout: 20_000 })
          await expect(page.locator('[data-quackback-whats-new]')).toHaveCount(0)
          // The frame records the first-visit baseline once the changelog loads.
          await page.waitForTimeout(3_000)

          const announced = `${marker} Dark mode is here`
          const quiet = `${marker} Internal fixes`
          const insert = (title: string, announce: boolean, secondsAgo: number) =>
            supportDb()`INSERT INTO changelog_entries
              (id, title, content, published_at, announce_on_launcher)
              VALUES (${toUuid(generateId('changelog'))}, ${title}, ${`${title}. Try it today.`},
                      NOW() - make_interval(secs => ${secondsAgo}), ${announce})`
          await insert(announced, true, 2)
          // Newer, but its author kept it out of the card.
          await insert(quiet, false, 1)

          await page.reload()
          const card = page.locator('[data-quackback-whats-new]')
          await expect(card).toBeVisible({ timeout: 30_000 })
          await expect(card).toContainText(announced)
          await expect(card).not.toContainText(quiet)
          await expect(card).toContainText('1 new update')
          await snap(page, '07-whats-new-card')
        }
      )
    }
  )
})
