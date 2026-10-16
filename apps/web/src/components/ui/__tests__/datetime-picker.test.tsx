// @vitest-environment happy-dom
/**
 * A date-only pick is stored as noon UTC on the picked day, so it names the
 * same calendar day everywhere. The trigger must show that day in every time
 * zone: noon UTC on Oct 1 is already Oct 2 in Kiritimati (UTC+14).
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DateTimePicker } from '../datetime-picker'

const realTz = process.env.TZ

beforeEach(() => {
  process.env.TZ = 'Pacific/Kiritimati'
})

afterEach(() => {
  cleanup()
  process.env.TZ = realTz
})

describe('DateTimePicker', () => {
  it('shows a date-only value as its calendar day in any zone', () => {
    render(
      <DateTimePicker value={new Date('2026-10-01T12:00:00.000Z')} onChange={() => {}} dateOnly />
    )
    expect(screen.getByRole('button', { name: /2026/ }).textContent).toContain('Oct 1, 2026')
  })

  it('shows a date and time in the viewer zone', () => {
    render(<DateTimePicker value={new Date('2026-10-01T12:00:00.000Z')} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /2026/ }).textContent).toContain(
      'Oct 2, 2026 · 02:00'
    )
  })
})

describe('DateTimePicker open and clear hooks', () => {
  it('reports the popover opening and closing', () => {
    const onOpenChange = vi.fn()
    render(<DateTimePicker onChange={() => {}} onOpenChange={onOpenChange} placeholder="Pick" />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(onOpenChange).toHaveBeenCalledTimes(2)
  })

  it('reports the close after a date-only pick', () => {
    const onOpenChange = vi.fn()
    render(
      <DateTimePicker onChange={() => {}} onOpenChange={onOpenChange} placeholder="Pick" dateOnly />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }))
    fireEvent.click(screen.getByText('15'))
    expect(onOpenChange.mock.calls).toEqual([[true], [false]])
  })

  it('names the clear control with clearLabel, falling back to "Clear date"', () => {
    const onClear = vi.fn()
    const value = new Date('2026-10-01T12:00:00.000Z')
    const { rerender } = render(
      <DateTimePicker value={value} onChange={() => {}} onClear={onClear} />
    )
    expect(screen.getByRole('button', { name: 'Clear date' })).toBeInTheDocument()

    rerender(
      <DateTimePicker
        value={value}
        onChange={() => {}}
        onClear={onClear}
        clearLabel="Clear due date"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear due date' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
