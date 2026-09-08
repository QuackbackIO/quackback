import { afterEach, expect, it, vi } from 'vitest'
import { abortSlackTurn, abortSlackTurnFromPayload, beginSlackTurn, endSlackTurn } from '../turns'

afterEach(() => {
  vi.useRealTimers()
})

it('aborts the registered turn for that thread and ignores others', async () => {
  const turn = beginSlackTurn('T1', 'C1', '1.2')
  const other = beginSlackTurn('T1', 'C1', '9.9')
  const stopped = new Promise<void>((resolve) =>
    turn.signal.addEventListener('abort', () => resolve(), { once: true })
  )
  expect(abortSlackTurn('T1', 'C1', '1.2')).toBe(true)
  await stopped
  expect(turn.signal.aborted).toBe(true)
  expect(other.signal.aborted).toBe(false)
  expect(abortSlackTurn('T1', 'C1', '1.2')).toBe(false)
  endSlackTurn('T1', 'C1', '1.2', turn)
  endSlackTurn('T1', 'C1', '9.9', other)
})

it('aborts from an agent_session_stopped envelope and ignores other events', async () => {
  const turn = beginSlackTurn('T1', 'C1', '1.2')
  expect(
    abortSlackTurnFromPayload({
      team_id: 'T1',
      event: { type: 'app_mention', channel: 'C1', thread_ts: '1.2' },
    })
  ).toBe(false)
  expect(turn.signal.aborted).toBe(false)
  expect(
    abortSlackTurnFromPayload({
      team_id: 'T1',
      event: { type: 'agent_session_stopped', channel: 'C1', thread_ts: '1.2' },
    })
  ).toBe(true)
  expect(turn.signal.aborted).toBe(true)
  endSlackTurn('T1', 'C1', '1.2', turn)
})

it('aborts a turn that registers after Stop arrived during preflight', () => {
  expect(abortSlackTurn('T1', 'C1', 'pending')).toBe(true)
  const turn = beginSlackTurn('T1', 'C1', 'pending')
  expect(turn.signal.aborted).toBe(true)
  endSlackTurn('T1', 'C1', 'pending', turn)
})

it('does not abort a later turn after a stale pending Stop expires', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  expect(abortSlackTurn('T1', 'C1', 'stale')).toBe(true)
  vi.setSystemTime(new Date('2026-01-01T00:02:01Z'))
  const turn = beginSlackTurn('T1', 'C1', 'stale')
  expect(turn.signal.aborted).toBe(false)
  endSlackTurn('T1', 'C1', 'stale', turn)
})
