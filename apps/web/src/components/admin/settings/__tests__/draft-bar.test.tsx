// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DraftBar } from '../draft-bar'

afterEach(cleanup)

describe('DraftBar', () => {
  it('renders nothing when there are no unsaved changes', () => {
    const { container } = render(
      <DraftBar dirty={false} saving={false} onSave={() => {}} onDiscard={() => {}} />
    )
    expect(container.textContent).toBe('')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('shows the message and both actions when dirty', () => {
    render(<DraftBar dirty saving={false} onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('calls onSave and onDiscard', () => {
    const onSave = vi.fn()
    const onDiscard = vi.fn()
    render(<DraftBar dirty saving={false} onSave={onSave} onDiscard={onDiscard} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('shows a pending state and blocks both actions while saving', () => {
    const onSave = vi.fn()
    render(<DraftBar dirty saving onSave={onSave} onDiscard={() => {}} />)
    const save = screen.getByRole('button', { name: /Saving/ })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    fireEvent.click(save)
    expect(onSave).not.toHaveBeenCalled()
  })
})
