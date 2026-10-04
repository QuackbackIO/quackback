// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const sendInvitationFn = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/functions/admin', () => ({ sendInvitationFn }))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: { onboardingStatus: () => ({ queryKey: ['admin', 'onboarding'] }) },
}))

import { InviteTeamSheet, isInviteEmail, parseInviteEmails } from '../invite-team-sheet'

beforeEach(() => {
  sendInvitationFn.mockReset()
})
afterEach(cleanup)

it('reads pasted lists of addresses', () => {
  expect(parseInviteEmails(' A@acme.example, b@acme.example;c@acme.example\nd ')).toEqual([
    'a@acme.example',
    'b@acme.example',
    'c@acme.example',
    'd',
  ])
  expect(isInviteEmail('a@acme.example')).toBe(true)
  expect(isInviteEmail('d')).toBe(false)
})

it('invites each address with the default member role and shows a link when mail is off', async () => {
  sendInvitationFn.mockImplementation(async ({ data }: { data: { email: string } }) =>
    data.email.startsWith('a')
      ? { emailSent: true }
      : { emailSent: false, inviteLink: 'https://acme.quackback.test/invite/b' }
  )
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en">
        <InviteTeamSheet open onOpenChange={() => {}} />
      </IntlProvider>
    </QueryClientProvider>
  )
  const input = screen.getByLabelText('Email addresses')
  fireEvent.change(input, { target: { value: 'a@acme.example' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.change(input, { target: { value: 'b@acme.example' } })
  expect(screen.getAllByTestId('invite-chip')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Send invites' }))
  await waitFor(() => expect(sendInvitationFn).toHaveBeenCalledTimes(2))
  expect(sendInvitationFn).toHaveBeenNthCalledWith(1, {
    data: { email: 'a@acme.example', role: 'member' },
  })
  expect(sendInvitationFn).toHaveBeenNthCalledWith(2, {
    data: { email: 'b@acme.example', role: 'member' },
  })
  expect(await screen.findByText('Invited a@acme.example')).toBeTruthy()
  expect(screen.getByText('https://acme.quackback.test/invite/b')).toBeTruthy()
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'onboarding'] })
})

it('keeps a failed address so it can be fixed and resent', async () => {
  sendInvitationFn.mockRejectedValue(new Error('A team member with this email already exists'))
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en">
        <InviteTeamSheet open onOpenChange={() => {}} />
      </IntlProvider>
    </QueryClientProvider>
  )
  const input = screen.getByLabelText('Email addresses')
  fireEvent.change(input, { target: { value: 'a@acme.example' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send invites' }))
  expect(await screen.findByText('A team member with this email already exists')).toBeTruthy()
  expect(screen.getAllByTestId('invite-chip')).toHaveLength(1)
})
