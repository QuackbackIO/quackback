/**
 * Admin search: the results page, the search server function's ranking,
 * paging and refusals, and what each kind lets a teammate find.
 *
 * Journeys: INT-SR-02, INT-SR-03, INT-SR-05, INT-SR-06, INT-SR-07, INT-SR-11.
 *
 * Every record carries a token unique to the test in its title, so other
 * tests' rows never interleave with the ones asserted on.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import { callServerFn } from '../../support/server-fns'
import { asPersonApi, createBoard, createPost } from '../../product/platform-admin'

interface SearchResult {
  id: string
  kind: string
  title: string
  href: string
  excerpt?: string
  subtitle?: string
  score: number
}
interface SearchPage {
  results: SearchResult[]
  hasMore: boolean
}

/** A word no other record contains. */
function token(): string {
  return `zq${randomBytes(5).toString('hex')}`
}

function search(
  api: Parameters<typeof callServerFn>[0],
  data: { query: string; kind?: string; offset?: number; limit?: number }
) {
  return callServerFn<SearchPage>(api, 'searchWorkspaceFn', data, { method: 'GET' })
}

test(
  'INT-SR-06 ranking: exact title, prefix, contains, then body; pages never repeat',
  { tag: '@smoke' },
  async ({ playwright, marker, people }) => {
    const tok = token()
    const board = await createBoard(marker)
    const author = people.people.admin.principalId
    const body = await createPost(board.uuid, author, `Unrelated ${marker}`, `About ${tok} here.`)
    const contains = await createPost(board.uuid, author, `Our ${tok} plan`)
    const prefix = await createPost(board.uuid, author, `${tok} roadmap`)
    const exact = await createPost(board.uuid, author, tok)

    await asPersonApi(playwright, 'admin', async (api) => {
      const res = await search(api, { query: tok, kind: 'post' })
      expect(res.ok, res.error).toBe(true)
      expect(res.data.results.map((r) => r.id)).toEqual([exact.id, prefix.id, contains.id, body.id])
      const [s3, s2, s1, s0] = res.data.results.map((r) => r.score)
      expect(Math.floor(s3)).toBe(3)
      expect(Math.floor(s2)).toBe(2)
      expect(Math.floor(s1)).toBe(1)
      expect(Math.floor(s0)).toBe(0)
      expect(res.data.hasMore).toBe(false)
      // A result opens the admin post view.
      expect(res.data.results[0].href).toContain(exact.id)

      // One row a page: the same four, in the same order, none twice.
      const seen: string[] = []
      for (let offset = 0; offset < 5; offset++) {
        const page = await search(api, { query: tok, kind: 'post', offset, limit: 1 })
        seen.push(...page.data.results.map((r) => r.id))
        expect(page.data.hasMore).toBe(offset < 3)
      }
      expect(seen).toEqual([exact.id, prefix.id, contains.id, body.id])

      // Three or more characters match inside a word.
      const inside = await search(api, { query: tok.slice(2), kind: 'post' })
      expect(inside.data.results.map((r) => r.id)).toContain(exact.id)
    })
  }
)

test(
  'INT-SR-07 deleted posts and posts on deleted boards are not found',
  { tag: '@core' },
  async ({ playwright, marker, people }) => {
    const tok = token()
    const author = people.people.admin.principalId
    const live = await createBoard(`${marker}-live`)
    const gone = await createBoard(`${marker}-gone`)
    const kept = await createPost(
      live.uuid,
      author,
      `${tok} kept`,
      `<p><strong>${tok}</strong> body</p>`
    )
    const deleted = await createPost(live.uuid, author, `${tok} deleted`)
    const orphan = await createPost(gone.uuid, author, `${tok} orphan`)
    await supportDb()`UPDATE posts SET deleted_at = now() WHERE id = ${deleted.uuid}`
    await supportDb()`UPDATE boards SET deleted_at = now() WHERE id = ${gone.uuid}`

    await asPersonApi(playwright, 'admin', async (api) => {
      const res = await search(api, { query: tok, kind: 'post' })
      expect(res.ok, res.error).toBe(true)
      const ids = res.data.results.map((r) => r.id)
      expect(ids).toEqual([kept.id])
      expect(ids).not.toContain(orphan.id)
      // The excerpt is plain text.
      const excerpt = res.data.results[0].excerpt ?? ''
      expect(excerpt).not.toMatch(/<|\*\*/)
    })
  }
)

