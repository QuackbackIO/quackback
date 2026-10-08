// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'

const hoisted = vi.hoisted(() => ({ billing: true, canBill: true }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useBillingEnabled: () => hoisted.billing,
}))
vi.mock('@/lib/client/hooks/use-permission', () => ({ usePermission: () => hoisted.canBill }))

import { CopilotPaused } from '../copilot-paused'

function show(resetsAt: string | null) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <CopilotPaused resetsAt={resetsAt} />
    </IntlProvider>
  )
}

beforeEach(() => {
  hoisted.billing = true
  hoisted.canBill = true
})
afterEach(cleanup)

describe('Copilot paused for the period', () => {
  it('says so in the box, with the day it comes back, not on hover', () => {
    show('2026-11-01T00:00:00.000Z')
    const box = screen.getByRole('status')
    expect(box).toHaveTextContent('Copilot is paused until Nov 1.')
    expect(box).toBeVisible()
    // Nothing to type into while it is paused.
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('links whoever manages billing to the usage, and never names a price', () => {
    show('2026-11-01T00:00:00.000Z')
    expect(screen.getByRole('link', { name: 'See usage' })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
    expect(document.body.textContent).not.toMatch(/[$€£]|\d+\s*(a|per) month/i)
  })

  it('offers no link to a teammate who cannot manage billing, or where there is no billing', () => {
    hoisted.canBill = false
    show('2026-11-01T00:00:00.000Z')
    expect(screen.queryByRole('link')).toBeNull()
    cleanup()

    hoisted.canBill = true
    hoisted.billing = false
    show('2026-11-01T00:00:00.000Z')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('still says it is paused when the reset day is not known', () => {
    show(null)
    expect(screen.getByRole('status')).toHaveTextContent('Copilot is paused.')
  })
})
