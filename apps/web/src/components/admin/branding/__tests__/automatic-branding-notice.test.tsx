// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it, vi } from 'vitest'
import { AutomaticBrandingNotice } from '../automatic-branding-notice'

afterEach(cleanup)

it('offers an explicit Undo for a current permitted automatic logo change', () => {
  const undo = vi.fn()
  render(
    <IntlProvider locale="en">
      <AutomaticBrandingNotice
        status={{
          domain: 'example.com',
          pendingActionId: 'automatic-logo',
          status: 'applied',
          canUndo: true,
        }}
        pending={false}
        error={null}
        onUndo={undo}
      />
    </IntlProvider>
  )
  expect(screen.getByText('Logo from example.com')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(undo).toHaveBeenCalledTimes(1)
})

it('does not offer a dead Undo when the current actor lacks branding permission', () => {
  render(
    <IntlProvider locale="en">
      <AutomaticBrandingNotice
        status={{
          domain: 'example.com',
          pendingActionId: 'automatic-logo',
          status: 'applied',
          canUndo: false,
        }}
        pending={false}
        error={null}
        onUndo={() => {
          throw new Error('Undo is unavailable')
        }}
      />
    </IntlProvider>
  )
  expect(screen.getByText('Logo from example.com')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
})

it.each(['pending', 'failed', 'skipped', 'undone'] as const)('keeps %s lookups quiet', (status) => {
  render(
    <IntlProvider locale="en">
      <AutomaticBrandingNotice
        status={{ domain: 'example.com', pendingActionId: null, status, canUndo: false }}
        pending={false}
        error={null}
        onUndo={() => {
          throw new Error('No logo was applied')
        }}
      />
    </IntlProvider>
  )
  expect(screen.queryByText('Logo from example.com')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
})

it('keeps a refused Undo visible and prevents duplicate requests while saving', () => {
  const undo = vi.fn()
  render(
    <IntlProvider locale="en">
      <AutomaticBrandingNotice
        status={{
          domain: 'example.com',
          pendingActionId: 'automatic-logo',
          status: 'applied',
          canUndo: true,
        }}
        pending={true}
        error="This change cannot be undone."
        onUndo={undo}
      />
    </IntlProvider>
  )
  const button = screen.getByRole('button', { name: 'Undo' })
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(undo).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('This change cannot be undone.')
})
