/**
 * The team's post modal and New post dialog: create, edit, status, owner, ETA,
 * tags, board, lock, delete and restore, activity, and a Contributor's limits.
 *
 * Journeys: FBA-P-01 FBA-P-02 FBA-P-04 FBA-P-05 FBA-P-07 FBA-P-08 FBA-P-09
 * FBA-P-11 FBA-P-12 FBA-P-13 FBA-P-14 FBA-P-15 FBA-P-17 FBA-P-18 FBA-P-19
 * FBA-P-20 FBA-P-21 FBA-P-35 FBA-P-36 FBA-P-37 FBA-P-41, and the lower rows
 * FBA-P-03 FBA-P-06 FBA-P-10 FBA-P-24 FBA-P-31 at the server-function boundary.
 */
import type { Page } from '@playwright/test'
import { fromUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { supportDb, pollFor } from '../../support/db'
import { hooksApi, subscribe, unsubscribe, deliveriesOf, bodyOf } from '../../support/webhooks'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { mintCustomer } from '../../support/widget-portal'
import { createSupportApiKey } from '../../utils/db-helpers'
import {
  customerPost,
  makeBoard,
  makePost,
  makeTag,
  openInbox,
  openPost,
  portalCustomer,
  postRow,
  statusIdBySlug,
  uuid,
} from '../../product/feedback-admin'
import {
  activityOf,
  activityTypesOf,
  bellsOfPost,
  commentsOf,
  eventsOfPost,
  openActivity,
  pickStatus,
  popover,
  pressManage,
  sidebarRow,
  statusSlugOf,
  subscriptionsOf,
  votesOf,
  waitForPostEvent,
  waitForActivity,
} from '../../product/feedback-admin-posts'

// Well-formed ids nothing has.
const NOBODY = '01900000-0000-7000-8000-000000000000'
const UNKNOWN_POST = fromUuid('post', NOBODY)
const UNKNOWN_BOARD = fromUuid('board', NOBODY)
const UNKNOWN_STATUS = fromUuid('post_status', NOBODY)

/**
 * Open the New post dialog. A press that lands before the inbox has
 * hydrated does nothing, so press again until the form is there.
 */
async function openNewPost(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: 'New post' }).click()
    await expect(page.getByPlaceholder("What's the feedback about?")).toBeVisible({
      timeout: 3_000,
    })
  }).toPass({ timeout: 20_000 })
}

/** Make one status the workspace default (isolated tests only). */
async function setDefaultStatus(statusId: string): Promise<void> {
  await supportDb()`UPDATE post_statuses SET is_default = (id = ${uuid(statusId)})`
}

