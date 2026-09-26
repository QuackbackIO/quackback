/**
 * The journeys the bench measures.
 *
 * Document journeys fetch one server-rendered page and count the work behind
 * it. Browser journeys drive a real page, from a user action to the rendered
 * result, and count the work on both sides of the wire. A journey is only
 * worth keeping if its counts come out identical on every run; the bench
 * checks that with --repeat.
 */
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import postgres from 'postgres'
import { buildWidgetInstallSnippet } from '../src/lib/shared/widget/install-prompt'
import { BENCH_DATABASE_URL, BENCH_PORT } from './config'

export type Actor = 'anon' | 'admin'

export interface DocumentJourney {
  kind: 'document'
  name: string
  as: Actor
  /** A fixed path, or one resolved at run time (seeded ids differ per database). */
  path: string | ((request: APIRequestContext) => Promise<string>)
  /** Part of the breadth sweep over every page (skipped by --core). */
  sweep?: boolean
}

export interface BrowserJourney {
  kind: 'browser'
  name: string
  as: Actor
  /** Unmeasured lead-in, e.g. the page a click-through starts from. */
  setup?: (page: Page) => Promise<void>
  /** The measured interaction. Resolves once its result is on screen. */
  run: (page: Page) => Promise<void>
  /** Puts back what the journey wrote, so every journey measures the seeded data. */
  teardown?: () => Promise<void>
  /** Part of the breadth sweep over every page (skipped by --core). */
  sweep?: boolean
}

export type Journey = DocumentJourney | BrowserJourney

const firstPortalPost = (page: Page) => page.locator('a[href*="/posts/post_"]').first()

let benchDb: postgres.Sql | undefined
const db = () => (benchDb ??= postgres(BENCH_DATABASE_URL, { max: 1, onnotice: () => {} }))

/**
 * A seeded conversation a journey writes to, saved before the write and put
 * back after it: the row as it was, only the messages it had, and none of the
 * events (or the jobs that dispatch them) the write recorded.
 */
function seededConversation(subject: string) {
  let saved: { id: string; row: string; messages: string[]; event: string; job: string } | null =
    null
  return {
    async save() {
      const [conversation] = await db()<{ id: string; row: string }[]>`
        SELECT id, row_to_json(conversations)::text AS row FROM conversations
        WHERE subject = ${subject}`
      if (!conversation) throw new Error(`no seeded conversation "${subject}"`)
      const messages = await db()<{ id: string }[]>`
        SELECT id FROM conversation_messages WHERE conversation_id = ${conversation.id}`
      const [marks] = await db()<{ event: string; job: string }[]>`
        SELECT (SELECT coalesce(max(id), 0) FROM events)::text AS event,
               (SELECT coalesce(max(id), 0) FROM job_queue)::text AS job`
      saved = { ...conversation, messages: messages.map((m) => m.id), ...marks! }
    },
    async restore() {
      if (!saved) return
      const { id, row, messages, event, job } = saved
      saved = null
      const columns = Object.keys(JSON.parse(row)).filter((column) => column !== 'id')
      await db().begin(async (tx) => {
        await tx`DELETE FROM conversation_messages
          WHERE conversation_id = ${id} AND id <> ALL(${messages}::uuid[])`
        await tx`UPDATE conversations SET (${tx(columns)}) = (
          SELECT ${tx(columns)} FROM json_populate_record(NULL::conversations, ${row}::text::json))
          WHERE id = ${id}`
        await tx`DELETE FROM job_queue WHERE id > ${job}`
        await tx`DELETE FROM events WHERE id > ${event}`
      })
    },
  }
}

/** The reply the send-reply journey posts, to a conversation put back afterwards. */
const REPLY = 'Measuring what a reply costs.'
const replyConversation = seededConversation('Bench conversation 2')

/** The unsaved welcome message the portal-draft journey previews. */
const WELCOME_DRAFT = 'Tell us what would make the bench faster.'

/** How long a hover-then-click journey rests the pointer on a link before pressing it. */
const HOVER_MS = 250

/**
 * Click until `ready` shows. A setup step that clicks right after a page load
 * can land before hydration, and that click is lost.
 */
async function clickUntil(target: Locator, ready: Locator) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await target.click()
    const shown = await ready
      .waitFor({ timeout: 1000 })
      .then(() => true)
      .catch(() => false)
    if (shown) return
  }
  await ready.waitFor()
}

