// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'

vi.mock('../install-messenger-sheet', () => ({ InstallMessengerSheet: () => null }))
vi.mock('../invite-team-sheet', () => ({
  InviteTeamSheet: ({ open }: { open: boolean }) =>
    open ? <div role="region" aria-label="Invite your team" /> : null,
}))
vi.mock('@/components/admin/ask/copilot-on-home', () => ({ useCopilotOnHome: () => false }))

import {
  OPEN_TRY_MESSENGER_EVENT as LIVE_EVENT,
  consumeSetupLink,
  useGoingLiveSheets,
} from '../going-live-sheets'
import { openGoingLiveSheet } from '../going-live-events'
import { AdminProductTourProvider } from '../admin-product-tour'
import { OPEN_TRY_MESSENGER_EVENT } from '../try-messenger-button'

function SheetHost() {
  return <>{useGoingLiveSheets()}</>
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('setup email links', () => {
  it('reads a step sheet or a test and strips only those parameters', () => {
    expect(consumeSetupLink('https://a.test/admin?open=install-messenger&x=1')).toEqual({
      open: 'install-messenger',
      test: null,
      rest: '/admin?x=1',
    })
    expect(consumeSetupLink('https://a.test/admin?try=idea')).toEqual({
      open: null,
      test: 'idea',
      rest: '/admin',
    })
    expect(consumeSetupLink('https://a.test/admin?open=elsewhere')?.open).toBeNull()
    expect(consumeSetupLink('https://a.test/admin')).toBeNull()
  })

  it('opens Try Messenger once its host is listening, even when the effect runs twice', async () => {
    expect(LIVE_EVENT).toBe(OPEN_TRY_MESSENGER_EVENT)
    window.history.replaceState(null, '', '/admin?try=idea')
    const heard: unknown[] = []
    const listen = (event: Event) => heard.push((event as CustomEvent).detail)
    render(
      <StrictMode>
        <SheetHost />
      </StrictMode>
    )
    // The Try Messenger host can register after this effect.
    window.addEventListener(OPEN_TRY_MESSENGER_EVENT, listen)
    await new Promise((resolve) => setTimeout(resolve, 10))
    window.removeEventListener(OPEN_TRY_MESSENGER_EVENT, listen)
    expect(heard).toEqual(['idea'])
    expect(window.location.search).toBe('')
  })
})

describe('the admin layout', () => {
  it('opens a going-live sheet on request', async () => {
    render(
      <AdminProductTourProvider>
        <p>page</p>
      </AdminProductTourProvider>
    )
    expect(screen.queryByRole('region', { name: 'Invite your team' })).toBeNull()
    await act(async () => openGoingLiveSheet('invite-team'))
    expect(await screen.findByRole('region', { name: 'Invite your team' })).toBeTruthy()
  })

  it('opens the step a setup email links to', async () => {
    window.history.replaceState(null, '', '/admin?open=invite-team')
    render(
      <AdminProductTourProvider>
        <p>page</p>
      </AdminProductTourProvider>
    )
    expect(await screen.findByRole('region', { name: 'Invite your team' })).toBeTruthy()
    expect(window.location.search).toBe('')
  })
})
