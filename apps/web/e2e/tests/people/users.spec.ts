/**
 * People directory and profiles in the admin (/admin/users), and the portal
 * users' own rows they change.
 *
 * Journeys: PPL-U-02, PPL-U-11, PPL-U-20, PPL-U-21, PPL-U-23, PPL-U-31,
 * PPL-U-32, PPL-U-41, PPL-U-42 (smoke), PPL-U-43
 */
import type { APIRequestContext } from '@playwright/test'
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { emailLogFor, waitForEmailLog } from '../../support/mailpit'
import {
  DELETED_USER_PRINCIPAL,
  commentAs,
  leadContext,
  mustCall,
  personApi,
  portalUser,
  portalUserRow,
  postAs,
  postStatusId,
  refusedCall,
  restAdmin,
  seedBoard,
  seedLead,
  seedLeadActivity,
  userRow,
  usersUrl,
  uuid,
  voteAs,
  voteCountOf,
  voteRowsOf,
} from '../../product/people'

interface ListedUser {
  principalId: string
  name: string | null
  email: string | null
  contactEmail: string | null
  isLead: boolean
}

async function listIds(
  admin: APIRequestContext,
  filters: Record<string, unknown>
): Promise<string[]> {
  const res = await mustCall<{ items: ListedUser[] }>(admin, 'listPortalUsersFn', {
    limit: 100,
    ...filters,
  })
  return res.items.map((u) => u.principalId)
}

test.describe('directory search and leads', () => {
  test(
    'PPL-U-02 search matches name, account email and a lead contact email, ignoring case',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const byName = await portalUserRow(marker, {
        name: `Zelda ${marker.toUpperCase()}`,
        email: `zz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@other.example`,
      })
      const byEmail = await portalUserRow(marker, { name: 'Plain Name' })
      const lead = await seedLead('anon', {
        name: 'Anonymous visitor',
        contactEmail: `${marker}-lead@customers.example`,
      })

      const found = await listIds(admin, { search: marker.toUpperCase() })
      expect(found).toContain(byName.principalId)
      expect(found).toContain(byEmail.principalId)
      expect(found, 'leads stay on the Leads tab').not.toContain(lead.principalId)

      const leads = await listIds(admin, { search: `${marker}-LEAD`, lifecycle: 'leads' })
      expect(leads).toEqual([lead.principalId])
      await admin.dispose()
    }
  )

  test(
    'PPL-U-11 the Leads tab lists engaged anonymous people only',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const board = await seedBoard(marker)
      const author = await portalUser(browser, `${marker}-a`)
      const post = await postAs(author.api, board.id, `Idea ${marker}`)

      const withEmail = await seedLead(marker, { contactEmail: `${marker}-c@customers.example` })
      const voter = await seedLead(marker)
      const poster = await seedLead(marker)
      const commenter = await seedLead(marker)
      const idle = await seedLead(marker)
      await seedLeadActivity(voter.principalUuid, { vote: post.id })
      await seedLeadActivity(poster.principalUuid, {
        post: { boardId: board.id, title: `Lead idea ${marker}` },
      })
      await seedLeadActivity(commenter.principalUuid, {
        comment: { postId: post.id, content: `Lead ${marker}` },
      })
      // A session alone does not make a lead.
      await (await leadContext(browser, idle)).close()

      const res = await mustCall<{ items: ListedUser[] }>(admin, 'listPortalUsersFn', {
        search: marker,
        lifecycle: 'leads',
        limit: 100,
      })
      const ids = res.items.map((u) => u.principalId)
      expect(ids.sort()).toEqual(
        [withEmail, voter, poster, commenter].map((l) => l.principalId).sort()
      )
      for (const item of res.items) {
        expect(item.isLead).toBe(true)
        expect(item.email ?? '').not.toContain('@anon')
      }
      const emailed = res.items.find((u) => u.principalId === withEmail.principalId)
      expect(emailed?.contactEmail).toBe(`${marker}-c@customers.example`)
      // Users and leads never mix.
      expect(await listIds(admin, { search: marker })).toEqual([author.principalId])
      await admin.dispose()
    }
  )
})

