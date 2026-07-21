/**
 * Board access-matrix E2E (PR #191).
 *
 * Proves the per-action access tiers (view / vote / comment / submit:
 * anonymous ⊂ authenticated ⊂ segments ⊂ team), the workspace allowAnonymous
 * master switch, and team bypass — across four real identities established
 * in-test via magic-link:
 *   - anonymous (no session)
 *   - authenticated user (no segment)
 *   - segment member (in the board's allowlist)
 *   - team admin
 *
 * Runs serially: it toggles the workspace allowAnonymous switch and shares the
 * e2e-* board fixtures, so tests must not interleave.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  loginViaMagicLink,
  setupAccessFixtures,
  setWorkspaceAnon,
  type AccessFixtures,
} from '../../utils/access-helpers'

const MEMBER_EMAIL = 'e2e-seg-member@example.test'
const PLAIN_EMAIL = 'e2e-plain-user@example.test'
const ADMIN_EMAIL = 'demo@example.com'

test.describe.configure({ mode: 'serial' })

let fx: AccessFixtures
let anonCtx: BrowserContext
let userCtx: BrowserContext
let memberCtx: BrowserContext
let adminCtx: BrowserContext
let anon: Page
let user: Page
let member: Page
let admin: Page

const PROBE_POST = 'E2E access probe post' // seeded once per board by the fixtures
const BOARD_DISPLAY: Record<keyof AccessFixtures['boards'], string> = {
  public: 'E2E Public',
  allanon: 'E2E All Anonymous',
  segview: 'E2E Segment View',
  mixedseg: 'E2E Mixed Segment',
  private: 'E2E Private',
  mod: 'E2E Moderated',
}

/**
 * Board display-names the actor can VIEW. The portal board-list UI is a
 * custom popover without stable roles, so instead of scraping it we probe the
 * server's view filter directly: each board has exactly one seeded probe post,
 * and the board-filtered feed (`/?board=<slug>`) surfaces it iff `canViewBoard`
 * passes for this actor. Deterministic, and a stronger assertion than nav text.
 */