test(
  'FBA-P-01 a teammate creates a post from the inbox: published, authored by them, one vote and one subscription',
  { tag: '@smoke' },
  async ({ playwright, baseURL, people, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await api.dispose()
    const hooks = await hooksApi(playwright, baseURL, people, marker)
    const hook = await subscribe(hooks, marker, ['post.created'])
    try {
      const admin = await asPerson('admin')
      await openInbox(admin, { board: [board.id] })
      await openNewPost(admin)
      const dialog = admin.getByRole('dialog')
      const title = `${marker} dark mode please`
      await dialog.getByPlaceholder("What's the feedback about?").fill(title)
      await dialog
        .getByRole('combobox')
        .filter({ hasText: /Select board|Board/ })
        .first()
        .click()
      await admin.getByRole('option', { name: board.name }).click()
      await dialog.getByRole('button', { name: 'Create post' }).click()
      await expect(dialog).toBeHidden()

      const [row] = await pollFor('the new post', async () => {
        const rows = await supportDb()`SELECT * FROM posts WHERE title = ${title}`
        return rows.length ? rows : undefined
      })
      const adminUuid = uuid(people.people.admin.principalId)
      expect(row.principal_id).toBe(adminUuid)
      expect(row.board_id).toBe(uuid(board.id))
      expect(row.moderation_state).not.toBe('pending')
      expect(row.vote_count).toBe(1)
      const { fromUuid } = await import('@quackback/ids')
      const postId = fromUuid('post', String(row.id))
      expect((await votesOf(postId)).map((v) => v.principal_id)).toEqual([adminUuid])
      await expect
        .poll(async () => (await subscriptionsOf(postId)).map((s) => s.principal_id))
        .toEqual([adminUuid])

      const [delivery] = await deliveriesOf(marker, 'post.created', postId)
      expect(bodyOf<{ post: { id: string; title: string } }>(delivery).data.post).toMatchObject({
        id: postId,
        title,
      })
      // And it shows in the board's list.
      await expect(admin.locator('h3', { hasText: title })).toBeVisible()
    } finally {
      await unsubscribe(hooks, hook)
      await hooks.dispose()
    }
  }
)

test(
  'FBA-P-07 changing a post status from the sidebar persists, logs from and to, and fires post.status_changed',
  { tag: '@smoke' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} status me` })
    await api.dispose()

    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    await pickStatus(admin, 'Open', 'Planned')
    await expect(sidebarRow(admin, 'Status').getByRole('button', { name: 'Planned' })).toBeVisible()

    const [event] = await waitForPostEvent(post.id, 'post.status_changed')
    expect(JSON.stringify(event.payload)).toContain('Planned')
    const status = await pollFor('the stored status', async () => {
      const [r] = await supportDb()`
        SELECT s.slug FROM posts p JOIN post_statuses s ON s.id = p.status_id
        WHERE p.id = ${uuid(post.id)}`
      return r?.slug === 'planned' ? r.slug : undefined
    })
    expect(status).toBe('planned')
    const changed = await waitForActivity(post.id, 'status.changed')
    expect(changed).toHaveLength(1)
    expect(changed[0].metadata).toMatchObject({ fromName: 'Open', toName: 'Planned' })

    await admin.reload()
    await expect(admin.getByRole('dialog')).toBeVisible()
    await expect(sidebarRow(admin, 'Status').getByRole('button', { name: 'Planned' })).toBeVisible()
    await openActivity(admin, /changed status/)
  }
)

test(
  'FBA-P-02 New post on behalf of a person makes them the author with the vote and subscription; without post.set_author the caller is the author',
  { tag: '@core' },
  async ({ playwright, people, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await api.dispose()
    const person = await mintCustomer({
      email: `${marker}@customers.example`,
      name: `Author ${marker.slice(-12)}`,
    })

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await openNewPost(admin)
    const dialog = admin.getByRole('dialog')
    const title = `${marker} on behalf`
    await dialog.getByPlaceholder("What's the feedback about?").fill(title)
    await dialog
      .getByRole('combobox')
      .filter({ hasText: /Select board|Board/ })
      .first()
      .click()
    await admin.getByRole('option', { name: board.name }).click()
    await dialog
      .getByRole('button', { name: /Ada Admin/ })
      .first()
      .click()
    await popover(admin).getByPlaceholder('Search members...').fill(person.name)
    await popover(admin)
      .getByRole('button', { name: new RegExp(person.name) })
      .first()
      .click()
    await dialog.getByRole('button', { name: 'Create post' }).click()
    await expect(admin.getByRole('button', { name: 'Create post' })).toBeHidden()

    const [row] = await pollFor('the new post', async () => {
      const rows = await supportDb()`SELECT id, principal_id FROM posts WHERE title = ${title}`
      return rows.length ? rows : undefined
    })
    expect(row.principal_id).toBe(person.principalUuid)
    const postId = fromUuid('post', String(row.id))
    expect((await votesOf(postId)).map((v) => v.principal_id)).toEqual([person.principalUuid])
    await expect
      .poll(async () => (await subscriptionsOf(postId)).map((s) => s.principal_id))
      .toEqual([person.principalUuid])

    // The Contributor preset has no post.set_author: the chosen author is ignored.
    const contributor = await personApi(playwright, 'contributor')
    const res = await callServerFn<{ id: string }>(contributor, 'createPostFn', {
      boardId: board.id,
      title: `${marker} by contributor`,
      authorPrincipalId: fromUuid('principal', person.principalUuid),
    })
    await contributor.dispose()
    expect(res.ok, res.raw).toBe(true)
    expect((await postRow(res.data.id))?.principal_id).toBe(
      uuid(people.people.contributor.principalId)
    )
  }
)

test(
  'FBA-P-04 a post created over REST without a status gets the workspace default status',
  {
    tag: ['@nightly', '@isolated', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'FBA-P-04: post.service.ts createPost falls back to the status slugged "open", not the default status',
    },
  },
  async ({ playwright, people, baseURL, marker }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const planned = await statusIdBySlug('planned')
    const open = await statusIdBySlug('open')
    const key = createSupportApiKey(people.people.admin.email, 'personal')
    const rest = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${key}` },
    })
    try {
      // Seeded in SQL: updateStatusFn with only isDefault answers 500 ("No values
      // to set", status.service.ts updateStatus) after it has moved the default.
      await setDefaultStatus(planned)
      const res = await rest.post('/api/v1/posts', {
        data: { boardId: board.id, title: `${marker} via rest` },
      })
      expect(res.status(), await res.text()).toBe(201)
      const body = (await res.json()) as { data: { id: string } }
      expect(await statusSlugOf(body.data.id)).toBe('planned')
    } finally {
      await setDefaultStatus(open)
      await rest.dispose()
      await api.dispose()
    }
  }
)

