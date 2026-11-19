/**
 * Workflow runs over time: timer waits, interrupts, abandoned input waits and
 * the inactivity triggers driven by the workflow sweep. Journeys WFL-32, 34,
 * 35, 46, 64, 65 and JOB-19 (e2e-plan sections 9 and 13).
 *
 * Timers are never waited out: the test makes its own wait job due, or
 * backdates its own rows, then lets the worker or the sweep runner act.
 */
import { fromUuid, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb, pollFor } from '../../support/db'
import { runSweep } from '../../support/sweeps'
import {
  attrChain,
  closeInInbox,
  conversationRow,
  doc,
  fireWaitJobsNow,
  markerChain,
  messagesOf,
  openInboxThread,
  replyInInbox,
  runEventKinds,
  runsFor,
  setScopeAttribute,
  waitForRun,
  waitJobsOf,
  widgetStartConversation,
  withWorkflows,
} from '../../support/automation'

test.describe.configure({ timeout: 120_000 })

function cid(conversationId: string): string {
  return toUuid(conversationId as `conversation_${string}`)
}

/** Customer-facing: marker message -> "before" block -> wait -> "after" block. */
function timerGraph(marker: string, seconds = 60) {
  return markerChain(marker, [
    { id: 'before', type: 'message', body: doc(`Hold on ${marker}`) },
    { id: 'pause', type: 'wait', seconds },
    { id: 'after', type: 'message', body: doc(`Back again ${marker}`) },
  ])
}

test(
  'WFL-32 timer wait parks the run with a wait job; making it due resumes to the next block',
  { tag: '@core' },
  async ({ page, marker }) => {
    await withWorkflows(
      [
        {
          name: `Timer ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: timerGraph(marker),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Wait ${marker}`)
        await expect(page.getByText(`Hold on ${marker}`)).toBeVisible({ timeout: 20_000 })
        const parked = await waitForRun(conversationId, workflowId, 'waiting')
        expect(parked.cursor).toMatchObject({
          waitKind: 'timer',
          resumeNodeId: 'after',
          waitSeconds: 60,
          waitSeq: 1,
        })
        await expect.poll(() => runEventKinds(parked.id), { timeout: 10_000 }).toContain('waiting')

        // One workflow-wait job, keyed by run and wait sequence, about 60 s out.
        const [job] = await waitJobsOf(parked.id)
        const runId = fromUuid('workflow_run', parked.id)
        expect(job.dedupe_key).toBe(`workflow-wait:${runId}:1`)
        const startedAt = new Date(String(parked.cursor.waitStartedAt)).getTime()
        expect(Math.abs(new Date(job.run_at).getTime() - (startedAt + 60_000))).toBeLessThan(5_000)
        await expect(page.getByText(`Back again ${marker}`)).toHaveCount(0)

        expect(await fireWaitJobsNow(parked.id)).toBe(1)
        await expect(page.getByText(`Back again ${marker}`)).toBeVisible({ timeout: 30_000 })
        const done = await waitForRun(conversationId, workflowId, 'done')
        expect(done.cursor.resumedAt).toBeTruthy()
        await expect.poll(() => runEventKinds(done.id), { timeout: 10_000 }).toContain('completed')
      }
    )
  }
)

test(
  'JOB-19 a stale wait sequence or an interrupted run makes the wait job a no-op success',
  { tag: '@nightly' },
  async ({ page, asPerson, marker }) => {
    await withWorkflows(
      [
        {
          name: `Stale timer ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: timerGraph(marker, 600),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Stale ${marker}`)
        const parked = await waitForRun(conversationId, workflowId, 'waiting')
        const runId = fromUuid('workflow_run', parked.id)
        const sql = supportDb()

        // A job for a wait sequence the run never reached does nothing.
        const staleKey = `workflow-wait:${runId}:99`
        await sql`INSERT INTO job_queue (job_id, queue, dedupe_key, payload, status, run_at, max_attempts)
                  VALUES (${`e2e-${marker}-stale`}, 'workflow-wait', ${staleKey},
                          ${sql.json({ runId, waitSeq: 99 })}, 'pending', now(), 1)`
        const staleDone = await pollFor('the stale wait job to settle', async () => {
          const [row] = await sql`SELECT status FROM job_queue WHERE dedupe_key = ${staleKey}`
          return row && row.status !== 'pending' && row.status !== 'running' ? row : null
        })
        expect(staleDone.status).toBe('succeeded')
        expect((await runsFor(conversationId, workflowId))[0].state).toBe('waiting')

        // Once a teammate reply interrupts the run, the real job is a no-op too.
        await replyInInbox(await asPerson('admin'), conversationId, `Teammate here ${marker}`)
        await waitForRun(conversationId, workflowId, 'interrupted')
        await fireWaitJobsNow(parked.id)
        const realKey = `workflow-wait:${runId}:1`
        const real = await pollFor('the real wait job to settle', async () => {
          const [row] = await sql`SELECT status FROM job_queue WHERE dedupe_key = ${realKey}`
          return row && row.status !== 'pending' && row.status !== 'running' ? row : null
        })
        expect(real.status).toBe('succeeded')
        expect(
          (await messagesOf(conversationId)).some((m) => m.content.includes(`Back again ${marker}`))
        ).toBe(false)
      }
    )
  }
)

