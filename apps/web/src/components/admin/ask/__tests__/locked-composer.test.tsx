// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
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
        <p>Enter to send</p>
      </LockedComposer>
      <button type="button">After</button>
    </IntlProvider>
  )
  return screen.getByRole('group', { name: 'Ask Copilot' })
}

const offer = () => screen.getByRole('link', { name: 'Upgrade' })

describe('the composer without AI credits', () => {
  it('stays greyed and inert, with the offer out of sight at rest but describing the area', () => {
    const area = mount()
    expect(screen.getByRole('textbox', { hidden: true }).closest('[inert]')).not.toBeNull()
    expect(offer()).not.toBeVisible()
    expect(area).toHaveAccessibleDescription(/Copilot needs AI credits/)
  })

  it('is no tab stop of its own: the offer link is the one stop, and focusing it shows it', () => {
    const area = mount()
    expect(area).not.toHaveAttribute('tabindex')
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>('a[href], button, [tabindex]')
    ).filter((element) => !element.closest('[inert]'))
    expect(focusable.map((element) => element.textContent)).toEqual(['Before', 'Upgrade', 'After'])
    act(() => offer().focus())
    expect(offer()).toBeVisible()
    fireEvent.blur(offer(), { relatedTarget: screen.getByRole('button', { name: 'After' }) })
    expect(offer()).not.toBeVisible()
  })

  it('shows the offer on hover and hides it when the pointer leaves', () => {
    const area = mount()
    fireEvent.mouseEnter(area)
    expect(offer()).toBeVisible()
    fireEvent.mouseLeave(area)
    expect(offer()).not.toBeVisible()
  })

  it('shows the offer on tap, and Escape hides it again', () => {
    const area = mount()
    fireEvent.click(area)
    expect(offer()).toBeVisible()
    fireEvent.keyDown(area, { key: 'Escape' })
    expect(offer()).not.toBeVisible()
  })
})
