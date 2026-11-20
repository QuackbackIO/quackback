/**
 * Settings > Boards: the list, create, rename, read-only, delete, access,
 * data tab, the email card and who can open a board's settings.
 *
 * Journeys: FBA-T-01 FBA-T-02 FBA-T-04 FBA-T-05 FBA-T-06 FBA-T-07 FBA-T-08
 * FBA-T-09 FBA-T-10 FBA-T-11 FBA-T-12
 * Skipped: FBA-T-03 (plan board cap; see the test)
 */
import { readFileSync } from 'node:fs'
import { fromUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { pollFor, supportDb } from '../../support/db'
import { waitForHydration } from '../../utils/helpers'
import {
  customerPost,
  makeBoard,
  makePost,
  portalCustomer,
  statusIdBySlug,
  uuid,
} from '../../product/feedback-admin'
import {
  auditRows,
  boardRow,
  boardRowDb,
  eventTypesFor,
  openBoardSettings,
  openHydrated,
  waitForEventType,
} from '../../product/feedback-admin-settings'

test(
  'FBA-T-01 the boards list shows each board with its live post count and access badges',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const open = await makeBoard(api, marker, {
      name: `${marker} Open`,
      description: `About ${marker}`,
    })
    const team = await makeBoard(api, marker, { name: `${marker} Team`, preset: 'private' })
    const closed = await makeBoard(api, marker, { name: `${marker} Closed` })
    const p1 = await makePost(api, { boardId: open.id, title: `${marker} one` })
    await makePost(api, { boardId: open.id, title: `${marker} two` })
    const gone = await makePost(api, { boardId: open.id, title: `${marker} gone` })
    const dup = await makePost(api, { boardId: open.id, title: `${marker} dup` })
    await makePost(api, { boardId: team.id, title: `${marker} only one` })
    const sql = supportDb()
    await sql`UPDATE posts SET deleted_at = now() WHERE id = ${uuid(gone.id)}`
    await sql`UPDATE posts SET canonical_post_id = ${uuid(p1.id)}, merged_at = now()
              WHERE id = ${uuid(dup.id)}`
    const ro = await callServerFn(api, 'updateBoardFn', { id: closed.id, readOnly: true })
    expect(ro.ok, ro.raw).toBe(true)
    await api.dispose()

    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/boards')
    const openRow = boardRow(admin, open.name)
    // Deleted and merged posts are not counted.
    await expect(openRow).toContainText(`About ${marker} · 2 posts`)
    await expect(openRow).toHaveAttribute('href', `/admin/settings/boards/${open.slug}`)
    await expect(openRow).not.toContainText('Team only')
    // Some board is read-only, so every row says Open or Read-only.
    await expect(openRow).toContainText('Open')
    const teamRow = boardRow(admin, team.name)
    await expect(teamRow).toContainText('1 post')
    await expect(teamRow).toContainText('Team only')
    await expect(boardRow(admin, closed.name)).toContainText('Read-only')
    await expect(boardRow(admin, closed.name)).toContainText('0 posts')
  }
)

