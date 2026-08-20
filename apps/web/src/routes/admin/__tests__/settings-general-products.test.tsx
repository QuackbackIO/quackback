// @vitest-environment happy-dom
/**
 * Feedback & Roadmaps backs the portal homepage, so its product switch is
 * fixed on: no click can send `feedback: false` from this card. The server
 * refuses the write too (see feature-flags-always-on.test.ts) — this covers
 * the half an admin actually sees.
 */
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProductsCard } from '../settings.general'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/shared/types'

function renderCard(onToggle = vi.fn()) {
  render(<ProductsCard flags={DEFAULT_FEATURE_FLAGS} pending={false} onToggle={onToggle} />)
  return onToggle
}

describe('Products card', () => {
  it('renders the feedback switch on and non-interactive, and says so', () => {
    const onToggle = renderCard()
    const feedback = screen.getByLabelText('Feedback & Roadmaps')

    expect(feedback).toBeChecked()
    expect(feedback).toBeDisabled()
    expect(screen.getByText('Feedback & Roadmaps is always enabled')).toBeVisible()

    fireEvent.click(feedback)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('leaves the other products switchable', () => {
    const onToggle = renderCard()
    const changelog = screen.getByLabelText('Changelog')

    expect(changelog).toBeChecked()
    expect(changelog).not.toBeDisabled()

    fireEvent.click(changelog)
    expect(onToggle).toHaveBeenCalledWith('changelog', false)
  })

  it('never claims feedback is off, even if a stored row says so', () => {
    render(
      <ProductsCard
        flags={{ ...DEFAULT_FEATURE_FLAGS, feedback: false }}
        pending={false}
        onToggle={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Feedback & Roadmaps')).toBeChecked()
  })
})
