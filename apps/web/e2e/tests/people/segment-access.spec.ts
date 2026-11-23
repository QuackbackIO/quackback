/**
 * Segment-gated access: boards gated per action by segment, a membership
 * change taking effect on the next request, and a private portal admitting
 * members of allowed segments.
 *
 * Journeys: PPL-G-34 (smoke), PPL-G-35, PPL-G-36, PPL-G-38 (isolated)
 */
import type { Page } from '@playwright/test'
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { ISOLATED } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import { expectJson } from '../../support/api-client'
import {
  callServerFn,
  createSegment,
  mustCall,
  personApi,
  portalUser,
  refusedCall,
  restAdmin,
  seedBoard,
  seedPost,
} from '../../product/people-segments'

/** Open a post's portal page and say whether its title shows. */
async function expectPost(page: Page, url: string, title: string, visible: boolean) {
  await page.goto(url)
  if (visible) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 })
  } else {
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText(title)).toHaveCount(0)
  }
}

test.describe('segment-gated boards', () => {
  test(
    'PPL-G-34 a segment-gated board shows to members and the team only',
    { tag: '@smoke' },
    async ({ asPerson, browser, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const seg = await createSegment(admin, { name: `Insiders ${marker}`, type: 'manual' })
      const member = await portalUser(browser, marker)
      const outsider = await portalUser(browser, marker)
      await mustCall(admin, 'assignUsersToSegmentFn', {
        segmentId: seg.id,
        principalIds: [member.principalId],
      })
      const board = await seedBoard(marker)
      const access = await callServerFn(admin, 'updateBoardAccessFn', {
        boardId: board.id,
        access: {
          view: 'segments',
          vote: 'segments',
          comment: 'segments',
          submit: 'segments',
          segments: { view: [seg.id], vote: [seg.id], comment: [seg.id], submit: [seg.id] },
          moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
        },
      })
      expect(access.ok, access.raw.slice(0, 300)).toBe(true)
      const title = `Gated idea ${marker}`
      const post = await seedPost(board.id, member.principalUuid, title)
      const url = `/b/${board.slug}/posts/${post.id}`

      await expectPost(await member.context.newPage(), url, title, true)
      await expectPost(await asPerson('admin'), url, title, true)
      await expectPost(await outsider.context.newPage(), url, title, false)
      const visitor = await browser.newPage()
      await expectPost(visitor, url, title, false)
      await visitor.close()

      // The member finds the post in the board's feed.
      const memberFeed = await member.context.newPage()
      await memberFeed.goto(`/?board=${board.slug}`)
      await expect(memberFeed.getByRole('link', { name: title })).toBeVisible({ timeout: 15_000 })
      await admin.dispose()
    }
  )

  test(
    'PPL-G-35 segment-gated vote, comment and submit',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const seg = await createSegment(admin, { name: `Voters ${marker}`, type: 'manual' })
      const viewSeg = await createSegment(admin, { name: `Viewers ${marker}`, type: 'manual' })
      const member = await portalUser(browser, marker)
      const outsider = await portalUser(browser, marker)
      await mustCall(admin, 'assignUsersToSegmentFn', {
        segmentId: seg.id,
        principalIds: [member.principalId],
      })
      const board = await seedBoard(marker)
      await mustCall(admin, 'updateBoardAccessFn', {
        boardId: board.id,
        access: {
          view: 'anonymous',
          vote: 'segments',
          comment: 'segments',
          submit: 'segments',
          segments: { view: [], vote: [seg.id], comment: [seg.id], submit: [seg.id] },
          moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
        },
      })
      const post = await seedPost(board.id, member.principalUuid, `Gated ${marker}`)
      const postUuid = post.id

      // The outsider is refused each action with the segment copy.
      for (const [fn, data, action] of [
        ['toggleVoteFn', { postId: postUuid }, 'vote'],
        ['createCommentFn', { postId: postUuid, content: `Hi ${marker}` }, 'comment'],
        [
          'createPublicPostFn',
          { boardId: board.id, title: `Out ${marker}`, content: 'x' },
          'submit',
        ],
      ] as const) {
        const res = await refusedCall(outsider.api, fn, data)
        expect(res.error, fn).toContain(`Only specific groups can ${action} on this board`)
      }
      const sql = supportDb()
      expect(
        await sql`SELECT id FROM post_votes WHERE principal_id = ${outsider.principalUuid}`
      ).toHaveLength(0)
      expect(await sql`SELECT id FROM posts WHERE title = ${`Out ${marker}`}`).toHaveLength(0)

      // The member can do all three.
      const vote = await mustCall<{ voted: boolean }>(member.api, 'toggleVoteFn', {
        postId: postUuid,
      })
      expect(vote.voted).toBe(true)
      await mustCall(member.api, 'createCommentFn', { postId: postUuid, content: `Yes ${marker}` })
      await mustCall(member.api, 'createPublicPostFn', {
        boardId: board.id,
        title: `In ${marker}`,
        content: 'x',
      })
      expect(await sql`SELECT id FROM posts WHERE title = ${`In ${marker}`}`).toHaveLength(1)

      // View is checked first: a member of the submit segment outside the
      // view segment cannot post.
      await mustCall(admin, 'updateBoardAccessFn', {
        boardId: board.id,
        access: {
          view: 'segments',
          vote: 'segments',
          comment: 'segments',
          submit: 'segments',
          segments: { view: [viewSeg.id], vote: [seg.id], comment: [seg.id], submit: [seg.id] },
          moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
        },
      })
      await refusedCall(member.api, 'createPublicPostFn', {
        boardId: board.id,
        title: `Blind ${marker}`,
        content: 'x',
      })
      expect(await sql`SELECT id FROM posts WHERE title = ${`Blind ${marker}`}`).toHaveLength(0)
      await admin.dispose()
    }
  )

  test(
    'PPL-G-36 a membership change applies on the next request',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const rest = await restAdmin(playwright)
      const seg = await createSegment(admin, { name: `Live ${marker}`, type: 'manual' })
      const person = await portalUser(browser, marker)
      const board = await seedBoard(marker)
      await mustCall(admin, 'updateBoardAccessFn', {
        boardId: board.id,
        access: {
          view: 'segments',
          vote: 'segments',
          comment: 'segments',
          submit: 'segments',
          segments: { view: [seg.id], vote: [seg.id], comment: [seg.id], submit: [seg.id] },
          moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
        },
      })
      const title = `Members only ${marker}`
      const post = await seedPost(board.id, person.principalUuid, title)
      const url = `/b/${board.slug}/posts/${post.id}`
      const page = await person.context.newPage()
      const members = `/api/v1/segments/${seg.slug}/members`

      await expectPost(page, url, title, false)
      await expectJson(
        await rest.post(members, { data: { principalIds: [person.principalId] } }),
        200
      )
      await expectPost(page, url, title, true)
      await expectJson(
        await rest.delete(members, { data: { principalIds: [person.principalId] } }),
        200
      )
      await expectPost(page, url, title, false)
      await rest.dispose()
      await admin.dispose()
    }
  )
})

