/**
 * Feedback imports and exports, team side: the CSV import route, its dry run
 * and run poll, the hub, and the board CSV export.
 *
 * Journeys: FBA-X-01, FBA-X-02, FBA-X-05, FBA-X-06, FBA-X-07, FBA-X-08,
 * FBA-X-09, FBA-X-10, FBA-X-11, FBA-X-12, FBA-X-13, FBA-X-14, FBA-X-15,
 * FBA-X-16, FBA-X-17, FBA-X-19, FBA-X-20, FBA-AI-14
 * (FBA-X-03 is in admin-export.serial.spec.ts.)
 *
 * Every import names its own board (boardId), so the workspace's "first board
 * by name" default is never used, and every title carries the marker.
 */
import { readFileSync } from 'node:fs'
import type { Download } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { personApi, callServerFn } from '../../support/server-fns'
import { supportDb } from '../../support/db'
import { createRole } from '../../support/access'
import {
  makeBoard,
  makePost,
  makeTag,
  openPost,
  portalCustomer,
  statusIdBySlug,
  uuid,
} from '../../product/feedback-admin'
import {
  csvOf,
  importAndWait,
  postImport,
  postsTitled,
  settledImportRun,
  tagNamesOf,
} from '../../product/feedback-admin-ai'

const COLUMNS = [
  'title',
  'content',
  'status',
  'tags',
  'board',
  'author_name',
  'author_email',
  'email_verified',
  'vote_count',
  'created_at',
  'source_id',
]

function row(r: Partial<Record<(typeof COLUMNS)[number], string>>): Record<string, string> {
  return { author_name: 'Imported Person', content: 'Imported details', ...r }
}

const sql = () => supportDb()

// The day's batch tag exists before any import here: two first-of-the-day
// imports racing to create it make one run fail on the unique tag name
// (ensureBatchTag has no conflict handling; reported as a product bug).
test.beforeAll(async () => {
  const name = `import-csv-${new Date().toISOString().slice(0, 10)}`
  await sql()`INSERT INTO post_tags (id, name, color)
    VALUES (${toUuid(generateId('post_tag'))}, ${name}, '#6b7280')
    ON CONFLICT (name) WHERE deleted_at IS NULL DO NOTHING`
})