test(
  'FBA-P-05 editing the title in the modal saves it, closes the modal and fires post.updated with the changed field',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} old title` })
    await api.dispose()
    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    const dialog = admin.getByRole('dialog')
    const save = dialog.getByRole('button', { name: 'Save changes' })
    await expect(save).toBeDisabled()
    const newTitle = `${marker} new title`
    await dialog.getByPlaceholder("What's the feedback about?").fill(newTitle)
    await save.click()
    await expect(admin.getByText('Post updated')).toBeVisible()
    await expect(dialog).toBeHidden()
    expect((await postRow(post.id))?.title).toBe(newTitle)
    await expect(admin.locator('h3', { hasText: newTitle })).toBeVisible()
    const [event] = await waitForPostEvent(post.id, 'post.updated')
    expect(JSON.stringify(event.payload)).toContain('"title"')
    // A title edit writes no activity row (only the creation's).
    expect(
      (await activityTypesOf(post.id)).filter((t) => t !== 'post.created' && t !== 'vote.cast')
    ).toEqual([])
  }
)

test(
  'FBA-P-08 choosing the status a post already has changes nothing',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'FBA-P-08: post.status.ts changeStatus has no same-status guard; re-picking the status re-sends the whole fan-out',
    },
  },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} same status` })
    const same = await callServerFn(api, 'changePostStatusFn', {
      id: post.id,
      statusId: await statusIdBySlug('open'),
    })
    expect(same.ok, same.raw).toBe(true)
    // A real change afterwards is the barrier: once its event is in, any
    // event from the first call would be too.
    await callServerFn(api, 'changePostStatusFn', {
      id: post.id,
      statusId: await statusIdBySlug('planned'),
    })
    await api.dispose()
    await waitForPostEvent(post.id, 'post.status_changed')
    const events = (await eventsOfPost(post.id)).filter((e) => e.type === 'post.status_changed')
    expect(events).toHaveLength(1)
    expect((await activityOf(post.id)).filter((a) => a.type === 'status.changed')).toHaveLength(1)
  }
)

test(
  'FBA-P-09 entering a complete status announces the ship moment once; moving between complete statuses does not',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} ship it` })
    await api.dispose()
    const admin = await asPerson('admin')
    await admin.addInitScript(() => {
      ;(window as unknown as { __ships: number }).__ships = 0
      window.addEventListener('quackback:ship-moment', () => {
        ;(window as unknown as { __ships: number }).__ships++
      })
    })
    await openPost(admin, post.id, post.title)
    const ships = () => admin.evaluate(() => (window as unknown as { __ships: number }).__ships)
    await pickStatus(admin, 'Open', 'Complete')
    await expect.poll(ships).toBe(1)
    await expect(
      sidebarRow(admin, 'Status').getByRole('button', { name: 'Complete' })
    ).toBeVisible()
    await pickStatus(admin, 'Complete', 'Closed')
    await expect.poll(() => statusSlugOf(post.id)).toBe('closed')
    expect(await ships()).toBe(1)
  }
)

test(
  'FBA-P-11 assigning an owner logs it, bells the new owner and fires post.owner_assigned; clearing logs the removal',
  { tag: '@core' },
  async ({ playwright, people, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} own me` })
    await api.dispose()
    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    await sidebarRow(admin, 'Owner').getByRole('button', { name: 'Unassigned' }).click()
    await popover(admin)
      .getByRole('button', { name: /Ben Agent/ })
      .click()
    await expect(admin.getByText('Owner assigned')).toBeVisible()
    const agentB = people.people.agentB.principalId
    expect((await postRow(post.id))?.owner_principal_id).toBe(uuid(agentB))
    const [event] = await waitForPostEvent(post.id, 'post.owner_assigned')
    expect(JSON.stringify(event.payload)).toContain(agentB)
    await pollFor('the owner bell', async () =>
      (await bellsOfPost(post.id)).find(
        (b) => b.type === 'post_owner_assigned' && b.principalId === agentB
      )
    )
    // The assigner gets no bell.
    expect(
      (await bellsOfPost(post.id)).filter((b) => b.principalId === people.people.admin.principalId)
    ).toEqual([])

    await sidebarRow(admin, 'Owner')
      .getByRole('button', { name: /Ben Agent/ })
      .click()
    await popover(admin).getByRole('button', { name: 'Unassigned' }).click()
    await expect(admin.getByText('Owner unassigned')).toBeVisible()
    expect((await postRow(post.id))?.owner_principal_id).toBeNull()
    await expect.poll(() => activityTypesOf(post.id)).toContain('owner.unassigned')
    await waitForActivity(post.id, 'owner.assigned')
    await openActivity(admin, /assigned Ben Agent/)
    await expect(admin.getByRole('dialog').getByText(/removed assignee/)).toBeVisible()
  }
)

