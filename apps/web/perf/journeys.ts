/**
 * The journeys the bench measures.
 *
 * Document journeys fetch one server-rendered page and count the work behind
 * it. Browser journeys drive a real page, from a user action to the rendered
 * result, and count the work on both sides of the wire. A journey is only
 * worth keeping if its counts come out identical on every run; the bench
 * checks that with --repeat.
 */
import type { APIRequestContext, Browser, Locator, Page, Request } from '@playwright/test'
import postgres from 'postgres'
import { buildWidgetInstallSnippet } from '../src/lib/shared/widget/install-prompt'
import { BENCH_DATABASE_URL, BENCH_PORT, BENCH_URL } from './config'
import { BENCH_DESIGNS, designedPath, serveDesignFiles, type BenchDesign } from './designs'

export type Actor = 'anon' | 'admin'

export interface DocumentJourney {
  kind: 'document'
  name: string
  as: Actor
  /** A fixed path, or one resolved at run time (seeded ids differ per database). */
  path: string | ((request: APIRequestContext) => Promise<string>)
  /** The suite it belongs to (perf/config.ts BENCH_SUITE); core when left out. */
  suite?: 'designed'
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
  /** Scores how far the content moves during the measured part (cls). */
  layoutShifts?: boolean
  /** A phone's screen instead of a 1440 by 900 desktop. */
  device?: 'phone'
  /** The suite it belongs to (perf/config.ts BENCH_SUITE); core when left out. */
  suite?: 'designed'
  /** Part of the breadth sweep over every page (skipped by --core). */
  sweep?: boolean
  /**
   * Also measures what the run felt like (see interaction.ts): long tasks, the
   * slowest event to paint, missed frames, messages across frames and the
   * renders in child frames.
   */
  interaction?: boolean
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
  ['/admin/settings/people', 'Users'],
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
    'changelog',
    'feedback',
    'help-center',
    'inbox',
    'feedback/moderation',
    'notifications',
    'roadmap',
    'users?sort=newest',
  ].map((page) => ({ path: `/admin/${page}`, as: 'admin' as const })),
  ...[
    'agent',
    'billing',
    'boards',
    'changelog',
    'channels',
    'channels/email',
    'channels/github',
    'channels/messenger',
    'companies',
    'connectors',
    'conversation-data',
    'copilot',
    'developers',
    'domains',
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
    'skills',
    'sla',
    'statuses',
    'tags',
    'ticket-statuses',
    'ticket-types',
    'widget',
    'widget/install',
    'workflows',
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

/**
 * The designed portals (perf/designs.ts), each as its document and as a
 * visitor loads it on a desktop and on a phone, scored on how far its content
 * moves as it draws. Their own suite: PERF_SUITE=designed.
 */
function designedJourneys(): Journey[] {
  const load =
    (design: BenchDesign, path = '/') =>
    async (page: Page) => {
      await serveDesignFiles(page)
      await page.goto(designedPath(design, path))
      await page.locator('[data-qb-part=band]').first().waitFor()
      await firstPortalPost(page).waitFor()
    }
  return [
    ...BENCH_DESIGNS.flatMap((design): Journey[] => [
      {
        kind: 'document',
        name: `doc:designed:${design}`,
        as: 'anon',
        path: designedPath(design),
        suite: 'designed',
      },
      {
        kind: 'browser',
        name: `ui:designed:${design}-load`,
        as: 'anon',
        suite: 'designed',
        layoutShifts: true,
        run: load(design),
      },
      {
        kind: 'browser',
        name: `ui:designed:${design}-load:phone`,
        as: 'anon',
        suite: 'designed',
        device: 'phone',
        layoutShifts: true,
        run: load(design),
      },
    ]),
    // The pages whose posts arrive after the page: a roadmap's columns, by
    // groups down the page (kiln) and as a board (juniper), and the changelog.
    ...(
      [
        ['kiln', '/roadmap'],
        ['juniper', '/roadmap'],
        ['juniper', '/changelog'],
      ] as const
    ).map(([design, path]): Journey => ({
      kind: 'browser',
      name: `ui:designed:${design}-${path.slice(1)}:phone`,
      as: 'anon',
      suite: 'designed',
      device: 'phone',
      layoutShifts: true,
      run: async (page) => {
        await serveDesignFiles(page)
        await page.goto(designedPath(design, path))
        // Done once the page's own posts are in, with no placeholder left.
        await page
          .locator(path === '/changelog' ? '[data-qb-section=entries]' : '.roadmap-card')
          .first()
          .waitFor()
        await page.waitForFunction(() => !document.querySelector('[data-qb-skeleton]'))
      },
    })),
  ]
}

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
    layoutShifts: true,
    run: async (page) => {
      await page.goto('/?sort=trending')
      await firstPortalPost(page).waitFor()
    },
  },
  {
    kind: 'browser',
    name: 'ui:portal-open-post',
    as: 'anon',
    layoutShifts: true,
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
    layoutShifts: true,
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
    layoutShifts: true,
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
    layoutShifts: true,
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
      await clickUntil(page.getByRole('textbox', { name: 'Write a comment…' }), composer)
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
    //
    // The send's response and the stream's echo of the conversation race, and
    // when the echo lands first the thread renders once more. That render used
    // to re-render every closed menu, dialog and detail-panel control (about
    // 100 renders, so the count read either 621 or 721); with those memoised
    // it costs about 20, inside the tolerance. If the count starts reading two
    // values again, budget it at the higher one with --update --repeat.
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
      await clickUntil(page.getByRole('textbox', { name: 'Post title' }), composer)
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
      const title = page.getByRole('textbox', { name: 'Post title' })
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
      const title = page.getByRole('textbox', { name: 'Post title' })
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
      const title = page.getByRole('textbox', { name: 'Post title' })
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
  ...designedJourneys(),
]