test(
  'FBA-T-02 New board creates a Team only board with a unique slug and opens its Access tab',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const name = `${marker} Ideas`
    const admin = await asPerson('admin')
    await openHydrated(
      admin,
      '/admin/settings/boards',
      admin.getByRole('button', { name: 'New board' })
    )
    await admin.getByRole('button', { name: 'New board' }).click()
    const dialog = admin.getByRole('dialog')
    // An empty name is refused in the form.
    await dialog.getByRole('button', { name: 'Create board' }).click()
    await expect(dialog.getByText('Board name is required')).toBeVisible()

    await dialog.getByLabel('Board name').fill(name)
    await dialog.getByLabel('Description').fill(`Say it, ${marker}`)
    await dialog.getByRole('button', { name: 'Team only' }).click()
    await dialog.getByRole('checkbox', { name: 'Customize access after create' }).click()
    await dialog.getByRole('button', { name: 'Create board' }).click()

    const row = await pollFor('the new board', async () => {
      const [r] = await supportDb()`SELECT * FROM boards WHERE name = ${name}`
      return r
    })
    const slug = String(row?.slug ?? '')
    expect(slug).toBe(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    await expect(admin).toHaveURL(new RegExp(`/admin/settings/boards/${slug}\\?tab=access$`))
    await expect(admin.getByRole('tab', { name: 'Access' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    const access = row.access as Record<string, string>
    expect([access.view, access.vote, access.comment, access.submit]).toEqual([
      'team',
      'team',
      'team',
      'team',
    ])
    expect(row.description).toBe(`Say it, ${marker}`)
    await waitForEventType(fromUuid('board', String(row.id)), 'board.created')

    // The same name again gets the next free slug.
    const api = await personApi(playwright, 'admin')
    const again = await makeBoard(api, marker, { name })
    expect(again.slug).toBe(`${slug}-1`)
    await api.dispose()
  }
)

test(
  'FBA-T-04 renaming a board saves on blur and the settings URL follows the new slug',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker, { name: `${marker} Before` })
    const taken = await makeBoard(api, marker, { name: `${marker} Taken` })
    await api.dispose()

    const admin = await asPerson('admin')
    await openBoardSettings(admin, board.slug)
    const nameInput = admin.getByLabel('Name', { exact: true })
    await waitForHydration(nameInput)
    await nameInput.fill(`${marker} After`)
    await admin.getByLabel('Description').click()
    const newSlug = `${marker} After`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    await expect(admin).toHaveURL(new RegExp(`/admin/settings/boards/${newSlug}$`))
    await expect.poll(async () => (await boardRowDb(board.id)).name).toBe(`${marker} After`)
    expect((await boardRowDb(board.id)).slug).toBe(newSlug)

    // A name whose slug is taken still renames; the slug stays.
    await nameInput.fill(taken.name)
    await admin.getByLabel('Description').click()
    await expect.poll(async () => (await boardRowDb(board.id)).name).toBe(taken.name)
    expect((await boardRowDb(board.id)).slug).toBe(newSlug)
    await expect(admin).toHaveURL(new RegExp(`/admin/settings/boards/${newSlug}$`))

    await admin.reload()
    await expect(admin.getByLabel('Name', { exact: true })).toHaveValue(taken.name)
  }
)

test(
  'FBA-T-05 a board description saves on blur, shows in the list and clears to nothing',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await api.dispose()

    const admin = await asPerson('admin')
    await openBoardSettings(admin, board.slug)
    await waitForHydration(admin.getByLabel('Description'))
    await admin.getByLabel('Description').fill(`Wishes of ${marker}`)
    await admin.getByLabel('Name', { exact: true }).click()
    await expect
      .poll(async () => (await boardRowDb(board.id)).description)
      .toBe(`Wishes of ${marker}`)
    await admin.goto('/admin/settings/boards')
    await expect(boardRow(admin, board.name)).toContainText(`Wishes of ${marker} · 0 posts`)

    await openBoardSettings(admin, board.slug)
    const description = admin.getByLabel('Description')
    await waitForHydration(description)
    await expect(description).toHaveValue(`Wishes of ${marker}`)
    await description.click()
    await admin.keyboard.press('ControlOrMeta+a')
    await admin.keyboard.press('Backspace')
    await expect(description).toHaveValue('')
    await admin.getByLabel('Name', { exact: true }).click()
    await expect.poll(async () => (await boardRowDb(board.id)).description).toBeNull()
  }
)

test(
  'FBA-T-06 a read-only board refuses new posts, votes and comments but lets the team triage',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const other = await makeBoard(api, marker, { name: `${marker} Elsewhere` })
    const post = await makePost(api, { boardId: board.id, title: `${marker} existing` })
    const visitor = await makePost(api, { boardId: other.id, title: `${marker} visitor` })
    const customer = await portalCustomer(browser, marker)
    await callServerFn(customer.api, 'toggleVoteFn', { postId: post.id })

    const admin = await asPerson('admin')
    await openBoardSettings(admin, board.slug)
    await waitForHydration(admin.getByRole('switch', { name: 'Read-only' }))
    await admin.getByRole('switch', { name: 'Read-only' }).click()
    await expect.poll(async () => (await boardRowDb(board.id)).read_only).toBe(true)

    // Customers: no post, vote or comment.
    const create = await callServerFn(customer.api, 'createPublicPostFn', {
      boardId: board.id,
      title: `${marker} new`,
      content: '',
    })
    expect(create.ok).toBe(false)
    expect(create.raw).toContain('BOARD_READ_ONLY')
    const comment = await callServerFn(customer.api, 'createCommentFn', {
      postId: post.id,
      content: 'Me too',
    })
    expect(comment.ok).toBe(false)
    expect(comment.raw).toContain('BOARD_READ_ONLY')

    // The team: no new post or comment either, nor a move in.
    const teamCreate = await callServerFn(api, 'createPostFn', {
      boardId: board.id,
      title: `${marker} team new`,
    })
    expect(teamCreate.ok).toBe(false)
    expect(teamCreate.raw).toContain('BOARD_READ_ONLY')
    const teamComment = await callServerFn(api, 'createCommentFn', {
      postId: post.id,
      content: 'Team note',
    })
    expect(teamComment.ok).toBe(false)
    const moveIn = await callServerFn(api, 'changePostBoardFn', {
      id: visitor.id,
      boardId: board.id,
    })
    expect(moveIn.ok).toBe(false)

    // ...but status changes, removing a vote and moving out still work.
    const status = await callServerFn(api, 'changePostStatusFn', {
      id: post.id,
      statusId: await statusIdBySlug('planned'),
    })
    expect(status.ok, status.raw).toBe(true)
    const unvote = await callServerFn(customer.api, 'toggleVoteFn', { postId: post.id })
    expect(unvote.ok, unvote.raw).toBe(true)
    const [votes] = await supportDb()`SELECT count(*)::int AS n FROM post_votes
                                       WHERE post_id = ${uuid(post.id)}
                                         AND principal_id = ${customer.principalUuid}`
    expect(votes.n).toBe(0)
    const moveOut = await callServerFn(api, 'changePostBoardFn', {
      id: post.id,
      boardId: other.id,
    })
    expect(moveOut.ok, moveOut.raw).toBe(true)

    await admin.goto('/admin/settings/boards')
    await expect(boardRow(admin, board.name)).toContainText('Read-only')
    await customer.close()
    await api.dispose()
  }
)