test(
  'FBA-P-11 a post owner must be a teammate',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'FBA-P-11: setPostOwnerFn (functions/posts.ts) accepts any principal id; a customer can be made owner',
    },
  },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} customer owner` })
    const customer = await mintCustomer({ email: `${marker}@customers.example` })
    const res = await callServerFn(api, 'setPostOwnerFn', {
      id: post.id,
      ownerId: customer.principalId,
    })
    await api.dispose()
    expect(res.ok).toBe(false)
    expect((await postRow(post.id))?.owner_principal_id).toBeNull()
  }
)

test(
  'FBA-P-12 a month ETA is stored as the first of that UTC month and can be cleared, without activity',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} when` })
    await api.dispose()
    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    await sidebarRow(admin, 'ETA').getByRole('button', { name: 'Set ETA' }).click()
    await popover(admin).getByLabel('ETA').fill('2027-03')
    await expect(admin.getByText('ETA updated')).toBeVisible()
    await expect
      .poll(async () => ((await postRow(post.id))?.eta as Date | null)?.toISOString())
      .toBe('2027-03-01T00:00:00.000Z')
    await sidebarRow(admin, 'ETA').getByRole('button').click()
    await popover(admin).getByRole('button', { name: 'Clear ETA' }).click()
    await expect(admin.getByText('ETA cleared')).toBeVisible()
    await expect.poll(async () => (await postRow(post.id))?.eta ?? null).toBeNull()
    expect((await activityTypesOf(post.id)).filter((t) => t.includes('eta'))).toEqual([])
  }
)

test(
  'FBA-P-13 adding and removing tags logs the names; resubmitting the same set logs nothing',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const red = await makeTag(api, `${marker}-red`)
    const blue = await makeTag(api, `${marker}-blue`)
    const post = await makePost(api, { boardId: board.id, title: `${marker} tag me` })
    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    for (const tag of [red, blue]) {
      await sidebarRow(admin, 'Tags').getByRole('button', { name: 'Add', exact: true }).click()
      await popover(admin).getByRole('button', { name: tag.name }).click()
      await expect(sidebarRow(admin, 'Tags').getByRole('button', { name: tag.name })).toBeVisible()
    }
    // Clicking a chip removes the tag.
    await sidebarRow(admin, 'Tags').getByRole('button', { name: red.name }).click()
    await expect(sidebarRow(admin, 'Tags').getByRole('button', { name: red.name })).toBeHidden()
    const tagRows = async () =>
      (await activityOf(post.id)).filter((a) => a.type.startsWith('tags.'))
    await expect.poll(async () => (await tagRows()).length).toBe(3)
    const rows = await tagRows()
    expect(rows.map((r) => [r.type, r.metadata.tagNames])).toEqual([
      ['tags.added', [red.name]],
      ['tags.added', [blue.name]],
      ['tags.removed', [red.name]],
    ])
    const same = await callServerFn(api, 'updatePostTagsFn', { id: post.id, tagIds: [blue.id] })
    expect(same.ok, same.raw).toBe(true)
    expect(await tagRows()).toHaveLength(3)
    const [assigned] = await supportDb()`
      SELECT count(*)::int AS n FROM post_tag_assignments WHERE post_id = ${uuid(post.id)}`
    expect(assigned.n).toBe(1)
    await api.dispose()
  }
)

test(
  'FBA-P-14 moving a post to another board keeps its votes and logs from and to',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const from = await makeBoard(api, `${marker}-a`)
    const to = await makeBoard(api, `${marker}-b`)
    const post = await makePost(api, { boardId: from.id, title: `${marker} move me` })
    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    await sidebarRow(admin, 'Board').getByRole('button', { name: from.name }).click()
    await popover(admin).getByRole('button', { name: to.name }).click()
    await expect(admin.getByText('Board updated')).toBeVisible()
    expect((await postRow(post.id))?.board_id).toBe(uuid(to.id))
    expect(await votesOf(post.id)).toHaveLength(1)
    const moved = await pollFor('post.board_changed', async () =>
      (await activityOf(post.id)).find((a) => a.type === 'post.board_changed')
    )
    expect(moved.metadata).toMatchObject({ fromBoardName: from.name, toBoardName: to.name })
    await openActivity(admin, /moved to a different board/)

    // The same board again is a no-op; a read-only board refuses the move.
    await callServerFn(api, 'changePostBoardFn', { id: post.id, boardId: to.id })
    expect((await activityOf(post.id)).filter((a) => a.type === 'post.board_changed')).toHaveLength(
      1
    )
    await callServerFn(api, 'updateBoardFn', { id: from.id, readOnly: true })
    const refused = await callServerFn(api, 'changePostBoardFn', { id: post.id, boardId: from.id })
    expect(refused.code).toBe('BOARD_READ_ONLY')
    await api.dispose()
  }
)