/**
 * Run `action`, then wait until the page has had no request in flight for
 * `quietMs`. A navigation's reads include the ones its page makes after it
 * mounts; moving on while one is in flight can abort it, and whether an
 * aborted request reached the server is a race.
 */
async function untilQuiet(page: Page, action: () => Promise<void>, quietMs = 300) {
  const inflight = new Set<unknown>()
  let lastChange = Date.now()
  const started = (request: { resourceType(): string }) => {
    if (request.resourceType() === 'eventsource') return
    inflight.add(request)
    lastChange = Date.now()
  }
  const ended = (request: unknown) => {
    if (inflight.delete(request)) lastChange = Date.now()
  }
  page.on('request', started)
  page.on('requestfinished', ended)
  page.on('requestfailed', ended)
  try {
    await action()
    while (inflight.size > 0 || Date.now() - lastChange < quietMs) {
      await page.waitForTimeout(50)
    }
  } finally {
    page.off('request', started)
    page.off('requestfinished', ended)
    page.off('requestfailed', ended)
  }
}

/**
 * The settings pages a tour clicks through from General, each with the
 * heading that shows once its loader has finished. None embeds a preview
 * frame, so every read counted is the page's own.
 */
const SETTINGS_TOUR = [
  ['/admin/settings/members', 'Members & Teams'],
  ['/admin/settings/security/authentication', 'Access & Security'],
  ['/admin/settings/developers', 'Developers'],
  ['/admin/settings/integrations', 'Integrations'],
  ['/admin/settings/people', 'People'],
  ['/admin/settings/companies', 'Companies'],
  ['/admin/settings/imports', 'Imports & exports'],
] as const

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

/**
 * Every page reachable without an id that answers 200 on the bench data, loaded
 * both as a document and in a browser. Pages behind a feature the bench data
 * leaves off redirect, and are left out rather than measured as redirects.
 */
const SWEEP_PAGES: { path: string; as: Actor }[] = [
  ...[
    'analytics',
    'automation',
    'automation/agent',
    'automation/connectors',
    'automation/copilot',
    'automation/performance',
    'automation/skills',
    'automation/workflows',
    'changelog',
    'feedback',
    'help-center',
    'inbox',
    'moderation',
    'notifications',
    'roadmap',
    'users?sort=newest',
  ].map((page) => ({ path: `/admin/${page}`, as: 'admin' as const })),
  ...[
    'billing',
    'boards',
    'changelog',
    'channels',
    'channels/email',
    'channels/github',
    'channels/messenger',
    'companies',
    'conversation-data',
    'developers',
    'domains',
    'feedback',
    'general',
    'help-center',
    'imports',
    'integrations',
    'labs',
    'macros',
    'members',
    'members/roles/new',
    'moderation',
    'notifications',
    'office-hours',
    'people',
    'portal',
    'security/authentication',
    'security/sso/new',
    'sla',
    'statuses',
    'support',
    'tags',
    'ticket-statuses',
    'ticket-types',
    'widget',
    'widget/install',
  ].map((page) => ({ path: `/admin/settings/${page}`, as: 'admin' as const })),
  ...['/roadmap', '/changelog', '/hc', '/support', '/notifications'].map((path) => ({
    path,
    as: 'anon' as const,
  })),
  ...['/settings/profile', '/settings/preferences', '/notifications', '/support'].map((path) => ({
    path,
    as: 'admin' as const,
  })),
]

