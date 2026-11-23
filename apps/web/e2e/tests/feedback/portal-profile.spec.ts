/**
 * The public profile page /u/<principalId>: header, tabs and counts scoped to
 * what the viewer may see, the shared not-found page, and the team-only
 * context strip.
 *
 * Owner question (not asserted beyond what the page shows): whether a
 * customer's upvote and comment history should be public at all.
 *
 * Journeys: FBP-U-01 FBP-U-02 FBP-U-03 FBP-U-04 FBP-U-05 FBP-U-07
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { mintCustomer } from '../../support/widget-portal'
import {
  createBoard,
  fbFn,
  personContext,
  portalCustomer,
  seedComment,
  seedPost,
  seedVotes,
  visitor,
} from '../../product/feedback-portal'

interface Item {
  title: string
  [k: string]: unknown
}
interface Profile {
  displayName: string
  isTeamMember: boolean
  postCount: number
  commentCount: number
  voteCount: number
  posts: Item[]
  comments: Item[]
  upvotes: Item[]
}

const titles = (items: Item[] | undefined) => (items ?? []).map((i) => i.title).sort()

async function adminUserUuid(): Promise<string> {
  const [row] =
    await supportDb()`SELECT id FROM "user" WHERE email = 'e2e-support-admin@example.com'`
  return row.id as string
}

test.describe('portal profile', () => {
  test(
    'FBP-U-01 a contributor profile shows name, member since, counts and the three tabs',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const person = await mintCustomer({
        email: `${marker}-p@customers.example`,
        name: 'Rowan Profile',
      })
      const post = await seedPost(board, {
        title: `${marker} my idea`,
        authorPrincipalUuid: person.principalUuid,
      })
      const other = await seedPost(board, { title: `${marker} their idea` })
      await seedComment(other, { content: 'agree', principalUuid: person.principalUuid })
      await seedVotes(other, [person.principalUuid])
      const anon = await visitor(browser, marker)
      const page = anon.page
      await page.goto(`/u/${person.principalId}`)
      await expect(page.getByRole('heading', { name: 'Rowan Profile' })).toBeVisible()
      await expect(page.getByText(/^Member since \w+ \d{4}$/)).toBeVisible()
      await expect(page).toHaveTitle(/^Rowan Profile - /)
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
      await expect(page.getByRole('link', { name: new RegExp(post.title) })).toHaveAttribute(
        'href',
        `/b/${board.slug}/posts/${post.id}`
      )
      const profile = await fbFn<Profile>(anon.request, 'publicProfile', 'getPublicUserProfileFn', {
        principalId: person.principalId,
      })
      expect(profile.value).toMatchObject({
        displayName: 'Rowan Profile',
        isTeamMember: false,
        postCount: 1,
        commentCount: 1,
        voteCount: 1,
      })
      expect(titles(profile.value?.posts)).toEqual([post.title])
      expect(titles(profile.value?.comments)).toEqual([other.title])
      expect(titles(profile.value?.upvotes)).toEqual([other.title])
    }
  )

  test(
    'FBP-U-02 every miss is the same Profile not found page',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const team = await createBoard(marker, { access: { view: 'team' } })
      const hiddenOnly = await mintCustomer({
        email: `${marker}-h@customers.example`,
        name: 'Hidden Hana',
      })
      await seedPost(team, {
        title: `${marker} team only`,
        authorPrincipalUuid: hiddenOnly.principalUuid,
      })
      const ghost = await mintCustomer({ anonymous: true })
      const owner = await mintCustomer({ email: `${marker}-o@customers.example` })
      const tester = await mintCustomer({ email: `${marker}-t@customers.example` })
      await supportDb()`UPDATE principal SET test_owner_principal_id = ${owner.principalUuid}
        WHERE id = ${tester.principalUuid}`
      const anon = await visitor(browser, marker)
      for (const id of [
        generateId('principal'),
        'principal_not-a-typeid',
        ghost.principalId,
        tester.principalId,
        hiddenOnly.principalId,
      ]) {
        const res = await anon.page.goto(`/u/${id}`)
        expect(res?.status(), id).toBe(404)
        await expect(anon.page.getByText('Profile not found'), id).toBeVisible()
        await expect(anon.page.getByText('Hidden Hana'), id).toHaveCount(0)
      }
      // The team sees the person whose only post is on a team board.
      const admin = await personContext(browser, await adminUserUuid(), marker)
      const res = await admin.page.goto(`/u/${hiddenOnly.principalId}`)
      expect(res?.status()).toBe(200)
      await expect(admin.page.getByRole('heading', { name: 'Hidden Hana' })).toBeVisible()
    }
  )

  test(
    'FBP-U-03 profile activity follows what the viewer may see',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const open = await createBoard(marker, { suffix: 'open' })
      const team = await createBoard(marker, { suffix: 'team', access: { view: 'team' } })
      const author = await portalCustomer(browser, marker, { suffix: 'author', name: 'Ash Author' })
      const by = { authorPrincipalUuid: author.principalUuid }
      const pub = await seedPost(open, { title: `${marker} public`, ...by })
      const teamPost = await seedPost(team, { title: `${marker} team`, ...by })
      const held = await seedPost(open, {
        title: `${marker} held`,
        moderationState: 'pending',
        ...by,
      })
      await seedPost(open, { title: `${marker} deleted`, deletedAt: new Date(), ...by })
      const read = async (request: typeof author.request) =>
        (
          await fbFn<Profile>(request, 'publicProfile', 'getPublicUserProfileFn', {
            principalId: author.principalId,
          })
        ).value
      const anon = await visitor(browser, marker)
      const asAnon = await read(anon.request)
      expect(titles(asAnon?.posts)).toEqual([pub.title])
      expect(asAnon?.postCount).toBe(1)
      const asSelf = await read(author.request)
      expect(titles(asSelf?.posts)).toEqual([pub.title, held.title].sort())
      expect(asSelf?.postCount).toBe(2)
      const admin = await personContext(browser, await adminUserUuid(), marker)
      const asTeam = await read(admin.request)
      expect(titles(asTeam?.posts)).toEqual([pub.title, teamPost.title, held.title].sort())
      expect(asTeam?.postCount).toBe(3)
    }
  )

  test(
    'FBP-U-04 the Commented on tab lists public comments only',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const person = await mintCustomer({ email: `${marker}-p@customers.example` })
      const a = await seedPost(board, { title: `${marker} public comment` })
      const b = await seedPost(board, { title: `${marker} private comment` })
      const c = await seedPost(board, { title: `${marker} deleted comment` })
      await seedComment(a, { content: 'public', principalUuid: person.principalUuid })
      await seedComment(b, {
        content: 'private',
        principalUuid: person.principalUuid,
        isPrivate: true,
      })
      await seedComment(c, {
        content: 'gone',
        principalUuid: person.principalUuid,
        deletedAt: new Date(),
      })
      const anon = await visitor(browser, marker)
      const profile = await fbFn<Profile>(anon.request, 'publicProfile', 'getPublicUserProfileFn', {
        principalId: person.principalId,
      })
      expect(titles(profile.value?.comments)).toEqual([a.title])
      expect(profile.value?.commentCount).toBe(1)
    }
  )

  test(
    'FBP-U-04 a held comment neither lists its post nor counts on the public profile',
    {
      tag: '@nightly',
    },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const person = await mintCustomer({ email: `${marker}-p@customers.example` })
      const post = await seedPost(board, { title: `${marker} held comment` })
      await seedComment(post, {
        content: 'awaiting',
        principalUuid: person.principalUuid,
        moderationState: 'pending',
      })
      const other = await seedPost(board, { title: `${marker} public anchor` })
      await seedComment(other, { content: 'public', principalUuid: person.principalUuid })
      const anon = await visitor(browser, marker)
      const profile = await fbFn<Profile>(anon.request, 'publicProfile', 'getPublicUserProfileFn', {
        principalId: person.principalId,
      })
      expect(titles(profile.value?.comments)).toEqual([other.title])
      expect(profile.value?.commentCount).toBe(1)
    }
  )

  test(
    'FBP-U-05 the team-only context strip is refused to customers and served to people.view holders',
    { tag: '@core' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const person = await mintCustomer({
        email: `${marker}-p@customers.example`,
        name: 'Sky Strip',
      })
      await seedPost(board, {
        title: `${marker} anchor`,
        authorPrincipalUuid: person.principalUuid,
      })
      const customer = await portalCustomer(browser, marker)
      const refused = await fbFn(customer.request, 'publicProfile', 'getProfileTeamContextFn', {
        principalId: person.principalId,
      })
      expect(refused.value ?? null).toBeNull()
      expect(refused.error).toBeDefined()
      const admin = await personContext(browser, await adminUserUuid(), marker)
      const ok = await fbFn<{ email: string | null }>(
        admin.request,
        'publicProfile',
        'getProfileTeamContextFn',
        {
          principalId: person.principalId,
        }
      )
      expect(ok.value).toMatchObject({ email: person.email })
      await admin.page.goto(`/u/${person.principalId}`)
      await expect(admin.page.getByText('Team only')).toBeVisible()
      await customer.page.goto(`/u/${person.principalId}`)
      await expect(customer.page.getByRole('heading', { name: 'Sky Strip' })).toBeVisible()
      await expect(customer.page.getByText('Team only')).toHaveCount(0)
      await expect(customer.page.getByText(person.email)).toHaveCount(0)
    }
  )

  test(
    'FBP-U-07 an anonymous author has no profile and shows as the anonymous label',
    { tag: '@nightly' },
    async ({ browser, marker }) => {
      const board = await createBoard(marker)
      const ghost = await mintCustomer({ anonymous: true, name: 'Ghost Writer' })
      await seedPost(board, {
        title: `${marker} by nobody`,
        authorPrincipalUuid: ghost.principalUuid,
      })
      const anon = await visitor(browser, marker)
      const profile = await fbFn(anon.request, 'publicProfile', 'getPublicUserProfileFn', {
        principalId: ghost.principalId,
      })
      expect(profile.value ?? null).toBeNull()
      expect((await anon.page.goto(`/u/${ghost.principalId}`))?.status()).toBe(404)
    }
  )
})
