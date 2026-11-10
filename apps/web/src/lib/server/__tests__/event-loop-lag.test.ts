import { describe, expect, it } from 'vitest'
import { startEventLoopLagLog } from '../event-loop-lag'

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

function collect() {
  const warned: Record<string, number>[] = []
  return { warned, log: { warn: (fields: Record<string, number>) => void warned.push(fields) } }
}

describe('startEventLoopLagLog', () => {
  it('warns when the loop was held, with how long', async () => {
    const { warned, log } = collect()
    const stop = startEventLoopLagLog({ everyMs: 400, warnAboveMs: 100, log })
    await wait(50)
    const until = Date.now() + 300
    while (Date.now() < until) {
      // Holding the thread, as CPU work in a request does.
    }
    await wait(500)
    stop()
    expect(warned.length).toBeGreaterThan(0)
    expect(warned[0]!.maxMs).toBeGreaterThanOrEqual(250)
  })

  it('is quiet while the loop runs freely', async () => {
    const { warned, log } = collect()
    const stop = startEventLoopLagLog({ everyMs: 200, warnAboveMs: 100, log })
    await wait(500)
    stop()
    expect(warned).toEqual([])
  })
})
