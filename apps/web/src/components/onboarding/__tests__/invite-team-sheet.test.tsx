// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const sendInvitationFn = vi.hoisted(() => vi.fn())
const team = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/functions/admin', () => ({ sendInvitationFn }))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: { onboardingStatus: () => ({ queryKey: ['admin', 'onboarding'] }) },
}))
vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    teamMembersAndInvitations: () => ({ queryKey: ['settings', 'team'], queryFn: team }),
  },
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

import {
  InviteTeamSheet,
  inviteEmailProblem,
  isInviteEmail,
  parseInviteEmails,
} from '../invite-team-sheet'

beforeEach(() => {
  sendInvitationFn.mockReset()
  team.mockReset()
  team.mockResolvedValue({ seatUsage: { used: 1, limit: null } })
})

function renderSheet(client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en">
        <InviteTeamSheet open onOpenChange={() => {}} />
      </IntlProvider>
    </QueryClientProvider>
  )
  return client
}

function addChips(...values: string[]) {
  const input = screen.getByLabelText('Email addresses')
  for (const value of values) {
    fireEvent.change(input, { target: { value } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }
}
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
  fireEvent.click(screen.getByRole('button', { name: 'Send 2 invites' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Send 1 invite' }))
  expect(await screen.findByText('A team member with this email already exists')).toBeTruthy()
  expect(screen.getAllByTestId('invite-chip')).toHaveLength(1)
})

it('says what is wrong with each address that will not send', () => {
  expect(inviteEmailProblem('mia@acme.com')).toBeNull()
  expect(inviteEmailProblem('jordan@acme')).toBe('end')
  expect(inviteEmailProblem('jordan.acme.com')).toBe('at')
  expect(inviteEmailProblem('a@b@c.com')).toBe('format')
})

it('explains each bad chip beside it and still sends the good ones', async () => {
  sendInvitationFn.mockResolvedValue({ emailSent: true })
  renderSheet()
  addChips('mia@acme.example', 'jordan@acme')
  const reason = await screen.findByText('jordan@acme is missing the end, like jordan@acme.com.')
  const bad = screen.getAllByTestId('invite-chip').find((chip) => chip.textContent?.includes('jordan'))!
  expect(bad.getAttribute('aria-invalid')).toBe('true')
  expect(bad.getAttribute('aria-describedby')).toBe(reason.id)

  fireEvent.click(screen.getByRole('button', { name: 'Send 1 invite' }))
  await waitFor(() => expect(sendInvitationFn).toHaveBeenCalledTimes(1))
  expect(sendInvitationFn).toHaveBeenCalledWith({
    data: { email: 'mia@acme.example', role: 'member' },
  })
  expect(await screen.findByText('Invited mia@acme.example')).toBeTruthy()
  expect(screen.getAllByTestId('invite-chip').map((chip) => chip.textContent)).toEqual([
    'jordan@acme',
  ])
})

it('counts pending invites in the seat meter and stops before the limit', async () => {
  team.mockResolvedValue({ seatUsage: { used: 2, members: 1, pendingInvites: 1, limit: 3 } })
  renderSheet()
  expect(await screen.findByText('Seats: 2 of 3 used, counting pending invites')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Manage seats' }).getAttribute('href')).toBe(
    '/admin/settings/billing'
  )
  addChips('a@acme.example', 'b@acme.example')
  expect(
    await screen.findByText('1 seat left. Remove an address or add seats.')
  ).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Send 2 invites' }).hasAttribute('disabled')).toBe(true)
})

it('shows no seat meter where seats are unlimited', async () => {
  renderSheet()
  await waitFor(() => expect(team).toHaveBeenCalled())
  expect(screen.queryByText(/Seats:/)).toBeNull()
})

it('turns a seat limit refusal into a clear message', async () => {
  sendInvitationFn.mockRejectedValue(
    new Error("You've reached your plan's team seats limit (3). Upgrade to add more.")
  )
  renderSheet()
  addChips('a@acme.example')
  fireEvent.click(screen.getByRole('button', { name: 'Send 1 invite' }))
  expect(
    await screen.findByText('No seat left for a@acme.example. Add seats to invite them.')
  ).toBeTruthy()
})

it('opens the address field with an email keyboard on phones', () => {
  renderSheet()
  expect(screen.getByLabelText('Email addresses').getAttribute('inputmode')).toBe('email')
})
