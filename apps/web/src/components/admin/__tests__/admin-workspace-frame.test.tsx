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
  it('folds the sidebar to nothing, out of reach on a wide screen, and gives the sheet an even margin', () => {
    const { slot, main } = frame(true)
    expect(slot.style.width).toBe('0px')
    // Hidden from pointer, keyboard and screen readers from sm up (where the
    // rail lives); visibility flips at the end of the width transition.
    expect(slot.className.split(/\s+/)).toContain('sm:invisible')
    expect(slot.className).toMatch(/transition-\[width,visibility\]/)
    expect(main.className).toContain('sm:ps-2')
  })

  // The sidebar component also renders the phone top bar (its own `sm:hidden`
  // fixed header with the menu button). Below `sm` the slot must not be
  // display:none, or every admin page loses its menu on a phone, and folding
  // the rail away on a wide screen must not make that phone menu inert.
  it.each([false, true])(
    'keeps the phone top bar reachable below sm (collapsed: %s)',
    (collapsed) => {
      const { slot } = frame(collapsed)
      const classes = slot.className.split(/\s+/)
      expect(classes).not.toContain('hidden')
      expect(classes).toContain('contents')
      expect(classes).toContain('sm:flex')
      expect(slot.hasAttribute('inert')).toBe(false)
      expect(slot.getAttribute('aria-hidden')).toBeNull()
    }
  )

  it('shows the sidebar at its width otherwise, the sheet against it', () => {
    const { slot, main } = frame(false)
    expect(slot.style.width).toBe('224px')
    expect(slot.className.split(/\s+/)).not.toContain('sm:invisible')
    expect(main.className).toContain('sm:ps-0')
  })

  it('leaves no room for the phone top bar on a full-page route, which has its own', () => {
    const canvas = (collapsed: boolean) => {
      frame(collapsed)
      const el = document.querySelector('[data-admin-canvas]') as HTMLElement
      const classes = el.className.split(/\s+/)
      cleanup()
      return classes
    }
    expect(canvas(true)).not.toContain('pt-14')
    expect(canvas(false)).toContain('pt-14')
  })
})
