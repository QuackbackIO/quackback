// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { IntlProvider } from 'react-intl'
import en from '@/locales/en.json'

vi.mock('../invite-team-sheet', () => ({
  InviteTeamSheet: ({ open }: { open: boolean }) =>
    open ? <div role="region" aria-label="Invite your team" /> : null,
}))
vi.mock('@/components/admin/ask/copilot-on-home', () => ({ useCopilotOnHome: () => false }))

import { consumeSetupLink, useGoingLiveSheets } from '../going-live-sheets'
import { openGoingLiveSheet } from '../going-live-events'
import { AdminProductTourProvider } from '../admin-product-tour'

function SheetHost() {
  return <>{useGoingLiveSheets()}</>
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('setup email links', () => {
  it('reads the step sheet and strips only that parameter', () => {
    expect(consumeSetupLink('https://a.test/admin?open=invite-team&x=1')).toEqual({
      open: 'invite-team',
      rest: '/admin?x=1',
    })
    expect(consumeSetupLink('https://a.test/admin?open=elsewhere')?.open).toBeNull()
    expect(consumeSetupLink('https://a.test/admin')).toBeNull()
  })

  it('opens the linked sheet once, even when the effect runs twice', async () => {
    window.history.replaceState(null, '', '/admin?open=invite-team')
    render(
      <IntlProvider locale="en" messages={en}>
        <StrictMode>
          <SheetHost />
        </StrictMode>
      </IntlProvider>
    )
    expect(await screen.findByRole('region', { name: 'Invite your team' })).toBeTruthy()
    expect(window.location.search).toBe('')
  })
})

describe('the admin layout', () => {
  // A catalog that holds the sheets' strings, so they open without loading any.
  const renderLayout = () =>
    render(
      <IntlProvider locale="en" messages={en}>
        <AdminProductTourProvider>
          <p>page</p>
        </AdminProductTourProvider>
      </IntlProvider>
    )

  it('opens a going-live sheet on request', async () => {
    renderLayout()
    expect(screen.queryByRole('region', { name: 'Invite your team' })).toBeNull()
    await act(async () => openGoingLiveSheet('invite-team'))
    expect(await screen.findByRole('region', { name: 'Invite your team' })).toBeTruthy()
  })

  it('opens the step a setup email links to', async () => {
    window.history.replaceState(null, '', '/admin?open=invite-team')
    renderLayout()
    expect(await screen.findByRole('region', { name: 'Invite your team' })).toBeTruthy()
    expect(window.location.search).toBe('')
  })
})
