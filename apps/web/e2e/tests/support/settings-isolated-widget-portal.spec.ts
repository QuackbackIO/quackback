/**
 * Widget and portal journeys that need a workspace-wide setting flipped
 * (support surfaces off, tickets only, prevent replies to closed
 * conversations, office hours, the help center). Every test here is tagged
 * `@isolated`: it skips itself in the shared shards and runs in the
 * support-isolated job, one worker on a database of its own. Each test sets
 * the baseline it depends on (WIDGET_BASELINE: the AI agent neither fronts nor
 * answers) and puts every setting it touched back in `finally`
 * (withSettings), so no test depends on another's settings.
 */
import { randomBytes } from 'node:crypto'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { fakeAi } from '../../support/fake-ai-client'
import {
  SUPPORT_FLAGS_ON,
  WIDGET_BASELINE,
  isolatedSettingsBaseline,
  withEveryTeammateAway,
  withSettings,
} from '../../support/isolated-settings'
import {
  agentApi,
  composer,
  conversationRow,
  messageCount,
  mintCustomer,
  mintSessionToken,
  mintVisitor,
  openWidget,
  openWidgetThread,
  portalContext,
  portalFn,
  seedBlockMessage,
  serverFnId,
  streamStatus,
  visitorSend,
  visitorType,
  widgetFn,
  widgetTab,
} from '../../support/widget-portal'

const baseline = isolatedSettingsBaseline()

test.beforeEach(async () => {
  test.skip(!ISOLATED, ISOLATED_SKIP)
  // Generous: a flipped setting must never outlive its test on a timeout.
  test.setTimeout(120_000)
  await baseline.apply()
})

test.afterEach(async () => {
  await baseline.restore()
})

/** A fresh anonymous visitor with one conversation, its thread open in the widget. */
async function openThread(page: Page, request: APIRequestContext, opening: string, email?: string) {
  const visitor = await mintVisitor(email ? { email } : {})
  const { conversation } = await visitorSend(request, visitor.token, opening)
  const widget = await openWidget(page, { visitorToken: visitor.token })
  await openWidgetThread(widget, opening)
  await expect(widget.getByText(opening)).toBeVisible({ timeout: 15_000 })
  return { visitor, conversation, widget }
}

/** The visitor's own message texts in a conversation, oldest first. */
async function visitorMessages(conversationId: string): Promise<string[]> {
  const rows = await supportDb()`SELECT content FROM conversation_messages
    WHERE conversation_id = ${toUuid(conversationId as `conversation_${string}`)}
      AND sender_type = 'visitor' ORDER BY created_at`
  return rows.map((r) => r.content as string)
}

/**
 * Everyone away, no office hours, an offline message set; a fresh anonymous
 * visitor (a synthetic temp-<id>@anon.quackback.io address, as the anonymous
 * sign-in makes one) opens their thread. Runs `check` with the widget and
 * what getMyConversation told it.
 */
async function anonymousVisitorOffline(
  page: Page,
  request: APIRequestContext,
  marker: string,
  offlineMessage: string,
  check: (widget: ReturnType<Page['frameLocator']>, mine: unknown) => Promise<void>
) {
  await withEveryTeammateAway(() =>
    withSettings(
      {
        feature_flags: SUPPORT_FLAGS_ON,
        widget_config: { ...WIDGET_BASELINE, 'messenger.offlineMessage': offlineMessage },
        metadata: { 'officeHours.enabled': false },
      },
      async () => {
        const visitor = await mintVisitor()
        await supportDb()`UPDATE "user" SET email = ${`temp-${visitor.userUuid}@anon.quackback.io`}
          WHERE id = ${visitor.userUuid}`
        const opening = `${marker} anyone there?`
        const { conversation } = await visitorSend(request, visitor.token, opening)
        const mine = await widgetFn<Record<string, unknown>>(request, 'widgetGetMyConversationFn', {
          bearer: visitor.token,
          data: { conversationId: conversation.id },
        })
        const widget = await openWidget(page, { visitorToken: visitor.token })
        await openWidgetThread(widget, opening)
        await expect(widget.getByText(opening)).toBeVisible({ timeout: 15_000 })
        await check(widget, mine.value)
      }
    )
  )
}

const CLOSED_REFUSAL = {
  code: 'CONVERSATION_CLOSED',
  message: 'This conversation has been closed. Please start a new one.',
}