test(
  'FBA-P-15 locking comments stops customers but not the team; unlocking lets customers back in',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} lock me` })
    const customer = await portalCustomer(browser, marker)
    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    await pressManage(admin, 'Lock comments')
    await expect.poll(async () => (await postRow(post.id))?.is_comments_locked).toBe(true)
    const refused = await callServerFn(customer.api, 'createCommentFn', {
      postId: post.id,
      content: `${marker} let me in`,
    })
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain('Comments are locked on this post')
    const team = await callServerFn(api, 'createCommentFn', {
      postId: post.id,
      content: `${marker} team still talks`,
    })
    expect(team.ok, team.raw).toBe(true)

    await pressManage(admin, 'Unlock comments')
    await expect.poll(async () => (await postRow(post.id))?.is_comments_locked).toBe(false)
    const allowed = await callServerFn(customer.api, 'createCommentFn', {
      postId: post.id,
      content: `${marker} thanks`,
    })
    expect(allowed.ok, allowed.raw).toBe(true)
    await waitForActivity(post.id, 'comments.locked')
    await waitForActivity(post.id, 'comments.unlocked')
    await customer.close()
    await api.dispose()
  }
)

test(
  'FBA-P-17 deleting a post soft-deletes it, logs it, fires post.deleted and takes it off the list',
  { tag: '@core' },
  async ({ playwright, people, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} delete me` })
    await api.dispose()
    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    await pressManage(admin, 'Delete post')
    const confirm = admin.getByRole('alertdialog')
    await confirm
      .getByRole('button', { name: /Delete/ })
      .last()
      .click()
    await expect(admin.getByText('Post deleted')).toBeVisible()
    const row = await postRow(post.id)
    expect(row?.deleted_at).not.toBeNull()
    expect(row?.deleted_by_principal_id).toBe(uuid(people.people.admin.principalId))
    await waitForPostEvent(post.id, 'post.deleted')
    await expect.poll(() => activityTypesOf(post.id)).toContain('post.deleted')
    await openInbox(admin, { board: [board.id] })
    await expect(admin.getByRole('button', { name: 'New post' })).toBeVisible()
    await expect(admin.locator('h3', { hasText: post.title })).toHaveCount(0)
    await openInbox(admin, { board: [board.id], deleted: true })
    await expect(admin.locator('h3', { hasText: post.title })).toBeVisible()
  }
)

test(
  'FBA-P-17 post.deleted from the post modal names who deleted it',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'FBA-P-17: post.user-actions.ts builds the event actor from principalId and userId only, so dispatchPostDeleted has no email or name for deletedBy',
    },
  },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} who deleted` })
    expect((await callServerFn(api, 'deletePostFn', { id: post.id })).ok).toBe(true)
    await api.dispose()
    const [event] = await waitForPostEvent(post.id, 'post.deleted')
    expect(event.payload).toMatchObject({ deletedBy: 'e2e-support-admin@example.com' })
  }
)

test(
  'FBA-P-18 deleting twice, an unknown post, or as a Contributor is refused',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} twice` })
    const contributor = await personApi(playwright, 'contributor')
    const denied = await callServerFn(contributor, 'deletePostFn', { id: post.id })
    await contributor.dispose()
    expect(denied.ok).toBe(false)
    expect((await postRow(post.id))?.deleted_at).toBeNull()
    expect((await callServerFn(api, 'deletePostFn', { id: post.id })).ok).toBe(true)
    const again = await callServerFn(api, 'deletePostFn', { id: post.id })
    expect(again.code).toBe('DELETE_NOT_ALLOWED')
    const unknown = await callServerFn(api, 'deletePostFn', { id: UNKNOWN_POST })
    expect(unknown.code).toBe('POST_NOT_FOUND')
    await api.dispose()
  }
)

test(
  'FBA-P-19 restoring from the Deleted posts view brings the post back with its votes and logs it',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} bring back` })
    expect((await callServerFn(api, 'deletePostFn', { id: post.id })).ok).toBe(true)
    await api.dispose()
    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id], deleted: true })
    await admin.locator('h3', { hasText: post.title }).click()
    await pressManage(admin, 'Restore post')
    await expect(admin.getByText('Post restored')).toBeVisible()
    expect((await postRow(post.id))?.deleted_at).toBeNull()
    expect(await votesOf(post.id)).toHaveLength(1)
    await waitForPostEvent(post.id, 'post.restored')
    await waitForActivity(post.id, 'post.restored')
    await openInbox(admin, { board: [board.id] })
    await expect(admin.locator('h3', { hasText: post.title })).toBeVisible()
  }
)

test(
  'FBA-P-20 restoring a live post or one deleted over 30 days ago is refused',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} too late` })
    const live = await callServerFn(api, 'restorePostFn', { id: post.id })
    expect(live.ok).toBe(false)
    expect(live.error).toContain('Post is not deleted')
    await callServerFn(api, 'deletePostFn', { id: post.id })
    await supportDb()`UPDATE posts SET deleted_at = now() - interval '31 days'
                      WHERE id = ${uuid(post.id)}`
    const late = await callServerFn(api, 'restorePostFn', { id: post.id })
    expect(late.code).toBe('RESTORE_EXPIRED')
    expect((await postRow(post.id))?.deleted_at).not.toBeNull()
    await api.dispose()
  }
)