test.describe('editing a person', () => {
  test(
    'PPL-U-20 changing an identified person email lowercases it and resets verification',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const person = await portalUserRow(marker)
      const next = `New-${marker}@Example.com`

      await mustCall(admin, 'updatePortalUserFn', { principalId: person.principalId, email: next })
      let row = await userRow(person.userUuid)
      expect(row.email).toBe(next.toLowerCase())
      expect(row.email_verified).toBe(false)

      // Re-saving the unchanged address with a new name keeps verification.
      await supportDb()`UPDATE "user" SET email_verified = true WHERE id = ${person.userUuid}`
      await mustCall(admin, 'updatePortalUserFn', {
        principalId: person.principalId,
        name: `Renamed ${marker}`,
        email: next.toLowerCase(),
      })
      row = await userRow(person.userUuid)
      expect(row.name).toBe(`Renamed ${marker}`)
      expect(row.email_verified).toBe(true)
      expect(await emailLogFor(next.toLowerCase()), 'no email is sent').toEqual([])
      await admin.dispose()
    }
  )

  test(
    'PPL-U-21 an address held by another account is refused; clearing an email is allowed',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const person = await portalUserRow(marker)
      const other = await portalUserRow(marker)

      const taken = await refusedCall(admin, 'updatePortalUserFn', {
        principalId: person.principalId,
        email: other.email.toUpperCase(),
      })
      expect(taken.code).toBe('EMAIL_IN_USE')
      expect((await userRow(person.userUuid)).email).toBe(person.email)

      await mustCall(admin, 'updatePortalUserFn', { principalId: person.principalId, email: null })
      const row = await userRow(person.userUuid)
      expect(row.email).toBeNull()
      expect(row.email_verified).toBe(false)
      await admin.dispose()
    }
  )

  test(
    'PPL-U-23 editing a teammate or an unknown person is refused',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const admin = await personApi(playwright, 'admin')
      const mate = await newTeammate({ roleKey: 'contributor' })
      for (const principalId of [mate.principalId, generateId('principal')]) {
        const res = await refusedCall(admin, 'updatePortalUserFn', {
          principalId,
          name: `Hijack ${marker}`,
        })
        expect(res.code, principalId).toBe('USER_NOT_FOUND')
      }
      const [row] = await supportDb()`SELECT name FROM "user" WHERE email = ${mate.email}`
      expect(row.name).toBe(mate.name)
      await admin.dispose()
    }
  )
})

test.describe('merging a lead', () => {
  test(
    'PPL-U-31 merging a lead that voted the same post as the user leaves one vote counted',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'mergeLeadIntoUser deletes the colliding lead vote without decrementing posts.vote_count (principal-repoint.ts); see QUARANTINE.md',
      },
    },
    async ({ browser, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const board = await seedBoard(marker)
      const author = await portalUser(browser, `${marker}-a`)
      const post = await postAs(author.api, board.id, `Idea ${marker}`)
      const before = await voteCountOf(post.id)
      const user = await portalUser(browser, marker)
      const lead = await seedLead(marker, { contactEmail: user.email })
      await seedLeadActivity(lead.principalUuid, { vote: post.id })
      await voteAs(user.api, post.id)
      expect(await voteCountOf(post.id)).toBe(before + 2)

      await mustCall(admin, 'mergeLeadIntoUserFn', {
        principalId: lead.principalId,
        targetPrincipalId: user.principalId,
      })
      expect(await voteRowsOf(post.id)).toBe(before + 1)
      expect(await voteCountOf(post.id), 'the count matches the vote rows').toBe(before + 1)
      await admin.dispose()
    }
  )

  test(
    'PPL-U-32 merge refusals move nothing',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const admin = await personApi(playwright, 'admin')
      const lead = await seedLead(marker, { contactEmail: `${marker}-l@customers.example` })
      const otherLead = await seedLead(marker)
      const user = await portalUserRow(marker)
      const otherUser = await portalUserRow(marker)
      const mate = await newTeammate({ roleKey: 'contributor' })

      const pairs: Array<[string, string]> = [
        [lead.principalId, lead.principalId],
        [user.principalId, otherUser.principalId],
        [lead.principalId, otherLead.principalId],
        [lead.principalId, mate.principalId],
        [lead.principalId, generateId('principal')],
      ]
      for (const [source, target] of pairs) {
        const res = await refusedCall(admin, 'mergeLeadIntoUserFn', {
          principalId: source,
          targetPrincipalId: target,
        })
        expect(res.code, `${source} -> ${target}`).toBe('MEMBER_NOT_FOUND')
      }
      const sql = supportDb()
      const kept = [lead.principalUuid, user.principalUuid, otherLead.principalUuid]
      const rows = await sql`SELECT id FROM principal WHERE id IN ${sql(kept)}`
      expect(rows).toHaveLength(3)
      await admin.dispose()
    }
  )
})

test.describe('blocking', () => {
  test(
    'PPL-U-41 a blocked subscriber gets no status-change email; the other subscriber does',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const board = await seedBoard(marker)
      const blocked = await portalUser(browser, marker)
      const post = await postAs(blocked.api, board.id, `Idea ${marker}`)
      const other = await portalUser(browser, marker)
      await commentAs(other.api, post.id, `Me too ${marker}`)
      const subs = await supportDb()`SELECT principal_id FROM post_subscriptions
        WHERE post_id = ${uuid(post.id)}`
      expect(subs.map((r) => r.principal_id as string).sort()).toEqual(
        [blocked.principalUuid, other.principalUuid].sort()
      )

      const admin = await personApi(playwright, 'admin')
      await mustCall(admin, 'blockPersonFn', { principalId: blocked.principalId })
      await admin.dispose()

      const rest = await restAdmin(playwright)
      const res = await rest.patch(`/api/v1/posts/${post.id}`, {
        data: { statusId: await postStatusId('planned') },
      })
      expect(res.status(), await res.text()).toBe(200)
      await rest.dispose()

      await waitForEmailLog(other.email, { direction: 'outbound' }, 30_000)
      // The blocked person's delivery runs in the same fan-out; give it a
      // moment more before reading its absence.
      await new Promise((r) => setTimeout(r, 3_000))
      expect(await emailLogFor(blocked.email)).toEqual([])
    }
  )
})