test.describe('private portal', () => {
  test(
    'PPL-G-38 a private portal admits verified members of allowed segments',
    { tag: ['@core', '@isolated'] },
    async ({ browser, playwright, people, marker }) => {
      test.skip(!ISOLATED, 'runs in product-isolated')
      const admin = await personApi(playwright, 'admin')
      const seg = await createSegment(admin, { name: `Allowed ${marker}`, type: 'manual' })
      const verified = await portalUser(browser, marker)
      const unverified = await portalUser(browser, marker)
      const outsider = await portalUser(browser, marker)
      const sql = supportDb()
      await sql`UPDATE "user" SET email_verified = false WHERE id = ${unverified.userUuid}`
      await mustCall(admin, 'assignUsersToSegmentFn', {
        segmentId: seg.id,
        principalIds: [verified.principalId, unverified.principalId],
      })

      await withSettings({ portal_config: { 'access.visibility': 'public' } }, async () => {
        const since = new Date()
        const unknown = generateId('segment')
        await mustCall(admin, 'updatePortalAccessFn', {
          visibility: 'private',
          allowedSegmentIds: [seg.id, unknown],
        })
        const [settings] = await sql`SELECT portal_config FROM settings LIMIT 1`
        const access = JSON.parse(String(settings.portal_config)).access
        expect(access.allowedSegmentIds, 'unknown ids are dropped').toEqual([seg.id])

        const check = (api: typeof admin) =>
          mustCall<{ granted: boolean; reason: string }>(
            api,
            'evaluateMyPortalAccessFn',
            undefined,
            { method: 'GET' }
          )
        expect(await check(verified.api)).toMatchObject({ granted: true, reason: 'segment' })
        expect(await check(unverified.api)).toMatchObject({ granted: false })
        expect(await check(outsider.api)).toMatchObject({
          granted: false,
          reason: 'unauthorized',
        })

        const audit = await sql`SELECT before_value, after_value, actor_email FROM audit_log
          WHERE event_type = 'portal.allowed_segments.changed' AND occurred_at >= ${since}`
        expect(audit).toHaveLength(1)
        expect(audit[0].actor_email).toBe(people.people.admin.email)
        expect(audit[0].after_value).toMatchObject({ allowedSegmentIds: [seg.id] })
      })
      await admin.dispose()
    }
  )
})
