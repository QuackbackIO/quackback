/**
 * The team's comments in the post modal: public and private comments,
 * Comment & mark a status, pin, delete, restore and edit.
 *
 * Journeys: FBA-P-28 FBA-P-29 FBA-P-30 FBA-P-32 FBA-P-33 FBA-P-34 FBA-P-40
 */
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { supportDb, pollFor } from '../../support/db'
import {
  customerPost,
  makeBoard,
  makePost,
  openPost,
  portalCustomer,
  postRow,
  statusIdBySlug,
  uuid,
} from '../../product/feedback-admin'
import {
  activityOf,
  commentsOf,
  eventsOfPost,
  openActivity,
  principalUuid,
  subscriptionsOf,
  waitForPostEvent,
  waitForActivity,
} from '../../product/feedback-admin-posts'
import type { Page } from '@playwright/test'

/** Type a comment into the modal's composer and submit it with `button`. */
async function writeComment(page: Page, text: string, button: string | RegExp = 'Comment') {
  const dialog = page.getByRole('dialog')
  // The composer is a stand-in until pressed; the press mounts the editor focused.
  await dialog.getByRole('textbox', { name: 'Write a comment...' }).click()
  await expect(page.locator('[contenteditable="true"]:focus')).toBeVisible()
  await page.keyboard.type(text)
  await dialog.getByRole('button', { name: button, exact: typeof button === 'string' }).click()
}

function commentEl(page: Page, commentId: string) {
  return page.locator(`[id="comment-${commentId}"]`)
}

async function commentIdOf(postId: string, content: string): Promise<string> {
  const { fromUuid } = await import('@quackback/ids')
  const row = await pollFor(`comment "${content}"`, async () =>
    (await commentsOf(postId)).find((c) => c.content.includes(content))
  )
  return fromUuid('post_comment', row.id)
}

test(
  'FBA-P-28 a team comment shows with the team marker, counts, and subscribes the commenter',
  { tag: '@core' },
  async ({ playwright, browser, people, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await api.dispose()
    const customer = await portalCustomer(browser, marker)
    const post = await customerPost(customer, {
      boardId: board.id,
      title: `${marker} needs a reply`,
    })

    const agentB = await asPerson('agentB')
    await openPost(agentB, post.id)
    const text = `${marker} thanks, looking into it`
    await writeComment(agentB, text)
    const commentId = await commentIdOf(post.id, text)
    await expect(commentEl(agentB, commentId).getByText('Team').first()).toBeVisible()

    const [row] = (await commentsOf(post.id)).filter((c) => c.content.includes(text))
    expect(row).toMatchObject({ is_team_member: true, is_private: false })
    expect((await postRow(post.id))?.comment_count).toBe(1)
    await pollFor('the commenter subscription', async () =>
      (await subscriptionsOf(post.id)).length > 1 ? true : undefined
    )
    const subs = await subscriptionsOf(post.id)
    expect(
      subs.find((s) => s.principal_id === principalUuid(people.people.agentB.principalId))
    ).toMatchObject({ reason: 'comment' })
    await waitForPostEvent(post.id, 'comment.created')
    await customer.close()
  }
)

test(
  'FBA-P-29 a private comment is stored private, not counted, and replies to it are forced private',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} internal` })
    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)

    const dialog = admin.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Private', exact: true }).click()
    const text = `${marker} internal note only`
    await writeComment(admin, text)
    const commentId = await commentIdOf(post.id, text)
    const [row] = (await commentsOf(post.id)).filter((c) => c.content.includes(text))
    expect(row.is_private).toBe(true)
    expect((await postRow(post.id))?.comment_count).toBe(0)
    const [event] = await waitForPostEvent(post.id, 'comment.created')
    expect(JSON.stringify(event.payload)).toContain('"isPrivate":true')

    // A reply to the private comment is private even when not asked to be.
    const reply = await callServerFn(api, 'createCommentFn', {
      postId: post.id,
      content: `${marker} reply`,
      parentId: commentId,
      isPrivate: false,
    })
    expect(reply.ok, reply.raw).toBe(true)
    const replyRow = (await commentsOf(post.id)).find((c) => c.content === `${marker} reply`)
    expect(replyRow?.is_private).toBe(true)
    expect((await postRow(post.id))?.comment_count).toBe(0)

    // A customer cannot post a private comment.
    const customer = await portalCustomer(browser, marker)
    const refused = await callServerFn(customer.api, 'createCommentFn', {
      postId: post.id,
      content: `${marker} sneaky`,
      isPrivate: true,
    })
    expect(refused.ok).toBe(false)
    expect(refused.code).toBe('PRIVATE_COMMENT_FORBIDDEN')
    await customer.close()
    await api.dispose()
  }
)

test(
  'FBA-P-30 Comment & mark posts the comment and changes the status in one action',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} mark me` })
    await api.dispose()
    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    const dialog = admin.getByRole('dialog')
    // The composer's status picker shows the current status.
    await dialog
      .locator('form, div')
      .filter({ has: admin.getByRole('button', { name: 'Comment', exact: true }) })
      .last()
      .getByRole('button', { name: 'Open', exact: true })
      .click()
    await admin
      .getByRole('button', { name: /^Planned/ })
      .last()
      .click()
    const text = `${marker} shipping this next`
    await writeComment(admin, text, 'Comment & mark Planned')

    const planned = await statusIdBySlug('planned')
    const open = await statusIdBySlug('open')
    await pollFor('the new status', async () =>
      (await postRow(post.id))?.status_id === uuid(planned) ? true : undefined
    )
    const row = (await commentsOf(post.id)).find((c) => c.content.includes(text))
    expect(row).toMatchObject({
      status_change_from_id: uuid(open),
      status_change_to_id: uuid(planned),
    })
    expect(await waitForActivity(post.id, 'status.changed')).toHaveLength(1)
    await waitForPostEvent(post.id, 'post.status_changed')
    const types = (await eventsOfPost(post.id)).map((e) => e.type)
    expect(types.indexOf('comment.created')).toBeLessThan(types.indexOf('post.status_changed'))
  }
)

