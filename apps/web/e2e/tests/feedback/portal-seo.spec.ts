/**
 * The portal sitemap's post URLs.
 *
 * Journeys: FBP-L-33
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import { mintCustomer } from '../../support/widget-portal'
import {
  adminRest,
  createBoard,
  postPath,
  restPost,
  seedPost,
  visitor,
} from '../../product/feedback-portal'

test.describe('portal sitemap', () => {
  test(
    'FBP-L-33 the sitemap lists published posts on anonymous-view boards and nothing else',
    { tag: '@nightly' },
    async ({ browser, marker, playwright }) => {
      const board = await createBoard(marker)
      const teamBoard = await createBoard(marker, { suffix: 'team', access: { view: 'team' } })
      const listed = await seedPost(board, { title: `${marker} public` })
      const held = await seedPost(board, { title: `${marker} held`, moderationState: 'pending' })
      const deleted = await seedPost(board, { title: `${marker} deleted`, deletedAt: new Date() })
      const team = await seedPost(teamBoard, { title: `${marker} team` })
      const canonical = await seedPost(board, { title: `${marker} canonical` })
      const merged = await seedPost(board, { title: `${marker} merged` })
      await restPost(await adminRest(playwright, marker), `/posts/${merged.id}/merge`, {
        canonicalPostId: canonical.id,
      })
      // A test customer (owner: a principal only this test uses; one test
      // customer per owner).
      const owner = await mintCustomer({ email: `${marker}-owner@customers.example` })
      const tester = await mintCustomer({ email: `${marker}-tester@customers.example` })
      await supportDb()`UPDATE principal SET test_owner_principal_id = ${owner.principalUuid}
        WHERE id = ${tester.principalUuid}`
      const testPost = await seedPost(board, {
        title: `${marker} test customer`,
        authorPrincipalUuid: tester.principalUuid,
      })

      const anon = await visitor(browser, marker)
      const res = await anon.request.get('/sitemap.xml', {
        headers: { 'cache-control': 'no-cache' },
      })
      expect(res.status()).toBe(200)
      const xml = await res.text()
      expect(xml).toContain(postPath(listed))
      expect(xml).toContain(postPath(canonical))
      for (const p of [held, deleted, team, merged, testPost]) {
        expect(xml, p.title).not.toContain(p.id)
      }
    }
  )

  test.describe('workspace switches', () => {
    test.beforeEach(() => {
      test.skip(!ISOLATED, ISOLATED_SKIP)
    })

    test(
      'FBP-L-33 a private portal serves an empty sitemap',
      { tag: ['@nightly', '@isolated'] },
      async ({ browser, marker }) => {
        const board = await createBoard(marker)
        const post = await seedPost(board, { title: `${marker} public` })
        const anon = await visitor(browser, marker)
        const open = await anon.request.get('/sitemap.xml')
        expect(await open.text()).toContain(post.id)
        await withSettings({ portal_config: { 'access.visibility': 'private' } }, async () => {
          const res = await anon.request.get(`/sitemap.xml?${marker}`)
          expect(res.status()).toBe(200)
          expect(await res.text()).not.toContain('/posts/')
        })
      }
    )
  })
})
