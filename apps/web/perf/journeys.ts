/**
 * The journeys the bench measures.
 *
 * Document journeys fetch one server-rendered page and count the work behind
 * it. Browser journeys drive a real page, from a user action to the rendered
 * result, and count the work on both sides of the wire. A journey is only
 * worth keeping if its counts come out identical on every run; the bench
 * checks that with --repeat.
 */
import type { APIRequestContext, Page } from '@playwright/test'
import { buildWidgetInstallSnippet } from '../src/lib/shared/widget/install-prompt'
import { BENCH_PORT } from './config'

export type Actor = 'anon' | 'admin'

export interface DocumentJourney {
  kind: 'document'
  name: string
  as: Actor
  /** A fixed path, or one resolved at run time (seeded ids differ per database). */
  path: string | ((request: APIRequestContext) => Promise<string>)
}

export interface BrowserJourney {
  kind: 'browser'
  name: string
  as: Actor
  /** Unmeasured lead-in, e.g. the page a click-through starts from. */
  setup?: (page: Page) => Promise<void>
  /** The measured interaction. Resolves once its result is on screen. */
  run: (page: Page) => Promise<void>
}

export type Journey = DocumentJourney | BrowserJourney

const firstPortalPost = (page: Page) => page.locator('a[href*="/posts/post_"]').first()

/** The first post linked from the portal home, for loading a post page directly. */
async function firstPostPath(request: APIRequestContext): Promise<string> {
  const html = await (await request.get('/?sort=trending')).text()
  const match = html.match(/\/b\/[a-z0-9-]+\/posts\/post_[a-z0-9]+/)
  if (!match) throw new Error('no post link on the portal home')
  return match[0]
}

/** A customer's page on another site, with the widget installed as documented. */
const HOST_PAGE = 'https://customer.example/'
const hostPageHtml = () =>
  `<!doctype html><html><head><title>Customer site</title></head><body><h1>Customer site</h1>` +
  `${buildWidgetInstallSnippet(`http://localhost:${BENCH_PORT}`)}</body></html>`

export const journeys: Journey[] = [
  // Server-rendered documents, anonymous visitor.
  { kind: 'document', name: 'doc:portal-home', as: 'anon', path: '/?sort=trending' },
  { kind: 'document', name: 'doc:portal-roadmap', as: 'anon', path: '/roadmap' },
  { kind: 'document', name: 'doc:portal-changelog', as: 'anon', path: '/changelog' },
  // A post page streams a query after the shell, so its document only ends
  // once that query has been written into it.
  { kind: 'document', name: 'doc:portal-post', as: 'anon', path: firstPostPath },
  { kind: 'document', name: 'doc:help-center', as: 'anon', path: '/hc' },
  { kind: 'document', name: 'doc:widget', as: 'anon', path: '/widget' },

  // The same portal pages for a signed-in user: the difference is the
  // per-request cost of a session.
  { kind: 'document', name: 'doc:portal-home+session', as: 'admin', path: '/?sort=trending' },
  { kind: 'document', name: 'doc:portal-changelog+session', as: 'admin', path: '/changelog' },

  // Admin documents.
  { kind: 'document', name: 'doc:admin-feedback', as: 'admin', path: '/admin/feedback' },
  { kind: 'document', name: 'doc:admin-inbox', as: 'admin', path: '/admin/inbox' },
  { kind: 'document', name: 'doc:admin-roadmap', as: 'admin', path: '/admin/roadmap' },
  { kind: 'document', name: 'doc:admin-changelog', as: 'admin', path: '/admin/changelog' },
  { kind: 'document', name: 'doc:admin-help-center', as: 'admin', path: '/admin/help-center' },
  { kind: 'document', name: 'doc:admin-users', as: 'admin', path: '/admin/users?sort=newest' },
  { kind: 'document', name: 'doc:admin-settings', as: 'admin', path: '/admin/settings/general' },

  // Browser journeys: launch, navigate, open.
  {
    kind: 'browser',
    name: 'ui:portal-load',
    as: 'anon',
    run: async (page) => {
      await page.goto('/?sort=trending')
      await firstPortalPost(page).waitFor()
    },
  },
  {
    kind: 'browser',
    name: 'ui:portal-open-post',
    as: 'anon',
    setup: async (page) => {
      await page.goto('/?sort=trending')
      await firstPortalPost(page).waitFor()
    },
    run: async (page) => {
      await firstPortalPost(page).click()
      await page.waitForURL(/\/posts\/post_/)
      await page.getByRole('heading', { level: 1 }).first().waitFor()
    },
  },
  {
    kind: 'browser',
    name: 'ui:portal-post-load',
    as: 'anon',
    run: async (page) => {
      await page.goto(await firstPostPath(page.request), { waitUntil: 'load' })
      await page.getByRole('heading', { level: 1 }).first().waitFor()
    },
  },
  {
    kind: 'browser',
    name: 'ui:widget-load',
    as: 'anon',
    run: async (page) => {
      await page.goto('/widget')
      await page.getByRole('button', { name: 'Home', exact: true }).waitFor()
    },
  },
  {
    // What every visitor to a page with the widget installed pays: the SDK
    // preloads the hidden widget iframe whether or not the visitor opens it.
    kind: 'browser',
    name: 'ui:widget-embed',
    as: 'anon',
    run: async (page) => {
      await page.route(HOST_PAGE, (route) =>
        route.fulfill({ contentType: 'text/html', body: hostPageHtml() })
      )
      // The widget is served from a loopback address; a public page needs
      // the browser's local-network permission to reach it.
      await page.context().grantPermissions(['local-network-access'])
      await page.goto(HOST_PAGE)
      await page
        .frameLocator('iframe.quackback-widget-iframe')
        .getByRole('button', { name: 'Home', exact: true })
        .waitFor({ state: 'attached' })
    },
  },
  {
    kind: 'browser',
    name: 'ui:widget-feedback-tab',
    as: 'anon',
    setup: async (page) => {
      await page.goto('/widget')
      await page.getByRole('button', { name: 'Home', exact: true }).waitFor()
    },
    run: async (page) => {
      await page.getByRole('button', { name: 'Feedback', exact: true }).click()
      await page
        .getByRole('button', { name: /^Vote \(/ })
        .first()
        .waitFor()
    },
  },
  {
    kind: 'browser',
    name: 'ui:admin-feedback-load',
    as: 'admin',
    run: async (page) => {
      await page.goto('/admin/feedback')
      await page.locator('[data-post-id]').first().waitFor()
    },
  },
  {
    kind: 'browser',
    name: 'ui:admin-open-post',
    as: 'admin',
    setup: async (page) => {
      await page.goto('/admin/feedback')
      await page.locator('[data-post-id]').first().waitFor()
    },
    run: async (page) => {
      await page.locator('[data-post-id]').first().click()
      await page.getByRole('dialog').waitFor()
      await page.getByRole('dialog').getByText('Status').first().waitFor()
    },
  },
  {
    kind: 'browser',
    name: 'ui:admin-inbox-load',
    as: 'admin',
    run: async (page) => {
      await page.goto('/admin/inbox')
      await page.getByText('Bench conversation').first().waitFor()
    },
  },
  {
    kind: 'browser',
    name: 'ui:admin-nav-feedback-to-roadmap',
    as: 'admin',
    setup: async (page) => {
      await page.goto('/admin/feedback')
      await page.locator('[data-post-id]').first().waitFor()
    },
    run: async (page) => {
      await page.locator('a[href="/admin/roadmap"]').first().click()
      await page.waitForURL(/\/admin\/roadmap/)
      await page.getByRole('heading').first().waitFor()
    },
  },
]