// ---------------------------------------------------------------------------
// The customer portal builder, /design
// ---------------------------------------------------------------------------

/*
 * The design engine is a Labs switch, off in the bench data, so every journey
 * above measures the portal as it is. Each builder journey turns the engine on
 * in its setup and off in its teardown, as an admin does in Labs, from a
 * context of its own, so the measured page starts blank. What the journey
 * wrote to the draft, or published, is put back as it was.
 */

/** The bench admin's session, which bench.ts saves before any journey runs. */
const ADMIN_STATE = new URL('./.results/admin-state.json', import.meta.url).pathname

/** The bench's browser, kept from a setup for the teardown that follows it. */
let builderBrowser: Browser | null = null

/** Turns the design engine on or off in Labs, and reads the settings back in once it moved. */
async function switchDesignEngine(browser: Browser, on: boolean): Promise<void> {
  const context = await browser.newContext({ baseURL: BENCH_URL, storageState: ADMIN_STATE })
  try {
    const page = await context.newPage()
    await page.goto('/admin/settings/labs')
    const toggle = page.locator('#labs-portalDesignV2')
    await toggle.waitFor()
    if ((await toggle.getAttribute('aria-checked')) === String(on)) return
    // A click before the page has hydrated is lost, so it is made until the switch moves.
    await untilQuiet(page, async () => {
      await clickUntil(toggle, page.locator(`#labs-portalDesignV2[aria-checked="${on}"]`))
    })
    // The switch emptied the settings cache; the next journey finds it full again, as before.
    await page.reload()
    await toggle.waitFor()
    await context.request.get('/')
  } finally {
    await context.close()
  }
}

/** The published design and its draft, saved before a builder journey and put back after it. */
function savedDesign() {
  let saved: { row: string; revision: number; at: string; event: string; job: string } | null = null
  return {
    async save() {
      const [design] = await db()<{ row: string }[]>`
        SELECT row_to_json(portal_designs)::text AS row FROM portal_designs`
      if (!design) throw new Error('no portal design: run bun perf/setup-db.ts')
      const [marks] = await db()<{ revision: number; at: string; event: string; job: string }[]>`
        SELECT (SELECT coalesce(max(number), 0) FROM portal_design_revisions)::int AS revision,
               now()::text AS at,
               (SELECT coalesce(max(id), 0) FROM events)::text AS event,
               (SELECT coalesce(max(id), 0) FROM job_queue)::text AS job`
      saved = { row: design.row, ...marks! }
    },
    async restore() {
      if (!saved) return
      const { row, revision, at, event, job } = saved
      saved = null
      const { id } = JSON.parse(row) as { id: string }
      const columns = Object.keys(JSON.parse(row)).filter((column) => column !== 'id')
      await db().begin(async (tx) => {
        await tx`UPDATE portal_designs SET (${tx(columns)}) = (
          SELECT ${tx(columns)} FROM json_populate_record(NULL::portal_designs, ${row}::text::json))
          WHERE id = ${id}`
        await tx`DELETE FROM portal_design_revisions WHERE design_id = ${id} AND number > ${revision}`
        await tx`DELETE FROM portal_design_saved WHERE created_at >= ${at}::timestamptz`
        await tx`DELETE FROM audit_log WHERE occurred_at >= ${at}::timestamptz`
        await tx`DELETE FROM job_queue WHERE id > ${job}`
        await tx`DELETE FROM events WHERE id > ${event}`
      })
    },
  }
}

