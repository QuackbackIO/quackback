/**
 * The team's post modal and New post dialog: create, edit, status, owner, ETA,
 * tags, board, lock, delete and restore, activity, and a Contributor's limits.
 *
 * Journeys: FBA-P-01 FBA-P-07
 */
import { test, expect } from '../../support/fixtures'
import { personApi } from '../../support/server-fns'
import { supportDb, pollFor } from '../../support/db'
import { hooksApi, subscribe, unsubscribe, deliveriesOf, bodyOf } from '../../support/webhooks'
import { makeBoard, makePost, openInbox, openPost, uuid } from '../../product/feedback-admin'
import {
  activityOf,
  openActivity,
  pickStatus,
  sidebarRow,
  subscriptionsOf,
  votesOf,
  waitForPostEvent,
} from '../../product/feedback-admin-posts'

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
      await admin.getByRole('button', { name: 'New post' }).click()
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
      expect((await subscriptionsOf(postId)).map((s) => s.principal_id)).toEqual([adminUuid])

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
    const changed = (await activityOf(post.id)).filter((a) => a.type === 'status.changed')
    expect(changed).toHaveLength(1)
    expect(changed[0].metadata).toMatchObject({ fromName: 'Open', toName: 'Planned' })

    await admin.reload()
    await expect(admin.getByRole('dialog')).toBeVisible()
    await expect(sidebarRow(admin, 'Status').getByRole('button', { name: 'Planned' })).toBeVisible()
    await openActivity(admin, /changed status/)
  }
)