async function visibleBoardNames(page: Page): Promise<string[]> {
  const names: string[] = []
  for (const key of Object.keys(BOARD_DISPLAY) as Array<keyof AccessFixtures['boards']>) {
    await page.goto(`/?board=${fx.boards[key].slug}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(600) // let the filtered feed settle
    const body = await page.locator('body').innerText()
    if (body.includes(PROBE_POST)) names.push(BOARD_DISPLAY[key])
  }
  return names
}

test.beforeAll(async ({ browser }) => {
  anonCtx = await browser.newContext()
  userCtx = await browser.newContext()
  memberCtx = await browser.newContext()
  adminCtx = await browser.newContext()

  // Establish identities (magic-link verify auto-creates the user).
  await loginViaMagicLink(userCtx, PLAIN_EMAIL)
  await loginViaMagicLink(memberCtx, MEMBER_EMAIL)
  await loginViaMagicLink(adminCtx, ADMIN_EMAIL, { role: 'admin' })

  // Provision boards + segment, and add the member to the segment (member
  // principal exists now that they've signed in).
  fx = setupAccessFixtures(MEMBER_EMAIL)
  setWorkspaceAnon(true) // baseline ON

  anon = await anonCtx.newPage()
  user = await userCtx.newPage()
  member = await memberCtx.newPage()
  admin = await adminCtx.newPage()
})

test.afterAll(async () => {
  setWorkspaceAnon(true) // restore baseline
  await Promise.all([anonCtx?.close(), userCtx?.close(), memberCtx?.close(), adminCtx?.close()])
})

test.describe('view tier — board-list visibility', () => {
  test('anonymous sees only anonymous-view boards', async () => {
    const names = await visibleBoardNames(anon)
    expect(names).toContain('E2E Public')
    expect(names).toContain('E2E All Anonymous')
    expect(names).not.toContain('E2E Segment View')
    expect(names).not.toContain('E2E Mixed Segment')
    expect(names).not.toContain('E2E Private')
  })

  test('authenticated non-member: anon-view boards yes, segment/team boards no', async () => {
    const names = await visibleBoardNames(user)
    expect(names).toContain('E2E Public')
    expect(names).not.toContain('E2E Segment View')
    expect(names).not.toContain('E2E Mixed Segment')
    expect(names).not.toContain('E2E Private')
  })

  test('segment member sees the segment boards (view:segments[A])', async () => {
    const names = await visibleBoardNames(member)
    expect(names).toContain('E2E Public')
    expect(names).toContain('E2E Segment View')
    expect(names).toContain('E2E Mixed Segment')
    expect(names).not.toContain('E2E Private') // still team-only
  })

  test('team admin bypasses all tiers — sees every board', async () => {
    const names = await visibleBoardNames(admin)
    expect(names).toContain('E2E Segment View')
    expect(names).toContain('E2E Private')
    expect(names).toContain('E2E Mixed Segment')
  })
})

// Engage the submit composer (the per-action submit gate surfaces on
// interaction, not as upfront page text) and report the resulting state.
async function composerState(page: Page, boardSlug: string) {
  await page.goto(`/?board=${boardSlug}`)
  await page.waitForLoadState('networkidle')
  const composer = page.getByPlaceholder(/what'?s your idea/i).first()
  await composer.click()
  await composer.fill(`E2E access probe ${Date.now()}`)
  await page.waitForTimeout(400)
  const body = (await page.locator('main').innerText()).toLowerCase()
  const submitBtn = page.getByRole('button', { name: /^(submit|post|submit feedback)$/i }).first()
  const submitVisible = await submitBtn.isVisible().catch(() => false)
  const submitEnabled = submitVisible ? await submitBtn.isEnabled().catch(() => false) : false
  return {
    needsSignIn: /sign in|log in/.test(body),
    noAccess: /don'?t have access|only team members|not allowed/.test(body),
    submitEnabled,
  }
}

test.describe('submit tier — submit affordance + enforcement', () => {
  test('anonymous on a submit:authenticated board → gated (sign in)', async () => {
    const s = await composerState(anon, 'e2e-public')
    expect(s.needsSignIn).toBe(true)
    expect(s.submitEnabled).toBe(false)
  })

  test('authenticated user CAN submit to a submit:authenticated board', async () => {
    const s = await composerState(user, 'e2e-public')
    expect(s.needsSignIn).toBe(false)
    expect(s.submitEnabled).toBe(true)
  })

  test('segment member is denied submit on a submit:team board (mixedseg)', async () => {
    // Member can VIEW (segments[A]) but submit is team-only → no-access, not sign-in.
    const s = await composerState(member, 'e2e-mixedseg')
    expect(s.noAccess).toBe(true)
    expect(s.submitEnabled).toBe(false)
  })
})

// Load a board's seeded post and report the post-level access state.
async function postState(page: Page, board: { slug: string; postId: string }) {
  await page.goto(`/b/${board.slug}/posts/${board.postId}`)
  await page.waitForLoadState('networkidle')
  const body = (await page.locator('main, body').first().innerText()).toLowerCase()
  const denied = /post not found|page not found/.test(body)
  return {
    denied,
    renders: !denied && body.includes('e2e access probe post'),
    signInToComment: /sign in to comment|log in to comment/.test(body),
    hasCommentEditor: (await page.locator('[contenteditable="true"], textarea').count()) > 0,
  }
}

test.describe('post view + comment tier', () => {
  test('anonymous: views an anonymous-view post but comment is gated (comment:authenticated)', async () => {
    const s = await postState(anon, fx.boards.public)
    expect(s.renders).toBe(true)
    expect(s.signInToComment).toBe(true)
  })

  test('anonymous: can comment on an all-anonymous board (comment:anonymous)', async () => {
    const s = await postState(anon, fx.boards.allanon)
    expect(s.renders).toBe(true)
    expect(s.signInToComment).toBe(false)
    expect(s.hasCommentEditor).toBe(true)
  })

  test('segment member can view a segment-board post; non-member is denied (no leak)', async () => {
    const memberView = await postState(member, fx.boards.segview)
    expect(memberView.renders).toBe(true)

    const nonMemberView = await postState(user, fx.boards.segview)
    expect(nonMemberView.denied).toBe(true)
    expect(nonMemberView.renders).toBe(false) // title/content not leaked
  })

  test('anonymous is denied a team-only (private) board post', async () => {
    const s = await postState(anon, fx.boards.private)
    expect(s.denied).toBe(true)
    expect(s.renders).toBe(false)
  })
})

test.describe('allowAnonymous master switch (fail-closed ceiling)', () => {
  test('view never ceilinged; anon submit allowed when ON, gated when OFF', async () => {
    // ON (baseline): anonymous can submit to an all-anonymous board.
    const on = await composerState(anon, 'e2e-allanon')
    expect(on.needsSignIn).toBe(false)
    expect(on.submitEnabled).toBe(true)

    setWorkspaceAnon(false)
    try {
      const off = await composerState(anon, 'e2e-allanon')
      // Submit now gated for anon...
      expect(off.submitEnabled).toBe(false)
      expect(off.needsSignIn).toBe(true)
      // ...but the board is still VIEWABLE (allowAnonymous never ceilings view).
      const names = await visibleBoardNames(anon)
      expect(names).toContain('E2E All Anonymous')
    } finally {
      setWorkspaceAnon(true)
    }
  })
})

// Open a board's seeded post detail and return its vote button (data-testid on
// the detail sidebar). This describe runs last so any anon session a vote mints
// can't leak into the other tests, and the workspace switch is back ON by now.
async function gotoPost(page: Page, board: { slug: string; postId: string }) {
  await page.goto(`/b/${board.slug}/posts/${board.postId}`)
  await page.waitForLoadState('networkidle')
}
const voteButton = (page: Page) => page.getByTestId('vote-button').first()

test.describe('vote tier — vote affordance + gating', () => {
  test('anonymous on a vote:authenticated board → vote raises sign-in (no vote recorded)', async () => {
    await gotoPost(anon, fx.boards.public)
    const btn = voteButton(anon)
    await expect(btn).toBeVisible()
    await btn.click()
    // vote requires sign-in, so the auth dialog is raised instead of voting.
    await expect(anon.getByRole('dialog')).toBeVisible()
    await expect(anon.getByText(/sign in to vote/i)).toBeVisible()
    await anon.keyboard.press('Escape')
  })

  test('authenticated user CAN vote on a vote:authenticated board', async () => {
    await gotoPost(user, fx.boards.public)
    const btn = voteButton(user)
    await expect(btn).toBeVisible()
    await expect(btn).not.toHaveAttribute('aria-disabled', 'true')
    const before = (await btn.getAttribute('aria-pressed')) === 'true'
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', String(!before)) // toggled = vote accepted
    await btn.click() // restore the count
    await expect(btn).toHaveAttribute('aria-pressed', String(before))
  })

  test('anonymous CAN vote on an all-anonymous board (vote:anonymous)', async () => {
    await gotoPost(anon, fx.boards.allanon)
    const btn = voteButton(anon)
    await expect(btn).toBeVisible()
    await expect(btn).not.toHaveAttribute('aria-disabled', 'true')
    const before = (await btn.getAttribute('aria-pressed')) === 'true'
    await btn.click()
    // No sign-in dialog: an anon session is minted silently and the vote lands.
    await expect(anon.getByRole('dialog')).toHaveCount(0)
    await expect(btn).toHaveAttribute('aria-pressed', String(!before))
    await btn.click() // restore
    await expect(btn).toHaveAttribute('aria-pressed', String(before))
  })
})

// ── Moderation: hold-for-review + approve / reject (posts AND comments) ──────
// e2e-mod holds anonymous + signed-in posts (anonPosts:on, signedPosts:on) and
// comments (comments:on), so we submit as the authenticated `user` (more robust
// than an anon session) and moderate from the team `admin` page. The submitter
// sees their own pending item, but a held item must NOT reach other (anonymous)
// viewers — until a moderator approves it.

/** Submit a post to a board via the portal composer; resolves once accepted. */
async function submitFeedback(page: Page, boardSlug: string, title: string) {
  await page.goto(`/?board=${boardSlug}`)
  await page.waitForLoadState('networkidle')
  const composer = page.getByPlaceholder(/what'?s your idea/i).first()
  await composer.click()
  await composer.fill(title)
  const submit = page.getByRole('button', { name: /^submit/i }).first()
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.getByText('Feedback submitted')).toBeVisible({ timeout: 10000 })
}

/** Does the board's filtered feed (newest-first) surface a post with this title? */
async function feedShowsPost(page: Page, boardSlug: string, title: string): Promise<boolean> {
  await page.goto(`/?board=${boardSlug}&sort=new`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600) // let the feed settle
  return (await page.locator('body').innerText()).includes(title)
}

/** The admin moderation-queue row (a <li>) for a pending item — matched by a
 *  unique text (a post title, or a comment's body). Posts and comments render as
 *  <li>s in the same queue, each carrying its own Approve/Reject buttons. */
async function queueRow(adminPage: Page, uniqueText: string) {
  await adminPage.goto('/admin/moderation')
  await adminPage.waitForLoadState('networkidle')
  return adminPage.locator('li').filter({ hasText: uniqueText }).first()
}

/** Post a comment on a board's seeded post via the portal comment form. */
async function submitComment(page: Page, board: { slug: string; postId: string }, text: string) {
  await page.goto(`/b/${board.slug}/posts/${board.postId}`)
  await page.waitForLoadState('networkidle')
  const form = page
    .locator('form')
    .filter({ has: page.getByTestId('comment-form-editor') })
    .first()
  const editor = form.locator('[contenteditable="true"]').first()
  await editor.click()
  await editor.pressSequentially(text) // TipTap editor — type rather than fill
  await form.getByRole('button', { name: /^comment$/i }).click()
  await expect(editor).toHaveText('', { timeout: 10000 }) // form clears on success
}

/** Does the post detail show a comment containing this text (to the given actor)? */
async function postShowsComment(
  page: Page,
  board: { slug: string; postId: string },
  text: string
): Promise<boolean> {
  await page.goto(`/b/${board.slug}/posts/${board.postId}`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600) // let comments settle
  return (await page.locator('main, body').first().innerText()).includes(text)
}

test.describe('moderation — hold for review + approve/reject', () => {
  test('a held post is approved into the public feed', async () => {
    const title = `E2E Hold-Approve ${Date.now()}`
    await submitFeedback(user, 'e2e-mod', title)

    // Held: the pending post is not visible to other (anonymous) viewers.
    expect(await feedShowsPost(anon, 'e2e-mod', title)).toBe(false)

    // It surfaces in the admin moderation queue; approving publishes it.
    const row = await queueRow(admin, title)
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.getByRole('button', { name: 'Approve' }).click()
    await expect(row).toBeHidden({ timeout: 10000 }) // leaves the queue once handled

    // Now published → visible to anonymous viewers.
    expect(await feedShowsPost(anon, 'e2e-mod', title)).toBe(true)
  })

  test('a held post is rejected and never shown publicly', async () => {
    const title = `E2E Hold-Reject ${Date.now()}`
    await submitFeedback(user, 'e2e-mod', title)

    const row = await queueRow(admin, title)
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.getByRole('button', { name: 'Reject' }).click()
    await expect(row).toBeHidden({ timeout: 10000 }) // soft-deleted, leaves the queue

    // Rejected → still hidden from the public feed.
    expect(await feedShowsPost(anon, 'e2e-mod', title)).toBe(false)
  })

  test('a held comment is approved onto the post', async () => {
    const text = `E2E held comment approve ${Date.now()}`
    await submitComment(user, fx.boards.mod, text)

    // Held: the pending comment is not visible to other (anonymous) viewers.
    expect(await postShowsComment(anon, fx.boards.mod, text)).toBe(false)

    // It surfaces under the queue's pending comments; approving publishes it.
    const row = await queueRow(admin, text)
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.getByRole('button', { name: 'Approve' }).click()
    await expect(row).toBeHidden({ timeout: 10000 })

    // Now published → visible to anonymous viewers.
    expect(await postShowsComment(anon, fx.boards.mod, text)).toBe(true)
  })

  test('a held comment is rejected and never shown', async () => {
    const text = `E2E held comment reject ${Date.now()}`
    await submitComment(user, fx.boards.mod, text)

    const row = await queueRow(admin, text)
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.getByRole('button', { name: 'Reject' }).click()
    await expect(row).toBeHidden({ timeout: 10000 }) // soft-deleted, leaves the queue

    // Rejected → still hidden on the post.
    expect(await postShowsComment(anon, fx.boards.mod, text)).toBe(false)
  })
})
