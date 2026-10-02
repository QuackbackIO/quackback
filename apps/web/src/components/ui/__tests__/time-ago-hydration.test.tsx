// @vitest-environment happy-dom
/**
 * The label is worked out on the server and again as the page hydrates, and
 * the two can straddle a boundary ("44 minutes ago", "1 hour ago").
 * That difference must not surface as a hydration error; the label settles
 * on the browser's value once mounted.
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getShortTimeAgo, getTimeAgo, TimeAgo } from '../time-ago'

const POSTED = new Date('2026-09-26T10:00:00.000Z')

afterEach(() => vi.useRealTimers())

describe('TimeAgo hydration', () => {
  it('hydrates without error when the label moved on since the server render', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-26T10:59:10.000Z'))
    const container = document.createElement('div')
    container.innerHTML = renderToString(<TimeAgo date={POSTED} />)
    expect(container.textContent).toBe('1 hour ago')

    vi.setSystemTime(new Date('2026-09-26T11:31:00.000Z'))
    const errors: unknown[] = []
    await act(async () => {
      hydrateRoot(container, <TimeAgo date={POSTED} />, {
        onRecoverableError: (error) => errors.push(error),
      })
    })

    expect(errors).toEqual([])
    expect(container.textContent).toBe('2 hours ago')
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

  // Narrow unit forms move between CLDR releases, so the expected text is
  // worded by Intl itself; what is under test is the locale reaching it. The
  // locales write in other scripts, because a Latin-script narrow form can
  // match English outright (German reads "3h" in newer CLDR data).
  const narrow = (locale: string, unit: string, value: number) =>
    new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(value)

  it.each([
    ['2026-09-26T10:05:00.000Z', 'ru', narrow('ru', 'minute', 5)],
    ['2026-09-26T13:00:00.000Z', 'zh-cn', narrow('zh-cn', 'hour', 3)],
    ['2026-09-28T10:00:00.000Z', 'ar', narrow('ar', 'day', 2)],
  ])('at %s reads in %s as %s', (now, locale, label) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    expect(getShortTimeAgo(POSTED, locale)).toBe(label)
    expect(label).not.toBe(getShortTimeAgo(POSTED))
  })

  it('reads "now" in the given language', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-26T10:00:30.000Z'))
    expect(getShortTimeAgo(POSTED, 'pl')).toBe('teraz')
  })
})

describe('getTimeAgo', () => {
  it.each([
    ['2026-09-26T10:00:44.000Z', 'now'],
    ['2026-09-26T10:00:45.000Z', '1 minute ago'],
    ['2026-09-26T10:44:00.000Z', '44 minutes ago'],
    ['2026-09-26T10:45:00.000Z', '1 hour ago'],
    ['2026-09-27T07:00:00.000Z', '21 hours ago'],
    ['2026-09-27T08:00:00.000Z', '1 day ago'],
    ['2026-10-21T10:00:00.000Z', '25 days ago'],
    ['2026-10-23T10:00:00.000Z', '1 month ago'],
    ['2027-07-26T10:00:00.000Z', '10 months ago'],
    ['2027-08-26T10:00:00.000Z', '1 year ago'],
    ['2029-09-26T10:00:00.000Z', '3 years ago'],
    // A date still to come reads forward.
    ['2026-09-24T10:00:00.000Z', 'in 2 days'],
  ])('at %s reads %s', (now, label) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    expect(getTimeAgo(POSTED)).toBe(label)
  })

  it.each([
    ['pl', '3 dni temu'],
    ['de', 'vor 3 Tagen'],
    ['es', 'hace 3 días'],
    ['zh-cn', '3天前'],
  ])('reads in %s as %s', (locale, label) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T10:00:00.000Z'))
    expect(getTimeAgo(POSTED, locale)).toBe(label)
  })

  it('is empty for a missing or invalid date', () => {
    expect(getTimeAgo(null)).toBe('')
    expect(getTimeAgo('not a date')).toBe('')
  })
})

describe('TimeAgo language', () => {
  it("renders in the app's language inside an IntlProvider", () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T10:00:00.000Z'))
    const html = renderToString(
      <IntlProvider locale="pl">
        <TimeAgo date={POSTED} />
      </IntlProvider>
    )
    expect(html).toContain('3 dni temu')
  })

  it('keeps a locale it is given over the app language', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T10:00:00.000Z'))
    const html = renderToString(
      <IntlProvider locale="pl">
        <TimeAgo date={POSTED} locale="en" />
      </IntlProvider>
    )
    expect(html).toContain('3 days ago')
  })

  it('hydrates a localized label without error', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T10:00:00.000Z'))
    const ui = (
      <IntlProvider locale="de">
        <TimeAgo date={POSTED} short />
      </IntlProvider>
    )
    const container = document.createElement('div')
    container.innerHTML = renderToString(ui)
    const errors: unknown[] = []
    await act(async () => {
      hydrateRoot(container, ui, { onRecoverableError: (error) => errors.push(error) })
    })

    expect(errors).toEqual([])
    expect(container.textContent).toBe(
      new Intl.NumberFormat('de', { style: 'unit', unit: 'day', unitDisplay: 'narrow' }).format(3)
    )
  })
})
