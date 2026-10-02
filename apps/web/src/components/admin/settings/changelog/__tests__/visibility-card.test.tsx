// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { VisibilityCard } from '../visibility-card'
import { DEFAULT_CHANGELOG_SETTINGS } from '@/lib/shared/changelog-settings'

afterEach(cleanup)

describe('changelog VisibilityCard', () => {
  it('maps public to the Everyone tile', () => {
    render(<VisibilityCard settings={DEFAULT_CHANGELOG_SETTINGS} onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: /Everyone/ }).getAttribute('aria-checked')).toBe(
      'true'
    )
  })

  it('maps authenticated to the Signed-in users tile', () => {
    render(
      <VisibilityCard
        settings={{ ...DEFAULT_CHANGELOG_SETTINGS, audience: 'authenticated' }}
        onChange={() => {}}
      />
    )
    expect(
      screen.getByRole('radio', { name: /Signed-in users/ }).getAttribute('aria-checked')
    ).toBe('true')
  })

  it('choosing Signed-in users saves audience authenticated', () => {
    const onChange = vi.fn()
    render(<VisibilityCard settings={DEFAULT_CHANGELOG_SETTINGS} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: /Signed-in users/ }))
    expect(onChange).toHaveBeenCalledWith({ audience: 'authenticated' })
  })
})
