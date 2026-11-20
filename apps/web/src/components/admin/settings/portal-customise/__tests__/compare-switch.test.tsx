// @vitest-environment happy-dom
/**
 * Before, After and Live: a group of toggle buttons above the preview that
 * only change what the preview shows, and a label on the preview that says
 * which look that is.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompareLabel, CompareSwitch } from '../compare-switch'

afterEach(cleanup)

const pressed = () =>
  screen.getAllByRole('button').map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`)

describe('CompareSwitch', () => {
  it('is a named group of toggle buttons, After pressed', () => {
    render(<CompareSwitch view="after" canBefore canLive onView={() => {}} />)
    expect(screen.getByRole('group', { name: 'Compare' })).toBeInTheDocument()
    expect(pressed()).toEqual(['Before:false', 'After:true', 'Live:false'])
  })

  it('asks for the view a button names', () => {
    const onView = vi.fn()
    render(<CompareSwitch view="after" canBefore canLive onView={onView} />)
    fireEvent.click(screen.getByRole('button', { name: 'Before' }))
    fireEvent.click(screen.getByRole('button', { name: 'Live' }))
    fireEvent.click(screen.getByRole('button', { name: 'After' }))
    expect(onView.mock.calls.map(([view]) => view)).toEqual(['before', 'live', 'after'])
  })

  it('turns Before off with no earlier step, and Live off when nothing differs from live', () => {
    render(<CompareSwitch view="after" canBefore={false} canLive={false} onView={() => {}} />)
    expect(screen.getByRole('button', { name: 'Before' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Live' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'After' })).toBeEnabled()
  })

  it('shows which look is pressed', () => {
    render(<CompareSwitch view="live" canBefore canLive onView={() => {}} />)
    expect(pressed()).toEqual(['Before:false', 'After:false', 'Live:true'])
  })
})

describe('CompareLabel', () => {
  it('says nothing over the draft', () => {
    const { container } = render(<CompareLabel view="after" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names the look the preview shows', () => {
    const { rerender } = render(<CompareLabel view="before" />)
    expect(screen.getByText('Before this change')).toBeInTheDocument()
    rerender(<CompareLabel view="live" />)
    expect(screen.getByText('Live: what visitors see now')).toBeInTheDocument()
    // At the foot of the preview: the header above is often what is being compared.
    expect(screen.getByText('Live: what visitors see now').className).toContain('bottom-')
  })
})
