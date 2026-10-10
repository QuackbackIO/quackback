// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it, vi } from 'vitest'
import { AutomaticBrandingNotice } from '../automatic-branding-notice'
import type { AutomaticBrandingStatus } from '@/lib/shared/website-branding'

afterEach(cleanup)

const base: AutomaticBrandingStatus = {
  domain: 'example.com',
  status: 'applied',
  logoUrl: '/api/storage/logos/acme.png',
  colorApplied: true,
  canUndo: true,
  canUse: false,
}

function mount(
  status: AutomaticBrandingStatus,
  overrides: { pending?: boolean; error?: string } = {}
) {
  const handlers = { undo: vi.fn(), accept: vi.fn(), dismiss: vi.fn() }
  const view = render(
    <IntlProvider locale="en">
      <AutomaticBrandingNotice
        status={status}
        pending={overrides.pending ?? false}
        error={overrides.error ?? null}
        onUndo={handlers.undo}
        onAccept={handlers.accept}
        onDismiss={handlers.dismiss}
      />
    </IntlProvider>
  )
  return { ...handlers, view }
}

it('names the logo and color with a thumbnail and an explicit Undo', () => {
  const { undo, accept, dismiss, view } = mount(base)
  expect(screen.getByText('Logo and color from example.com')).toBeVisible()
  expect(view.container.querySelector('img')).toHaveAttribute('src', base.logoUrl)
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(undo).toHaveBeenCalledTimes(1)
  expect(accept).not.toHaveBeenCalled()
  expect(dismiss).not.toHaveBeenCalled()
})

it('says Logo from when only the logo changed', () => {
  mount({ ...base, colorApplied: false })
  expect(screen.getByText('Logo from example.com')).toBeVisible()
  expect(screen.queryByText(/color/)).toBeNull()
})

it('does not offer a dead Undo when the current teammate lacks the permission', () => {
  mount({ ...base, canUndo: false })
  expect(screen.getByText('Logo and color from example.com')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
})

it('offers a weak logo with Use it and Not now and no Undo', () => {
  const { undo, accept, dismiss, view } = mount({
    ...base,
    status: 'offered',
    colorApplied: false,
    canUndo: false,
    canUse: true,
  })
  expect(screen.getByText('Use the logo from example.com?')).toBeVisible()
  expect(view.container.querySelector('img')).toHaveAttribute('src', base.logoUrl)
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Use it' }))
  expect(accept).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
  expect(dismiss).toHaveBeenCalledTimes(1)
  expect(undo).not.toHaveBeenCalled()
})

it('shows nothing for an offer this teammate cannot answer', () => {
  const { view } = mount({ ...base, status: 'offered', canUndo: false, canUse: false })
  expect(view.container).toBeEmptyDOMElement()
})

it.each(['eligible', 'pending', 'failed', 'skipped', 'undone', 'declined'] as const)(
  'keeps %s lookups quiet',
  (status) => {
    const { view } = mount({ ...base, status, canUse: true })
    expect(view.container).toBeEmptyDOMElement()
  }
)

it('keeps a refused action visible and prevents duplicate requests while saving', () => {
  const { undo } = mount(base, {
    pending: true,
    error: 'The branding changed since then. Undo is unavailable.',
  })
  const button = screen.getByRole('button', { name: 'Undo' })
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(undo).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The branding changed since then. Undo is unavailable.'
  )
})
