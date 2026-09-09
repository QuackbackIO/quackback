import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), abort: vi.fn() }))
vi.mock('@/lib/server/jobs/job-queue', () => ({ enqueueJob: mocks.enqueue }))
vi.mock('@/lib/server/jobs/wake', () => ({ postJobWakeAbort: mocks.abort }))
vi.mock('@/lib/server/integrations/encryption', () => ({
  encryptSecrets: (value: unknown) => JSON.stringify(value),
}))
import { slackAppHooks } from '../hooks'
import { beginSlackTurn, endSlackTurn } from '../agent/turns'

const executor = {} as never
const events = (event: Record<string, unknown>) =>
  JSON.stringify({ team_id: 'T1', event_id: 'Ev1', event })

beforeEach(() => {
  mocks.enqueue.mockReset().mockResolvedValue(undefined)
  mocks.abort.mockReset()
})

it.each([
  'app_uninstalled',
  'tokens_revoked',
  'reaction_added',
  'app_home_opened',
  'agent_session_stopped',
])('enqueues subscribed lifecycle event %s for the worker', async (type) => {
  const response = await slackAppHooks.handle('events', events({ type }), null, executor)
  expect(response.status).toBe(200)
  expect(mocks.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({ queue: 'slack-hook', dedupeKey: 'Ev1' })
  )
})

it('aborts an in-flight turn when Stop arrives, then still enqueues cleanup', async () => {
  const turn = beginSlackTurn('T1', 'C1', '1.2')
  const stopped = new Promise<void>((resolve) =>
    turn.signal.addEventListener('abort', () => resolve(), { once: true })
  )
  const response = await slackAppHooks.handle(
    'events',
    events({ type: 'agent_session_stopped', channel: 'C1', thread_ts: '1.2', user: 'U1' }),
    null,
    executor
  )
  await stopped
  expect(response.status).toBe(200)
  expect(turn.signal.aborted).toBe(true)
  expect(mocks.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({ queue: 'slack-hook', dedupeKey: 'Ev1' })
  )
  expect(mocks.abort).toHaveBeenCalledWith({ team: 'T1', channel: 'C1', thread: '1.2' })
  endSlackTurn('T1', 'C1', '1.2', turn)
})

it('acks unthreaded channel chatter without a job', async () => {
  const response = await slackAppHooks.handle(
    'events',
    events({ type: 'message', channel_type: 'channel', user: 'U1' }),
    null,
    executor
  )
  expect(response.status).toBe(200)
  expect(mocks.enqueue).not.toHaveBeenCalled()
})

it('answers url_verification synchronously', async () => {
  const response = await slackAppHooks.handle(
    'events',
    JSON.stringify({ type: 'url_verification', challenge: 'c' }),
    null,
    executor
  )
  expect(await response.json()).toEqual({ challenge: 'c' })
  expect(mocks.enqueue).not.toHaveBeenCalled()
})