const builderDesign = savedDesign()

const canvas = (page: Page) => page.frameLocator('iframe[data-designer-canvas]')
const properties = (page: Page) => page.getByRole('complementary', { name: 'Properties' })
const topBar = (page: Page) => page.getByRole('banner')

/** Until the canvas draws the page the builder shows, ready to pick from. */
async function canvasReady(page: Page) {
  await page.locator('[data-canvas-box][aria-busy="false"]').waitFor()
  await canvas(page).locator('style[data-preview-designer]').waitFor({ state: 'attached' })
  await canvas(page).locator('[data-qb-section]').first().waitFor()
}

/** Whether a request is the draft's save, which follows a change by a moment. */
const isDraftSave = (request: Request) =>
  request.method() === 'POST' && /"design","revision"/.test(request.postData() ?? '')

/** Runs `action`, then waits until the save of the draft it changed has finished. */
async function untilDraftSaved(page: Page, action: () => Promise<void>) {
  const saved = page.waitForResponse((res) => isDraftSave(res.request()))
  await action()
  await saved
}

/** Runs `action`, a change, then waits until the draft's save has started (settling waits out the rest). */
async function untilDraftSaving(page: Page, action: () => Promise<void>) {
  const saving = page.waitForRequest(isDraftSave)
  await action()
  await saving
}

/**
 * The lead-in every builder journey shares: the engine on, the design saved to
 * put back, the one-time hints taken as seen (so none covers what a journey
 * works), and with `open`, the builder open on Home with its canvas drawn.
 */
async function builderSetup(page: Page, { open = true } = {}) {
  builderBrowser = page.context().browser()
  await switchDesignEngine(builderBrowser!, true)
  await builderDesign.save()
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem
    Storage.prototype.getItem = function (key: string) {
      return key.startsWith('quackback:designer-coach-') ? '1' : get.call(this, key)
    }
  })
  if (!open) return
  await page.goto('/design?path=/')
  await canvasReady(page)
}

async function builderTeardown() {
  await builderDesign.restore()
  if (builderBrowser) await switchDesignEngine(builderBrowser, false)
}

/** Home's headline on the canvas, which these journeys retype and restyle. */
const headline = (page: Page) => canvas(page).locator('[data-qb-words="home.title"]')

/** Picks Home's headline on the canvas, so its own settings show. */
async function pickHeadline(page: Page) {
  await headline(page).click()
  await properties(page).getByRole('heading', { name: 'Headline', level: 2 }).waitFor()
}

/** The headline's size as the canvas draws it. */
const headlineSize = (page: Page) =>
  headline(page).evaluate((element) => getComputedStyle(element).fontSize)

/** Waits until the canvas draws the headline at `size`. */
async function untilHeadlineSize(page: Page, size: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await headlineSize(page).catch(() => null)) === size) return
    await page.waitForTimeout(25)
  }
  throw new Error(`the canvas never drew the headline at ${size}`)
}

/** Waits until the canvas draws the headline at a size other than `from`, and holds it. */
async function untilHeadlineResized(page: Page, from: string) {
  let last = from
  let held = 0
  for (let attempt = 0; attempt < 200 && held < 4; attempt++) {
    const now = await headlineSize(page).catch(() => from)
    held = now !== from && now === last ? held + 1 : 0
    last = now
    await page.waitForTimeout(25)
  }
  if (held < 4) throw new Error(`the canvas never drew the headline at a new size`)
}

/** A tile of the picked part's settings, such as a text size, in the group named `group`. */
const tile = (page: Page, group: 'Text size' | 'Text colour', name: string) =>
  properties(page)
    .getByRole('radiogroup', { name: group })
    .getByRole('radio', { name, exact: true })

/** What the headline is retyped to, letter by letter (about 20 characters). */
const TYPED_HEADLINE = 'Tell us what to build'

/** How far a scrub drags: one step every SCRUB_PX (4 px), twenty steps. */
const SCRUB_STEPS = 20
const SCRUB_PX = 4

/**
 * The ten steps the undo and redo journey walks: the headline's text size and
 * its colour by turns, so no two in a row are the same change, which undo
 * would take back as one.
 */
const UNDO_STEPS = [
  ['Large', 'Brand colour'],
  ['Display', 'Text'],
  ['Standard', 'Brand colour'],
  ['Large', 'Text'],
  ['Display', 'Brand colour'],
].flatMap(([size, colour]) => [
  { group: 'Text size' as const, name: size! },
  { group: 'Text colour' as const, name: colour! },
])

