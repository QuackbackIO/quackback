// @vitest-environment happy-dom
/**
 * A full-page admin route (portal Customise) folds the sidebar away rather
 * than dropping it: the slot narrows to nothing with a transition, the rail
 * inside it inert, and the page sheet keeps an even margin on every side.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { AdminWorkspaceFrame } from '../admin-workspace-frame'

afterEach(cleanup)

function frame(collapsed: boolean) {
  render(
    <IntlProvider locale="en">
      <AdminWorkspaceFrame sidebar={<nav>rail</nav>} notices={null} collapsed={collapsed}>
        <p>page</p>
      </AdminWorkspaceFrame>
    </IntlProvider>
  )
  return {
    slot: screen.getByText('rail').closest('[data-admin-sidebar-slot]') as HTMLElement,
    main: screen.getByRole('main'),
  }
}

describe('AdminWorkspaceFrame', () => {
  it('folds the sidebar to nothing, inert, and gives the sheet an even margin', () => {
    const { slot, main } = frame(true)
    expect(slot.style.width).toBe('0px')
    expect(slot.hasAttribute('inert')).toBe(true)
    expect(slot.className).toMatch(/transition-\[width\]/)
    expect(main.className).toContain('sm:ps-2')
  })

  it('shows the sidebar at its width otherwise, the sheet against it', () => {
    const { slot, main } = frame(false)
    expect(slot.style.width).toBe('224px')
    expect(slot.hasAttribute('inert')).toBe(false)
    expect(main.className).toContain('sm:ps-0')
  })
})
