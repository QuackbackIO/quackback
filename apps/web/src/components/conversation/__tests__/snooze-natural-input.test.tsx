// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { SnoozeNaturalInput } from '../snooze-natural-input'

describe('<SnoozeNaturalInput>', () => {
  const onResolve = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a natural-language time on Enter and reports the date', () => {
    render(<SnoozeNaturalInput onResolve={onResolve} />)
    const input = screen.getByLabelText(/type a time/i)
    fireEvent.change(input, { target: { value: 'tomorrow morning' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onResolve).toHaveBeenCalledTimes(1)
    const resolved = onResolve.mock.calls[0]![0] as Date
    expect(resolved.getTime()).toBeGreaterThan(Date.now())
    expect(resolved.getHours()).toBe(9)
  })

  it('shows what the phrase resolved to', () => {
    render(<SnoozeNaturalInput onResolve={onResolve} />)
    const input = screen.getByLabelText(/type a time/i)
    fireEvent.change(input, { target: { value: 'next week' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText(/snoozes until/i)).toBeTruthy()
  })

  it('flags unparseable input without resolving', () => {
    render(<SnoozeNaturalInput onResolve={onResolve} />)
    const input = screen.getByLabelText(/type a time/i)
    fireEvent.change(input, { target: { value: 'whenever' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onResolve).not.toHaveBeenCalled()
    expect(screen.getByText(/try "tomorrow morning"/i)).toBeTruthy()
  })
})
