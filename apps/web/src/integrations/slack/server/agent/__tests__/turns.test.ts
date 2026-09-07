import { expect, it } from 'vitest'
import { abortSlackTurn, abortSlackTurnFromPayload, beginSlackTurn, endSlackTurn } from '../turns'

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