function sweepJourneys(): Journey[] {
  return SWEEP_PAGES.flatMap(({ path, as }): Journey[] => [
    { kind: 'document', name: `sweep:doc:${as}:${path}`, as, path, sweep: true },
    {
      kind: 'browser',
      name: `sweep:ui:${as}:${path}`,
      as,
      sweep: true,
      run: async (page) => {
        await page.goto(path, { waitUntil: 'load' })
      },
    },
  ])
}

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
    // The trending post above has no comments. The most voted one has, so this
    // is what rendering a comment thread adds to opening a post.
    kind: 'browser',
    name: 'ui:portal-open-post-with-comments',
    as: 'anon',
    setup: async (page) => {
      await page.goto('/?sort=top')
      await firstPortalPost(page).waitFor()
    },
    run: async (page) => {
      await firstPortalPost(page).click()
      await page.waitForURL(/\/posts\/post_/)
      await page.locator('[id^="comment-"]').first().waitFor()
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
  {
    // From a page that has not read the roadmap's lists (statuses, boards,
    // tags, segments), so the loader fetches every one of them.
    kind: 'browser',
    name: 'ui:admin-nav-inbox-to-roadmap',
    as: 'admin',
    setup: async (page) => {
      await page.goto('/admin/inbox')
      await page.getByText('Bench conversation').first().waitFor()
    },
    run: async (page) => {
      await page.locator('a[href="/admin/roadmap"]').first().click()
      await page.waitForURL(/\/admin\/roadmap/)
      await page.getByRole('heading').first().waitFor()
    },
  },

  // The same click-throughs the way a person makes them: the pointer rests on
  // the link long enough for the router's intent preload to start before the
  // press (and the focus the press gives the link) lands.
  {
    kind: 'browser',
    name: 'ui:portal-hover-open-post',
    as: 'anon',
    setup: async (page) => {
      await page.goto('/?sort=trending')
      await firstPortalPost(page).waitFor()
    },
    run: async (page) => {
      await firstPortalPost(page).hover()
      await page.waitForTimeout(HOVER_MS)
      await firstPortalPost(page).click()
      await page.waitForURL(/\/posts\/post_/)
      await page.getByRole('heading', { level: 1 }).first().waitFor()
    },
  },
  {
    kind: 'browser',
    name: 'ui:admin-hover-nav-feedback-to-roadmap',
    as: 'admin',
    setup: async (page) => {
      await page.goto('/admin/feedback')
      await page.locator('[data-post-id]').first().waitFor()
    },
    run: async (page) => {
      const link = page.locator('a[href="/admin/roadmap"]').first()
      await link.hover()
      await page.waitForTimeout(HOVER_MS)
      await link.click()
      await page.waitForURL(/\/admin\/roadmap/)
      await page.getByRole('heading').first().waitFor()
    },
  },

  // Interactions, where re-rendering shows: typing, opening, switching.
  {
    kind: 'browser',
    name: 'ui:admin-feedback-type-search',
    as: 'admin',
    setup: async (page) => {
      await page.goto('/admin/feedback')
      await page.locator('[data-post-id]').first().waitFor()
    },
    run: async (page) => {
      const search = page
        .getByRole('searchbox')
        .or(page.getByPlaceholder(/search/i))
        .first()
      await search.click()
      await search.pressSequentially('export', { delay: 60 })
      await page.waitForURL(/search=export|q=export/).catch(() => {})
    },
  },
  {
    kind: 'browser',
    name: 'ui:admin-inbox-open-conversation',
    as: 'admin',
    setup: async (page) => {
      await page.goto('/admin/inbox')
      await page.getByText('Bench conversation 1').first().waitFor()
    },
    run: async (page) => {
      await page.getByText('Bench conversation 1').first().click()
      await page.getByText('Bench conversation 1 - visitor message one').first().waitFor()
    },
  },
  {
    kind: 'browser',
    name: 'ui:portal-post-type-comment',
    as: 'admin',
    setup: async (page) => {
      await page.goto(await firstPostPath(page.request))
      await page.getByRole('heading', { level: 1 }).first().waitFor()
    },
    run: async (page) => {
      const composer = page.getByRole('textbox', { name: /comment/i }).first()
      await composer.click()
      await page.locator('[contenteditable="true"]').first().waitFor()
      await page.keyboard.type('Measuring what a keystroke costs.', { delay: 30 })
    },
  },
  // Typing alone: the editor is mounted and focused before the measured part.
  {
    kind: 'browser',
    name: 'ui:admin-post-modal-type-comment',
    as: 'admin',
    setup: async (page) => {
      const html = await (await page.request.get('/admin/feedback')).text()
      const postId = html.match(/data-post-id="(post_[a-z0-9]+)"/)?.[1]
      if (!postId) throw new Error('no post on the admin feedback page')
      await page.goto(`/admin/feedback?post=${postId}`)
      const composer = page.locator('[data-testid="comment-form-editor"] [contenteditable="true"]')
      await clickUntil(page.getByRole('textbox', { name: 'Write a comment...' }), composer)
      await composer.click()
    },
    run: async (page) => {
      await page.keyboard.type('Measuring what a keystroke costs.', { delay: 30 })
    },
  },
  {
    kind: 'browser',
    name: 'ui:admin-inbox-type-reply',
    as: 'admin',
    setup: async (page) => {
      await page.goto('/admin/inbox')
      const composer = page.locator('[contenteditable="true"]').first()
      await clickUntil(page.getByText('Bench conversation 1').first(), composer)
      await page.getByText('Bench conversation 1 - visitor message one').first().waitFor()
      await composer.click()
    },
    run: async (page) => {
      await page.keyboard.type('Measuring what a keystroke costs.', { delay: 30 })
    },
  },
  {
    // Sending a reply: the message lands in the thread and the inbox catches
    // its lists up. The teardown puts the conversation back as seeded, so no
    // journey after it (nor this one, repeated) sees the reply.
    kind: 'browser',
    name: 'ui:admin-inbox-send-reply',
    as: 'admin',
    setup: async (page) => {
      await replyConversation.save()
      await page.goto('/admin/inbox')
      const composer = page.locator('[contenteditable="true"]').first()
      await clickUntil(page.getByText('Bench conversation 2').first(), composer)
      await page.getByText('Bench conversation 2 - visitor message one').first().waitFor()
      await composer.click()
      await page.keyboard.type(REPLY)
    },
    run: async (page) => {
      await page.keyboard.press('Enter')
      await page.locator('[data-message-id]', { hasText: REPLY }).waitFor()
    },
    teardown: () => replyConversation.restore(),
  },
  {
    kind: 'browser',
    name: 'ui:widget-type-message',
    as: 'anon',
    setup: async (page) => {
      await page.goto('/widget')
      await page.getByRole('button', { name: 'Home', exact: true }).waitFor()
      const ask = page.getByRole('button', { name: 'Ask a question' })
      await clickUntil(page.getByRole('button', { name: 'Messages', exact: true }), ask)
      const composer = page.locator('[contenteditable="true"]').first()
      await clickUntil(ask, composer)
      await composer.click()
    },
    run: async (page) => {
      await page.keyboard.type('Measuring what a keystroke costs.', { delay: 30 })
    },
  },
  // The "new post" composers: the title is typed before the measured part.
  {
    kind: 'browser',
    name: 'ui:portal-type-new-post',
    as: 'admin',
    setup: async (page) => {
      await page.goto('/?sort=trending')
      await firstPortalPost(page).waitFor()
      const composer = page.locator('[contenteditable="true"]').first()
      await clickUntil(page.getByRole('textbox', { name: 'Feedback title' }), composer)
      await page.keyboard.type('A keystroke budget')
      await composer.click()
    },
    run: async (page) => {
      await page.keyboard.type('Measuring what a keystroke costs.', { delay: 30 })
    },
  },
  {
    kind: 'browser',
    name: 'ui:widget-type-new-post',
    as: 'anon',
    setup: async (page) => {
      await page.goto('/widget')
      await page.getByRole('button', { name: 'Home', exact: true }).waitFor()
      const title = page.getByRole('textbox', { name: 'Feedback title' })
      await clickUntil(page.getByRole('button', { name: 'Feedback', exact: true }), title)
      await title.click()
      await page.keyboard.type('A keystroke budget')
      const composer = page.locator('[contenteditable="true"]').first()
      await composer.click()
    },
    run: async (page) => {
      await page.keyboard.type('Measuring what a keystroke costs.', { delay: 30 })
    },
  },
  // Typing a new post's title, which also looks for similar posts. The composer
  // is open (its editor mounted) before the measured part.
  {
    kind: 'browser',
    name: 'ui:portal-type-post-title',
    as: 'admin',
    setup: async (page) => {
      await page.goto('/?sort=trending')
      await firstPortalPost(page).waitFor()
      const title = page.getByRole('textbox', { name: 'Feedback title' })
      await clickUntil(title, page.locator('[contenteditable="true"]').first())
      await title.click()
    },
    run: async (page) => {
      await page.keyboard.type('Measuring what a keystroke costs.', { delay: 30 })
    },
  },
  {
    kind: 'browser',
    name: 'ui:widget-type-post-title',
    as: 'anon',
    setup: async (page) => {
      await page.goto('/widget')
      await page.getByRole('button', { name: 'Home', exact: true }).waitFor()
      const title = page.getByRole('textbox', { name: 'Feedback title' })
      await clickUntil(page.getByRole('button', { name: 'Feedback', exact: true }), title)
      // The composer opens on the first character.
      await title.click()
      await page.keyboard.type('M')
      await page.locator('[contenteditable="true"]').first().waitFor()
      await title.click()
    },
    run: async (page) => {
      await page.keyboard.type('easuring what a keystroke costs.', { delay: 30 })
    },
  },
  {
    kind: 'browser',
    name: 'ui:widget-switch-tabs',
    as: 'anon',
    setup: async (page) => {
      await page.goto('/widget')
      await page.getByRole('button', { name: 'Home', exact: true }).waitFor()
    },
    run: async (page) => {
      await page.getByRole('button', { name: 'Help', exact: true }).click()
      await page.getByRole('textbox', { name: 'Search help articles' }).waitFor()
      await page.getByRole('button', { name: 'Changelog', exact: true }).click()
      await page
        .getByRole('heading', { name: 'Latest' })
        .or(page.getByText('No updates yet'))
        .first()
        .waitFor()
      await page.getByRole('button', { name: 'Home', exact: true }).click()
    },
  },
  {
    kind: 'browser',
    name: 'ui:admin-settings-click-through',
    as: 'admin',
    setup: async (page) => {
      await page.goto('/admin/settings/general')
      await page.getByRole('heading').first().waitFor()
    },
    run: async (page) => {
      // Each step waits for that page's own data, not just its heading: the
      // heading renders first, and moving on before the data arrived made the
      // count depend on timing.
      await page.locator('a[href="/admin/settings/portal"]').first().click()
      await page.waitForURL('/admin/settings/portal')
      await page.getByRole('main').getByRole('switch').first().waitFor()
      // The portal preview is a whole portal in a frame, with reads of its
      // own after it hydrates; leaving before they finish made the count a race.
      const preview = await page.locator('iframe[title="Portal preview"]').elementHandle()
      const frame = await preview?.contentFrame()
      await frame?.waitForLoadState('networkidle')
      await page.locator('a[href="/admin/settings/members"]').first().click()
      await page.waitForURL('/admin/settings/members')
      await page.getByText('demo@example.com').first().waitFor()
    },
  },
  {
    // An unsaved welcome message on the portal settings page travels into the
    // portal preview frame as one draft message: what that message re-renders
    // in the frame is what every edit costs there. Nothing is saved.
    kind: 'browser',
    name: 'ui:admin-settings-portal-draft-welcome',
    as: 'admin',
    setup: async (page) => {
      await page.goto('/admin/settings/portal')
      const preview = await page.locator('iframe[title="Portal preview"]').elementHandle()
      const frame = await preview?.contentFrame()
      await frame?.locator('a[href*="/posts/post_"]').first().waitFor()
      await frame?.waitForLoadState('networkidle')
      const welcome = page.locator(
        'xpath=//*[normalize-space()="Welcome message"]/ancestor::*[.//*[@contenteditable="true"]][1]'
      )
      await welcome.locator('[contenteditable="true"]').click()
    },
    run: async (page) => {
      await page.keyboard.insertText(WELCOME_DRAFT)
      await page.frameLocator('iframe[title="Portal preview"]').getByText(WELCOME_DRAFT).waitFor()
    },
  },
  {
    // What a navigation between settings pages costs, page by page: each step
    // is one click on the settings nav, done once the page and every read it
    // makes after mounting have finished.
    kind: 'browser',
    name: 'ui:admin-settings-tour',
    as: 'admin',
    setup: async (page) => {
      await page.goto('/admin/settings/general')
      await page.getByRole('heading', { name: 'General', exact: true }).waitFor()
    },
    run: async (page) => {
      for (const [path, heading] of SETTINGS_TOUR) {
        await untilQuiet(page, async () => {
          await page.locator(`a[href="${path}"]`).first().click()
          await page.waitForURL(path)
          await page.getByRole('heading', { name: heading, exact: true }).first().waitFor()
        })
      }
    },
  },

  ...sweepJourneys(),
]
