// @vitest-environment happy-dom
/**
 * Opening the sign-in dialog redraws the dialog, not every vote button and
 * post card that can open it.
 */
import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { AuthPopoverProvider, useAuthPopover, useAuthPopoverState } from '../auth-popover-context'

let opens = 0
function Opener() {
  const { openAuthPopover } = useAuthPopover()
  opens++
  return (
    <button type="button" onClick={() => openAuthPopover({ mode: 'signup', description: 'Vote' })}>
      Vote
    </button>
  )
}

function Dialog() {
  const { isOpen, mode, description } = useAuthPopoverState()
  return <p>{isOpen ? `open ${mode} ${description}` : 'closed'}</p>
}

describe('AuthPopoverProvider', () => {
  it('opens the dialog without redrawing what opens it', () => {
    opens = 0
    render(
      <AuthPopoverProvider>
        <Opener />
        <Opener />
        <Dialog />
      </AuthPopoverProvider>
    )
    expect(opens).toBe(2)
    act(() => screen.getAllByRole('button', { name: 'Vote' })[0]!.click())
    expect(screen.getByText('open signup Vote')).toBeTruthy()
    expect(opens).toBe(2)
  })
})
