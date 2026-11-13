// @vitest-environment happy-dom
/**
 * The customer-facing due date (ticket-stage.tsx): "Due {date}" in a
 * neutral tone, hidden without a date or once the ticket is closed, and never
 * an overdue alarm.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { TicketDueLabel } from '../ticket-stage'

afterEach(cleanup)

function renderLabel(props: Parameters<typeof TicketDueLabel>[0]) {
  return render(
    <IntlProvider locale="en-US" messages={{}}>
      <TicketDueLabel {...props} />
    </IntlProvider>
  )
}

// Midday UTC names the same calendar day in every zone the suite runs in.
const DUE = '2026-10-21T12:00:00.000Z'

describe('TicketDueLabel', () => {
  it('shows "Due" with the short date', () => {
    const { container } = renderLabel({ dueAt: DUE, closed: false })
    expect(container.textContent).toBe('Due Oct 21, 2026')
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe(DUE)
  })

  it('renders nothing without a due date', () => {
    expect(renderLabel({ dueAt: null, closed: false }).container.firstChild).toBeNull()
    cleanup()
    expect(renderLabel({ dueAt: undefined, closed: false }).container.firstChild).toBeNull()
  })

  it('renders nothing once the ticket is closed', () => {
    expect(renderLabel({ dueAt: DUE, closed: true }).container.firstChild).toBeNull()
  })

  it('renders nothing for a malformed date', () => {
    expect(renderLabel({ dueAt: 'not a date', closed: false }).container.firstChild).toBeNull()
  })

  it('stays neutral for a date that already passed', () => {
    const { container } = renderLabel({ dueAt: '2020-01-15T12:00:00.000Z', closed: false })
    expect(container.textContent).toBe('Due Jan 15, 2020')
    const label = container.firstElementChild as HTMLElement
    expect(label.className).toContain('text-muted-foreground')
    expect(label.className).not.toMatch(/destructive|red|amber/)
    expect(container.textContent).not.toMatch(/overdue/i)
  })

  it('passes a className through', () => {
    const { container } = renderLabel({ dueAt: DUE, closed: false, className: 'mt-1.5' })
    expect((container.firstElementChild as HTMLElement).className).toContain('mt-1.5')
  })
})
