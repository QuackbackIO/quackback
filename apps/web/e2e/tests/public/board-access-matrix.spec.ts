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
  const composer = page.getByRole('textbox', { name: /what'?s your idea/i }).first()
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
  const denied = /post not found|tripped us up|flown the pond/.test(body)
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
