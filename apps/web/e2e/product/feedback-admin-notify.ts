/**
 * Helpers for the feedback notification journeys (FBA-N-*),
 * e2e/tests/feedback/admin-notifications.spec.ts.
 *
 * A "followed post" is a post a fresh customer submitted (author follower)
 * and a second fresh customer voted on (vote follower), on a board only the
 * test uses, so every email and bell found by the customers' addresses or
 * principal ids belongs to this test alone.
 */
import type { APIRequestContext, Browser } from '@playwright/test'
import { callServerFn, type ServerFnResult } from '../support/server-fns'
import { pollFor, supportDb } from '../support/db'
import { waitForEventHandled } from '../support/bells'
import { mailTo, getMail, type MailpitMessage } from '../support/mailpit'
import { mintCustomer, type MintedCustomer } from '../support/widget-portal'
import { ANON_EMAIL_DOMAIN } from '@quackback/email/anon'
import {
  customerPost,
  makeBoard,
  portalCustomer,
  uuid,
  type MadeBoard,
  type PortalCustomer,
} from './feedback-admin'

/** Call a server function and fail with its answer when it throws. */
export async function fn<T = unknown>(
  api: APIRequestContext,
  name: string,
  data?: unknown,
  opts?: { method?: 'GET' | 'POST' }
): Promise<T> {
  const res: ServerFnResult<T> = await callServerFn<T>(api, name, data, opts)
  if (!res.ok) throw new Error(`${name} failed: ${res.raw.slice(0, 400)}`)
  return res.data
}

export interface FollowedPost {
  board: MadeBoard
  postId: string
  title: string
  /** The customer who submitted the post (reason author). */
  author: PortalCustomer
  /** A customer who voted (reason vote). */
  voter: PortalCustomer
  close: () => Promise<void>
}

/** A post on a fresh board, submitted by one fresh customer and voted on by another. */
export async function followedPost(
  admin: APIRequestContext,
  browser: Browser,
  marker: string,
  opts: { boardPreset?: 'public' | 'private' } = {}
): Promise<FollowedPost> {
  const board = await makeBoard(admin, marker, { preset: opts.boardPreset })
  const author = await portalCustomer(browser, `${marker}-a`, { name: `Author ${marker}` })
  const voter = await portalCustomer(browser, `${marker}-v`, { name: `Voter ${marker}` })
  const title = `${marker} followed idea`
  const post = await customerPost(author, {
    boardId: board.id,
    title,
    content: `Details of ${title}`,
  })
  await fn(voter.api, 'toggleVoteFn', { postId: post.id })
  return {
    board,
    postId: post.id,
    title,
    author,
    voter,
    close: async () => {
      await author.close()
      await voter.close()
    },
  }
}

/**
 * Wait until the newest event of `type` about `postId` is fully handled
 * (dispatch and every sink job). After this, a bell or email that is not
 * there is never coming.
 */
export function eventHandled(postId: string, type: string): Promise<string> {
  return waitForEventHandled(postId, { type, timeoutMs: 30_000 })
}

/**
 * Wait until every event about `postId` that exists now is handled (useful
 * before asserting an absence after several actions).
 */
export async function allEventsHandled(postId: string): Promise<void> {
  const sql = supportDb()
  await pollFor(
    `every event about ${postId} handled`,
    async () => {
      const events = await sql<{ event_id: string }[]>`
        SELECT event_id FROM events WHERE payload::text LIKE ${`%${postId}%`}`
      for (const e of events) {
        const [dispatch] = await sql`SELECT status FROM job_queue
          WHERE dedupe_key = ${`event-dispatch:${e.event_id}`}`
        if (dispatch && dispatch.status !== 'succeeded' && dispatch.status !== 'failed') return null
        const open = await sql`SELECT 1 FROM job_queue
          WHERE dedupe_key LIKE ${`${e.event_id}:%`} AND status NOT IN ('succeeded', 'failed')`
        if (open.length > 0) return null
      }
      return true
    },
    { timeoutMs: 30_000, intervalMs: 300 }
  )
}

/** Event types recorded about a post, oldest first. */
export async function eventTypesAbout(postId: string): Promise<string[]> {
  const rows = await supportDb()<{ type: string }[]>`
    SELECT type FROM events WHERE payload::text LIKE ${`%${postId}%`} ORDER BY id`
  return rows.map((r) => r.type)
}

/** Mailpit messages to `address` whose subject contains `subject` (newest first). */
export async function mailsWith(address: string, subject: string): Promise<MailpitMessage[]> {
  const found = (await mailTo(address)).filter((m) => m.Subject.includes(subject))
  return Promise.all(found.map((m) => getMail(m.ID)))
}

/** Wait for exactly-at-least `count` messages to `address` whose subject contains `subject`. */
export async function waitForMails(
  address: string,
  subject: string,
  count = 1
): Promise<MailpitMessage[]> {
  return pollFor(
    `${count} mail(s) to ${address} with "${subject}"`,
    async () => {
      const found = (await mailTo(address)).filter((m) => m.Subject.includes(subject))
      return found.length >= count ? Promise.all(found.map((m) => getMail(m.ID))) : null
    },
    { timeoutMs: 30_000, intervalMs: 300 }
  )
}

/** The Unsubscribe link of a feedback email. */
export function unsubscribeLink(message: MailpitMessage): string {
  const link = [...message.HTML.matchAll(/href="([^"]+)"/g)]
    .map((m) => m[1].replace(/&amp;/g, '&'))
    .find((href) => href.includes('/unsubscribe?token='))
  if (!link) throw new Error(`No unsubscribe link in "${message.Subject}"`)
  return link
}

/** Subscription rows of a post (principal TypeID uuid, reason, flags). */
export async function subscriptionsOf(postId: string) {
  return supportDb()<
    {
      principal_id: string
      reason: string
      notify_comments: boolean
      notify_status_changes: boolean
    }[]
  >`SELECT principal_id, reason, notify_comments, notify_status_changes
    FROM post_subscriptions WHERE post_id = ${uuid(postId)}`
}

/** A teammate principal's raw uuid. */
export function principalUuid(principalId: string): string {
  return uuid(principalId)
}

/**
 * An anonymous visitor shaped like the anonymous sign-in makes one: principal
 * type anonymous and the product's placeholder address
 * (temp-<id>@anon.quackback.io). mintCustomer's own placeholder
 * (temp-<id>@anon) is not one the product recognises, so it is rewritten here.
 */
export async function anonymousVisitor(): Promise<MintedCustomer> {
  const visitor = await mintCustomer({ anonymous: true })
  const email = `temp-${visitor.userUuid}@${ANON_EMAIL_DOMAIN}`
  await supportDb()`UPDATE "user" SET email = ${email} WHERE id = ${visitor.userUuid}`
  return { ...visitor, email }
}