test.describe('removing a person', () => {
  test(
    'PPL-U-42 removing a portal user takes them off the portal and re-points their content',
    { tag: '@smoke' },
    async ({ asPerson, browser, marker }) => {
      const board = await seedBoard(marker)
      const author = await portalUser(browser, marker)
      const post = await postAs(author.api, board.id, `Idea ${marker}`)
      const comment = await commentAs(author.api, post.id, `Comment ${marker}`)
      // The vote lands on someone else's post, so it is the voter's own row.
      const other = await portalUser(browser, marker, { name: `Other voter ${marker}` })
      const otherPost = await postAs(other.api, board.id, `Other ${marker}`)
      await voteAs(author.api, otherPost.id)

      const admin = await asPerson('admin')
      await admin.goto(usersUrl({ search: marker, selected: author.principalId }))
      const profile = admin.getByRole('heading', { name: author.name, exact: true })
      await expect(profile).toBeVisible({ timeout: 15_000 })

      await admin.getByRole('button', { name: 'More actions' }).click()
      await admin.getByRole('menuitem', { name: 'Remove from portal' }).click()
      const dialog = admin.getByRole('alertdialog')
      await expect(dialog.getByText(`Remove ${author.name}?`)).toBeVisible()
      await expect(dialog).toContainText('their votes are withdrawn')
      await expect(dialog).toContainText('reattributed to “Deleted user”')
      await dialog.getByRole('button', { name: 'Remove', exact: true }).click()

      // The pane closes; the person is gone from the list after a fresh load.
      await expect(profile).toHaveCount(0)
      await admin.goto(usersUrl({ search: marker }))
      await expect(admin.getByRole('heading', { level: 3, name: other.name })).toBeVisible({
        timeout: 15_000,
      })
      await expect(admin.getByRole('heading', { level: 3, name: author.name })).toHaveCount(0)

      const sql = supportDb()
      const [principal] = await sql`SELECT id FROM principal WHERE id = ${author.principalUuid}`
      expect(principal, 'principal row deleted').toBeUndefined()
      const [account] = await sql`SELECT id FROM "user" WHERE id = ${author.userUuid}`
      expect(account, 'global user row kept').toBeDefined()
      const sessions = await sql`SELECT id FROM session WHERE user_id = ${author.userUuid}`
      expect(sessions, 'every session ended').toHaveLength(0)

      const deletedUser = uuid(DELETED_USER_PRINCIPAL)
      const [postRow] = await sql`SELECT principal_id FROM posts WHERE id = ${uuid(post.id)}`
      expect(postRow.principal_id).toBe(deletedUser)
      const [commentRow] =
        await sql`SELECT principal_id FROM post_comments WHERE id = ${uuid(comment.id)}`
      expect(commentRow.principal_id).toBe(deletedUser)
      const votes =
        await sql`SELECT id FROM post_votes WHERE principal_id = ${author.principalUuid}`
      expect(votes, 'their votes are gone').toHaveLength(0)
      const subs =
        await sql`SELECT id FROM post_subscriptions WHERE principal_id = ${author.principalUuid}`
      expect(subs, 'their post subscriptions are gone').toHaveLength(0)

      // The portal shows the post under "Deleted user".
      const visitor = await browser.newPage()
      await visitor.goto(`/b/${board.slug}/posts/${post.id}`)
      await expect(visitor.getByRole('heading', { name: `Idea ${marker}` })).toBeVisible()
      await expect(visitor.getByText('Deleted user').first()).toBeVisible()
      await visitor.close()
    }
  )

  test(
    'PPL-U-43 removing a voter withdraws their vote from the post count',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'removePortalUser lets post_votes cascade without decrementing posts.vote_count (user.service.ts removePortalUser); see QUARANTINE.md',
      },
    },
    async ({ browser, playwright, marker }) => {
      const board = await seedBoard(marker)
      const author = await portalUser(browser, `${marker}-a`)
      const post = await postAs(author.api, board.id, `Idea ${marker}`)
      const voter = await portalUser(browser, marker)
      const before = await voteCountOf(post.id)
      const voted = await voteAs(voter.api, post.id)
      expect(voted.voted).toBe(true)
      expect(await voteCountOf(post.id)).toBe(before + 1)

      const admin = await personApi(playwright, 'admin')
      await mustCall(admin, 'deletePortalUserFn', { principalId: voter.principalId })
      await admin.dispose()

      expect(await voteRowsOf(post.id)).toBe(before)
      expect(await voteCountOf(post.id), 'the count drops with the withdrawn vote').toBe(before)
    }
  )
})
