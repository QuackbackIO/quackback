/**
 * The two setup emails: the owner's first landing queues the welcome now and
 * the day-two nudge, the welcome's content and its "Stop setup tips" link,
 * and the nudge going out only while the first result has not happened.
 *
 * Journeys: INT-ON-08, INT-ON-09, INT-ON-11, INT-ON-12.
 *
 * `@isolated`: the first landing, the owner and the first win live in the
 * workspace setup state, and any portal post elsewhere is a first win that
 * stops both emails. Each test makes a fresh owner, points the workspace's
 * goal at a private team board of its own (so the first win is judged on that
 * board alone), clears the "first landing seen" stamp, and puts the setup
 * state back afterwards. The nudge is promoted with the sweep runner
 * (`onboarding-email`, as of 49 hours from now).
 */
import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { pollFor, supportDb } from '../../support/db'
import { linksIn, mailTo, waitForMail } from '../../support/mailpit'
import { callServerFn } from '../../support/server-fns'
import type { TestTeammate } from '../../support/teammates'
import { createBoard, runPlatformSweep, withSetupState } from '../../product/platform'

const HOURS = 3_600_000

test.beforeEach(() => {
  test.skip(!ISOLATED, ISOLATED_SKIP)
})

interface Landing {
  owner: TestTeammate
  api: APIRequestContext
  board: { id: string; uuid: string }
  workspace: string
}

/**
 * A new workspace owner landing on Home for the first time, with the goal a
 * private team board only this test posts on.
 */
async function asFirstLanding<T>(
  ctx: {
    marker: string
    newTeammate: (o: {
      roleKey: string
      principalRole?: 'admin' | 'member'
    }) => Promise<TestTeammate>
    playwright: Parameters<TestTeammate['api']>[0]
  },
  body: (landing: Landing) => Promise<T>
): Promise<T> {
  const owner = await ctx.newTeammate({ roleKey: 'admin', principalRole: 'admin' })
  const board = await createBoard(ctx.marker, { view: 'team' })
  const [{ name: workspace }] = await supportDb()<{ name: string }[]>`
    SELECT name FROM settings LIMIT 1`
  return withSetupState(
    (state) => {
      const steps = (state.steps ?? {}) as Record<string, unknown>
      const startingPoint = (steps.startingPoint ?? {}) as Record<string, unknown>
      const { activationHandoffSeenAt: _seen, ...rest } = state
      return {
        ...rest,
        goals: ['product_feedback'],
        useCase: 'product_feedback',
        feedbackPrivate: true,
        ownerPrincipalId: owner.principalId,
        steps: {
          ...steps,
          startingPoint: {
            ...startingPoint,
            outcome: 'internal',
            resourceType: 'board',
            resourceId: board.id,
            source: 'existing',
          },
        },
      }
    },
    async () => {
      const api = await owner.api(ctx.playwright)
      try {
        return await body({ owner, api, board, workspace })
      } finally {
        await api.dispose()
      }
    }
  )
}

async function land(api: APIRequestContext): Promise<void> {
  const res = await callServerFn<{ ok: boolean }>(api, 'ensureOnboardingHomeReadyFn')
  expect(res.ok, res.error).toBe(true)
  expect(res.data.ok).toBe(true)
}

interface JobRow {
  dedupe_key: string
  status: string
  run_at: Date
  max_attempts: number
  payload: Record<string, unknown>
}

async function jobsFor(principalId: string): Promise<JobRow[]> {
  return supportDb()<JobRow[]>`
    SELECT dedupe_key, status, run_at, max_attempts, payload FROM job_queue
    WHERE queue = 'onboarding-email' AND payload->>'principalId' = ${principalId}
    ORDER BY run_at`
}

/** Promote the nudge and wait until its job has run (sent or skipped). */
async function runNudge(request: APIRequestContext, principalId: string): Promise<void> {
  await runPlatformSweep(request, 'onboarding-email', { asOf: new Date(Date.now() + 49 * HOURS) })
  await pollFor(
    'the nudge job to finish',
    async () => {
      const nudge = (await jobsFor(principalId)).find((j) => j.payload.kind === 'nudge')
      return nudge && !['pending', 'running'].includes(nudge.status) ? nudge : null
    },
    { timeoutMs: 20_000 }
  )
}

async function sentKinds(principalId: string): Promise<string[]> {
  const rows = await supportDb()<{ kind: string }[]>`
    SELECT kind FROM onboarding_emails WHERE principal_id = ${toUuid(principalId as `principal_${string}`)}
    ORDER BY kind`
  return rows.map((r) => r.kind)
}