test(
  'FBA-P-21 deleting a canonical post does not hide its merged duplicates',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'FBA-P-21: post.user-actions.ts softDeletePost never releases the duplicates of a deleted canonical; the inbox hides every post with canonical_post_id',
    },
  },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const canonical = await makePost(api, { boardId: board.id, title: `${marker} canonical` })
    const duplicate = await makePost(api, { boardId: board.id, title: `${marker} duplicate` })
    const merged = await callServerFn(api, 'mergePostFn', {
      duplicatePostId: duplicate.id,
      canonicalPostId: canonical.id,
    })
    expect(merged.ok, merged.raw).toBe(true)
    expect((await callServerFn(api, 'deletePostFn', { id: canonical.id })).ok).toBe(true)
    await api.dispose()
    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expect(admin.locator('h3', { hasText: duplicate.title })).toBeVisible()
  }
)

test(
  'FBA-P-35 the Activity tab lists what the team did, newest first',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const other = await makeBoard(api, `${marker}-to`)
    const tag = await makeTag(api, `${marker}-t`)
    const post = await makePost(api, { boardId: board.id, title: `${marker} history` })
    const steps: [string, unknown][] = [
      ['changePostStatusFn', { id: post.id, statusId: await statusIdBySlug('planned') }],
      ['updatePostTagsFn', { id: post.id, tagIds: [tag.id] }],
      ['changePostBoardFn', { id: post.id, boardId: other.id }],
      ['toggleCommentsLockFn', { id: post.id, locked: true }],
    ]
    const before = (await activityOf(post.id)).length
    for (const [i, [fn, data]] of steps.entries()) {
      const res = await callServerFn(api, fn, data)
      expect(res.ok, `${fn}: ${res.raw}`).toBe(true)
      // Activity is written after the response; wait so the order is strict.
      await expect.poll(async () => (await activityOf(post.id)).length).toBe(before + i + 1)
    }
    await api.dispose()

    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    await openActivity(admin, /locked comments/)
    const lines = admin
      .getByRole('dialog')
      .getByText(
        /(created this post|changed status|added tags|moved to a different board|locked comments)$/
      )
    await expect(lines).toHaveText([
      /locked comments/,
      /moved to a different board/,
      /added tags/,
      /changed status/,
      /created this post/,
    ])
  }
)

