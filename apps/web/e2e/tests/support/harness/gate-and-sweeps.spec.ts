/**
 * Self-test: the suite runs on a production build with the harness gate open,
 * and the sweep runner moves a snooze timer only when told the time.
 */
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../../support/fixtures'
import { supportDb } from '../../../support/db'
import { minutesFromNow, runSweep } from '../../../support/sweeps'
import { seedConversation } from '../../../utils/db-helpers'

test.describe('harness gate', { tag: '@smoke' }, () => {
  test('the app under test is a production build', async ({ request }) => {
    // The Vite dev client only exists on the dev server.
    const devClient = await request.get('/@vite/client')
    expect(devClient.status()).toBe(404)
  })

  test('the presence probe answers 204 with the harness on', async ({ request }) => {
    const res = await request.get('/api/e2e/presence')
    expect(res.status()).toBe(204)
  })

  test('the sweep runner refuses names outside its list and a clock it cannot use', async ({
    request,
  }) => {
    const unknown = await request.post('/api/e2e/sweep', { data: { job: 'import' } })
    expect(unknown.status()).toBe(400)
    expect(await unknown.text()).toContain('Unknown sweep')

    const noClock = await request.post('/api/e2e/sweep', {
      data: { job: 'email-log-retention', asOf: new Date().toISOString() },
    })
    expect(noClock.status()).toBe(400)
  })
})

test.describe('sweep runner', { tag: '@smoke' }, () => {
  test('snooze-sweep wakes a conversation only once "as of" passes its timer', async ({
    request,
    marker,
  }) => {
    const { conversationId } = seedConversation(marker)
    const sql = supportDb()
    const id = toUuid(conversationId as `conversation_${string}`)
    await sql`UPDATE conversations SET status = 'snoozed', snoozed_until = now() + interval '1 hour'
              WHERE id = ${id}`

    // At the wall clock the timer is an hour away: nothing wakes.
    await runSweep(request, 'snooze-sweep')
    const [still] = await sql`SELECT status FROM conversations WHERE id = ${id}`
    expect(still.status).toBe('snoozed')

    // As of two hours from now it is due.
    const run = await runSweep(request, 'snooze-sweep', { asOf: minutesFromNow(120) })
    expect(run.result.woken).toBeGreaterThanOrEqual(1)
    const [woken] = await sql`SELECT status, snoozed_until FROM conversations WHERE id = ${id}`
    expect(woken.status).toBe('open')
    expect(woken.snoozed_until).toBeNull()
  })

  test('workflow-wait promotes a delayed job due by "as of" and leaves later ones', async ({
    request,
    marker,
  }) => {
    const sql = supportDb()
    const dueJob = `e2e-${marker}-due`
    const laterJob = `e2e-${marker}-later`
    // Harmless payloads: the handler finds no run and settles the job.
    for (const [jobId, minutes] of [
      [dueJob, 60],
      [laterJob, 600],
    ] as const) {
      await sql`INSERT INTO job_queue (job_id, queue, payload, status, run_at, max_attempts)
                VALUES (${jobId}, 'workflow-wait',
                        ${sql.json({ runId: `${marker}-missing` })}, 'pending',
                        now() + make_interval(mins => ${minutes}), 1)`
    }

    const run = await runSweep(request, 'workflow-wait', { asOf: minutesFromNow(120) })
    expect(run.result.promoted).toBeGreaterThanOrEqual(1)

    const rows = await sql`SELECT job_id, status, run_at <= now() AS due
                           FROM job_queue WHERE job_id IN (${dueJob}, ${laterJob})`
    const byId = Object.fromEntries(rows.map((r) => [r.job_id, r]))
    expect(byId[dueJob].due).toBe(true)
    expect(byId[laterJob].due).toBe(false)
    expect(byId[laterJob].status).toBe('pending')
  })
})
