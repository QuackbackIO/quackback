/**
 * A widget visitor driven from the test process, through the same calls the
 * widget makes: an anonymous sign-in (Bearer token, like the widget's
 * localStorage token), the widget server functions, and the visitor's own
 * conversation stream with a minted stream token.
 *
 *   const visitor = await createVisitor(playwright)
 *   const { conversationId } = await visitor.send(`hello ${marker}`)
 *   const stream = await visitor.openStream(conversationId)
 *
 * Use a real browser (`/e2e/widget`) when the journey is about what the widget
 * shows; use this for what the visitor's stream carries.
 */
import {
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { supportDb } from './db'
import { supportEnv } from './env'
import { callServerFn } from './server-fns'
import { openStream, type OpenStream } from './streams'

export interface TestVisitor {
  /** Signed in as the visitor (Bearer). */
  api: APIRequestContext
  bearer: string
  /** Send a message; with no id it starts a new conversation. */
  send: (
    content: string,
    conversationId?: string
  ) => Promise<{ conversationId: string; messageId: string }>
  /** A fresh stream token (valid for about two minutes). */
  streamToken: () => Promise<string>
  /** The visitor's conversation stream. */
  openStream: (conversationId: string, lastEventId?: string) => Promise<OpenStream>
  /** The visitor's principal TypeID. */
  principalId: () => Promise<string>
  /** The visitor's display name. */
  name: string
  dispose: () => Promise<void>
}

/**
 * Open the widget (`/widget`, the page the SDK iframes) in a new browser
 * context as this visitor: their token is put where the widget keeps it, so
 * the widget shows the same conversations the API visitor started. Opens the
 * Messages tab, and the conversation whose text is `openText` when given.
 */
export async function openWidgetAs(
  browser: Browser,
  visitor: TestVisitor,
  openText?: string
): Promise<Page> {
  const context = await browser.newContext()
  const origin = new URL(supportEnv().baseUrl).origin
  await context.addInitScript(
    ([key, token]) => {
      try {
        window.localStorage.setItem(key, token)
      } catch {
        // storage blocked: the widget mints its own visitor instead
      }
    },
    [
      `quackback:anon-token:${origin}`,
      JSON.stringify({ token: visitor.bearer, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }),
    ] as const
  )
  const page = await context.newPage()
  page.on('close', () => void context.close().catch(() => {}))
  await page.goto('/widget')
  await expect(async () => {
    await page.getByRole('button', { name: 'Messages', exact: true }).click()
    if (openText) {
      await page.getByText(openText).first().click({ timeout: 2_000 })
    }
  }).toPass({ timeout: 20_000 })
  return page
}

export async function createVisitor(
  playwright: PlaywrightWorkerArgs['playwright']
): Promise<TestVisitor> {
  const baseURL = supportEnv().baseUrl
  // What the anonymous sign-in writes (an anonymous user, its principal and a
  // widget session), minted here so the sign-in rate limit never applies.
  const sql = supportDb()
  const suffix = randomBytes(12).toString('hex')
  const userUuid = toUuid(generateId('user'))
  const principalUuid = toUuid(generateId('principal'))
  const token = randomBytes(24).toString('base64url')
  const name = `Visitor ${suffix.slice(0, 6)}`
  await sql.begin(async (tx) => {
    await tx`INSERT INTO "user" (id, name, email, email_verified, is_anonymous, created_at, updated_at)
             VALUES (${userUuid}, ${name}, ${`temp-${suffix}@anon.quackback.io`}, false, true, NOW(), NOW())`
    await tx`INSERT INTO principal (id, user_id, role, type, display_name, created_at)
             VALUES (${principalUuid}, ${userUuid}, 'user', 'anonymous', ${name}, NOW())`
    await tx`INSERT INTO session (id, expires_at, token, created_at, updated_at, user_agent, scope, user_id)
             VALUES (${randomUUID()}, ${new Date(Date.now() + 24 * 60 * 60 * 1000)}, ${token}, NOW(), NOW(),
                     'support-e2e', 'widget', ${userUuid})`
  })
  const signature = createHmac('sha256', supportEnv().app.SECRET_KEY).update(token).digest('base64')
  const bearer = `${token}.${signature}`
  const api = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${bearer}` },
  })

  const streamToken = async () => {
    const r = await callServerFn<{ token: string }>(
      api,
      'widgetMintConversationStreamTokenFn',
      undefined,
      { method: 'GET' }
    )
    if (!r.ok) throw new Error(`stream token refused: ${r.error.slice(0, 300)}`)
    return r.data.token
  }

  const principal = fromUuid('principal', principalUuid)
  return {
    api,
    bearer,
    send: async (content, conversationId) => {
      const r = await callServerFn<{
        conversation?: { id: string; visitorPrincipalId?: string }
        message?: { id: string; author?: { principalId?: string } }
        conversationId?: string
      }>(api, 'widgetSendConversationMessageFn', {
        content,
        ...(conversationId ? { conversationId } : {}),
      })
      if (!r.ok) throw new Error(`visitor send refused: ${r.error.slice(0, 300)}`)
      const id = r.data.conversation?.id ?? r.data.conversationId ?? conversationId
      if (!id || !r.data.message?.id) {
        throw new Error(`unexpected send answer: ${JSON.stringify(r.data).slice(0, 300)}`)
      }
      return { conversationId: id, messageId: r.data.message.id }
    },
    streamToken,
    openStream: async (conversationId, lastEventId) =>
      openStream({
        query: { conversationId, token: await streamToken() },
        ...(lastEventId ? { lastEventId } : {}),
      }),
    principalId: async () => principal,
    name,
    dispose: () => api.dispose(),
  }
}

/**
 * Prove an open admin thread (`/admin/inbox?i=<id>`) is live before acting:
 * the page shows text from the server before it hydrates and opens its
 * stream, and a frame sent meanwhile is never replayed. Repeats the visitor's
 * typing until the thread shows "<visitor> is typing…".
 */
export async function warmUpAgentThread(
  page: Page,
  visitor: TestVisitor,
  conversationId: string
): Promise<void> {
  const indicator = page.getByText(`${visitor.name} is typing…`)
  await expect(async () => {
    await callServerFn(visitor.api, 'widgetSendConversationTypingFn', { conversationId })
    await expect(indicator).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 30_000 })
}

/**
 * Prove an open admin inbox list is live: a visitor keeps writing until the
 * list shows their latest message (each one refreshes a live list).
 */
export async function warmUpInboxList(
  page: Page,
  visitor: TestVisitor,
  marker: string
): Promise<void> {
  let conversationId: string | undefined
  let n = 0
  await expect(async () => {
    const text = `list is live ${n++} ${marker}`
    conversationId = (await visitor.send(text, conversationId)).conversationId
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 1_500 })
  }).toPass({ timeout: 30_000 })
}

/**
 * Prove an open widget thread is live before acting: repeats a teammate's
 * typing until the widget shows the typing dots.
 */
export async function warmUpWidgetThread(
  page: Page,
  agentApi: APIRequestContext,
  conversationId: string
): Promise<void> {
  const dots = page.locator('.animate-bounce').first()
  await expect(async () => {
    await callServerFn(agentApi, 'sendConversationTypingFn', { conversationId })
    await expect(dots).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 30_000 })
}

export type TypingFn = 'sendConversationTypingFn' | 'widgetSendConversationTypingFn'

/**
 * Prove a stream is subscribed before acting: repeat a typing signal until
 * the stream delivers a typing frame for the conversation. The typist must not
 * be the stream's own person (own typing is never echoed): a teammate's api
 * with 'sendConversationTypingFn', or the visitor's with
 * 'widgetSendConversationTypingFn'.
 */
export async function warmUpStream(
  stream: OpenStream,
  conversationId: string,
  typist: { api: APIRequestContext; fn: TypingFn }
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const r = await callServerFn(typist.api, typist.fn, { conversationId })
    if (!r.ok) throw new Error(`typing refused: ${r.error.slice(0, 300)}`)
    try {
      await stream.waitFor(
        (e) => e.event === 'typing' && e.data.conversationId === conversationId,
        750
      )
      return
    } catch {
      // not subscribed yet: signal again
    }
  }
  throw new Error('the stream never delivered a warm-up typing frame')
}
