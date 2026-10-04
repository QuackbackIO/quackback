// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it } from 'vitest'
import en from '@/locales/en.json'
import { LockedComposer } from '../locked-composer'

afterEach(cleanup)

function mount() {
  render(
    <IntlProvider locale="en" messages={en}>
      <button type="button">Before</button>
      <LockedComposer
        overlay={
          <div>
            Copilot needs AI credits. Pro includes them.
            <a href="/admin/settings/billing">Upgrade</a>
          </div>
        }
      >
        <textarea aria-label="Ask Copilot" />
      </LockedComposer>
      <button type="button">After</button>
    </IntlProvider>
  )
  return screen.getByRole('group', { name: 'Ask Copilot' })
}

const offer = () => screen.queryByRole('link', { name: 'Upgrade' })

describe('the composer without AI credits', () => {
  it('stays greyed and inert, with the offer hidden at rest but describing the area', () => {
    const area = mount()
    expect(screen.getByRole('textbox', { hidden: true }).closest('[inert]')).not.toBeNull()
    expect(offer()).toBeNull()
    expect(area).toHaveAccessibleDescription(/Copilot needs AI credits/)
  })

  it('shows the offer on hover and hides it when the pointer leaves', () => {
    const area = mount()
    fireEvent.mouseEnter(area)
    expect(offer()).toHaveAttribute('href', '/admin/settings/billing')
    fireEvent.mouseLeave(area)
    expect(offer()).toBeNull()
  })

  it('shows the offer on keyboard focus, and Escape or blur hides it', () => {
    const area = mount()
    act(() => area.focus())
    expect(offer()).toBeTruthy()
    fireEvent.keyDown(area, { key: 'Escape' })
    expect(offer()).toBeNull()
    expect(area).toHaveFocus()
    fireEvent.focus(area)
    expect(offer()).toBeTruthy()
    fireEvent.blur(area, { relatedTarget: screen.getByRole('button', { name: 'After' }) })
    expect(offer()).toBeNull()
  })

  it('keeps the offer while focus moves onto its link, and shows it on tap', () => {
    const area = mount()
    act(() => area.focus())
    const link = offer()!
    fireEvent.blur(area, { relatedTarget: link })
    expect(offer()).toBeTruthy()
    fireEvent.keyDown(area, { key: 'Escape' })
    fireEvent.click(area)
    expect(offer()).toBeTruthy()
  })
})
