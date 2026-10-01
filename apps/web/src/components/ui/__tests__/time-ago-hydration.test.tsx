// @vitest-environment happy-dom
/**
 * The label is worked out on the server and again as the page hydrates, and
 * the two can straddle a boundary ("59 minutes ago", "about 1 hour ago").
 * That difference must not surface as a hydration error; the label settles
 * on the browser's value once mounted.
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getShortTimeAgo, TimeAgo } from '../time-ago'

const POSTED = new Date('2026-09-26T10:00:00.000Z')

afterEach(() => vi.useRealTimers())

describe('TimeAgo hydration', () => {
  it('hydrates without error when the label moved on since the server render', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-26T10:59:10.000Z'))
    const container = document.createElement('div')
    container.innerHTML = renderToString(<TimeAgo date={POSTED} />)
    expect(container.textContent).toBe('about 1 hour ago')

    vi.setSystemTime(new Date('2026-09-26T11:31:00.000Z'))
    const errors: unknown[] = []
    await act(async () => {
      hydrateRoot(container, <TimeAgo date={POSTED} />, {
        onRecoverableError: (error) => errors.push(error),
      })
    })

    expect(errors).toEqual([])
    expect(container.textContent).toBe('about 2 hours ago')
  })

  it('hydrates the short label without error when it ticked over a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-26T10:04:59.900Z'))
    const container = document.createElement('div')
    container.innerHTML = renderToString(<TimeAgo date={POSTED} short />)
    expect(container.textContent).toBe('4m')

    vi.setSystemTime(new Date('2026-09-26T10:05:00.400Z'))
    const errors: unknown[] = []
    await act(async () => {
      hydrateRoot(container, <TimeAgo date={POSTED} short />, {
        onRecoverableError: (error) => errors.push(error),
      })
    })

    expect(errors).toEqual([])
    expect(container.textContent).toBe('5m')
  })
})

describe('getShortTimeAgo', () => {
  it.each([
    ['2026-09-26T10:00:59.000Z', 'now'],
    ['2026-09-26T10:01:00.000Z', '1m'],
    ['2026-09-26T10:59:59.000Z', '59m'],
    ['2026-09-26T11:00:00.000Z', '1h'],
    ['2026-09-27T09:59:59.000Z', '23h'],
    ['2026-09-27T10:00:00.000Z', '1d'],
  ])('at %s reads %s', (now, label) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    expect(getShortTimeAgo(POSTED)).toBe(label)
  })

  it('is empty for a missing or invalid date', () => {
    expect(getShortTimeAgo(null)).toBe('')
    expect(getShortTimeAgo('not a date')).toBe('')
  })
})
