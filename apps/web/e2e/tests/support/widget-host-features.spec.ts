/**
 * The widget on a customer's own page (area CUS-W): what the SDK shows above
 * the closed launcher, how the panel opens and closes, and what a visitor in
 * another language sees, in every widget language. Every test loads the real SDK on a host page and
 * leaves the panel closed unless the test opens it.
 *
 * Set E2E_GALLERY_DIR to also save a screenshot of each result there.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { generateId, toUuid } from '@quackback/ids'
import type { Browser, Page } from '@playwright/test'
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

/** The widget's own words for one UI language, read from its catalogue. */
function catalogue(locale: string): Record<string, string> {
  const here = dirname(fileURLToPath(import.meta.url))
  return JSON.parse(readFileSync(join(here, '../../../src/locales', `${locale}.json`), 'utf8'))
}

/**
 * Browser languages a visitor might arrive with, and the widget language each
 * one gets. None of them is a help center language here, so every one of them
 * must still see the default-language collections.
 */
const BROWSER_LANGUAGES: { tag: string; ui: string }[] = [
  { tag: 'de-DE', ui: 'de' },
  { tag: 'fr-FR', ui: 'fr' },
  { tag: 'es-ES', ui: 'es' },
  { tag: 'nl-NL', ui: 'nl' },
  { tag: 'pl-PL', ui: 'pl' },
  { tag: 'ru-RU', ui: 'ru' },
  { tag: 'uk-UA', ui: 'uk' },
  { tag: 'ar-EG', ui: 'ar' },
  { tag: 'th-TH', ui: 'th' },
  { tag: 'zh-CN', ui: 'zh-cn' },
  { tag: 'zh-TW', ui: 'zh-tw' },
  { tag: 'pt-BR', ui: 'pt-br' },
  // Regional tags that map onto a catalogue of a sibling region or script.
  { tag: 'pt-PT', ui: 'pt-br' },
  { tag: 'zh-HK', ui: 'zh-tw' },
  { tag: 'fr-CA', ui: 'fr' },
  // A language the widget has no words for: English menus, same articles.
  { tag: 'sw-KE', ui: 'en' },
]

const RTL = new Set(['ar'])

/** A host page in a browser set to one language, opened on the Help tab. */
async function helpInLanguage(
  browser: Browser,
  tag: string,
  run: (page: Page) => Promise<void>
): Promise<void> {
  const context = await browser.newContext({
    locale: tag,
    extraHTTPHeaders: { 'Accept-Language': `${tag},${tag.split('-')[0]};q=0.9` },
  })
  const page = await context.newPage()
  try {
    await openHost(page, { open: { view: 'help' } })
    await run(page)
  } finally {
    await context.close()
  }
}

/** A published article in a public collection, in the default language. */
async function seedArticle(marker: string): Promise<{
  title: string
  collection: string
  body: string
  categoryUuid: string
  articleUuid: string
}> {
  const sql = supportDb()
  const categoryUuid = toUuid(generateId('kb_category'))
  const articleUuid = toUuid(generateId('article'))
  const [author] = await sql`SELECT id FROM principal WHERE role = 'admin' AND type = 'user'
    ORDER BY created_at LIMIT 1`
  const slug = `${marker}-${randomBytes(3).toString('hex')}`
  const collection = `Getting started ${marker}`
  const title = `Set up your account ${marker}`
  const body = 'Open Settings, then Account.'
  await sql`INSERT INTO kb_categories (id, slug, name, is_public, position, created_at, updated_at)
    VALUES (${categoryUuid}, ${slug}, ${collection}, true, 0, NOW(), NOW())`
  await sql`INSERT INTO kb_articles (id, category_id, slug, title, content, principal_id,
      published_at, created_at, updated_at)
    VALUES (${articleUuid}, ${categoryUuid}, ${slug}, ${title}, ${body},
      ${author.id}, NOW() - interval '1 minute', NOW(), NOW())`
  return { title, collection, body, categoryUuid, articleUuid }
}

/** A translation of a seeded collection and (optionally) its article. */
async function translate(
  seeded: { categoryUuid: string; articleUuid: string },
  locale: string,
  words: { collection: string; title?: string; body?: string; status?: 'draft' | 'published' }
): Promise<void> {
  const sql = supportDb()
  await sql`INSERT INTO kb_category_translations (id, category_id, locale, name)
    VALUES (${toUuid(generateId('kb_category_translation'))}, ${seeded.categoryUuid}, ${locale},
      ${words.collection})`
  if (words.title) {
    await sql`INSERT INTO kb_article_translations (id, article_id, locale, title, content, status)
      VALUES (${toUuid(generateId('kb_article_translation'))}, ${seeded.articleUuid}, ${locale},
        ${words.title}, ${words.body ?? ''}, ${words.status ?? 'published'})`
  }
}