test.describe('import route', () => {
  test(
    'FBA-X-06 each invalid upload is refused with its own status and message and writes nothing',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      test.setTimeout(90_000)
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      const good = csvOf([row({ title: `${marker} never written` })], COLUMNS)
      const cases: [string, Awaited<ReturnType<typeof postImport>>, number, string][] = []
      const answer = async (
        label: string,
        res: Awaited<ReturnType<typeof postImport>>,
        status: number,
        error: string
      ) => {
        cases.push([label, res, status, error])
      }

      await answer(
        'not a csv',
        await postImport(api, good, {
          boardId: board.id,
          fileName: 'posts.txt',
          mimeType: 'text/plain',
          mode: 'dry_run',
        }),
        400,
        'File must be a CSV'
      )
      await answer(
        'bad board id',
        await postImport(api, good, { boardId: 'not-a-board', mode: 'dry_run' }),
        400,
        'Invalid board ID format'
      )
      await answer(
        'unknown board',
        await postImport(api, good, {
          boardId: fromUuid('board', '00000000-0000-7000-8000-000000000000'),
          mode: 'dry_run',
        }),
        400,
        'Board not found'
      )
      await answer(
        'missing columns',
        await postImport(api, `name,body\n${marker},x`, { boardId: board.id, mode: 'dry_run' }),
        400,
        'Missing required columns: title, content'
      )
      await answer(
        'header only',
        await postImport(api, 'title,content\n', { boardId: board.id, mode: 'dry_run' }),
        400,
        'CSV file is empty'
      )
      const tooMany = ['title,content,author_name']
      for (let i = 0; i < 10_001; i++) tooMany.push(`${marker} r${i},x,A`)
      await answer(
        'row limit',
        await postImport(api, tooMany.join('\n'), { boardId: board.id }),
        400,
        'File exceeds maximum of 10000 rows'
      )
      // Just over 10MB of file, inside the request allowance: the file check.
      const pad = 'x'.repeat(10 * 1024 * 1024 + 1024)
      await answer(
        'file too big',
        await postImport(api, `title,content\n${marker},${pad}`, { boardId: board.id }),
        400,
        'File size exceeds 10MB limit'
      )
      const noFile = await api.post('/api/import', { multipart: { mode: 'commit' } })
      await answer('no file', noFile, 400, 'No file provided')

      for (const [label, res, status, error] of cases) {
        expect(res.status(), label).toBe(status)
        expect(((await res.json()) as { error: string }).error, label).toBe(error)
      }

      // Without settings.manage the upload is refused before reading the file.
      const viewer = await personApi(playwright, 'noAccess')
      const refused = await postImport(viewer, good, { boardId: board.id })
      expect(refused.status()).toBe(403)
      expect(await refused.json()).toEqual({ error: 'Only admins can import data' })
      await viewer.dispose()

      expect(await postsTitled(`${marker} never written`)).toHaveLength(0)
      await api.dispose()
    }
  )

  test(
    'FBA-X-07 a dry run previews counts, creations, a sample and row errors without writing',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      const csv = csvOf(
        [
          row({
            title: `${marker} one`,
            status: `${marker} Stage`,
            tags: `${marker}-tag`,
            board: `${marker}-new-board`,
          }),
          row({ title: `${marker} two`, board: `${marker}-new-board`, author_name: '' }),
          row({ title: `${marker} three`, author_email: `${marker}@new-author.example` }),
          row({ title: '', author_name: 'Nobody' }),
        ],
        COLUMNS
      )
      const res = await postImport(api, csv, { boardId: board.id, mode: 'dry_run' })
      expect(res.status()).toBe(200)
      const preview = (await res.json()) as {
        totalRows: number
        creates: { boards: string[]; statuses: string[]; tags: string[] }
        sample: { row: number; title: string; action: string; isNewAuthor: boolean }[]
        errors: { row: number; message: string }[]
        updatedCount: number
      }
      expect(preview.totalRows).toBe(4)
      expect(preview.creates.statuses).toEqual([`${marker} Stage`])
      expect(preview.creates.tags).toEqual([`${marker}-tag`])
      expect(preview.creates.boards).toHaveLength(1)
      // Row two has no author at all; row four has no title.
      expect(preview.errors.map((e) => [e.row, e.message])).toEqual([
        [2, 'Author name or email is required'],
        [4, 'Title is required'],
      ])
      expect(preview.sample.map((s) => [s.row, s.title, s.action])).toEqual([
        [1, `${marker} one`, 'create'],
        [3, `${marker} three`, 'create'],
      ])
      expect(preview.sample[1].isNewAuthor).toBe(true)
      expect(preview.updatedCount).toBe(0)

      // Nothing was written: no post, status, tag, user or run.
      expect(await postsTitled(`${marker} one`)).toHaveLength(0)
      expect(
        await sql()`SELECT 1 FROM post_statuses WHERE name = ${`${marker} Stage`}`
      ).toHaveLength(0)
      expect(await sql()`SELECT 1 FROM post_tags WHERE name = ${`${marker}-tag`}`).toHaveLength(0)
      expect(
        await sql()`SELECT 1 FROM "user" WHERE email = ${`${marker}@new-author.example`}`
      ).toHaveLength(0)
      await api.dispose()
    }
  )

  test(
    'FBA-X-09 bad rows are skipped with row errors and the rest import',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      const csv = csvOf(
        [
          row({ title: `${marker} good` }),
          row({ title: '' }),
          row({ title: `${marker} ${'t'.repeat(200)}` }),
          row({ title: `${marker} long body`, content: 'c'.repeat(10_001) }),
          row({ title: `${marker} no author`, author_name: '' }),
          row({ title: `${marker} bad email`, author_name: '', author_email: 'not-an-email' }),
        ],
        COLUMNS
      )
      const run = await importAndWait(api, csv, { boardId: board.id })
      expect(run.status).toBe('completed')
      expect(run.totals).toMatchObject({ rows: 6, created: 1, updated: 0, skipped: 5, errors: 5 })
      const messages = new Map(run.errorReport!.map((e) => [e.row, e.message]))
      expect(messages.get(2)).toBe('Title is required')
      expect(messages.get(3)).toBe('Title must be 200 characters or less')
      expect(messages.get(4)).toBe('Content must be 10000 characters or less')
      expect(messages.get(5)).toBe('Author name or email is required')
      expect(messages.get(6)).toBeTruthy()
      expect(await postsTitled(`${marker} good`)).toHaveLength(1)
      expect(await postsTitled(`${marker} no author`)).toHaveLength(0)
      expect(await postsTitled(`${marker} bad email`)).toHaveLength(0)
      await api.dispose()
    }
  )

  test(
    'FBA-X-10 unknown statuses, boards and tags are created, and every post gets the day batch tag',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      const statusName = `${marker} In Review`
      const boardSlug = `${marker}-new-board`
      const tagName = `${marker}-fresh`
      const run = await importAndWait(
        api,
        csvOf(
          [
            row({ title: `${marker} a`, status: statusName, tags: tagName }),
            row({ title: `${marker} b`, board: boardSlug }),
          ],
          COLUMNS
        ),
        { boardId: board.id }
      )
      try {
        expect(run.status).toBe('completed')
        expect(run.totals).toMatchObject({ created: 2, skipped: 0 })
        const [status] =
          await sql()`SELECT color, category FROM post_statuses WHERE name = ${statusName}`
        expect(status).toMatchObject({ color: '#6b7280', category: 'active' })
        const [tag] = await sql()`SELECT color FROM post_tags WHERE name = ${tagName}`
        expect(tag).toMatchObject({ color: '#6b7280' })
        const [newBoard] = await sql()`SELECT id FROM boards WHERE slug = ${boardSlug}`
        expect(newBoard).toBeTruthy()

        const [a] = await postsTitled(`${marker} a`)
        const [b] = await postsTitled(`${marker} b`)
        expect(b.board_id).toBe(newBoard.id)
        expect(a.board_id).toBe(uuid(board.id))
        const day = new Date().toISOString().slice(0, 10)
        expect(await tagNamesOf(String(a.id))).toEqual([`import-csv-${day}`, tagName].sort())
        expect(await tagNamesOf(String(b.id))).toEqual([`import-csv-${day}`])

        // A second run the same day reuses the batch tag.
        const again = await importAndWait(api, csvOf([row({ title: `${marker} c` })], COLUMNS), {
          boardId: board.id,
        })
        expect(again.status).toBe('completed')
        const batchTags = await sql()`SELECT id FROM post_tags
          WHERE name = ${`import-csv-${day}`} AND deleted_at IS NULL`
        expect(batchTags).toHaveLength(1)
      } finally {
        // Keep the workspace's shared lists tidy for other tests.
        await sql()`UPDATE post_statuses SET deleted_at = now() WHERE name = ${statusName}`
        await sql()`UPDATE boards SET deleted_at = now() WHERE slug = ${boardSlug}`
        await api.dispose()
      }
    }
  )

  test(
    'FBA-X-11 authors match existing users case-insensitively, new emails become verified shells, names become contacts',
    { tag: '@core' },
    async ({ playwright, people, marker }) => {
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      const existing = people.people.customer.email.toUpperCase()
      const fresh = `${marker}@shell.example`
      const unverified = `${marker}-u@shell.example`
      const run = await importAndWait(
        api,
        csvOf(
          [
            row({ title: `${marker} existing`, author_name: '', author_email: existing }),
            row({ title: `${marker} fresh`, author_name: 'Fresh Shell', author_email: fresh }),
            row({
              title: `${marker} unverified`,
              author_email: unverified,
              email_verified: 'false',
              vote_count: '-3',
            }),
            row({ title: `${marker} contact`, author_name: `Contact ${marker}` }),
          ],
          COLUMNS
        ),
        { boardId: board.id }
      )
      expect(run.status).toBe('completed')
      expect(run.totals).toMatchObject({ created: 4, skipped: 0 })

      const authorOf = async (title: string) => {
        const [r] = await sql()`SELECT u.email, u.email_verified, pr.display_name, p.vote_count
          FROM posts p JOIN principal pr ON pr.id = p.principal_id
          LEFT JOIN "user" u ON u.id = pr.user_id WHERE p.title = ${title}`
        return r
      }
      expect(await authorOf(`${marker} existing`)).toMatchObject({
        email: people.people.customer.email,
      })
      expect(await authorOf(`${marker} fresh`)).toMatchObject({
        email: fresh,
        email_verified: true,
      })
      expect(await authorOf(`${marker} unverified`)).toMatchObject({
        email: unverified,
        email_verified: false,
        vote_count: 0,
      })
      const contact = await authorOf(`${marker} contact`)
      expect(contact.display_name).toBe(`Contact ${marker}`)
      expect(contact.email ?? null).toBeNull()
      await api.dispose()
    }
  )

  test(
    'FBA-X-12 a row whose source_id was imported before updates that post, and the dry run says Update',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      const sourceId = `${marker}-src-1`
      const first = await importAndWait(
        api,
        csvOf(
          [
            row({
              title: `${marker} v1`,
              status: 'planned',
              tags: `${marker}-x`,
              source_id: sourceId,
            }),
          ],
          COLUMNS
        ),
        { boardId: board.id }
      )
      expect(first.totals).toMatchObject({ created: 1 })
      const [post] = await postsTitled(`${marker} v1`)

      const second = csvOf(
        [
          row({
            title: `${marker} v2`,
            status: 'in_progress',
            tags: `${marker}-y`,
            source_id: sourceId,
          }),
          row({ title: `${marker} other` }),
        ],
        COLUMNS
      )
      const dry = await postImport(api, second, { boardId: board.id, mode: 'dry_run' })
      const preview = (await dry.json()) as {
        sample: { title: string; action: string }[]
        updatedCount: number
      }
      expect(preview.updatedCount).toBe(1)
      expect(preview.sample.map((s) => [s.title, s.action])).toEqual([
        [`${marker} v2`, 'update'],
        [`${marker} other`, 'create'],
      ])

      const run = await importAndWait(api, second, { boardId: board.id })
      expect(run.totals).toMatchObject({ created: 1, updated: 1 })
      expect(await postsTitled(`${marker} v1`)).toHaveLength(0)
      const [updated] = await postsTitled(`${marker} v2`)
      expect(updated.id).toBe(post.id)
      expect(updated.status_id).toBe(uuid(await statusIdBySlug('in_progress')))
      const day = new Date().toISOString().slice(0, 10)
      expect(await tagNamesOf(String(post.id))).toEqual([`import-csv-${day}`, `${marker}-y`].sort())
      const links = await sql()`SELECT 1 FROM post_external_links
        WHERE integration_type = 'import' AND external_id = ${sourceId}`
      expect(links).toHaveLength(1)
      await api.dispose()
    }
  )

  test(
    'FBA-X-12 a re-import with blank status and vote_count cells keeps the stored status and votes',
    {
      tag: '@core',
    },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      const sourceId = `${marker}-src-blank`
      await importAndWait(
        api,
        csvOf(
          [
            row({
              title: `${marker} first`,
              status: 'planned',
              vote_count: '7',
              source_id: sourceId,
            }),
          ],
          COLUMNS
        ),
        { boardId: board.id }
      )
      const run = await importAndWait(
        api,
        csvOf([row({ title: `${marker} retitled`, source_id: sourceId })], COLUMNS),
        { boardId: board.id }
      )
      expect(run.totals).toMatchObject({ updated: 1 })
      const [post] = await postsTitled(`${marker} retitled`)
      expect(post.vote_count).toBe(7)
      expect(post.status_id).toBe(uuid(await statusIdBySlug('planned')))
      await api.dispose()
    }
  )

  test(
    'FBA-X-13 vote_count sets the number with no voter rows; a real vote moves it from that base',
    { tag: '@nightly' },
    async ({ playwright, browser, marker }) => {
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      await importAndWait(
        api,
        csvOf([row({ title: `${marker} counted`, vote_count: '5' })], COLUMNS),
        {
          boardId: board.id,
        }
      )
      const [post] = await postsTitled(`${marker} counted`)
      const postId = fromUuid('post', String(post.id))
      expect(post.vote_count).toBe(5)
      expect(await sql()`SELECT 1 FROM post_votes WHERE post_id = ${post.id}`).toHaveLength(0)

      const voters = await callServerFn<unknown[]>(
        api,
        'fetchPostVotersFn',
        { id: postId },
        { method: 'GET' }
      )
      expect(voters.ok, voters.raw).toBe(true)
      expect(voters.data).toEqual([])

      const customer = await portalCustomer(browser, marker)
      const vote = await callServerFn(customer.api, 'toggleVoteFn', { postId })
      expect(vote.ok, vote.raw).toBe(true)
      expect((await postsTitled(`${marker} counted`))[0].vote_count).toBe(6)
      await callServerFn(customer.api, 'toggleVoteFn', { postId })
      expect((await postsTitled(`${marker} counted`))[0].vote_count).toBe(5)
      await customer.close()
      await api.dispose()
    }
  )

  test(
    'FBA-X-14 a row aimed at a read-only board is skipped with the board message',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const open = await makeBoard(api, `${marker}-open`)
      const closed = await makeBoard(api, `${marker}-closed`)
      const lock = await callServerFn(api, 'updateBoardFn', { id: closed.id, readOnly: true })
      expect(lock.ok, lock.raw).toBe(true)
      const run = await importAndWait(
        api,
        csvOf(
          [
            row({ title: `${marker} to closed`, board: closed.slug }),
            row({ title: `${marker} to open` }),
          ],
          COLUMNS
        ),
        { boardId: open.id }
      )
      expect(run.status).toBe('completed')
      expect(run.totals).toMatchObject({ created: 1, skipped: 1 })
      expect(run.errorReport).toEqual([
        expect.objectContaining({
          row: 1,
          message: "This board isn't taking new feedback right now.",
        }),
      ])
      expect(await postsTitled(`${marker} to closed`)).toHaveLength(0)
      expect(await postsTitled(`${marker} to open`)).toHaveLength(1)
      await api.dispose()
    }
  )

  test(
    'FBA-X-15 FBA-AI-14 an imported post is published at its CSV date with no event, subscription or AI work',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      // A post made in the app, for contrast: it gets an event and a subscription.
      const made = await makePost(api, { boardId: board.id, title: `${marker} made in app` })
      await importAndWait(
        api,
        csvOf(
          [
            row({
              title: `${marker} imported`,
              author_email: `${marker}@imported.example`,
              created_at: '2023-03-04T05:06:07Z',
            }),
          ],
          COLUMNS
        ),
        { boardId: board.id }
      )
      const [post] = await postsTitled(`${marker} imported`)
      const postId = fromUuid('post', String(post.id))
      expect(post.moderation_state).toBe('published')
      expect(new Date(String(post.created_at)).toISOString()).toBe('2023-03-04T05:06:07.000Z')

      // The app-made post has its post.created event, subscription and embedding.
      await expect
        .poll(async () =>
          (await sql()`SELECT type FROM events WHERE entity_id = ${made.id}`).map((e) => e.type)
        )
        .toContain('post.created')
      await expect
        .poll(
          async () =>
            (
              await sql()`SELECT embedding IS NOT NULL AS e FROM posts WHERE id = ${uuid(made.id)}`
            )[0].e,
          {
            timeout: 20_000,
          }
        )
        .toBe(true)
      expect(
        await sql()`SELECT 1 FROM post_subscriptions WHERE post_id = ${uuid(made.id)}`
      ).not.toHaveLength(0)

      // The imported one has none of it.
      expect(await sql()`SELECT type FROM events WHERE entity_id = ${postId}`).toHaveLength(0)
      expect(await sql()`SELECT 1 FROM post_subscriptions WHERE post_id = ${post.id}`).toHaveLength(
        0
      )
      expect(await sql()`SELECT 1 FROM post_activity WHERE post_id = ${post.id}`).toHaveLength(0)
      const [ai] = await sql()`SELECT embedding IS NULL AS no_embedding, merge_checked_at FROM posts
        WHERE id = ${post.id}`
      expect(ai).toMatchObject({ no_embedding: true, merge_checked_at: null })
      expect(await sql()`SELECT 1 FROM post_sentiment WHERE post_id = ${post.id}`).toHaveLength(0)
      await api.dispose()
    }
  )

  test(
    'FBA-X-17 a custom role with settings.manage can start an import but cannot poll its run',
    { tag: '@nightly' },
    async ({ playwright, newTeammate, marker }) => {
      const roleKey = await createRole(marker, ['settings.manage', 'post.view_private'])
      const mate = await newTeammate({ roleKey })
      const api = await mate.api(playwright)
      const admin = await personApi(playwright, 'admin')
      const board = await makeBoard(admin, marker)
      const res = await postImport(api, csvOf([row({ title: `${marker} by role` })], COLUMNS), {
        boardId: board.id,
      })
      expect(res.status()).toBe(202)
      const { runId } = (await res.json()) as { runId: string }
      const poll = await api.get(`/api/import/runs/${runId}`)
      expect(poll.status()).toBe(403)
      expect(await poll.json()).toEqual({ error: 'Only admins can view import runs' })
      // The run itself still completes (the admin can see it).
      expect((await settledImportRun(admin, runId)).status).toBe('completed')
      await api.dispose()
      await admin.dispose()
    }
  )

  test(
    'FBA-X-19 rows naming a deleted board, status or tag get fresh live ones, not the deleted rows',
    {
      tag: '@core',
    },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const home = await makeBoard(api, marker)
      const gone = await makeBoard(api, `${marker}-gone`)
      const tag = await makeTag(api, `${marker}-gone-tag`)
      const status = await callServerFn<{ id: string; slug: string }>(api, 'createStatusFn', {
        name: `${marker} Gone`.slice(-50),
        slug: `gone_${marker.replace(/[^a-z0-9]/g, '_')}`.slice(0, 50),
        color: '#123456',
        category: 'active',
      })
      expect(status.ok, status.raw).toBe(true)
      for (const [fn, id] of [
        ['deleteBoardFn', gone.id],
        ['deletePostTagFn', tag.id],
        ['deleteStatusFn', status.data.id],
      ] as const) {
        const res = await callServerFn(api, fn, { id })
        expect(res.ok, `${fn}: ${res.raw}`).toBe(true)
      }
      try {
        const run = await importAndWait(
          api,
          csvOf(
            [
              row({
                title: `${marker} names deleted`,
                board: gone.slug,
                status: status.data.slug,
                tags: tag.name,
              }),
            ],
            COLUMNS
          ),
          { boardId: home.id }
        )
        expect(run.status).toBe('completed')
        const [post] = await postsTitled(`${marker} names deleted`)
        const [b] = await sql()`SELECT deleted_at FROM boards WHERE id = ${post.board_id}`
        const [s] = await sql()`SELECT deleted_at FROM post_statuses WHERE id = ${post.status_id}`
        const tags = await sql()`SELECT t.name, t.deleted_at FROM post_tag_assignments a
          JOIN post_tags t ON t.id = a.tag_id WHERE a.post_id = ${post.id} AND t.name = ${tag.name}`
        expect.soft(b.deleted_at, 'board').toBeNull()
        expect.soft(s.deleted_at, 'status').toBeNull()
        expect(
          tags.map((t) => t.deleted_at),
          'tag'
        ).toEqual([null])
      } finally {
        await sql()`UPDATE post_statuses SET deleted_at = now()
          WHERE name = ${`${marker} Gone`.slice(-50)} AND deleted_at IS NULL`
        await sql()`UPDATE boards SET deleted_at = now() WHERE slug = ${gone.slug} AND deleted_at IS NULL`
        await api.dispose()
      }
    }
  )
})

