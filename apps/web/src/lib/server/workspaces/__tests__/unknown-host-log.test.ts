import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetUnknownHostLog, warnUnknownHost } from '../unknown-host-log'

const MESSAGE = 'no workspace claims this hostname'

describe('warnUnknownHost', () => {
  const log = { warn: vi.fn() }

  beforeEach(() => {
    resetUnknownHostLog()
    log.warn.mockReset()
  })

  it('logs the first request for a host', () => {
    warnUnknownHost('gone.example.com', log, 0)
    expect(log.warn).toHaveBeenCalledExactlyOnceWith({ host: 'gone.example.com' }, MESSAGE)
  })

  it('folds a burst for one host into a single line', () => {
    for (let i = 0; i < 300; i++) warnUnknownHost('gone.example.com', log, i)
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('logs again after the window, with the count it folded', () => {
    for (let i = 0; i < 5; i++) warnUnknownHost('gone.example.com', log, i)
    warnUnknownHost('gone.example.com', log, 60_000)
    expect(log.warn).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenLastCalledWith(
      { host: 'gone.example.com', foldedSinceLast: 4 },
      MESSAGE
    )
  })

  it('keeps each host on its own window', () => {
    warnUnknownHost('a.example.com', log, 0)
    warnUnknownHost('b.example.com', log, 1)
    warnUnknownHost('a.example.com', log, 2)
    expect(log.warn.mock.calls.map(([fields]) => fields.host)).toEqual([
      'a.example.com',
      'b.example.com',
    ])
  })

  it('stays bounded when every request names a new host', () => {
    for (let i = 0; i < 2_500; i++) warnUnknownHost(`h${i}.example.com`, log, 0)
    // Every new host still gets its line: starting over only forgets the old ones.
    expect(log.warn).toHaveBeenCalledTimes(2_500)
    warnUnknownHost('h0.example.com', log, 1)
    expect(log.warn).toHaveBeenCalledTimes(2_501)
  })
})
