// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { StrictMode } from 'react'

vi.mock('../install-messenger-sheet', () => ({ InstallMessengerSheet: () => null }))
vi.mock('../invite-team-sheet', () => ({ InviteTeamSheet: () => null }))

import {
  GoingLiveSheets,
  OPEN_TRY_MESSENGER_EVENT as LIVE_EVENT,
  consumeSetupLink,
} from '../going-live-sheets'
import { OPEN_TRY_MESSENGER_EVENT } from '../try-messenger-button'

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
        <GoingLiveSheets />
      </StrictMode>
    )
    // The host registers after this effect, as the admin layout's parent does.
    window.addEventListener(OPEN_TRY_MESSENGER_EVENT, listen)
    await new Promise((resolve) => setTimeout(resolve, 10))
    window.removeEventListener(OPEN_TRY_MESSENGER_EVENT, listen)
    expect(heard).toEqual(['idea'])
    expect(window.location.search).toBe('')
  })
})