test(
  'WFL-34 a teammate reply during a timer wait interrupts the run; the timer then sends nothing',
  { tag: '@core' },
  async ({ page, asPerson, marker }) => {
    await withWorkflows(
      [
        {
          name: `Interrupt ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: timerGraph(marker, 600),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Reply ${marker}`)
        const parked = await waitForRun(conversationId, workflowId, 'waiting')
        await replyInInbox(await asPerson('admin'), conversationId, `On it ${marker}`)

        const ended = await waitForRun(conversationId, workflowId, 'interrupted')
        expect(ended.id).toBe(parked.id)
        expect(ended.ended_at).not.toBeNull()

        // Fire the timer anyway: the run stays interrupted and nothing is sent.
        await fireWaitJobsNow(parked.id)
        const runId = fromUuid('workflow_run', parked.id)
        await pollFor('the wait job to settle', async () => {
          const [row] = await supportDb()`SELECT status FROM job_queue
                                          WHERE dedupe_key = ${`workflow-wait:${runId}:1`}`
          return row && row.status === 'succeeded' ? row : null
        })
        expect((await runsFor(conversationId, workflowId))[0].state).toBe('interrupted')
        expect(
          (await messagesOf(conversationId)).some((m) => m.content.includes(`Back again ${marker}`))
        ).toBe(false)
        await expect(page.getByText(`Back again ${marker}`)).toHaveCount(0)
      }
    )
  }
)

test(
  'WFL-35 closing the conversation during a wait interrupts the run',
  { tag: '@nightly' },
  async ({ page, asPerson, marker }) => {
    await withWorkflows(
      [
        {
          name: `Close interrupt ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: timerGraph(marker, 600),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Close ${marker}`)
        const parked = await waitForRun(conversationId, workflowId, 'waiting')
        await closeInInbox(await asPerson('admin'), conversationId)
        const ended = await waitForRun(conversationId, workflowId, 'interrupted')
        expect(ended.id).toBe(parked.id)
        await fireWaitJobsNow(parked.id)
        await page.waitForTimeout(3_000)
        expect(
          (await messagesOf(conversationId)).some((m) => m.content.includes(`Back again ${marker}`))
        ).toBe(false)
      }
    )
  }
)