test(
  'FBA-T-07 deleting a board needs its exact name, hides it and refuses a second delete',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker, { name: `${marker} Doomed` })
    await makePost(api, { boardId: board.id, title: `${marker} on doomed` })

    const admin = await asPerson('admin')
    await openBoardSettings(admin, board.slug)
    await waitForHydration(admin.getByRole('button', { name: 'Delete board' }))
    await admin.getByRole('button', { name: 'Delete board' }).click()
    const dialog = admin.getByRole('alertdialog').or(admin.getByRole('dialog'))
    const confirm = dialog.getByRole('button', { name: 'Delete board' })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel(/to confirm/).fill(board.name.slice(0, -1))
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel(/to confirm/).fill(board.name)
    await confirm.click()

    await expect(admin).toHaveURL(/\/admin\/settings\/boards$/)
    await expect(boardRow(admin, board.name)).toHaveCount(0)
    expect((await boardRowDb(board.id)).deleted_at).not.toBeNull()
    await waitForEventType(board.id, 'board.deleted')
    expect(await eventTypesFor(board.id)).toContain('board.created')

    const again = await callServerFn(api, 'deleteBoardFn', { id: board.id })
    expect(again.ok).toBe(false)
    expect(again.code).toBe('BOARD_NOT_FOUND')
    await api.dispose()
  }
)

test(
  'FBA-T-08 the Access tab presets set every cell, a cell change derives Custom and saves',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await api.dispose()

    const admin = await asPerson('admin')
    await openBoardSettings(admin, board.slug, 'access')
    await waitForHydration(admin.getByRole('button', { name: 'Team only', exact: true }))
    await admin.getByRole('button', { name: 'Team only', exact: true }).click()
    await expect
      .poll(async () => {
        const a = (await boardRowDb(board.id)).access as Record<string, string>
        return [a.view, a.vote, a.comment, a.submit]
      })
      .toEqual(['team', 'team', 'team', 'team'])
    await expect
      .poll(async () => (await auditRows('board.access.changed', board.id)).length)
      .toBe(1)

    // Everyone: anyone views; the suite's workspace keeps anonymous voting,
    // commenting and posting off, so those cells sit on Signed-in users.
    await admin.getByRole('button', { name: 'Everyone', exact: true }).click()
    await expect
      .poll(async () => {
        const a = (await boardRowDb(board.id)).access as Record<string, string>
        return [a.view, a.vote, a.comment, a.submit]
      })
      .toEqual(['anonymous', 'authenticated', 'authenticated', 'authenticated'])

    // A Segments cell with no segment chosen shows the warning and does not save.
    await admin.getByRole('button', { name: 'Comment: Specific segments' }).click()
    await expect(admin.getByRole('status', { name: 'Custom' })).toBeVisible()
    await expect(
      admin.getByText('Some rules use Segments but no segments are selected.')
    ).toBeVisible()
    await admin.keyboard.press('Escape')
    await admin.waitForTimeout(1500)
    expect(((await boardRowDb(board.id)).access as Record<string, string>).comment).toBe(
      'authenticated'
    )

    // A plain tier saves as Custom.
    await admin.getByRole('button', { name: 'Comment: Team only' }).click()
    await expect
      .poll(async () => ((await boardRowDb(board.id)).access as Record<string, string>).comment)
      .toBe('team')
    await expect(admin.getByRole('status', { name: 'Custom' })).toBeVisible()
    // One audit row per save: Team only, Everyone, then the Custom change.
    await expect
      .poll(async () => (await auditRows('board.access.changed', board.id)).length)
      .toBe(3)
    const rows = await auditRows('board.access.changed', board.id)
    expect(JSON.stringify(rows[2].after_value)).toContain('"comment":"team"')
  }
)