test(
  'INT-SR-11 people and companies are found by name, email and domain',
  { tag: '@core' },
  async ({ playwright, newTeammate }) => {
    const tok = token()
    const mate = await newTeammate({ roleKey: 'support_lead', name: `Mate ${tok}` })
    const companyId = randomUUID()
    await supportDb()`INSERT INTO companies (id, name, domain)
                      VALUES (${companyId}, ${`Company ${tok}`}, ${`${tok}.example`})`
    await asPersonApi(playwright, 'admin', async (api) => {
      const teammates = await search(api, { query: tok, kind: 'teammate' })
      expect(teammates.ok, teammates.error).toBe(true)
      expect(teammates.data.results.map((r) => r.title)).toEqual([mate.name])
      expect(teammates.data.results[0].href).toContain('/admin/settings/members')

      const byDomain = await search(api, { query: `${tok}.example`, kind: 'company' })
      expect(byDomain.data.results.map((r) => r.title)).toEqual([`Company ${tok}`])
      expect(byDomain.data.results[0].subtitle).toBe(`${tok}.example`)
    })
  }
)

test(
  'INT-SR-03 only teammates with a dashboard session may search',
  { tag: '@core' },
  async ({ playwright, marker, people }) => {
    const tok = token()
    const board = await createBoard(marker)
    await createPost(board.uuid, people.people.admin.principalId, tok)

    // A portal customer: refused, nothing returned.
    await asPersonApi(playwright, 'customer', async (api) => {
      const res = await search(api, { query: tok })
      expect(res.ok).toBe(false)
      expect(res.raw).not.toContain(tok)
    })
    // Signed out.
    const anon = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    const res = await search(anon, { query: tok })
    expect(res.ok).toBe(false)
    expect(res.raw).not.toContain(tok)
    await anon.dispose()
  }
)

test(
  'INT-SR-05 the results page: type chips and the filter and page in the URL',
  { tag: '@core' },
  async ({ asPerson, marker, people }) => {
    const tok = token()
    const board = await createBoard(marker)
    for (let i = 0; i < 21; i++) {
      await createPost(board.uuid, people.people.admin.principalId, `${tok} idea ${i}`)
    }
    const admin = await asPerson('admin')
    await admin.goto(`/admin/search?q=${tok}`)
    // The box has focus on load.
    await expect(admin.getByRole('searchbox', { name: 'Search Quackback' })).toBeFocused()
    const chips = admin.getByRole('group', { name: 'Filter by type' })
    await expect(chips.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    await expect(admin.getByRole('listitem').filter({ hasText: tok })).toHaveCount(20)

    // Choose Posts, then the next page: both stay in the URL.
    await chips.getByRole('button', { name: 'Posts' }).click()
    await expect(admin).toHaveURL(/kind=post/)
    await expect(chips.getByRole('button', { name: 'Posts' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    const pages = admin.getByRole('navigation', { name: 'Pages' })
    await pages.getByRole('button', { name: 'Next' }).click()
    await expect(admin).toHaveURL(/kind=post/)
    await expect(admin).toHaveURL(/page=2/)
    await expect(admin.getByRole('listitem').filter({ hasText: tok })).toHaveCount(1)
    await expect(pages.getByRole('button', { name: 'Next' })).toBeDisabled()
    await expect(pages.getByRole('button', { name: 'Previous' })).toBeEnabled()
  }
)

test(
  'INT-SR-02 the results page ignores a short query, an unknown kind and a page out of range',
  { tag: '@core' },
  async ({ asPerson, marker, people }) => {
    const tok = token()
    const board = await createBoard(marker)
    await createPost(board.uuid, people.people.admin.principalId, `${tok} idea`)
    const admin = await asPerson('admin')

    // One character: no search, a hint.
    await admin.goto('/admin/search?q=a')
    await expect(admin.getByText('Type at least two characters.')).toBeVisible()

    const chips = admin.getByRole('group', { name: 'Filter by type' })
    for (const extra of ['&kind=nope', '&page=99', '&page=abc']) {
      await admin.goto(`/admin/search?q=${tok}${extra}`)
      await expect(chips.getByRole('button', { name: 'All' }), extra).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(admin.getByRole('listitem').filter({ hasText: tok }), extra).toHaveCount(1)
    }
  }
)