/** The headline's size once the publish journey's change is drawn. */
let publishedSize = ''

journeys.push(
  {
    // From a blank tab to the canvas showing the portal, ready to pick from.
    kind: 'browser',
    name: 'ui:builder-open',
    as: 'admin',
    interaction: true,
    setup: (page) => builderSetup(page, { open: false }),
    run: async (page) => {
      await page.goto('/design?path=/')
      await canvasReady(page)
    },
    teardown: builderTeardown,
  },
  {
    // A click on a Home block on the canvas: the block is picked, its settings open.
    // Then the block beside it, which the outline and chip glide to.
    kind: 'browser',
    name: 'ui:builder-pick-block',
    as: 'admin',
    interaction: true,
    setup: (page) => builderSetup(page),
    run: async (page) => {
      const blocks = canvas(page).locator('[data-qb-section^="block-"]')
      const heading = (name: string) =>
        properties(page).getByRole('heading', { name, level: 2 }).waitFor()
      await blocks.nth(2).click({ position: { x: 6, y: 6 } })
      await heading('Top posts')
      await page
        .locator('[data-chip-for="' + (await blocks.nth(2).getAttribute('data-qb-section')) + '"]')
        .waitFor()
      const next = await blocks.nth(3).getAttribute('data-qb-section')
      await blocks.nth(3).click({ position: { x: 6, y: 6 } })
      await heading('Latest updates')
      await page.locator(`[data-chip-for="${next}"]`).waitFor()
      // Until the outline has glided to it.
      await page.waitForTimeout(250)
    },
    teardown: builderTeardown,
  },
  {
    // Retyping Home's headline where it sits on the canvas, then keeping it with Enter.
    kind: 'browser',
    name: 'ui:builder-type-headline',
    as: 'admin',
    interaction: true,
    setup: async (page) => {
      await builderSetup(page)
      await headline(page).dblclick()
      await canvas(page)
        .locator('[data-qb-words-editing] [contenteditable="true"]')
        .waitFor({ state: 'visible' })
    },
    run: async (page) => {
      await untilDraftSaving(page, async () => {
        await page.keyboard.type(TYPED_HEADLINE, { delay: 30 })
        await page.keyboard.press('Enter')
        await canvas(page)
          .locator('[data-qb-words="home.title"]', { hasText: TYPED_HEADLINE })
          .waitFor()
      })
    },
    teardown: builderTeardown,
  },
  {
    // Dragging the headline's own text size through twenty steps, as a scrub does.
    kind: 'browser',
    name: 'ui:builder-scrub-size',
    as: 'admin',
    interaction: true,
    setup: async (page) => {
      await builderSetup(page)
      await pickHeadline(page)
      // Custom shows the size's own field, unset until it changes.
      await tile(page, 'Text size', 'Custom').click()
      await properties(page)
        .getByRole('slider', { name: /text size/i })
        .waitFor()
    },
    run: async (page) => {
      const handle = properties(page).getByRole('slider', { name: /text size/i })
      const from = Number(await handle.getAttribute('aria-valuenow'))
      const drawn = await headlineSize(page)
      const box = (await handle.boundingBox())!
      const y = box.y + box.height / 2
      await untilDraftSaving(page, async () => {
        await page.mouse.move(box.x + box.width / 2, y)
        await page.mouse.down()
        for (let step = 1; step <= SCRUB_STEPS; step++) {
          await page.mouse.move(box.x + box.width / 2 + step * SCRUB_PX + 1, y)
          await page.waitForTimeout(16)
        }
        await page.mouse.up()
        await handle.and(page.locator(`[aria-valuenow="${from + SCRUB_STEPS}"]`)).waitFor()
        await untilHeadlineResized(page, drawn)
      })
    },
    teardown: builderTeardown,
  },
  {
    // Another page from the switcher, then the phone's width.
    kind: 'browser',
    name: 'ui:builder-switch-page-device',
    as: 'admin',
    interaction: true,
    setup: (page) => builderSetup(page),
    run: async (page) => {
      await topBar(page)
        .getByRole('button', { name: /^Page:/ })
        .click()
      await page.getByRole('option', { name: 'Changelog', exact: true }).click()
      await topBar(page)
        .getByRole('button', { name: /^Page:\s*Changelog/ })
        .waitFor()
      await canvasReady(page)
      await page.getByRole('radio', { name: 'Phone' }).click()
      await page.getByText('Phone, 390 px wide').waitFor()
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLIFrameElement>('iframe[data-designer-canvas]')?.style.width ===
          '390px'
      )
      await canvasReady(page)
    },
    teardown: builderTeardown,
  },
  {
    // The canvas in dark, from the View menu, and back to light: the page the canvas
    // shows, drawn in the other mode.
    kind: 'browser',
    name: 'ui:builder-switch-theme',
    as: 'admin',
    interaction: true,
    setup: (page) => builderSetup(page),
    run: async (page) => {
      for (const [theme, drawn] of [
        ['Dark', 'html.dark'],
        ['Light', 'html:not(.dark)'],
      ] as const) {
        await page.locator('[data-view-menu]').click()
        await page
          .getByRole('radiogroup', { name: 'Preview as' })
          .getByRole('radio', { name: theme, exact: true })
          .click()
        await page.keyboard.press('Escape')
        await canvas(page).locator(drawn).waitFor({ state: 'attached' })
        await canvasReady(page)
      }
    },
    teardown: builderTeardown,
  },
  {
    // The Theme sheet, over the properties.
    kind: 'browser',
    name: 'ui:builder-open-theme',
    as: 'admin',
    interaction: true,
    setup: (page) => builderSetup(page),
    run: async (page) => {
      await page.locator('[data-sheet-button="theme"]').click()
      const sheet = page.getByRole('region', { name: 'Theme' })
      await sheet.waitFor()
      await sheet.getByText('Brand colour').first().waitFor()
    },
    teardown: builderTeardown,
  },
  {
    // Folding Ask AI's pane to its rail and opening it again, the canvas taking the room.
    kind: 'browser',
    name: 'ui:builder-fold-ai',
    as: 'admin',
    interaction: true,
    setup: (page) => builderSetup(page),
    run: async (page) => {
      const pane = page.locator('#designer-ai-pane')
      const open = Math.round((await pane.boundingBox())?.width ?? 0)
      await pane.getByRole('button', { name: 'Collapse Ask AI' }).click()
      await page.waitForFunction(
        () => (document.getElementById('designer-ai-pane')?.getBoundingClientRect().width ?? 0) < 60
      )
      await pane.getByRole('button', { name: 'Ask AI', exact: true }).click()
      await page.waitForFunction(
        (to) =>
          Math.round(
            document.getElementById('designer-ai-pane')?.getBoundingClientRect().width ?? 0
          ) === to,
        open
      )
    },
    teardown: builderTeardown,
  },
  {
    // Ten steps back with Ctrl+Z and ten forward again.
    kind: 'browser',
    name: 'ui:builder-undo-redo',
    as: 'admin',
    interaction: true,
    setup: async (page) => {
      await builderSetup(page)
      await pickHeadline(page)
      await untilDraftSaved(page, async () => {
        for (const { group, name } of UNDO_STEPS) await tile(page, group, name).click()
      })
    },
    run: async (page) => {
      const undo = topBar(page).getByRole('button', { name: 'Undo', exact: true })
      const redo = topBar(page).getByRole('button', { name: 'Redo', exact: true })
      await untilDraftSaving(page, async () => {
        // As a held key repeats them, about 25 a second.
        for (let i = 0; i < UNDO_STEPS.length; i++) {
          await page.keyboard.press('ControlOrMeta+z')
          await page.waitForTimeout(40)
        }
        await undo.and(page.locator('[aria-disabled="true"]')).waitFor()
        for (let i = 0; i < UNDO_STEPS.length; i++) {
          await page.keyboard.press('ControlOrMeta+Shift+z')
          await page.waitForTimeout(40)
        }
        await redo.and(page.locator('[aria-disabled="true"]')).waitFor()
      })
    },
    teardown: builderTeardown,
  },
  {
    // Publish, from the click to the dialog closed, the canvas drawing the published
    // design and the top bar saying there is nothing left to publish.
    kind: 'browser',
    name: 'ui:builder-publish',
    as: 'admin',
    interaction: true,
    setup: async (page) => {
      await builderSetup(page)
      await pickHeadline(page)
      await untilDraftSaved(page, () => tile(page, 'Text size', 'Large').click())
      await topBar(page)
        .getByRole('button', { name: /1 change/ })
        .waitFor()
      publishedSize = await headlineSize(page)
    },
    run: async (page) => {
      await topBar(page).getByRole('button', { name: 'Publish', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: /Publish 1 change/ })
      await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      await topBar(page)
        .getByRole('button', { name: /No changes/ })
        .waitFor()
      await canvasReady(page)
      await untilHeadlineSize(page, publishedSize)
    },
    teardown: builderTeardown,
  }
)