test(
  'FBA-P-36 the retry-sync control answers that there is no sync work for a post with no links',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} sync` })
    const res = await callServerFn<{ queued?: number }>(api, 'retryPostIntegrationSyncFn', {
      id: post.id,
    })
    expect(res.ok, res.raw).toBe(true)
    const unknown = await callServerFn(api, 'retryPostIntegrationSyncFn', { id: UNKNOWN_POST })
    expect(unknown.code).toBe('POST_NOT_FOUND')
    await api.dispose()
    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    const buttons = admin
      .getByRole('dialog')
      .getByText('Manage', { exact: true })
      .locator('xpath=..')
      .locator('button')
      .filter({ visible: true })
    await buttons.first().hover()
    await expect(admin.getByText('Sync integrations').filter({ visible: true })).toBeVisible()
    await buttons.first().click()
    await expect(admin.getByText('No new sync work to queue')).toBeVisible()
  }
)

test(
  'FBA-P-37 a Contributor can change status and tags but is refused edit, delete, ETA and lock',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const tag = await makeTag(api, `${marker}-c`)
    const post = await makePost(api, { boardId: board.id, title: `${marker} contributor` })
    await api.dispose()

    const page = await asPerson('contributor')
    await openPost(page, post.id, post.title)
    await pickStatus(page, 'Open', 'Planned')
    await expect(sidebarRow(page, 'Status').getByRole('button', { name: 'Planned' })).toBeVisible()
    await expect.poll(() => statusSlugOf(post.id), { timeout: 15_000 }).toBe('planned')

    const contributor = await personApi(playwright, 'contributor')
    const tags = await callServerFn(contributor, 'updatePostTagsFn', {
      id: post.id,
      tagIds: [tag.id],
    })
    expect(tags.ok, tags.raw).toBe(true)
    for (const [fn, data] of [
      ['updatePostFn', { id: post.id, title: `${marker} renamed` }],
      ['deletePostFn', { id: post.id }],
      ['setPostEtaFn', { id: post.id, eta: '2027-01-01T00:00:00.000Z' }],
      ['toggleCommentsLockFn', { id: post.id, locked: true }],
    ] as const) {
      const res = await callServerFn(contributor, fn, data)
      expect(res.ok, fn).toBe(false)
    }
    await contributor.dispose()
    const row = await postRow(post.id)
    expect(row).toMatchObject({
      title: post.title,
      deleted_at: null,
      eta: null,
      is_comments_locked: false,
    })

    // The title field is still offered; saving it ends in the permission error.
    // The status picker is a dialog too (and can still be closing), so name the
    // post modal by its title field rather than by role alone.
    const modal = page
      .getByRole('dialog')
      .filter({ has: page.getByPlaceholder("What's the feedback about?") })
    await modal.getByPlaceholder("What's the feedback about?").fill('x')
    await modal.getByRole('button', { name: 'Save changes' }).click()
    // Wait for the refusal to come back before reading the row.
    await expect(page.locator('[data-sonner-toast][data-type="error"]').first()).toBeVisible()
    await expect(modal).toBeVisible()
    expect((await postRow(post.id))?.title).toBe(post.title)
  }
)

test(
  'FBA-P-41 the post modal shows the post it was opened for',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const tag = await makeTag(api, `${marker}-d`)
    await api.dispose()
    const customer = await portalCustomer(browser, marker, { name: `Det ${marker.slice(-12)}` })
    const post = await customerPost(customer, {
      boardId: board.id,
      title: `${marker} the details`,
      content: `${marker} body text`,
    })
    // A second post on the same board must not bleed into the modal.
    await customerPost(customer, { boardId: board.id, title: `${marker} another one` })
    for (const n of ['one', 'two']) {
      await callServerFn(customer.api, 'createCommentFn', {
        postId: post.id,
        content: `${marker} comment ${n}`,
      })
    }
    await customer.close()
    const adminApi = await personApi(playwright, 'admin')
    await callServerFn(adminApi, 'updatePostTagsFn', { id: post.id, tagIds: [tag.id] })
    await adminApi.dispose()

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await admin.locator('h3', { hasText: post.title }).click()
    const dialog = admin.getByRole('dialog')
    await expect(dialog.getByPlaceholder("What's the feedback about?")).toHaveValue(post.title)
    await expect(dialog.getByText(`${marker} body text`)).toBeVisible()
    await expect(sidebarRow(admin, 'Author')).toContainText(customer.name)
    await expect(sidebarRow(admin, 'Board')).toContainText(board.name)
    await expect(sidebarRow(admin, 'Status')).toContainText('Open')
    await expect(sidebarRow(admin, 'Tags')).toContainText(tag.name)
    await expect(dialog.getByText('2 comments', { exact: false })).toBeVisible()
    const [view] = await Promise.all([
      admin.waitForEvent('popup'),
      dialog.getByRole('button', { name: 'View' }).click(),
    ])
    expect(view.url()).toMatch(new RegExp(`/b/${board.slug}/posts/${post.id}$`))
    await view.close()
    await expect(dialog.getByText(`${marker} another one`)).toHaveCount(0)
  }
)

// Lower rows, proved at the server-function boundary (the named unit files
// mock the database and do not cover these refusals end to end).

test(
  'FBA-P-03 New post refusals: empty or long title, long body, unknown board or status, read-only board',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const create = (data: Record<string, unknown>) =>
      callServerFn(api, 'createPostFn', { boardId: board.id, title: `${marker} ok`, ...data })
    expect((await create({ title: '' })).ok).toBe(false)
    expect((await create({ title: 'x'.repeat(201) })).ok).toBe(false)
    expect((await create({ content: 'x'.repeat(10_001) })).ok).toBe(false)
    expect((await create({ boardId: UNKNOWN_BOARD })).code).toBe('BOARD_NOT_FOUND')
    expect((await create({ statusId: UNKNOWN_STATUS })).code).toBe('STATUS_NOT_FOUND')
    await callServerFn(api, 'updateBoardFn', { id: board.id, readOnly: true })
    const closed = await create({})
    expect(closed.code).toBe('BOARD_READ_ONLY')
    expect(closed.error).toContain("This board isn't taking new feedback right now.")
    const [n] =
      await supportDb()`SELECT count(*)::int AS n FROM posts WHERE board_id = ${uuid(board.id)}`
    expect(n.n).toBe(0)
    await api.dispose()
  }
)

test(
  'FBA-P-06 edit refusals: an empty title toasts in the modal; blank, long title and long body are refused',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} keep title` })
    for (const data of [
      { title: '' },
      { title: '   ' },
      { title: 'x'.repeat(201) },
      { content: 'x'.repeat(10_001) },
    ]) {
      const res = await callServerFn(api, 'updatePostFn', { id: post.id, ...data })
      expect(res.ok, JSON.stringify(data).slice(0, 40)).toBe(false)
    }
    await api.dispose()
    expect((await postRow(post.id))?.title).toBe(post.title)
    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    await admin.getByRole('dialog').getByPlaceholder("What's the feedback about?").fill('')
    await admin.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click()
    await expect(admin.getByText('Title is required')).toBeVisible()
  }
)