/** The closed notice when a reply reopens the conversation (the default). */
const CLOSED_REOPENS = 'This conversation was closed. Reply to reopen it.'
/** The closed notice when replies to closed conversations are refused. */
const CLOSED_STARTS_NEW = 'This conversation is closed. Start a new one to message us.'

// ---------------------------------------------------------------------------
// Surfaces off, tickets only
// ---------------------------------------------------------------------------

test.describe('support surfaces switched off', { tag: '@isolated' }, () => {
  test(
    'CUS-W-17 with conversations off every visitor call is refused and the stream is gone',
    { tag: '@nightly' },
    async ({ request, marker }) => {
      const visitor = await mintVisitor()
      // Before the switch: a thread and a stream token the visitor already holds.
      const { conversation } = await visitorSend(request, visitor.token, `${marker} before`)
      const minted = await widgetFn<{ token: string }>(
        request,
        'widgetMintConversationStreamTokenFn',
        { bearer: visitor.token }
      )
      const streamToken = minted.value!.token
      const id = conversation.id

      await withSettings(
        {
          feature_flags: { supportInbox: false, supportTickets: false },
          widget_config: WIDGET_BASELINE,
        },
        async () => {
          const calls = [
            ['widgetSendConversationMessageFn', { conversationId: id, content: `${marker} after` }],
            ['widgetSendConversationMessageFn', { content: `${marker} new thread` }],
            ['widgetListConversationMessagesFn', { conversationId: id }],
            ['widgetMarkConversationReadFn', { conversationId: id }],
            ['widgetSendConversationTypingFn', { conversationId: id }],
            ['widgetSubmitCsatFn', { conversationId: id, rating: 5 }],
          ] as const
          for (const [name, data] of calls) {
            const res = await widgetFn(request, name, { bearer: visitor.token, data })
            expect(res.error, name).toMatchObject({
              code: 'CONVERSATIONS_NOT_ENABLED',
              statusCode: 403,
              message: 'Conversations are not enabled',
            })
          }

          const mine = await widgetFn<Record<string, unknown>>(
            request,
            'widgetGetMyConversationFn',
            {
              bearer: visitor.token,
              data: {},
            }
          )
          expect(mine.value).toMatchObject({ enabled: false, conversation: null, messages: [] })
          const list = await widgetFn<{ conversations: unknown[] }>(
            request,
            'widgetGetMyConversationsFn',
            { bearer: visitor.token }
          )
          expect(list.value?.conversations).toEqual([])

          const stream = await streamStatus(`conversationId=${id}&token=${streamToken}`)
          expect(stream.status).toBe(404)
        }
      )
      // Nothing was written while it was off.
      expect(await messageCount(id)).toBe(1)
      expect((await conversationRow(id)).csat_rating).toBeNull()
    }
  )

  test(
    'CUS-P-02 with both support surfaces off, /support and a thread redirect home',
    { tag: '@nightly' },
    async ({ browser, request, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const { conversation } = await visitorSend(request, token, `${marker} hello`)
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      try {
        // supportTickets off and the inbox flag off; then supportTickets off and
        // the portal chats toggle off. Either way the Support surface is gone.
        const offs = [
          { supportInbox: false, supportTickets: false, portal: true },
          { supportInbox: true, supportTickets: false, portal: false },
        ]
        for (const off of offs) {
          await withSettings(
            {
              feature_flags: { supportInbox: off.supportInbox, supportTickets: off.supportTickets },
              portal_config: { 'support.enabled': off.portal },
              widget_config: WIDGET_BASELINE,
            },
            async () => {
              for (const path of ['/support', `/support/${conversation.id}`]) {
                await page.goto(path)
                await expect(page, `${path} with ${JSON.stringify(off)}`).toHaveURL(/\/(\?.*)?$/, {
                  timeout: 15_000,
                })
                await expect(page.getByText(`${marker} hello`)).toHaveCount(0)
              }
            }
          )
        }
        // Back on (the baseline): the thread opens again.
        await page.goto(`/support/${conversation.id}`)
        await expect(page.getByText(`${marker} hello`)).toBeVisible({ timeout: 15_000 })
      } finally {
        await context.close()
      }
    }
  )

  test(
    'CUS-P-03 a tickets-only workspace lists the threads on /support but offers no chat start',
    { tag: '@nightly' },
    async ({ browser, request, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      await visitorSend(request, token, `${marker} hello`)
      const empty = await mintCustomer({ email: `empty-${customerEmail}` })
      const context = await portalContext(browser, customer)
      const emptyContext = await portalContext(browser, empty)
      const page = await context.newPage()
      const emptyPage = await emptyContext.newPage()
      const newConversation = (p: Page) => p.getByRole('link', { name: 'New conversation' })
      try {
        // The chat start shows while the inbox and the portal chats are on.
        await withSettings(
          {
            feature_flags: SUPPORT_FLAGS_ON,
            portal_config: { 'support.enabled': true },
            widget_config: WIDGET_BASELINE,
          },
          async () => {
            await page.goto('/support')
            await expect(newConversation(page)).toBeVisible({ timeout: 15_000 })
          }
        )
        // Tickets only: the inbox flag off, or the portal chats toggle off.
        const ticketsOnly = [
          { supportInbox: false, portal: true },
          { supportInbox: true, portal: false },
        ]
        for (const only of ticketsOnly) {
          await withSettings(
            {
              feature_flags: { supportInbox: only.supportInbox, supportTickets: true },
              portal_config: { 'support.enabled': only.portal },
              widget_config: WIDGET_BASELINE,
            },
            async () => {
              await page.goto('/support')
              await expect(page.getByRole('heading', { name: 'Support' })).toBeVisible({
                timeout: 15_000,
              })
              await expect(page.getByText(`${marker} hello`)).toBeVisible({ timeout: 15_000 })
              await expect(newConversation(page)).toHaveCount(0)

              await emptyPage.goto('/support')
              await expect(emptyPage.getByText('No conversations yet')).toBeVisible({
                timeout: 15_000,
              })
              await expect(newConversation(emptyPage)).toHaveCount(0)
            }
          )
        }
      } finally {
        await context.close()
        await emptyContext.close()
      }
    }
  )
})

// ---------------------------------------------------------------------------
// Prevent replies to closed conversations
// ---------------------------------------------------------------------------

test.describe('prevent replies to closed conversations', { tag: '@isolated' }, () => {
  const PREVENT = {
    feature_flags: SUPPORT_FLAGS_ON,
    widget_config: { ...WIDGET_BASELINE, 'messenger.preventRepliesWhenClosed': true },
  }

  test(
    'CUS-W-21 a free-text reply to a closed conversation is refused, and a rating is still taken',
    { tag: '@core' },
    async ({ page, request, marker }) => {
      await withSettings(PREVENT, async () => {
        const opening = `${marker} question`
        const { visitor, conversation, widget } = await openThread(page, request, opening)
        await agentApi(request).status(conversation.id, 'closed')
        await expect(widget.getByText('How was your conversation?')).toBeVisible({
          timeout: 15_000,
        })

        // The endpoint refuses the reply with the closed-conversation conflict.
        const refused = await widgetFn(request, 'widgetSendConversationMessageFn', {
          bearer: visitor.token,
          data: { conversationId: conversation.id, content: `${marker} api reply` },
        })
        expect(refused.error).toMatchObject({ ...CLOSED_REFUSAL, statusCode: 409 })

        // From the widget: the reply is not taken and the thread stays closed.
        const reply = `${marker} one more thing`
        await visitorType(widget, reply)
        // The refusal has come back once the notice is raised as an alert.
        await expect(widget.getByRole('alert').filter({ hasText: CLOSED_STARTS_NEW })).toBeVisible({
          timeout: 15_000,
        })
        await expect(composer(widget)).toContainText(reply)
        expect(await visitorMessages(conversation.id)).toEqual([opening])
        expect((await conversationRow(conversation.id)).status).toBe('closed')

        // A rating (the post-close footer) is still accepted.
        await widget.getByRole('button', { name: 'Rate 5 of 5' }).click()
        await widget.getByRole('button', { name: 'Send feedback' }).click()
        await expect(widget.getByText('Thanks for your feedback!')).toBeVisible({
          timeout: 15_000,
        })
        await pollFor('the rating', async () => {
          const row = await conversationRow(conversation.id)
          return row.csat_rating === 5 ? row : null
        })
      })
    }
  )

  test(
    'CUS-W-21 a matched rating-block reply to a closed conversation is accepted; a forged one is refused',
    { tag: '@core' },
    async ({ request, marker }) => {
      await withSettings(PREVENT, async () => {
        const visitor = await mintVisitor()
        const { conversation } = await visitorSend(request, visitor.token, `${marker} hi`)
        await agentApi(request).status(conversation.id, 'closed')
        const blockId = await seedBlockMessage(conversation.id, `${marker} How did we do?`, {
          kind: 'csat',
          allowTypingInterrupt: true,
        })
        const send = (blockReply: Record<string, unknown>) =>
          widgetFn(request, 'widgetSendConversationMessageFn', {
            bearer: visitor.token,
            data: { conversationId: conversation.id, content: '4', blockReply },
          })

        // A block reply that matches nothing on the thread is plain text: refused.
        const forged = await send({
          kind: 'csat',
          inReplyToMessageId: fromUuid('conversation_msg', toUuid(generateId('conversation_msg'))),
          rating: 4,
        })
        expect(forged.error).toMatchObject(CLOSED_REFUSAL)

        const matched = await send({
          kind: 'csat',
          inReplyToMessageId: fromUuid('conversation_msg', blockId),
          rating: 4,
        })
        expect(matched.error).toBeUndefined()
        await pollFor('the block rating', async () => {
          const row = await conversationRow(conversation.id)
          return row.csat_rating === 4 ? row : null
        })
      })
    }
  )

  test(
    'CUS-W-21 the widget tells the visitor a closed conversation takes no replies',
    { tag: '@core' },
    async ({ browser, page, request, marker }) => {
      // A thread loaded before the switch says a reply reopens it; the refused
      // send then says to start a new one, raised as an alert, and keeps the draft.
      const opening = `${marker} question`
      const { conversation, widget } = await openThread(page, request, opening)
      await agentApi(request).status(conversation.id, 'closed')
      await expect(widget.getByText(CLOSED_REOPENS)).toBeVisible({ timeout: 15_000 })
      await withSettings(PREVENT, async () => {
        const draft = `${marker} one more thing`
        await visitorType(widget, draft)
        await expect(widget.getByRole('alert').filter({ hasText: CLOSED_STARTS_NEW })).toBeVisible({
          timeout: 15_000,
        })
        await expect(widget.getByText(CLOSED_REOPENS)).toHaveCount(0)
        await expect(composer(widget)).toContainText(draft)
        expect(await visitorMessages(conversation.id)).toEqual([opening])
        expect((await conversationRow(conversation.id)).status).toBe('closed')

        // A thread loaded with the switch on says so before any send.
        const context = await browser.newContext()
        try {
          const fresh = await openThread(await context.newPage(), request, `${marker} later`)
          await agentApi(request).status(fresh.conversation.id, 'closed')
          await expect(
            fresh.widget.getByRole('status').filter({ hasText: CLOSED_STARTS_NEW })
          ).toBeVisible({ timeout: 15_000 })
          await expect(fresh.widget.getByText(CLOSED_REOPENS)).toHaveCount(0)
        } finally {
          await context.close()
        }
      })
    }
  )

  test(
    'CUS-P-18 with prevent-replies on, a portal reply to a closed thread is refused and a rating is taken',
    { tag: '@core' },
    async ({ browser, request, customerEmail, marker }) => {
      await withSettings(PREVENT, async () => {
        const customer = await mintCustomer({ email: customerEmail })
        const token = await mintSessionToken(customer.userUuid)
        const { conversation } = await visitorSend(request, token, `${marker} closed soon`)
        await agentApi(request).status(conversation.id, 'closed')
        const blockId = await seedBlockMessage(conversation.id, `${marker} Rate us`, {
          kind: 'csat',
          allowTypingInterrupt: true,
        })
        const context = await portalContext(browser, customer)
        try {
          const refused = await portalFn(context.request, 'sendConversationMessageFn', {
            conversationId: conversation.id,
            content: `${marker} reopen please`,
          })
          expect(refused.error).toMatchObject({ ...CLOSED_REFUSAL, statusCode: 409 })

          const page = await context.newPage()
          await page.goto(`/support/${conversation.id}`)
          await expect(page.getByText(`${marker} closed soon`)).toBeVisible({ timeout: 15_000 })
          // The portal thread is the widget's: the same notice, before and after a send.
          await expect(page.getByText(CLOSED_STARTS_NEW)).toBeVisible({ timeout: 15_000 })
          await expect(page.getByText(CLOSED_REOPENS)).toHaveCount(0)
          await visitorType(page, `${marker} typed reply`)
          await expect(page.getByRole('alert').filter({ hasText: CLOSED_STARTS_NEW })).toBeVisible({
            timeout: 15_000,
          })
          await expect(composer(page)).toContainText(`${marker} typed reply`)
          expect((await conversationRow(conversation.id)).status).toBe('closed')
          expect(await visitorMessages(conversation.id)).toEqual([`${marker} closed soon`])

          // A matched rating-block reply is still taken.
          const rated = await portalFn(context.request, 'sendConversationMessageFn', {
            conversationId: conversation.id,
            content: '5',
            blockReply: {
              kind: 'csat',
              inReplyToMessageId: fromUuid('conversation_msg', blockId),
              rating: 5,
            },
          })
          expect(rated.error).toBeUndefined()
          await pollFor('the rating', async () => {
            const row = await conversationRow(conversation.id)
            return row.csat_rating === 5 ? row : null
          })
        } finally {
          await context.close()
        }
      })
    }
  )
})

// ---------------------------------------------------------------------------
// Transport, availability and office hours
// ---------------------------------------------------------------------------

test.describe('transport and availability', { tag: '@isolated' }, () => {
  test(
    'CUS-W-25 in poll mode the widget opens no stream and still shows an agent reply',
    { tag: '@nightly' },
    async ({ page, request, marker }) => {
      // The transport is a deployment setting (CHAT_TRANSPORT_MODE), read by the
      // capabilities handshake: answer that handshake as a poll host would.
      const capabilities = serverFnId(
        'src/lib/server/functions/widget-capabilities.ts',
        'getWidgetCapabilitiesFn'
      )
      let handshakes = 0
      await page.route(`**/_serverFn/${capabilities}*`, async (route) => {
        const res = await route.fetch()
        const body = await res.text()
        if (!body.includes('"live"')) throw new Error(`unexpected capabilities: ${body}`)
        handshakes++
        await route.fulfill({ response: res, body: body.replace('"live"', '"poll"') })
      })
      const streams: string[] = []
      page.on('request', (req) => {
        if (req.url().includes('/api/chat/stream')) streams.push(req.url())
      })

      await withSettings(
        { feature_flags: SUPPORT_FLAGS_ON, widget_config: WIDGET_BASELINE },
        async () => {
          const opening = `${marker} polling`
          const { conversation, widget } = await openThread(page, request, opening)
          expect(handshakes).toBeGreaterThan(0)
          const reply = `${marker} agent answer`
          await agentApi(request).reply(conversation.id, reply)
          // Poll interval is 10 s.
          await expect(widget.getByText(reply)).toBeVisible({ timeout: 25_000 })
          expect(streams).toEqual([])
        }
      )
    }
  )

  test(
    'CUS-W-31 with everyone away and outside office hours the widget says when the team is back',
    { tag: '@core' },
    async ({ browser, request, marker, customerEmail }) => {
      const now = new Date()
      const closedDay = (now.getUTCDay() + 3) % 7
      const offlineMessage = `${marker} we answer by email within a day`
      const allDay = [0, 1, 2, 3, 4, 5, 6].flatMap((day) => [
        { day, start: '00:00', end: '12:00' },
        { day, start: '12:00', end: '00:00' },
      ])
      const schedule = (intervals: unknown[]) => ({
        'officeHours.enabled': true,
        'officeHours.timezone': 'UTC',
        'officeHours.intervals': intervals,
        'officeHours.holidays': [],
      })
      const widgetSettings = {
        ...WIDGET_BASELINE,
        'messenger.offlineMessage': offlineMessage,
      }
      await withEveryTeammateAway(() =>
        withSettings(
          {
            feature_flags: SUPPORT_FLAGS_ON,
            widget_config: widgetSettings,
            metadata: schedule([{ day: closedDay, start: '09:00', end: '10:00' }]),
          },
          async () => {
            const presence = await widgetFn<Record<string, unknown>>(
              request,
              'widgetGetConversationPresenceFn'
            )
            expect(presence.value).toMatchObject({ agentsOnline: false, withinOfficeHours: false })
            expect(presence.value?.nextOpenAt).toEqual(expect.any(String))

            // An identified visitor (a real email): the admin's offline message
            // and the next opening time.
            const context = await browser.newContext()
            const page = await context.newPage()
            try {
              const { widget } = await openThread(page, request, `${marker} hello`, customerEmail)
              await expect(widget.getByText("We'll reply by email")).toBeVisible({
                timeout: 15_000,
              })
              await expect(widget.getByText("We're online")).toHaveCount(0)
              await expect(widget.getByText(offlineMessage)).toBeVisible()
              await expect(
                widget.getByText(
                  /^Back (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) /
                )
              ).toBeVisible()
            } finally {
              await context.close()
            }

            // Inside office hours the team reads as available though nobody is online.
            await withSettings({ metadata: schedule(allDay) }, async () => {
              const open = await browser.newContext()
              const openPage = await open.newPage()
              try {
                const { widget } = await openThread(openPage, request, `${marker} open hours`)
                await expect(widget.getByText("We're online")).toBeVisible({ timeout: 15_000 })
                await expect(
                  widget.getByText("We're away right now", { exact: false })
                ).toHaveCount(0)
              } finally {
                await open.close()
              }
            })
          }
        )
      )
    }
  )

  test(
    'CUS-W-32 an anonymous visitor with nobody online sees the neutral line, not the offline message',
    { tag: '@core' },
    async ({ page, request, marker }) => {
      const offlineMessage = `${marker} we will email you`
      await anonymousVisitorOffline(page, request, marker, offlineMessage, async (widget, mine) => {
        expect(mine).toMatchObject({ visitorHasEmail: false, canEmailVisitor: false })
        await expect(
          widget.getByText(
            "We're away right now. Leave a message and we'll reply here when we're back."
          )
        ).toBeVisible({ timeout: 15_000 })
        await expect(widget.getByText(offlineMessage)).toHaveCount(0)
      })
    }
  )

  test(
    'CUS-W-32 the presence line never promises an anonymous visitor an email reply',
    { tag: '@core' },
    async ({ page, request, marker }) => {
      await anonymousVisitorOffline(page, request, marker, `${marker} offline`, async (widget) => {
        await expect(widget.getByText(/We're away right now/)).toBeVisible({ timeout: 15_000 })
        await expect(widget.getByText("We'll reply here", { exact: true }).first()).toBeVisible()
        await expect(widget.getByText(/by email/i)).toHaveCount(0)
      })
    }
  )
})

// ---------------------------------------------------------------------------
// The help center in the widget
// ---------------------------------------------------------------------------

/** A published, public help article under its own public category. */
async function seedArticle(
  marker: string,
  title: string,
  content: string
): Promise<{ id: string; uuid: string; title: string }> {
  const sql = supportDb()
  const categoryUuid = toUuid(generateId('kb_category'))
  const articleUuid = toUuid(generateId('article'))
  const [author] = await sql`SELECT id FROM principal WHERE role = 'admin' AND type = 'user'
    ORDER BY created_at LIMIT 1`
  const slug = `${marker}-${randomBytes(3).toString('hex')}`
  await sql`INSERT INTO kb_categories (id, slug, name, is_public, position, created_at, updated_at)
    VALUES (${categoryUuid}, ${slug}, ${`Guides ${marker}`}, true, 0, NOW(), NOW())`
  await sql`INSERT INTO kb_articles (id, category_id, slug, title, content, principal_id,
      published_at, created_at, updated_at)
    VALUES (${articleUuid}, ${categoryUuid}, ${slug}, ${title}, ${content}, ${author.id},
      NOW() - interval '1 minute', NOW(), NOW())`
  return { id: fromUuid('article', articleUuid), uuid: articleUuid, title }
}

const HELP_ON = {
  feature_flags: { ...SUPPORT_FLAGS_ON, helpCenter: true },
  widget_config: { ...WIDGET_BASELINE, 'tabs.help': true },
}

test.describe('the help center in the widget', { tag: '@isolated' }, () => {
  test(
    'CUS-W-51 help search finds an article by its title, answers [] for an empty query uncounted, and 404s when off',
    { tag: '@core' },
    async ({ request, marker }) => {
      const word = `zq${randomBytes(4).toString('hex')}`
      const article = await seedArticle(
        marker,
        `Resetting the ${word} gadget`,
        `Hold ${word} down.`
      )
      const ip = `10.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
      const headers = { 'x-e2e-client-ip': ip }
      const bucket = async () => {
        const rows = await supportDb()`SELECT * FROM rate_bucket WHERE key = ${`kbsearch:ip:${ip}`}`
        return rows.length
      }

      await withSettings(HELP_ON, async () => {
        const found = await request.get(
          `/api/widget/kb-search?q=${encodeURIComponent(article.title)}`,
          { headers }
        )
        expect(found.status()).toBe(200)
        const body = (await found.json()) as {
          data: { articles: Array<{ id: string; title: string }> }
        }
        expect(body.data.articles.map((a) => a.title)).toContain(article.title)
        const hit = body.data.articles.find((a) => a.title === article.title)
        expect(toUuid(hit!.id as `article_${string}`)).toBe(article.uuid)
        expect(await bucket()).toBe(1)

        // An empty query answers [] without touching a new address's budget.
        const blankIp = `10.52.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
        const blank = await request.get('/api/widget/kb-search?q=%20', {
          headers: { 'x-e2e-client-ip': blankIp },
        })
        expect(blank.status()).toBe(200)
        expect(await blank.json()).toEqual({ data: { articles: [] } })
        const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM rate_bucket
          WHERE key = ${`kbsearch:ip:${blankIp}`}`
        expect(n).toBe(0)
      })

      await withSettings(
        { feature_flags: { helpCenter: false }, widget_config: WIDGET_BASELINE },
        async () => {
          const off = await request.get(`/api/widget/kb-search?q=${encodeURIComponent(word)}`, {
            headers,
          })
          expect(off.status()).toBe(404)
          expect(await off.json()).toEqual({
            error: { code: 'NOT_FOUND', message: 'Knowledge base not found' },
          })
        }
      )
    }
  )

  test(
    'CUS-W-52 Ask AI in the widget streams a grounded answer with its source, and a miss when nothing matches',
    { tag: '@nightly' },
    async ({ page, marker }) => {
      const word = `zq${randomBytes(4).toString('hex')}`
      const article = await seedArticle(
        marker,
        `Pairing the ${word} remote`,
        `To pair the ${word} remote, hold the blue button for five seconds. ${marker}`
      )
      const answer = `${marker} hold the blue button for five seconds`
      await fakeAi.script({
        marker,
        json: { kind: 'grounded', answer: `${answer} [1].`, sources: [{ articleId: '1' }] },
      })
      try {
        await withSettings(HELP_ON, async () => {
          const probe = await page.request.get('/api/widget/kb-ask')
          expect(await probe.json()).toEqual({ data: { enabled: true } })

          const widget = await openWidget(page)
          await widgetTab(widget, 'Help').click()
          const search = widget.getByRole('textbox', { name: 'Search help articles' })
          await search.fill(`How do I pair the ${word} remote?`)
          await widget.getByRole('button', { name: /^Ask AI about/ }).click()
          await expect(widget.getByText(answer, { exact: false })).toBeVisible({ timeout: 20_000 })
          await expect(widget.getByText('Sources')).toBeVisible()
          await expect(widget.getByRole('button', { name: `1. ${article.title}` })).toBeVisible()

          // A question nothing in the help center matches: the model is never asked.
          const nonsense = `zq${randomBytes(5).toString('hex')} qx${randomBytes(5).toString('hex')}`
          await widget.getByRole('button', { name: 'Dismiss' }).click()
          await search.fill(nonsense)
          await widget.getByRole('button', { name: /^Ask AI about/ }).click()
          await expect(
            widget.getByText("I couldn't find a reliable answer to that in the help articles", {
              exact: false,
            })
          ).toBeVisible({ timeout: 20_000 })
          expect(await fakeAi.requests({ contains: nonsense, endpoint: 'chat' })).toEqual([])
        })
      } finally {
        await fakeAi.clear(marker)
      }
    }
  )

  test(
    'CUS-W-52 Ask AI answers 404 when the help center is off',
    { tag: '@nightly' },
    async ({ request }) => {
      await withSettings(
        { feature_flags: { helpCenter: false }, widget_config: WIDGET_BASELINE },
        async () => {
          const probe = await request.get('/api/widget/kb-ask')
          expect(probe.status()).toBe(404)
          const ask = await request.post('/api/widget/kb-ask', {
            data: {
              threadId: 't',
              runId: 'r',
              messages: [{ id: 'm', role: 'user', content: 'hello' }],
              tools: [],
              context: [],
              state: {},
              forwardedProps: {},
            },
          })
          expect(ask.status()).toBe(404)
          expect(await ask.json()).toEqual({
            error: { code: 'NOT_FOUND', message: 'Knowledge base not found' },
          })
        }
      )
    }
  )
})
