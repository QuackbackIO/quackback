// @vitest-environment happy-dom
/**
 * The ticket title editor in the thread header: click to edit, Enter or blur
 * saves the trimmed title, Escape cancels, and an empty or unchanged title
 * saves nothing. A refused rename surfaces a toast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { TicketDTO } from '@/lib/server/domains/tickets'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/client/mutations/inbox', () => ({
  useSetTicketTitle: () => ({ mutate: mocks.mutate, isPending: false, variables: undefined }),
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import { TicketTitleEditor } from '../ticket-title-editor'

const ticket = { id: 'ticket_1', title: 'Login broken' } as unknown as TicketDTO

function renderEditor(onChanged = vi.fn()) {
  render(
    <IntlProvider locale="en" messages={{}}>
      <TicketTitleEditor ticket={ticket} onChanged={onChanged} />
    </IntlProvider>
  )
  return onChanged
}

const startEditing = () => fireEvent.click(screen.getByRole('button', { name: 'Rename ticket' }))
const input = () => screen.getByRole('textbox', { name: 'Rename ticket' }) as HTMLInputElement

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('TicketTitleEditor', () => {
  it('shows the title until clicked, then edits it in place', () => {
    renderEditor()
    expect(screen.getByText('Login broken')).toBeTruthy()
    startEditing()
    expect(input().value).toBe('Login broken')
  })

  it('saves the trimmed title on Enter and reports the change', () => {
    const onChanged = renderEditor()
    startEditing()
    fireEvent.change(input(), { target: { value: '  Cannot log in with SSO ' } })
    fireEvent.keyDown(input(), { key: 'Enter' })

    expect(mocks.mutate).toHaveBeenCalledTimes(1)
    const [vars, opts] = mocks.mutate.mock.calls[0]
    expect(vars).toEqual({ ticketId: 'ticket_1', title: 'Cannot log in with SSO' })
    opts.onSuccess()
    expect(onChanged).toHaveBeenCalled()
  })

  it('saves on blur', () => {
    renderEditor()
    startEditing()
    fireEvent.change(input(), { target: { value: 'Renamed' } })
    fireEvent.blur(input())
    expect(mocks.mutate).toHaveBeenCalledTimes(1)
  })

  it('cancels on Escape without saving', () => {
    renderEditor()
    startEditing()
    fireEvent.change(input(), { target: { value: 'Never mind' } })
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(mocks.mutate).not.toHaveBeenCalled()
    expect(screen.getByText('Login broken')).toBeTruthy()
  })

  it.each(['', '   ', 'Login broken', ' Login broken '])(
    'saves nothing for the title %j',
    (value) => {
      renderEditor()
      startEditing()
      fireEvent.change(input(), { target: { value } })
      fireEvent.keyDown(input(), { key: 'Enter' })
      expect(mocks.mutate).not.toHaveBeenCalled()
    }
  )

  it('shows an error toast when the rename is refused', () => {
    renderEditor()
    startEditing()
    fireEvent.change(input(), { target: { value: 'Renamed' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    mocks.mutate.mock.calls[0][1].onError()
    expect(mocks.toastError).toHaveBeenCalledWith('Could not rename the ticket')
  })
})