test.describe('board export', () => {
  test(
    'FBA-X-01 Board > Data > Export CSV downloads the board live posts with neutralised formula cells',
    { tag: '@core' },
    async ({ playwright, asPerson, people, marker }) => {
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      const tagA = await makeTag(api, `${marker}-a`)
      const tagB = await makeTag(api, `${marker}-b`)
      await makePost(api, {
        boardId: board.id,
        title: `${marker} plain`,
        content: 'Plain details',
        tagIds: [tagA.id, tagB.id],
        statusId: await statusIdBySlug('planned'),
      })
      await makePost(api, { boardId: board.id, title: `=SUM(1) ${marker}`, content: 'formula' })
      await makePost(api, { boardId: board.id, title: `${marker} "quoted", comma`, content: '' })
      const gone = await makePost(api, { boardId: board.id, title: `${marker} deleted` })
      await sql()`UPDATE posts SET deleted_at = now() WHERE id = ${uuid(gone.id)}`

      const admin = await asPerson('admin')
      await admin.goto(`/admin/settings/boards/${board.slug}?tab=data`)
      // A click before hydration does nothing; click again until the file comes.
      let download: Download | undefined
      await expect(async () => {
        const downloading = admin.waitForEvent('download', { timeout: 3_000 })
        await admin.getByRole('button', { name: 'Export CSV' }).click()
        download = await downloading
      }).toPass({ timeout: 20_000 })
      if (!download) throw new Error('no download')
      expect(download.suggestedFilename()).toMatch(
        new RegExp(`^posts-export-${board.id}-\\d+\\.csv$`)
      )
      const text = readFileSync(await download.path(), 'utf8')
      const lines = text.split('\n')
      expect(lines[0]).toBe(
        'title,content,status,tags,board,author_name,author_email,vote_count,created_at'
      )
      // Newest first; the deleted post is not exported.
      expect(lines).toHaveLength(4)
      expect(lines[1]).toContain(`"${marker} ""quoted"", comma"`)
      expect(lines[2]).toContain(`"'=SUM(1) ${marker}"`)
      expect(lines[3]).toMatch(
        new RegExp(
          `^"${marker} plain","Plain details","Planned","${marker}-a,${marker}-b","${board.slug}","Ada Admin","${people.people.admin.email}",1,\\d{4}-`
        )
      )
      expect(text).not.toContain(`${marker} deleted`)
      await api.dispose()
    }
  )

  test(
    'FBA-X-02 the export route refuses no permission, a bad id and an unknown board',
    { tag: '@core' },
    async ({ playwright }) => {
      const contributor = await personApi(playwright, 'contributor')
      const denied = await contributor.get('/api/export')
      expect(denied.status()).toBe(403)
      expect(await denied.json()).toEqual({ error: 'Access denied' })
      await contributor.dispose()

      const api = await personApi(playwright, 'admin')
      const bad = await api.get('/api/export?boardId=nope')
      expect(bad.status()).toBe(400)
      expect(await bad.json()).toEqual({ error: 'Invalid board ID format' })
      const unknown = await api.get(
        `/api/export?boardId=${fromUuid('board', '00000000-0000-7000-8000-000000000000')}`
      )
      expect(unknown.status()).toBe(400)
      expect(await unknown.json()).toEqual({ error: 'Board not found' })
      await api.dispose()
    }
  )

  test(
    'FBA-X-02 a deleted board cannot be exported by id',
    {
      tag: '@core',
    },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      await makePost(api, { boardId: board.id, title: `${marker} on a deleted board` })
      const del = await callServerFn(api, 'deleteBoardFn', { id: board.id })
      expect(del.ok, del.raw).toBe(true)
      const res = await api.get(`/api/export?boardId=${board.id}`)
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error: 'Board not found' })
      await api.dispose()
    }
  )

  test(
    'FBA-X-20 exporting a board then importing the file elsewhere recreates its posts by name',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const from = await makeBoard(api, `${marker}-from`)
      const to = await makeBoard(api, `${marker}-to`)
      const tag = await makeTag(api, `${marker}-rt`)
      await makePost(api, {
        boardId: from.id,
        title: `${marker} round trip`,
        content: 'Kept details',
        tagIds: [tag.id],
        statusId: await statusIdBySlug('planned'),
      })
      const exported = await api.get(`/api/export?boardId=${from.id}`)
      expect(exported.status()).toBe(200)
      // Point the rows at the other board (board cells are slugs).
      const csv = (await exported.text()).replaceAll(`"${from.slug}"`, `"${to.slug}"`)

      const first = await importAndWait(api, csv, { boardId: to.id })
      expect(first.totals).toMatchObject({ created: 1, skipped: 0 })
      const [post] = await sql()`SELECT * FROM posts WHERE title = ${`${marker} round trip`}
        AND board_id = ${uuid(to.id)}`
      expect(post.status_id).toBe(uuid(await statusIdBySlug('planned')))
      expect(post.content).toBe('Kept details')
      expect(await tagNamesOf(String(post.id))).toContain(tag.name)

      // No source_id column, so a second import duplicates the row.
      await importAndWait(api, csv, { boardId: to.id })
      const copies = await sql()`SELECT 1 FROM posts WHERE title = ${`${marker} round trip`}
        AND board_id = ${uuid(to.id)}`
      expect(copies).toHaveLength(2)
      await api.dispose()
    }
  )
})