test.describe('widget on a host page: help in every language', () => {
  test.skip(!ISOLATED, 'turns on workspace-wide widget settings; runs in support-isolated')

  for (const { tag, ui } of BROWSER_LANGUAGES) {
    test(
      `CUS-W-H5 a visitor browsing in ${tag} sees the help articles, with ${ui} menus`,
      { tag: ['@core', '@isolated'] },
      async ({ browser, marker }) => {
        const words = catalogue(ui)
        const article = await seedArticle(marker)
        await withSettings(
          {
            feature_flags: { helpCenter: true },
            widget_config: { 'tabs.help': true },
            help_center_config: { 'locales.additional': [] },
          },
          async () =>
            helpInLanguage(browser, tag, async (page) => {
              const widget = page.frameLocator(FRAME)
              await expect(widget.getByText(words['widget.help.browseCollections'])).toBeVisible({
                timeout: 20_000,
              })
              await expect(widget.locator('html')).toHaveAttribute(
                'dir',
                RTL.has(ui) ? 'rtl' : 'ltr'
              )
              // Not a help center language: the default-language collections
              // show anyway, never the empty state.
              await expect(widget.getByText(article.collection)).toBeVisible()
              await expect(widget.getByText(words['widget.help.noCategories'])).toHaveCount(0)
              await widget.getByText(article.collection).scrollIntoViewIfNeeded()
              await snap(page, `06-help-${tag}`)

              await widget.getByText(article.collection).click()
              await widget.getByText(article.title).click()
              await expect(widget.getByText(article.body)).toBeVisible({ timeout: 15_000 })
            })
        )
      }
    )
  }

  test(
    'CUS-W-H5b translated help shows in each help center language, falls back where a translation is missing, and stays in the default language elsewhere',
    { tag: ['@core', '@isolated'] },
    async ({ browser, marker }) => {
      const article = await seedArticle(marker)
      // French: collection and article translated and published.
      const fr = {
        collection: `Premiers pas ${marker}`,
        title: `Configurer votre compte ${marker}`,
        body: 'Ouvrez Paramètres, puis Compte.',
      }
      await translate(article, 'fr', fr)
      // German: collection translated, article translation still a draft.
      const deCollection = `Erste Schritte ${marker}`
      await translate(article, 'de', {
        collection: deCollection,
        title: `Konto einrichten ${marker}`,
        body: 'Öffnen Sie Einstellungen.',
        status: 'draft',
      })
      // Spanish: fully translated, but Spanish is not a help center language.
      const es = { collection: `Primeros pasos ${marker}`, title: `Configura tu cuenta ${marker}` }
      await translate(article, 'es', { ...es, body: 'Abre Ajustes.' })

      await withSettings(
        {
          feature_flags: { helpCenter: true },
          widget_config: { 'tabs.help': true },
          help_center_config: { 'locales.additional': ['fr', 'de'] },
        },
        async () => {
          await helpInLanguage(browser, 'fr-FR', async (page) => {
            const widget = page.frameLocator(FRAME)
            await expect(widget.getByText(fr.collection)).toBeVisible({ timeout: 20_000 })
            await expect(widget.getByText(article.collection)).toHaveCount(0)
            await widget.getByText(fr.collection).scrollIntoViewIfNeeded()
            await snap(page, '06c-help-translated-fr')
            await widget.getByText(fr.collection).click()
            await widget.getByText(fr.title).click()
            await expect(widget.getByText(fr.body)).toBeVisible({ timeout: 15_000 })
            await expect(widget.getByTestId('widget-help-untranslated')).toHaveCount(0)
            await snap(page, '06d-help-translated-fr-article')
          })

          await helpInLanguage(browser, 'de-DE', async (page) => {
            const widget = page.frameLocator(FRAME)
            await expect(widget.getByText(deCollection)).toBeVisible({ timeout: 20_000 })
            await widget.getByText(deCollection).click()
            // The draft translation stays hidden; the default-language article shows.
            await expect(widget.getByText(article.title)).toBeVisible({ timeout: 15_000 })
            await expect(widget.getByText(`Konto einrichten ${marker}`)).toHaveCount(0)
            await snap(page, '06e-help-partial-de')
            await widget.getByText(article.title).click()
            await expect(widget.getByText(article.body)).toBeVisible({ timeout: 15_000 })
            // It says the article is not in German yet.
            await expect(widget.getByTestId('widget-help-untranslated')).toHaveText(
              catalogue('de')['widget.helpDetail.untranslated']
            )
            await snap(page, '06e-help-partial-de-article')
          })

          await helpInLanguage(browser, 'es-ES', async (page) => {
            const widget = page.frameLocator(FRAME)
            await expect(widget.getByText(article.collection)).toBeVisible({ timeout: 20_000 })
            await expect(widget.getByText(es.collection)).toHaveCount(0)
            await widget.getByText(article.collection).click()
            await expect(widget.getByText(article.title)).toBeVisible({ timeout: 15_000 })
            await expect(widget.getByText(es.title)).toHaveCount(0)
            await snap(page, '06f-help-not-enabled-es')
          })
        }
      )
    }
  )
})

test.describe('widget on a host page: workspace switches', () => {
  test.skip(!ISOLATED, 'turns on workspace-wide widget settings; runs in support-isolated')

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
