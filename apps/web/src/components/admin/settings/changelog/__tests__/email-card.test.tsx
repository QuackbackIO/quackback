// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EmailCard } from '../email-card'
import { DEFAULT_CHANGELOG_SETTINGS, type ChangelogSettings } from '@/lib/shared/changelog-settings'

vi.mock('../csv-import-section', () => ({ CsvImportSection: () => null }))

afterEach(cleanup)

function renderCard(patch: Partial<ChangelogSettings>, onChange = vi.fn()) {
  render(<EmailCard settings={{ ...DEFAULT_CHANGELOG_SETTINGS, ...patch }} onChange={onChange} />)
  return onChange
}

describe('EmailCard send switch', () => {
  it('reads on when emails are not disabled', () => {
    renderCard({ emailsDisabled: false })
    const sw = screen.getByRole('switch', { name: 'Send changelog emails' })
    expect(sw.getAttribute('aria-checked')).toBe('true')
  })

  it('reads off when the stored disabled flag is true', () => {
    renderCard({ emailsDisabled: true })
    const sw = screen.getByRole('switch', { name: 'Send changelog emails' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
  })

  it('turning it off stores emailsDisabled true', () => {
    const onChange = renderCard({ emailsDisabled: false })
    fireEvent.click(screen.getByRole('switch', { name: 'Send changelog emails' }))
    expect(onChange).toHaveBeenCalledWith({ emailsDisabled: true })
  })

  it('turning it on stores emailsDisabled false', () => {
    const onChange = renderCard({ emailsDisabled: true })
    fireEvent.click(screen.getByRole('switch', { name: 'Send changelog emails' }))
    expect(onChange).toHaveBeenCalledWith({ emailsDisabled: false })
  })

  it('has no inverted Disable switch', () => {
    renderCard({})
    expect(screen.queryByText(/Disable changelog emails/)).toBeNull()
  })
})
