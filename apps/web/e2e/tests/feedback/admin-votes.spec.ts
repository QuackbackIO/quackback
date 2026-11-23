/**
 * Votes the team manages from the post modal: add a voter on someone's
 * behalf, create a person and vote for them, remove a vote, the voters list
 * and a voter's notification level.
 *
 * Journeys: FBA-P-22 FBA-P-23 FBA-P-25 FBA-P-26 FBA-P-27
 */
import type { Page } from '@playwright/test'
import { fromUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { supportDb, pollFor } from '../../support/db'
import { mintCustomer } from '../../support/widget-portal'
import {
  customerPost,
  makeBoard,
  makePost,
  openPost,
  portalCustomer,
  postRow,
  uuid,
} from '../../product/feedback-admin'
import {
  activityOf,
  popover,
  principalUuid,
  subscriptionsOf,
  votesOf,
  waitForActivity,
} from '../../product/feedback-admin-posts'

/** Open the Voters dialog from the sidebar's avatar stack. */
async function openVoters(page: Page, count: number) {
  await page.getByRole('dialog').first().locator('button[class*="-space-x-2"]').click()
  const voters = page.getByRole('dialog', { name: `Voters (${count})` })
  await expect(voters).toBeVisible()
  return voters
}

function voterRow(voters: ReturnType<Page['getByRole']>, name: string) {
  return voters.locator('div.group').filter({ hasText: name })
}

/** The X shows on hover only. */
async function removeVoteOf(voters: ReturnType<Page['getByRole']>, name: string) {
  const row = voterRow(voters, name)
  await row.hover()
  await row.getByRole('button', { name: 'Remove vote' }).click()
}

test(
  'FBA-P-22 Add voter casts a proxy vote, subscribes the person and labels it Added by the teammate',
  { tag: '@core' },
  async ({ playwright, people, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} proxy me` })
    await api.dispose()
    const person = await mintCustomer({
      email: `${marker}@customers.example`,
      name: `Voter ${marker.slice(-12)}`,
    })

    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    await admin.getByRole('dialog').getByRole('button', { name: 'Add voter' }).click()
    await popover(admin).getByPlaceholder('Search members...').fill(person.name)
    await popover(admin)
      .getByRole('button', { name: new RegExp(person.name) })
      .first()
      .click()

    const vote = await pollFor('the proxy vote', async () =>
      (await votesOf(post.id)).find((v) => v.principal_id === person.principalUuid)
    )
    expect(vote).toMatchObject({
      source_type: 'proxy',
      added_by_principal_id: principalUuid(people.people.admin.principalId),
    })
    expect((await postRow(post.id))?.vote_count).toBe(2)
    const [proxy] = await waitForActivity(post.id, 'vote.proxy')
    expect(proxy?.metadata).toMatchObject({ voterName: person.name })
    const sub = (await subscriptionsOf(post.id)).find(
      (s) => s.principal_id === person.principalUuid
    )
    expect(sub).toMatchObject({
      reason: 'vote',
      notify_comments: true,
      notify_status_changes: true,
    })

    const voters = await openVoters(admin, 2)
    await expect(voterRow(voters, person.name)).toContainText('Added by Ada Admin')
  }
)

test(
  'FBA-P-23 Add voter can create a new person and vote for them; a bad email is refused',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const post = await makePost(api, { boardId: board.id, title: `${marker} new voter` })
    await api.dispose()
    const admin = await asPerson('admin')
    await openPost(admin, post.id, post.title)
    await admin.getByRole('dialog').getByRole('button', { name: 'Add voter' }).click()
    const pop = popover(admin)
    await pop.getByRole('button', { name: /New user|Create new user/ }).click()
    const name = `New ${marker.slice(-14)}`
    await pop.getByPlaceholder('Name').fill(name)
    await pop.getByPlaceholder('Email (optional)').fill('not-an-email')
    await pop.getByRole('button', { name: 'Create & add vote' }).click()
    await expect(admin.getByText('Invalid email address').first()).toBeVisible()
    expect(await votesOf(post.id)).toHaveLength(1)

    await pop.getByPlaceholder('Email (optional)').fill(`${marker}-new@customers.example`)
    await pop.getByRole('button', { name: 'Create & add vote' }).click()
    const [created] = await pollFor('the new person', async () => {
      const rows = await supportDb()`
        SELECT p.id FROM principal p JOIN "user" u ON u.id = p.user_id
        WHERE u.email = ${`${marker}-new@customers.example`}`
      return rows.length ? rows : undefined
    })
    const vote = await pollFor('their vote', async () =>
      (await votesOf(post.id)).find((v) => v.principal_id === created.id)
    )
    expect(vote.source_type).toBe('proxy')
  }
)

test(
  'FBA-P-25 removing a vote in the Voters dialog drops the count, logs it and keeps the subscription',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    await api.dispose()
    const customer = await portalCustomer(browser, marker, { name: `Cust ${marker.slice(-12)}` })
    const post = await customerPost(customer, { boardId: board.id, title: `${marker} unvote` })
    await customer.close()
    // The author's own vote is the only one.
    expect((await postRow(post.id))?.vote_count).toBe(1)

    const admin = await asPerson('admin')
    await openPost(admin, post.id)
    const voters = await openVoters(admin, 1)
    await removeVoteOf(voters, customer.name)
    await pollFor('the vote removed', async () =>
      (await votesOf(post.id)).length === 0 ? true : undefined
    )
    expect((await postRow(post.id))?.vote_count).toBe(0)
    const removed = await pollFor('vote.removed', async () =>
      (await activityOf(post.id)).find((a) => a.type === 'vote.removed')
    )
    expect(removed.metadata).toMatchObject({ voterName: customer.name })
    expect((await subscriptionsOf(post.id)).map((s) => s.principal_id)).toContain(
      customer.principalUuid
    )
  }
)

test(
  'FBA-P-26 the voters list joins the merged thread and shows each source',
  { tag: '@nightly' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const canonical = await makePost(api, { boardId: board.id, title: `${marker} canonical` })
    // A customer votes on a duplicate that is then merged into the canonical.
    const customer = await portalCustomer(browser, marker, { name: `Dup ${marker.slice(-12)}` })
    const duplicate = await customerPost(customer, { boardId: board.id, title: `${marker} dupe` })
    await customer.close()
    const merged = await callServerFn(api, 'mergePostFn', {
      duplicatePostId: duplicate.id,
      canonicalPostId: canonical.id,
    })
    expect(merged.ok, merged.raw).toBe(true)
    // An integration vote with a link, and an anonymous voter.
    const viaSlack = await mintCustomer({
      email: `${marker}-slack@customers.example`,
      name: `Slack ${marker.slice(-12)}`,
    })
    // An anonymous visitor as the anonymous plugin makes one (temp-<id>@anon.quackback.io).
    const anon = await mintCustomer({
      email: `temp-${marker}@anon.quackback.io`,
      name: 'Anonymous visitor',
    })
    const sql = supportDb()
    await sql`UPDATE principal SET type = 'anonymous' WHERE id = ${anon.principalUuid}`
    await sql`INSERT INTO post_votes (id, post_id, principal_id, source_type, source_external_url, created_at, updated_at)
              VALUES (gen_random_uuid(), ${uuid(canonical.id)}, ${viaSlack.principalUuid}, 'slack',
                      'https://slack.example/msg/1', now(), now()),
                     (gen_random_uuid(), ${uuid(canonical.id)}, ${anon.principalUuid}, NULL, NULL, now(), now())`
    await api.dispose()

    const admin = await asPerson('admin')
    await openPost(admin, canonical.id)
    const count = Number((await postRow(canonical.id))?.vote_count)
    const voters = await openVoters(admin, count)
    await expect(voters.getByText(customer.name)).toBeVisible()
    await expect(voters.getByText('Ada Admin')).toBeVisible()
    await expect(voters.getByRole('link', { name: /via Slack/ })).toHaveAttribute(
      'href',
      'https://slack.example/msg/1'
    )
    await expect(voters.getByText('Anonymous')).toBeVisible()
    await expect(voters.getByText(/@anon\.quackback\.io/)).toHaveCount(0)
    await expect(voters.getByText('Anonymous visitor')).toHaveCount(0)
  }
)

test(
  'FBA-P-27 a voter notification level is changed from the Voters dialog; a non-voter is refused',
  { tag: '@core' },
  async ({ playwright, browser, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const board = await makeBoard(api, marker)
    const customer = await portalCustomer(browser, marker, { name: `Lvl ${marker.slice(-12)}` })
    const post = await customerPost(customer, { boardId: board.id, title: `${marker} levels` })
    await customer.close()

    const admin = await asPerson('admin')
    await openPost(admin, post.id)
    const voters = await openVoters(admin, 1)
    await voterRow(voters, customer.name).getByRole('button', { name: 'All activity' }).click()
    await admin.getByRole('menuitemradio', { name: 'Status only' }).click()
    await pollFor('status only', async () => {
      const sub = (await subscriptionsOf(post.id)).find(
        (s) => s.principal_id === customer.principalUuid
      )
      return sub && !sub.notify_comments && sub.notify_status_changes ? sub : undefined
    })
    await voterRow(voters, customer.name).getByRole('button', { name: 'Status only' }).click()
    await admin.getByRole('menuitemradio', { name: 'Not subscribed' }).click()
    await pollFor('unsubscribed', async () =>
      (await subscriptionsOf(post.id)).some((s) => s.principal_id === customer.principalUuid)
        ? undefined
        : true
    )

    const stranger = await mintCustomer({ email: `${marker}-x@customers.example` })
    const refused = await callServerFn(api, 'adminUpdateVoterSubscriptionFn', {
      postId: post.id,
      principalId: fromUuid('principal', stranger.principalUuid),
      level: 'all',
    })
    expect(refused.ok).toBe(false)
    expect(refused.code).toBe('NOT_A_VOTER')
    await api.dispose()
  }
)
