/**
 * The contract an abandoned SSE stream has to honour: stop touching the
 * tenant the moment heartbeats go unanswered.
 */
import { describe, expect, it, vi } from 'vitest'
import { startStreamHeartbeat, type HeartbeatPingResult } from '../stream-heartbeat'

function withManualTicks() {
  const ticks: Array<() => void> = []
  const handle = startStreamHeartbeat({
    sendPing: () => ping(),
    onAlive,
    onTimeout,
    missLimit: 2,
    schedule: (tick) => {
      ticks.push(tick)
      return { clear }
    },
  })
  return { tick: () => ticks[0]!(), handle }
}

const onAlive = vi.fn()
const onTimeout = vi.fn()
const clear = vi.fn()
let ping: () => HeartbeatPingResult = () => 'ok'

describe('startStreamHeartbeat', () => {
  it('refreshes on a consumed ping and never times out', () => {
    onAlive.mockClear()
    onTimeout.mockClear()
    ping = () => 'ok'
    const { tick } = withManualTicks()
    tick()
    tick()
    tick()
    expect(onAlive).toHaveBeenCalledTimes(3)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('does not refresh presence while pings go unconsumed, then times out', () => {
    onAlive.mockClear()
    onTimeout.mockClear()
    ping = () => 'unconsumed'
    const { tick } = withManualTicks()
    tick()
    expect(onAlive).not.toHaveBeenCalled()
    expect(onTimeout).not.toHaveBeenCalled()
    tick()
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onAlive).not.toHaveBeenCalled()
  })

  it('a single unconsumed ping is not enough — a slow consumer gets another interval', () => {
    onAlive.mockClear()
    onTimeout.mockClear()
    ping = () => 'unconsumed'
    const { tick } = withManualTicks()
    tick()
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('an unconsumed streak resets when a ping is consumed again', () => {
    onAlive.mockClear()
    onTimeout.mockClear()
    const results: HeartbeatPingResult[] = ['unconsumed', 'ok', 'unconsumed']
    ping = () => results.shift() ?? 'ok'
    const { tick } = withManualTicks()
    tick()
    tick()
    tick()
    expect(onTimeout).not.toHaveBeenCalled()
    expect(onAlive).toHaveBeenCalledTimes(1)
  })

  it('tears down on the first closed ping — the consumer is already gone', () => {
    onAlive.mockClear()
    onTimeout.mockClear()
    ping = () => 'closed'
    const { tick } = withManualTicks()
    tick()
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onAlive).not.toHaveBeenCalled()
  })

  it('stop() cancels the timer and swallows later ticks', () => {
    onAlive.mockClear()
    onTimeout.mockClear()
    clear.mockClear()
    ping = () => 'closed'
    const { tick, handle } = withManualTicks()
    handle.stop()
    expect(clear).toHaveBeenCalledTimes(1)
    tick()
    expect(onTimeout).not.toHaveBeenCalled()
  })
})