test(
  'FBA-P-30 a teammate without post.set_status cannot change status through a comment',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'FBA-P-30: comment.service.ts applies statusId for any team author with no post.set_status check',
    },
  },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const board = await makeBoard(admin, marker)
    const post = await makePost(admin, { boardId: board.id, title: `${marker} no status right` })
    await admin.dispose()
    // noAccess holds post.view_private but not post.set_status.
    const api = await personApi(playwright, 'noAccess')
    await callServerFn(api, 'createCommentFn', {
      postId: post.id,
      content: `${marker} sneaking a status`,
      statusId: await statusIdBySlug('complete'),
    })
    await api.dispose()
    expect((await postRow(post.id))?.status_id).toBe(uuid(await statusIdBySlug('open')))
  }
)

test(
  'FBA-P-32 pinning a team comment makes it the response; pinning another replaces it; unpin clears it',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} pin it` })
    const ids: string[] = []
    for (const n of ['first', 'second']) {
      const res = await callServerFn<{ comment?: { id: string }; id?: string }>(
        api,
        'createCommentFn',
        { postId: post.id, content: `${marker} ${n} answer` }
      )
      expect(res.ok, res.raw).toBe(true)
      ids.push(await commentIdOf(post.id, `${marker} ${n} answer`))
    }
    // Refusals: a customer comment and a private comment cannot be pinned.
    const customer = await portalCustomer(browser, marker)
    await callServerFn(customer.api, 'createCommentFn', {
      postId: post.id,
      content: `${marker} customer says`,
    })
    await customer.close()
    const customerComment = await commentIdOf(post.id, `${marker} customer says`)
    const notTeam = await callServerFn(api, 'pinCommentFn', { commentId: customerComment })
    expect(notTeam.ok).toBe(false)
    expect(notTeam.error).toContain('Only team member comments can be pinned')

    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    await commentEl(admin, ids[0]).getByRole('button', { name: 'Pin', exact: true }).first().click()
    await pollFor('pinned first', async () =>
      (await postRow(post.id))?.pinned_comment_id === uuid(ids[0]) ? true : undefined
    )
    await commentEl(admin, ids[1]).getByRole('button', { name: 'Pin', exact: true }).first().click()
    await pollFor('pinned second', async () =>
      (await postRow(post.id))?.pinned_comment_id === uuid(ids[1]) ? true : undefined
    )
    await commentEl(admin, ids[1])
      .getByRole('button', { name: 'Unpin', exact: true })
      .first()
      .click()
    await pollFor('unpinned', async () =>
      (await postRow(post.id))?.pinned_comment_id === null ? true : undefined
    )
    await waitForActivity(post.id, 'comment.unpinned')
    const types = (await activityOf(post.id)).map((a) => a.type)
    expect(types.filter((t) => t === 'comment.pinned')).toHaveLength(2)
    expect(types.filter((t) => t === 'comment.unpinned')).toHaveLength(1)
    await openActivity(admin, /pinned a response/)
    await api.dispose()
  }
)

test(
  'FBA-P-33 the team deletes a customer comment: placeholder, count drops, comment.removed; a Contributor is refused',
  { tag: '@core' },
  async ({ playwright, browser, people, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await api.dispose()
    const customer = await portalCustomer(browser, marker)
    const post = await customerPost(customer, { boardId: board.id, title: `${marker} spammy` })
    for (const n of ['one', 'two']) {
      const res = await callServerFn(customer.api, 'createCommentFn', {
        postId: post.id,
        content: `${marker} comment ${n}`,
      })
      expect(res.ok, res.raw).toBe(true)
    }
    await customer.close()
    const one = await commentIdOf(post.id, `${marker} comment one`)
    const two = await commentIdOf(post.id, `${marker} comment two`)
    expect((await postRow(post.id))?.comment_count).toBe(2)

    // A Contributor (no comment.edit) is refused by the server.
    const contributor = await personApi(playwright, 'contributor')
    const refused = await callServerFn(contributor, 'userDeleteCommentFn', { commentId: two })
    expect(refused.ok).toBe(false)
    await contributor.dispose()

    const admin = await asPerson('admin')
    await openPost(admin, post.id)
    await commentEl(admin, one).getByRole('button', { name: 'Delete', exact: true }).first().click()
    await admin
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click()
    await pollFor('soft delete', async () =>
      (await commentsOf(post.id)).find((c) => c.content.includes('comment one'))?.deleted_at
        ? true
        : undefined
    )
    const [deleted] = await supportDb()`
      SELECT deleted_by_principal_id FROM post_comments WHERE id = ${uuid(one)}`
    expect(deleted.deleted_by_principal_id).toBe(principalUuid(people.people.admin.principalId))
    expect((await postRow(post.id))?.comment_count).toBe(1)
    expect(
      (await commentsOf(post.id)).find((c) => c.content.includes('comment two'))?.deleted_at
    ).toBeNull()
    await pollFor('comment.removed activity', async () =>
      (await activityOf(post.id)).find((a) => a.type === 'comment.removed')
    )
    await expect(commentEl(admin, one).getByRole('button', { name: 'Restore' })).toBeVisible()
  }
)

test(
  'FBA-P-34 restoring a deleted comment re-counts it; restoring a live comment is refused',
  { tag: '@nightly' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const customer = await portalCustomer(browser, marker)
    const post = await customerPost(customer, { boardId: board.id, title: `${marker} restore c` })
    await callServerFn(customer.api, 'createCommentFn', {
      postId: post.id,
      content: `${marker} keep me`,
    })
    await customer.close()
    const id = await commentIdOf(post.id, `${marker} keep me`)
    const live = await callServerFn(api, 'restoreCommentFn', { commentId: id })
    expect(live.ok).toBe(false)
    expect(live.code).toBe('NOT_DELETED')
    const del = await callServerFn(api, 'userDeleteCommentFn', { commentId: id })
    expect(del.ok, del.raw).toBe(true)
    expect((await postRow(post.id))?.comment_count).toBe(0)

    const admin = await asPerson('admin')
    await openPost(admin, post.id)
    await commentEl(admin, id).getByRole('button', { name: 'Restore', exact: true }).click()
    await pollFor('restored', async () =>
      (await commentsOf(post.id))[0]?.deleted_at === null ? true : undefined
    )
    expect((await postRow(post.id))?.comment_count).toBe(1)
    await pollFor('comment.restored activity', async () =>
      (await activityOf(post.id)).find((a) => a.type === 'comment.restored')
    )
    await api.dispose()
  }
)

test(
  'FBA-P-40 an admin edits a customer comment: content changes, history kept, comment.updated fired; a deleted comment cannot be edited',
  { tag: '@nightly' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await api.dispose()
    const customer = await portalCustomer(browser, marker)
    const post = await customerPost(customer, { boardId: board.id, title: `${marker} typo` })
    await callServerFn(customer.api, 'createCommentFn', {
      postId: post.id,
      content: `${marker} teh typo`,
    })
    await customer.close()
    const id = await commentIdOf(post.id, `${marker} teh typo`)

    const admin = await asPerson('admin')
    await openPost(admin, post.id)
    await commentEl(admin, id).getByRole('button', { name: 'Edit', exact: true }).first().click()
    const editor = admin.getByTestId('edit-comment-editor').locator('[contenteditable="true"]')
    await editor.click()
    await admin.keyboard.press('ControlOrMeta+a')
    await editor.pressSequentially(`${marker} the typo`)
    await commentEl(admin, id).getByRole('button', { name: 'Save', exact: true }).click()
    await pollFor('edited content', async () =>
      (await commentsOf(post.id))[0]?.content === `${marker} the typo` ? true : undefined
    )
    const history = await supportDb()`
      SELECT previous_content FROM post_comment_edit_history WHERE comment_id = ${uuid(id)}`
    expect(history.map((h) => String(h.previous_content))).toContain(`${marker} teh typo`)
    await waitForPostEvent(post.id, 'comment.updated')

    // Editing a deleted comment is refused.
    const adminApi = await personApi(playwright, 'admin')
    await callServerFn(adminApi, 'userDeleteCommentFn', { commentId: id })
    const refused = await callServerFn(adminApi, 'userEditCommentFn', {
      commentId: id,
      content: `${marker} again`,
    })
    expect(refused.ok).toBe(false)
    expect(refused.code).toBe('COMMENT_NOT_FOUND')
    await adminApi.dispose()
  }
)