test(
  'FBA-P-10 status change refusals: unknown status or post; a deleted post can still be re-statused',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} statuses` })
    const planned = await statusIdBySlug('planned')
    expect(
      (await callServerFn(api, 'changePostStatusFn', { id: post.id, statusId: UNKNOWN_STATUS }))
        .code
    ).toBe('STATUS_NOT_FOUND')
    expect(
      (await callServerFn(api, 'changePostStatusFn', { id: UNKNOWN_POST, statusId: planned })).code
    ).toBe('POST_NOT_FOUND')
    await callServerFn(api, 'deletePostFn', { id: post.id })
    const deleted = await callServerFn(api, 'changePostStatusFn', {
      id: post.id,
      statusId: planned,
    })
    expect(deleted.ok, deleted.raw).toBe(true)
    expect(await statusSlugOf(post.id)).toBe('planned')
    await api.dispose()
  }
)

test(
  'FBA-P-24 proxy vote refusals: read-only board, unknown or deleted post; a duplicate votes on its canonical',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const canonical = await makePost(api, { boardId: board.id, title: `${marker} canon` })
    const duplicate = await makePost(api, { boardId: board.id, title: `${marker} dup` })
    const gone = await makePost(api, { boardId: board.id, title: `${marker} gone` })
    await callServerFn(api, 'mergePostFn', {
      duplicatePostId: duplicate.id,
      canonicalPostId: canonical.id,
    })
    await callServerFn(api, 'deletePostFn', { id: gone.id })
    const voter = await mintCustomer({ email: `${marker}@customers.example` })
    const vote = (postId: string) =>
      callServerFn(api, 'proxyVoteFn', { postId, voterPrincipalId: voter.principalId })

    expect((await vote(UNKNOWN_POST)).code).toBe('POST_NOT_FOUND')
    expect((await vote(gone.id)).code).toBe('POST_NOT_FOUND')
    const onDup = await vote(duplicate.id)
    expect(onDup.ok, onDup.raw).toBe(true)
    expect((await votesOf(canonical.id)).map((v) => v.principal_id)).toContain(voter.principalUuid)
    expect((await votesOf(duplicate.id)).map((v) => v.principal_id)).not.toContain(
      voter.principalUuid
    )

    const closedBoard = await makeBoard(api, `${marker}-ro`)
    const closedPost = await makePost(api, { boardId: closedBoard.id, title: `${marker} ro` })
    await callServerFn(api, 'updateBoardFn', { id: closedBoard.id, readOnly: true })
    expect((await vote(closedPost.id)).code).toBe('BOARD_READ_ONLY')
    expect(await votesOf(closedPost.id)).toHaveLength(1)
    await api.dispose()
  }
)

test(
  'FBA-P-31 comment refusals: a parent from another post, a read-only board, a deleted board',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const a = await makePost(api, { boardId: board.id, title: `${marker} a` })
    const b = await makePost(api, { boardId: board.id, title: `${marker} b` })
    await callServerFn(api, 'createCommentFn', { postId: a.id, content: `${marker} on a` })
    const [parent] = await commentsOf(a.id)
    const mismatch = await callServerFn(api, 'createCommentFn', {
      postId: b.id,
      content: `${marker} wrong parent`,
      parentId: fromUuid('post_comment', parent.id),
    })
    expect(mismatch.code).toBe('VALIDATION_ERROR')
    expect(mismatch.error).toContain('Parent comment belongs to a different post')

    await callServerFn(api, 'updateBoardFn', { id: board.id, readOnly: true })
    expect(
      (await callServerFn(api, 'createCommentFn', { postId: a.id, content: `${marker} ro` })).code
    ).toBe('BOARD_READ_ONLY')

    const doomed = await makeBoard(api, `${marker}-del`)
    const onDoomed = await makePost(api, { boardId: doomed.id, title: `${marker} doomed` })
    expect((await callServerFn(api, 'deleteBoardFn', { id: doomed.id })).ok).toBe(true)
    expect(
      (await callServerFn(api, 'createCommentFn', { postId: onDoomed.id, content: `${marker} x` }))
        .code
    ).toBe('POST_NOT_FOUND')
    expect(await commentsOf(b.id)).toHaveLength(0)
    await api.dispose()
  }
)