test(
  'INT-ON-08 INT-ON-09 INT-ON-12 the first landing sends the welcome now and the nudge on day two',
  { tag: ['@core', '@isolated'] },
  async ({ marker, newTeammate, playwright, request }) => {
    await asFirstLanding({ marker, newTeammate, playwright }, async ({ owner, api, workspace }) => {
      const before = Date.now()
      await land(api)

      // Two jobs, deduped per kind and person; the nudge 48 hours after the welcome.
      const jobs = await jobsFor(owner.principalId)
      expect(jobs.map((j) => j.dedupe_key)).toEqual([
        `onboarding-email:welcome:${owner.principalId}`,
        `onboarding-email:nudge:${owner.principalId}`,
      ])
      expect(jobs.every((j) => j.max_attempts === 3)).toBe(true)
      const gap = jobs[1].run_at.getTime() - jobs[0].run_at.getTime()
      expect(Math.abs(gap - 48 * HOURS)).toBeLessThan(60_000)
      expect(jobs[0].run_at.getTime()).toBeGreaterThanOrEqual(before - 60_000)

      // A second landing is not a first landing: nothing more is queued.
      await land(api)
      expect(await jobsFor(owner.principalId)).toHaveLength(2)

      // The welcome: workspace name, the next step, the unsubscribe link.
      await runPlatformSweep(request, 'onboarding-email', { asOf: new Date() })
      const welcome = await waitForMail({
        to: owner.email,
        subject: `${workspace} is ready`,
        timeoutMs: 20_000,
      })
      expect(welcome.Subject).toBe(`${workspace} is ready, ${owner.name.split(' ')[0]}`)
      expect(welcome.Text).toContain(workspace)
      const links = linksIn(welcome)
      const unsubscribe = links.find((l) => l.includes('/unsubscribe?token='))
      expect(unsubscribe, links.join('\n')).toBeTruthy()
      expect(
        links.some((l) => /\/admin(\?|\/|$)/.test(new URL(l).pathname + new URL(l).search))
      ).toBe(true)
      expect(await sentKinds(owner.principalId)).toEqual(['welcome'])
      const token = new URL(unsubscribe!).searchParams.get('token')!
      const [tokenRow] = await supportDb()<{ action: string; expires_at: Date }[]>`
        SELECT action, expires_at FROM unsubscribe_tokens WHERE token = ${token}`
      expect(tokenRow.action).toBe('unsubscribe_onboarding')
      const days = (tokenRow.expires_at.getTime() - Date.now()) / (24 * HOURS)
      expect(days).toBeGreaterThan(29.9)
      expect(days).toBeLessThan(30.1)

      // Day two, no first result on the team board yet: the nudge goes.
      await runNudge(request, owner.principalId)
      const nudge = await waitForMail({ to: owner.email, subject: 'Your next step in' })
      expect(nudge.Subject).toBe(`Your next step in ${workspace}`)
      expect(await sentKinds(owner.principalId)).toEqual(['nudge', 'welcome'])
    })
  }
)

test(
  "INT-ON-11 'Stop setup tips' from the welcome turns the tips off and the nudge is skipped",
  { tag: ['@nightly', '@isolated'] },
  async ({ marker, newTeammate, playwright, request, page }) => {
    await asFirstLanding({ marker, newTeammate, playwright }, async ({ owner, api, workspace }) => {
      await land(api)
      await runPlatformSweep(request, 'onboarding-email', { asOf: new Date() })
      const welcome = await waitForMail({
        to: owner.email,
        subject: `${workspace} is ready`,
        timeoutMs: 20_000,
      })
      const unsubscribe = linksIn(welcome).find((l) => l.includes('/unsubscribe?token='))!
      const token = new URL(unsubscribe).searchParams.get('token')!

      await page.goto(unsubscribe)
      await expect(page.getByText('Stop setup tips?')).toBeVisible()
      await page.getByRole('button', { name: 'Stop setup tips' }).click()
      await expect(page.getByText('Setup tips are off.')).toBeVisible()
      const [row] = await supportDb()<{ used_at: Date | null }[]>`
        SELECT used_at FROM unsubscribe_tokens WHERE token = ${token}`
      expect(row.used_at).not.toBeNull()

      // Opening the link again is harmless.
      const again = await page.goto(unsubscribe)
      expect(again?.status()).toBeLessThan(400)

      await runNudge(request, owner.principalId)
      expect(await sentKinds(owner.principalId)).toEqual(['welcome'])
      expect((await mailTo(owner.email)).map((m) => m.Subject)).not.toContain(
        `Your next step in ${workspace}`
      )
    })
  }
)

test(
  'INT-ON-12 the nudge is skipped once the first result has happened',
  { tag: ['@core', '@isolated'] },
  async ({ marker, newTeammate, playwright, request, people }) => {
    await asFirstLanding(
      { marker, newTeammate, playwright },
      async ({ owner, api, board, workspace }) => {
        await land(api)
        await runPlatformSweep(request, 'onboarding-email', { asOf: new Date() })
        await waitForMail({ to: owner.email, subject: `${workspace} is ready`, timeoutMs: 20_000 })

        // A teammate other than the owner posts on the team board: the first win.
        const [status] = await supportDb()<{ id: string }[]>`
          SELECT id FROM post_statuses WHERE is_default LIMIT 1`
        await supportDb()`
          INSERT INTO posts (id, board_id, title, content, principal_id, status_id)
          VALUES (${randomUUID()}, ${board.uuid}, ${`Idea ${marker}`}, 'A first idea.',
                  ${toUuid(people.people.admin.principalId as `principal_${string}`)}, ${status?.id ?? null})`

        await runNudge(request, owner.principalId)
        expect(await sentKinds(owner.principalId)).toEqual(['welcome'])
        expect((await mailTo(owner.email)).map((m) => m.Subject)).not.toContain(
          `Your next step in ${workspace}`
        )
      }
    )
  }
)