test(
  'FBA-T-09 after a board goes Team only, its earlier follower gets no email or bell',
  { tag: '@core' },
  async ({ playwright, browser, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const customer = await portalCustomer(browser, marker)
    const post = await customerPost(customer, { boardId: board.id, title: `${marker} wish` })
    const sql = supportDb()

    // While public, a status change reaches the author: email and bell.
    const first = await callServerFn(api, 'changePostStatusFn', {
      id: post.id,
      statusId: await statusIdBySlug('planned'),
    })
    expect(first.ok, first.raw).toBe(true)
    const bellsOf = async () => sql`SELECT id FROM in_app_notifications
                                     WHERE principal_id = ${customer.principalUuid}`
    const mailOf = async () => sql`SELECT id FROM email_log WHERE address = ${customer.email}`
    await expect.poll(async () => (await bellsOf()).length, { timeout: 15_000 }).toBe(1)
    await expect.poll(async () => (await mailOf()).length, { timeout: 15_000 }).toBe(1)

    const narrowed = await callServerFn(api, 'updateBoardAccessFn', {
      boardId: board.id,
      access: {
        ...((await boardRowDb(board.id)).access as Record<string, unknown>),
        view: 'team',
        vote: 'team',
        comment: 'team',
        submit: 'team',
        segments: { view: [], vote: [], comment: [], submit: [] },
      },
    })
    expect(narrowed.ok, narrowed.raw).toBe(true)
    const second = await callServerFn(api, 'changePostStatusFn', {
      id: post.id,
      statusId: await statusIdBySlug('in_progress'),
    })
    expect(second.ok, second.raw).toBe(true)
    await waitForEventType(post.id, 'post.status_changed')
    // Give the fan-out time to (wrongly) deliver.
    await new Promise((r) => setTimeout(r, 4000))
    expect((await bellsOf()).length).toBe(1)
    expect((await mailOf()).length).toBe(1)

    // The earlier bell is now redacted for the customer.
    const list = await callServerFn<{ notifications: Array<Record<string, unknown>> }>(
      customer.api,
      'getNotificationsFn',
      { limit: 20 },
      { method: 'GET' }
    )
    expect(list.ok, list.raw).toBe(true)
    expect(JSON.stringify(list.data)).toContain('This activity is no longer visible to you.')
    expect(JSON.stringify(list.data)).not.toContain(marker)
    await customer.close()
    await api.dispose()
  }
)

test(
  'FBA-T-10 the Data tab exports the board as CSV and links to Imports & exports',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await makePost(api, { boardId: board.id, title: `${marker} exported idea` })
    await api.dispose()

    const admin = await asPerson('admin')
    await openBoardSettings(admin, board.slug, 'data')
    await expect(admin.getByText("Download this board's posts as a CSV file.")).toBeVisible()
    await waitForHydration(admin.getByRole('button', { name: 'Export CSV' }))
    const download = admin.waitForEvent('download')
    await admin.getByRole('button', { name: 'Export CSV' }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.csv$/)
    const body = readFileSync(await file.path(), 'utf8')
    expect(body).toContain(`${marker} exported idea`)

    // The import link does not carry the board (the hub picks one).
    const link = admin.getByRole('link', { name: 'Go to Imports & exports' })
    await expect(link).toHaveAttribute('href', '/admin/settings/imports')
  }
)

test(
  'FBA-T-11 an unknown board slug goes back to the list and a Contributor cannot open board settings',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const admin = await asPerson('admin')
    await admin.goto(`/admin/settings/boards/${marker}-nope`)
    await expect(admin).toHaveURL(/\/admin\/settings\/boards$/)

    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await api.dispose()
    await admin.goto(`/admin/settings/boards/${board.slug}?tab=moderation`)
    await expect(admin.getByRole('tab', { name: 'Moderation' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    const contributor = await asPerson('contributor')
    await contributor.goto(`/admin/settings/boards/${board.slug}`)
    await expect(contributor).toHaveURL(/error=not_team_member/)
  }
)

test(
  'FBA-T-12 the boards page Email card says which address feedback email is sent from',
  { tag: '@nightly' },
  async ({ asPerson }) => {
    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/boards')
    await expect(admin.getByText('Updates to people who follow a post.')).toBeVisible()
    await expect(admin.getByText(/Sent from/i).first()).toBeVisible()
  }
)

test(
  'FBA-T-03 at the plan board cap New board is disabled and the server refuses a create',
  { tag: '@nightly' },
  async () => {
    test.skip(
      true,
      'needs a plan with a board cap; the self-hosted build has no plan limits to switch on safely'
    )
  }
)
