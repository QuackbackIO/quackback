// @vitest-environment happy-dom
/**
 * The uptime bar's days used to be `title` attributes on plain spans: no
 * keyboard reach, no touch, no accessible name. Each day is now a button
 * named by its date, worst status and uptime, the bar is a single tab stop
 * with arrow-key movement, and one shared tooltip follows the day in view.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'react-intl'
import { StatusUptimeBar, type StatusUptimeDay } from '../status-uptime-bar'

afterEach(cleanup)

const days: StatusUptimeDay[] = [
  { date: '2026-10-01', worstStatus: 'operational', uptimePct: 100 },
  { date: '2026-10-02', worstStatus: 'partial_outage', uptimePct: 99.5 },
  { date: '2026-10-03', worstStatus: 'major_outage', uptimePct: 97.25 },
]

function renderBar(locale = 'en', messages: Record<string, string> = {}) {
  return render(
    <IntlProvider locale={locale} defaultLocale="en" messages={messages}>
      <StatusUptimeBar days={days} componentName="API" />
    </IntlProvider>
  )
}

describe('StatusUptimeBar', () => {
  it('names every day by its date, worst status and uptime', () => {
    renderBar()
    expect(screen.getByRole('group', { name: 'API uptime, last 3 days' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Oct 1: Operational, 100%',
      'Oct 2: Partial outage, 99.5%',
      'Oct 3: Major outage, 97.25%',
    ])
  })

  it('is one tab stop, on the latest day, and arrow keys move between days', async () => {
    renderBar()
    const user = userEvent.setup()
    const buttons = screen.getAllByRole('button')
    expect(buttons.filter((b) => b.tabIndex === 0)).toEqual([buttons[2]])

    await user.tab()
    expect(buttons[2]).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(buttons[1]).toHaveFocus()
    expect(buttons[1].tabIndex).toBe(0)
    expect(buttons[2].tabIndex).toBe(-1)
    await user.keyboard('{Home}')
    expect(buttons[0]).toHaveFocus()
    await user.keyboard('{End}')
    expect(buttons[2]).toHaveFocus()
  })

  it('shows the focused day in the tooltip', async () => {
    renderBar()
    const user = userEvent.setup()
    await user.tab()
    await user.keyboard('{ArrowLeft}')
    expect(await screen.findByText('Oct 2: Partial outage, 99.5%')).toBeInTheDocument()
  })

  it('opens a day on a tap, and a tap on another day moves it there', async () => {
    renderBar()
    const user = userEvent.setup()
    const [first, second] = screen.getAllByRole('button')
    await user.pointer({ keys: '[TouchA]', target: first })
    expect(await screen.findByText('Oct 1: Operational, 100%')).toBeInTheDocument()
    await user.pointer({ keys: '[TouchA]', target: second })
    expect(await screen.findByText('Oct 2: Partial outage, 99.5%')).toBeInTheDocument()
    expect(screen.queryByText('Oct 1: Operational, 100%')).toBeNull()
  })

  it('opens a day on a click even when the press does not focus it', async () => {
    renderBar()
    const [first] = screen.getAllByRole('button')
    await act(async () => {
      fireEvent.click(first)
    })
    expect(await screen.findByText('Oct 1: Operational, 100%')).toBeInTheDocument()
  })

  it('formats uptime for the locale instead of with a fixed decimal point', () => {
    renderBar('de', {
      'portal.status.uptime.pct': '{pct} % Verfügbarkeit',
      'portal.status.uptime.dayTooltip': '{day}: {label}, {pct} %',
    })
    // (100 + 99.5 + 97.25) / 3 = 98.9166…
    expect(screen.getByText('98,92 % Verfügbarkeit')).toBeInTheDocument()
    expect(screen.getAllByRole('button')[1].getAttribute('aria-label')).toBe(
      '2. Okt.: Partial outage, 99,5 %'
    )
  })
})
