/**
 * People directory and profiles in the admin (/admin/users), and the portal
 * users' own rows they change.
 *
 * Journeys: PPL-U-42 (smoke), PPL-U-43
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  DELETED_USER_PRINCIPAL,
  commentAs,
  mustCall,
  personApi,
  portalUser,
  postAs,
  seedBoard,
  usersUrl,
  uuid,
  voteAs,
  voteCountOf,
  voteRowsOf,
} from '../../product/people'

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
