// @vitest-environment happy-dom
/**
 * An absolute date is formatted on the server and again as the page hydrates,
 * in two runtimes whose default locale and time zone differ. The first render
 * on both sides must produce the same text, so hydration raises no error, and
 * the text then settles on the viewer's locale and zone.
 */
import { act } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { formatIn, restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { LocalDate, NUMERIC_DATE_TIME, useLocalDateFormatter } from '../local-date'

// 20:30 UTC on Oct 1 is already Oct 2 in Kiritimati (UTC+14).
const AT = '2026-10-01T20:30:00.000Z'
const DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
const VIEWER = { locale: 'de-DE', timeZone: 'Pacific/Kiritimati' }

afterEach(restoreRuntimeLocale)

/** Server-render `ui` as one runtime, then hydrate it as the viewer's browser. */
async function serverThenHydrate(ui: React.ReactElement) {
  setRuntimeLocale('en-GB', 'America/Los_Angeles')
  const container = document.createElement('div')
  container.innerHTML = renderToString(ui)
  const serverHtml = container.innerHTML

  setRuntimeLocale(VIEWER.locale, VIEWER.timeZone)
  const errors: unknown[] = []
  await act(async () => {
    hydrateRoot(container, ui, { onRecoverableError: (error) => errors.push(error) })
  })
  return { container, serverHtml, errors }
}

function Titled({ date }: { date: string }) {
  const format = useLocalDateFormatter()
  return <span title={`Created ${format(date, DAY)}`}>{format(date, { hour: 'numeric' })}</span>
}

describe('LocalDate', () => {
  it('server-renders a fixed locale in UTC, whatever the server runtime', () => {
    setRuntimeLocale('fr-FR', 'Asia/Tokyo')
    const html = renderToString(<LocalDate date={AT} options={DAY} />)
    expect(html).toContain('>Oct 1, 2026</time>')
    expect(html).toContain('dateTime="2026-10-01T20:30:00.000Z"')
  })

  it('hydrates without error in another locale and zone, then shows the viewer format', async () => {
    const { container, serverHtml, errors } = await serverThenHydrate(
      <LocalDate date={AT} options={DAY} />
    )

    expect(errors).toEqual([])
    expect(serverHtml).toContain('Oct 1, 2026')
    expect(container.textContent).toBe(formatIn(VIEWER.locale, VIEWER.timeZone, AT, DAY))
    expect(container.textContent).not.toBe('Oct 1, 2026')
  })

  it('keeps a time zone the options name, on both sides', async () => {
    const options = { ...DAY, timeZone: 'America/New_York' }
    const { container, serverHtml, errors } = await serverThenHydrate(
      <LocalDate date={AT} options={options} />
    )

    expect(errors).toEqual([])
    expect(serverHtml).toContain('Oct 1, 2026')
    expect(container.textContent).toBe(formatIn(VIEWER.locale, 'America/New_York', AT, DAY))
  })

  it('keeps a locale it is given, switching only the zone after hydration', async () => {
    const { container, serverHtml, errors } = await serverThenHydrate(
      <LocalDate date={AT} options={DAY} locale="en-US" />
    )

    expect(errors).toEqual([])
    expect(serverHtml).toContain('Oct 1, 2026')
    expect(container.textContent).toBe(formatIn('en-US', VIEWER.timeZone, AT, DAY))
    expect(container.textContent).toBe('Oct 2, 2026')
  })

  it('server-renders a locale it is given, in UTC', () => {
    setRuntimeLocale('en-US', 'Asia/Tokyo')
    expect(renderToString(<LocalDate date={AT} options={DAY} locale="de-DE" />)).toContain(
      '>1. Okt. 2026</time>'
    )
  })

  it('renders nothing for a missing or invalid date', () => {
    expect(renderToString(<LocalDate date={null} />)).toBe('')
    expect(renderToString(<LocalDate date="not a date" />)).toBe('')
  })
})

describe('useLocalDateFormatter', () => {
  it('hydrates a formatted title and text without error, then formats for the viewer', async () => {
    const { container, errors } = await serverThenHydrate(<Titled date={AT} />)

    expect(errors).toEqual([])
    const span = container.querySelector('span')!
    expect(span.getAttribute('title')).toBe(
      `Created ${formatIn(VIEWER.locale, VIEWER.timeZone, AT, DAY)}`
    )
    expect(span.textContent).toBe(formatIn(VIEWER.locale, VIEWER.timeZone, AT, { hour: 'numeric' }))
  })

  it('formats for the viewer from the first render when mounted on the client', async () => {
    setRuntimeLocale(VIEWER.locale, VIEWER.timeZone)
    const seen: string[] = []
    function Probe() {
      seen.push(useLocalDateFormatter()(AT, NUMERIC_DATE_TIME))
      return null
    }
    const container = document.createElement('div')
    await act(async () => {
      createRoot(container).render(<Probe />)
    })

    expect(seen[0]).toBe(formatIn(VIEWER.locale, VIEWER.timeZone, AT, NUMERIC_DATE_TIME))
  })
})