test.describe('imports hub', () => {
  test(
    'FBA-X-05 FBA-X-07 FBA-X-08 the hub previews a chosen CSV, imports it and reports the totals',
    { tag: '@core' },
    async ({ playwright, asPerson, marker }) => {
      test.setTimeout(60_000)
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      await api.dispose()
      const admin = await asPerson('admin')
      await admin.goto('/admin/settings/imports')
      await expect(
        admin.getByText(
          'Needs title and content columns, up to 10MB and 10,000 rows. Each row needs author_email or author_name. Keep source_id filled to re-run without duplicates.'
        )
      ).toBeVisible({ timeout: 15_000 })

      // The template is the import contract.
      const templateDownload = admin.waitForEvent('download')
      await admin.getByRole('button', { name: 'Download template' }).click()
      const template = readFileSync(await (await templateDownload).path(), 'utf8')
      expect(template.split('\n')[0]).toBe(
        'title,content,status,tags,board,author_name,author_email,email_verified,vote_count,created_at,source_id'
      )

      await admin.getByRole('combobox').filter({ hasText: 'Default board (optional)' }).click()
      await admin.getByRole('option', { name: board.name }).click()

      const csv = csvOf(
        [
          row({ title: `${marker} hub one`, tags: `${marker}-hubtag` }),
          row({ title: `${marker} hub two` }),
          row({ title: '' }),
        ],
        COLUMNS
      )
      await admin.locator('input[type="file"]').setInputFiles({
        name: `${marker}.csv`,
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      })
      await expect(
        admin.getByText('3 rows: 2 new posts, 0 updates, 1 skipped with errors.')
      ).toBeVisible()
      await expect(
        admin.getByText(`Will create: ${marker}-hubtag (tag).`, { exact: false })
      ).toBeVisible()
      await expect(admin.getByText('Row 3: Title is required')).toBeVisible()
      await expect(admin.getByRole('cell', { name: `${marker} hub one` })).toBeVisible()
      // Nothing written by the review.
      expect(await postsTitled(`${marker} hub one`)).toHaveLength(0)

      await admin.getByRole('button', { name: 'Import 2 posts' }).click()
      await expect(admin.getByText('Import complete')).toBeVisible({ timeout: 30_000 })
      await expect(
        admin.getByText('2 created, 1 skipped (1 row errors, see import history).')
      ).toBeVisible()
      const [one] = await postsTitled(`${marker} hub one`)
      expect(one.board_id).toBe(uuid(board.id))
    }
  )

  test(
    'FBA-X-16 the import history lists a finished run with its totals',
    { tag: '@core' },
    async ({ playwright, asPerson, newTeammate, marker }) => {
      const api = await personApi(playwright, 'admin')
      const board = await makeBoard(api, marker)
      const fileName = `${marker}-history.csv`
      const res = await postImport(api, csvOf([row({ title: `${marker} h` })], COLUMNS), {
        boardId: board.id,
        fileName,
      })
      expect(res.status()).toBe(202)
      await settledImportRun(api, ((await res.json()) as { runId: string }).runId)
      await api.dispose()

      const admin = await asPerson('admin')
      await admin.goto('/admin/settings/imports')
      const entry = admin.getByRole('row').filter({ hasText: fileName })
      await expect(entry).toBeVisible({ timeout: 15_000 })
      await expect(entry).toContainText('Completed')
      await expect(entry).toContainText('1 created')

      // A teammate with settings.manage but not the admin role is refused the history.
      const roleKey = await createRole(marker, ['settings.manage'])
      const mate = await newTeammate({ roleKey })
      const manager = await mate.api(playwright)
      const refused = await callServerFn(manager, 'listImportRunsFn', undefined, { method: 'GET' })
      expect(refused.ok).toBe(false)
      expect(refused.raw).toContain('Only admins can view import history')
      await manager.dispose()
    }
  )
})

test(
  'FBA-X-08 an opened imported post shows in the post modal',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await importAndWait(api, csvOf([row({ title: `${marker} visible` })], COLUMNS), {
      boardId: board.id,
    })
    const [post] = await postsTitled(`${marker} visible`)
    await api.dispose()
    const admin = await asPerson('admin')
    await openPost(admin, fromUuid('post', String(post.id)), `${marker} visible`)
  }
)