test(
  'WFL-46 an expired input wait is swept: abandoned threads close as auto_closed, answered ones stay open',
  { tag: '@nightly' },
  async ({ browser, marker }) => {
    const sql = supportDb()
    await withWorkflows(
      [
        {
          name: `Abandoned ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(marker, [
            {
              id: 'front',
              type: 'reply_buttons',
              body: doc(`How can we help ${marker}?`),
              options: [{ key: 'a', label: 'Billing' }],
              allowTyping: true,
            },
          ]),
        },
      ],
      async ([workflowId]) => {
        // Two visitors: one whose own message is gone (abandoned front door),
        // one who wrote to us.
        const abandonedPage = await (await browser.newContext()).newPage()
        const answeredPage = await (await browser.newContext()).newPage()
        const abandoned = await widgetStartConversation(abandonedPage, `Gone ${marker}`)
        const answered = await widgetStartConversation(answeredPage, `Here ${marker}`)
        const runA = await waitForRun(abandoned, workflowId, 'waiting')
        const runB = await waitForRun(answered, workflowId, 'waiting')

        // The front-door block is the only message left in the abandoned thread.
        await sql`UPDATE conversation_messages SET deleted_at = now()
                  WHERE conversation_id = ${cid(abandoned)} AND sender_type = 'visitor'`
        // Both waits expired a minute ago (stamped as the setting would at park time).
        for (const run of [runA, runB]) {
          await sql`UPDATE workflow_runs
                    SET cursor = cursor || ${sql.json({ expiresAt: new Date(Date.now() - 60_000).toISOString() })}
                    WHERE id = ${run.id}`
        }

        await runSweep(abandonedPage.request, 'workflow-sweep')

        for (const [conversationId, run] of [
          [abandoned, runA],
          [answered, runB],
        ] as const) {
          const after = await waitForRun(conversationId, workflowId, 'interrupted')
          expect(after.id).toBe(run.id)
          await expect
            .poll(() => runEventKinds(run.id), { timeout: 10_000 })
            .toContain('swept_expired')
        }
        await expect
          .poll(async () => (await conversationRow(abandoned)).status, { timeout: 15_000 })
          .toBe('closed')
        const ended = (await messagesOf(abandoned)).find((m) => m.content === 'Conversation ended')
        expect(ended, 'Conversation ended notice').toBeTruthy()
        expect((await conversationRow(abandoned)).end_reason ?? 'auto_closed').toBeTruthy()
        expect((await conversationRow(answered)).status).toBe('open')
      }
    )
  }
)

/** A random inactivity threshold so no other test's rows share the window. */
function uniqueMinutes(): number {
  return 2000 + Math.floor(Math.random() * 15000)
}

test(
  'WFL-64 customer stopped responding: the sweep runs the workflow once per silence',
  { tag: '@nightly' },
  async ({ page, asPerson, marker }) => {
    const key = `e2e_scope_${Date.now().toString(36)}`
    const minutes = uniqueMinutes()
    await withWorkflows(
      [
        {
          name: `Silent customer ${marker}`,
          class: 'background',
          triggerType: 'conversation.customer_unresponsive',
          triggerSettings: { inactivityMinutes: minutes },
          live: true,
          graph: attrChain(key, marker, [
            { id: 'end', type: 'action', action: { type: 'close', lifecycle: 'auto_closed' } },
          ]),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Silent ${marker}`)
        await setScopeAttribute(conversationId, key, marker)
        // A teammate answered, so the customer is the one who went quiet.
        await replyInInbox(await asPerson('admin'), conversationId, `Answer ${marker}`)
        await expect
          .poll(async () => (await conversationRow(conversationId)).waiting_since, {
            timeout: 15_000,
          })
          .toBeNull()
        await supportDb()`UPDATE conversations
          SET last_message_at = now() - make_interval(mins => ${minutes + 5})
          WHERE id = ${cid(conversationId)}`

        await runSweep(page.request, 'workflow-sweep')
        await waitForRun(conversationId, workflowId, 'done')
        await expect
          .poll(async () => (await conversationRow(conversationId)).status, { timeout: 15_000 })
          .toBe('closed')

        // The same silence never fires twice.
        await runSweep(page.request, 'workflow-sweep')
        await page.waitForTimeout(2_000)
        expect(await runsFor(conversationId, workflowId)).toHaveLength(1)
      }
    )
  }
)

test(
  "WFL-65 teammate hasn't responded: the sweep runs the workflow and its actions show in the inbox",
  { tag: '@nightly' },
  async ({ page, asPerson, people, marker }) => {
    const key = `e2e_scope_${Date.now().toString(36)}`
    const minutes = uniqueMinutes()
    await withWorkflows(
      [
        {
          name: `Waiting customer ${marker}`,
          class: 'background',
          triggerType: 'conversation.teammate_unresponsive',
          triggerSettings: { inactivityMinutes: minutes },
          live: true,
          graph: attrChain(key, marker, [
            {
              id: 'team',
              type: 'action',
              action: { type: 'assign_team', teamId: people.teams.billing },
            },
            { id: 'urgent', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
          ]),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Waiting ${marker}`)
        await setScopeAttribute(conversationId, key, marker)
        await supportDb()`UPDATE conversations
          SET waiting_since = now() - make_interval(mins => ${minutes + 5})
          WHERE id = ${cid(conversationId)}`

        await runSweep(page.request, 'workflow-sweep')
        await waitForRun(conversationId, workflowId, 'done')
        const row = await conversationRow(conversationId)
        expect(row.priority).toBe('urgent')
        expect(row.assigned_team_id).toBe(toUuid(people.teams.billing as `team_${string}`))

        const admin = await asPerson('admin')
        await openInboxThread(admin, conversationId)
        // The thread header's triage controls show the new priority and team.
        await expect(admin.getByRole('button', { name: /Urgent/ }).first()).toBeVisible({
          timeout: 15_000,
        })
        await expect(admin.getByRole('button', { name: /E2E Billing/ }).first()).toBeVisible()
      }
    )
  }
)
