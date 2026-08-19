// @vitest-environment happy-dom
/**
 * Coverage for the CF2 fix: ClampedIntInput (and DurationInput, which now
 * wraps it) used to clamp on every keystroke, so clearing the field snapped
 * straight to the min (then typing "5" read as "15"), and overshooting
 * mid-type clamped to the max before the user finished typing. Both now free
 * type while focused and only clamp on blur/Enter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ClampedIntInput, DurationInput } from '../shared'

afterEach(cleanup)

describe('ClampedIntInput', () => {
  it('free-types while focused: clearing then typing does not clamp mid-edit', () => {
    const onCommit = vi.fn()
    render(<ClampedIntInput value={5} min={1} max={30} onCommit={onCommit} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement

    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: '5' } })
    expect(input.value).toBe('5')
    // Nothing commits until blur/Enter: an in-progress edit never round-trips
    // through the clamp (the old bug: clearing then typing "5" -> "15").
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits the clamped value on blur', () => {
    const onCommit = vi.fn()
    render(<ClampedIntInput value={5} min={1} max={30} onCommit={onCommit} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement

    fireEvent.change(input, { target: { value: '999' } })
    expect(input.value).toBe('999') // still raw while focused
    fireEvent.blur(input)

    expect(onCommit).toHaveBeenCalledWith(30)
  })

  it('commits the clamped value on Enter', () => {
    const onCommit = vi.fn()
    render(<ClampedIntInput value={5} min={1} max={30} onCommit={onCommit} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement

    // Enter commits by blurring the field, which only dispatches a real
    // `blur` event (in happy-dom, same as a browser) if the element is
    // actually document.activeElement first: a real .focus() call, not just
    // a synthetic "focus" event.
    input.focus()
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onCommit).toHaveBeenCalledWith(1)
  })

  it('respects the committed-value bounds exactly (min and max inclusive, no clamp needed)', () => {
    const onCommit = vi.fn()
    render(<ClampedIntInput value={1} min={1} max={30} onCommit={onCommit} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement

    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith(30)
  })

  it('an empty or non-numeric commit falls back to the min', () => {
    const onCommit = vi.fn()
    render(<ClampedIntInput value={5} min={1} max={30} onCommit={onCommit} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith(1)
  })

  it('does not call onCommit when the clamped result equals the current value', () => {
    const onCommit = vi.fn()
    render(<ClampedIntInput value={5} min={1} max={30} onCommit={onCommit} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement

    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
  })
})

describe('DurationInput', () => {
  it('free-types the amount while focused, without clamping mid-edit', () => {
    const onChange = vi.fn()
    render(<DurationInput seconds={3600} onChange={onChange} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    expect(input.value).toBe('1') // 3600s -> 1 hour

    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: '5' } })
    expect(input.value).toBe('5')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('commits on blur, converted back to seconds at the current unit', () => {
    const onChange = vi.fn()
    render(<DurationInput seconds={3600} onChange={onChange} />) // 1 hour
    const input = screen.getByRole('spinbutton') as HTMLInputElement

    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith(5 * 3600)
  })

  it('the floor bound (0) is respected, with no ceiling clamp', () => {
    const onChange = vi.fn()
    render(<DurationInput seconds={3600} onChange={onChange} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement

    fireEvent.change(input, { target: { value: '-5' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith(0)

    onChange.mockClear()
    fireEvent.change(input, { target: { value: '999999' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith(999999 * 3600)
  })
})
