// @vitest-environment happy-dom
/**
 * The Add people dialog: one chip field that finds people who have signed in
 * and takes emails to invite, a role, the seat meter, a line per person saying
 * what will happen, and one submit that adds and invites together.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const fns = vi.hoisted(() => ({
  searchPeopleToAddFn: vi.fn(),
  addTeamMembersFn: vi.fn(),
  getTeamSeatsFn: vi.fn(),
  removeTeamMemberFn: vi.fn(),
  cancelInvitationFn: vi.fn(),
  resendInvitationFn: vi.fn(),
  listRolesFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/lib/server/functions/team-people', () => ({
  searchPeopleToAddFn: fns.searchPeopleToAddFn,
  addTeamMembersFn: fns.addTeamMembersFn,
  getTeamSeatsFn: fns.getTeamSeatsFn,
}))
vi.mock('@/lib/server/functions/admin', () => ({
  removeTeamMemberFn: fns.removeTeamMemberFn,
  cancelInvitationFn: fns.cancelInvitationFn,
  resendInvitationFn: fns.resendInvitationFn,
}))
vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    roles: () => ({ queryKey: ['settings', 'roles'], queryFn: fns.listRolesFn }),
  },
}))
vi.mock('@/lib/client/hooks/use-users-queries', () => ({ usersKeys: { all: ['users'] } }))
vi.mock('sonner', () => ({
  toast: Object.assign(fns.toast, { success: fns.toastSuccess, error: fns.toastError }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))
// The Base UI select needs layout APIs happy-dom lacks.
vi.mock('@/components/ui/select', () => import('./select-double'))

import { AddPeopleDialog, type AddPeopleDialogProps } from '../add-people-dialog'

const MAYA = {
  principalId: 'principal_maya',
  name: 'Maya Chen',
  avatarUrl: null,
  detail: 'maya@northwind.example',
  status: 'portal_user' as const,
}
const OMAR = {
  principalId: 'principal_omar',
  name: 'Omar Haddad',
  avatarUrl: null,
  detail: 'omar@northwind.example',
  status: 'portal_user' as const,
}
const TEAMMATE = {
  principalId: 'principal_tess',
  name: 'Tess Mate',
  avatarUrl: null,
  detail: 'tess@acme.example',
  status: 'member' as const,
}
const BOSS = {
  principalId: 'principal_bo',
  name: 'Bo Boss',
  avatarUrl: null,
  detail: 'bo@acme.example',
  status: 'admin' as const,
}

type SearchAnswer = {
  canSearchPeople: boolean
  people: Array<typeof MAYA | typeof TEAMMATE | typeof BOSS>
  email?: {
    address: string
    status: 'new' | 'pending_invite' | 'member' | 'portal_user'
    invitationId?: string
    invitedAt?: string
    principalId?: string
    roleName?: string
  }
}

let answers: Record<string, SearchAnswer>

beforeEach(() => {
  answers = {
    '': { canSearchPeople: true, people: [MAYA, OMAR, TEAMMATE, BOSS] },
  }
  fns.searchPeopleToAddFn.mockImplementation(async ({ data }: { data: { query: string } }) => {
    return answers[data.query] ?? { canSearchPeople: true, people: [] }
  })
  fns.getTeamSeatsFn.mockResolvedValue({ used: 3, limit: 10 })
  fns.listRolesFn.mockResolvedValue({
    roles: [
      { id: 'role_member', name: 'Member', isSystem: true, permissionKeys: [] },
      { id: 'role_editor', name: 'Editor', isSystem: false, permissionKeys: ['post.edit'] },
    ],
  })
  fns.addTeamMembersFn.mockResolvedValue({
    ok: true,
    added: [{ principalId: 'principal_maya', name: 'Maya Chen' }],
    invited: [],
  })
  fns.removeTeamMemberFn.mockResolvedValue({ success: true })
  fns.cancelInvitationFn.mockResolvedValue({ success: true })
  fns.resendInvitationFn.mockResolvedValue({ emailSent: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(props: Partial<AddPeopleDialogProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <AddPeopleDialog open onOpenChange={onOpenChange} canGrantAdmin {...props} />
    </QueryClientProvider>
  )
  return { onOpenChange, queryClient }
}

const field = () => screen.getByRole('combobox', { name: 'People' })
const primary = () => screen.getByRole('button', { name: /^(Add|Invite|Adding)/ })

async function type(text: string) {
  fireEvent.focus(field())
  fireEvent.change(field(), { target: { value: text } })
}

async function pick(name: string | RegExp) {
  fireEvent.click(await screen.findByRole('option', { name }))
}

function paste(text: string) {
  fireEvent.focus(field())
  fireEvent.paste(field(), { clipboardData: { getData: () => text } })
}

describe('AddPeopleDialog', () => {
  it('lists recently active people when the field is empty, teammates disabled', async () => {
    renderDialog({ workspaceName: 'Acme' })
    expect(screen.getByRole('heading', { name: 'Add people to Acme' })).toBeInTheDocument()
    fireEvent.focus(field())

    const list = await screen.findByRole('listbox', { name: 'Recently active' })
    const maya = await within(list).findByRole('option', { name: /Maya Chen/ })
    expect(maya).toHaveTextContent('maya@northwind.example')
    expect(maya).toHaveTextContent('Portal user')
    expect(maya).not.toHaveAttribute('aria-disabled')

    const tess = within(list).getByRole('option', { name: /Tess Mate/ })
    expect(tess).toHaveTextContent('Already a Member')
    expect(tess).toHaveAttribute('aria-disabled', 'true')
    const bo = within(list).getByRole('option', { name: /Bo Boss/ })
    expect(bo).toHaveTextContent('Already an Admin')
    expect(bo).toHaveAttribute('aria-disabled', 'true')

    // A teammate cannot be picked.
    fireEvent.click(tess)
    expect(screen.queryByRole('button', { name: 'Remove Tess Mate' })).toBeNull()
    expect(fns.searchPeopleToAddFn).toHaveBeenCalledWith({ data: { query: '' } })
  })

  it('searches once the typing settles, not on every keystroke', async () => {
    answers.may = { canSearchPeople: true, people: [MAYA, TEAMMATE] }
    renderDialog()
    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: 'm' } })
    fireEvent.change(field(), { target: { value: 'ma' } })
    fireEvent.change(field(), { target: { value: 'may' } })

    await waitFor(
      () => expect(fns.searchPeopleToAddFn).toHaveBeenCalledWith({ data: { query: 'may' } }),
      { timeout: 5000 }
    )
    const list = await screen.findByRole('listbox', { name: 'People' })
    expect(await within(list).findByRole('option', { name: /Maya Chen/ })).toBeInTheDocument()
    expect(within(list).getByRole('option', { name: /Tess Mate/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    const queries = fns.searchPeopleToAddFn.mock.calls.map((c) => c[0].data.query)
    expect(queries).toContain('may')
    expect(queries).not.toContain('m')
    expect(queries).not.toContain('ma')
  })

  it('offers to invite a full email nobody has used, as an envelope chip', async () => {
    answers['new@acme.example'] = {
      canSearchPeople: true,
      people: [],
      email: { address: 'new@acme.example', status: 'new' },
    }
    renderDialog()
    await type('new@acme.example')
    const option = await screen.findByRole('option', { name: /^Invite new@acme\.example/ })
    expect(option).toHaveTextContent(
      'Nobody with this email has signed in. They get an email invitation for 30 days.'
    )
    fireEvent.click(option)

    expect(screen.getByRole('button', { name: 'Remove new@acme.example' })).toBeInTheDocument()
    expect(field()).toHaveAttribute('placeholder', 'Add more people')
    const summary = screen.getByRole('list', { name: 'What happens' })
    expect(summary).toHaveTextContent(
      'new@acme.example gets an email invitation that works for 30 days.'
    )
    expect(primary()).toHaveTextContent('Invite 1 person')
    expect(field()).toHaveValue('')
  })

  it('shows an email with a pending invite as not accepted yet, with Resend', async () => {
    answers['wait@acme.example'] = {
      canSearchPeople: true,
      people: [],
      email: {
        address: 'wait@acme.example',
        status: 'pending_invite',
        invitationId: 'invite_1',
        invitedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
    }
    renderDialog()
    await type('wait@acme.example')

    expect(await screen.findByText('Invited 3 days ago, not accepted yet')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Invite wait@acme.example/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Resend invite' }))
    await waitFor(() =>
      expect(fns.resendInvitationFn).toHaveBeenCalledWith({ data: { invitationId: 'invite_1' } })
    )
    expect(await screen.findByText('Sent')).toBeInTheDocument()
  })

  it('names the role a pending invite was sent with, when known', async () => {
    answers['wait@acme.example'] = {
      canSearchPeople: true,
      people: [],
      email: {
        address: 'wait@acme.example',
        status: 'pending_invite',
        invitationId: 'invite_1',
        invitedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        roleName: 'Member',
      },
    }
    renderDialog()
    await type('wait@acme.example')
    expect(
      await screen.findByText('Invited 3 days ago as Member, not accepted yet')
    ).toBeInTheDocument()
  })

  it('shows an email already on the team as unavailable', async () => {
    answers['tess@acme.example'] = {
      canSearchPeople: true,
      people: [],
      email: { address: 'tess@acme.example', status: 'member' },
    }
    renderDialog()
    await type('tess@acme.example')
    const option = (await screen.findByText('Already on the team')).closest('[role="option"]')
    expect(option).toHaveTextContent('tess@acme.example')
    expect(option).toHaveAttribute('aria-disabled', 'true')
  })

  it('makes one invite chip per address when several emails are pasted', async () => {
    renderDialog()
    paste('Ann <ann@acme.example>, bob@acme.example; cy@acme.example\nann@acme.example')

    for (const address of ['ann@acme.example', 'bob@acme.example', 'cy@acme.example']) {
      expect(screen.getByRole('button', { name: `Remove ${address}` })).toBeInTheDocument()
    }
    expect(screen.getAllByText('invite')).toHaveLength(3)
    expect(primary()).toHaveTextContent('Invite 3 people')
    expect(field()).toHaveValue('')
  })

  it('shows a person as an avatar chip and an email as an invite chip', async () => {
    renderDialog()
    fireEvent.focus(field())
    await pick(/Maya Chen/)
    paste('a@acme.example b@acme.example')

    const mayaChip = screen.getByRole('button', { name: 'Remove Maya Chen' }).parentElement!
    expect(mayaChip).not.toHaveTextContent('invite')
    expect(mayaChip.textContent).toContain('MC')
    const emailChip = screen.getByRole('button', { name: 'Remove a@acme.example' }).parentElement!
    expect(emailChip).toHaveTextContent('invite')

    // Mixed: someone joins now, so the action is Add.
    expect(primary()).toHaveTextContent('Add 3 people')
    // A chosen person leaves the results list.
    fireEvent.focus(field())
    expect(screen.queryByRole('option', { name: /Maya Chen/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Maya Chen' }))
    expect(screen.queryByRole('button', { name: 'Remove Maya Chen' })).toBeNull()
  })

  it('works from the keyboard: arrows move, Enter picks, Backspace drops the last chip', async () => {
    renderDialog()
    fireEvent.focus(field())
    await screen.findByRole('option', { name: /Maya Chen/ })
    expect(field()).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    const active = field().getAttribute('aria-activedescendant')!
    expect(document.getElementById(active)).toHaveTextContent('Omar Haddad')
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Remove Omar Haddad' })).toBeInTheDocument()

    fireEvent.keyDown(field(), { key: 'Backspace' })
    expect(screen.queryByRole('button', { name: 'Remove Omar Haddad' })).toBeNull()
  })

  it('warns what Admin can do, and offers Admin only to someone who can grant it', async () => {
    renderDialog()
    const roleSelect = screen.getByLabelText('Role')
    expect(screen.queryByText(/Admins can change settings/)).toBeNull()
    fireEvent.change(roleSelect, { target: { value: 'admin' } })
    expect(
      screen.getByText('Admins can change settings, billing, members and sign-in.')
    ).toBeInTheDocument()
    // Custom roles are listed under their own heading.
    expect(await screen.findByRole('option', { name: 'Editor' })).toBeInTheDocument()

    cleanup()
    renderDialog({ canGrantAdmin: false })
    expect(screen.getByRole('option', { name: /^Admin - / })).toBeDisabled()
    expect(screen.getByRole('option', { name: /^Member - / })).not.toBeDisabled()
  })

  it('stops at the seat limit: amber message, billing link, primary disabled', async () => {
    fns.getTeamSeatsFn.mockResolvedValue({ used: 9, limit: 10 })
    renderDialog()
    expect(await screen.findByText('9 / 10')).toBeInTheDocument()

    fireEvent.focus(field())
    await pick(/Maya Chen/)
    expect(screen.getByText('10 / 10')).toBeInTheDocument()
    expect(primary()).toBeEnabled()

    fireEvent.focus(field())
    await pick(/Omar Haddad/)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(
      'Adding 2 people needs 11 seats and the plan has 10. Remove 1, or add seats in Plan & billing.'
    )
    expect(
      within(alert).getByRole('link', { name: 'add seats in Plan & billing' })
    ).toHaveAttribute('href', '/admin/settings/billing')
    expect(primary()).toBeDisabled()
    // Nothing would happen, so nothing is summarised.
    expect(screen.queryByRole('list', { name: 'What happens' })).toBeNull()
  })

  it('says what happens to each person, then submits people and emails together', async () => {
    fns.addTeamMembersFn.mockResolvedValue({
      ok: true,
      added: [{ principalId: 'principal_maya', name: 'Maya Chen' }],
      invited: [{ email: 'a@acme.example', invitationId: 'invite_a' }],
    })
    const onAdded = vi.fn()
    const { onOpenChange } = renderDialog({ onAdded })
    fireEvent.focus(field())
    await pick(/Maya Chen/)
    paste('a@acme.example b@acme.example')
    fireEvent.click(screen.getByRole('button', { name: 'Remove b@acme.example' }))
    await screen.findByRole('option', { name: 'Editor' })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'role_editor' } })

    const summary = screen.getByRole('list', { name: 'What happens' })
    const lines = within(summary)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(lines).toEqual([
      'Maya Chen joins now as an Editor and keeps signing in the way they do today.',
      'a@acme.example gets an email invitation that works for 30 days.',
    ])

    fireEvent.click(primary())
    await waitFor(() => expect(fns.addTeamMembersFn).toHaveBeenCalledTimes(1))
    expect(fns.addTeamMembersFn).toHaveBeenCalledWith({
      data: {
        principalIds: ['principal_maya'],
        emails: ['a@acme.example'],
        role: 'member',
        roleId: 'role_editor',
      },
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onAdded).toHaveBeenCalledWith(
      expect.objectContaining({ added: [{ principalId: 'principal_maya', name: 'Maya Chen' }] }),
      { role: 'member', roleId: 'role_editor', label: 'Editor' }
    )
  })

  it('opens prefilled with a person, and toasts with an Undo that removes them again', async () => {
    const onUndone = vi.fn()
    renderDialog({
      initialPerson: {
        principalId: 'principal_maya',
        name: 'Maya Chen',
        avatarUrl: null,
        detail: 'maya@northwind.example',
      },
      onUndone,
    })
    expect(screen.getByRole('heading', { name: 'Make Maya Chen a teammate' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'What happens' })).toHaveTextContent(
      'Maya Chen joins now as a Member and keeps signing in the way they do today.'
    )
    expect(screen.getByRole('button', { name: 'Remove Maya Chen' })).toBeInTheDocument()
    expect(primary()).toHaveTextContent('Add 1 person')

    fireEvent.click(primary())
    await waitFor(() => expect(fns.toastSuccess).toHaveBeenCalledTimes(1))
    expect(fns.addTeamMembersFn).toHaveBeenCalledWith({
      data: { principalIds: ['principal_maya'], emails: [], role: 'member' },
    })
    const [message, options] = fns.toastSuccess.mock.calls[0]
    expect(message).toBe(
      'Maya Chen is now a Member. Their ideas, votes and comments stay with them.'
    )
    expect(options.action.label).toBe('Undo')

    await act(async () => options.action.onClick())
    expect(fns.removeTeamMemberFn).toHaveBeenCalledWith({
      data: { principalId: 'principal_maya' },
    })
    expect(onUndone).toHaveBeenCalled()
  })

  it('keeps invitation links on screen when no email could be sent', async () => {
    fns.addTeamMembersFn.mockResolvedValue({
      ok: true,
      added: [],
      invited: [
        {
          email: 'a@acme.example',
          invitationId: 'invite_a',
          emailSent: false,
          inviteLink: 'https://acme.example/accept/abc',
        },
      ],
    })
    const { onOpenChange } = renderDialog()
    paste('a@acme.example b@acme.example')
    fireEvent.click(screen.getByRole('button', { name: 'Remove b@acme.example' }))
    fireEvent.click(primary())

    expect(await screen.findByText('https://acme.example/accept/abc')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Copy invitation link for a@acme.example' })
    ).toBeInTheDocument()
    // Nothing was emailed, so nothing is announced as sent.
    expect(fns.toastSuccess).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows a seat refusal from the server by the seat meter, with its numbers', async () => {
    fns.addTeamMembersFn.mockResolvedValue({
      ok: false,
      code: 'SEAT_LIMIT',
      message: 'Not enough seats: this needs 1 and 0 are free.',
      needed: 1,
      free: 0,
    })
    renderDialog()
    fireEvent.focus(field())
    await pick(/Maya Chen/)
    fireEvent.click(primary())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Adding 1 person needs 1 seat, and 0 are free. Remove 1, or add seats in Plan & billing.'
    )
    expect(fns.toastSuccess).not.toHaveBeenCalled()
  })

  it('shows a role the caller may not grant by the role field', async () => {
    fns.addTeamMembersFn.mockResolvedValue({
      ok: false,
      code: 'GRANT_CEILING',
      message: 'Only an admin can grant the Admin role',
    })
    renderDialog()
    fireEvent.focus(field())
    await pick(/Maya Chen/)
    fireEvent.click(primary())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can only give a role with no more access than your own. Choose another role.'
    )
  })

  it('shows any other refusal above the form', async () => {
    fns.addTeamMembersFn.mockResolvedValue({
      ok: false,
      code: 'ALREADY_MEMBER',
      message: 'Maya Chen is already on the team',
      principalId: 'principal_maya',
    })
    renderDialog()
    fireEvent.focus(field())
    await pick(/Maya Chen/)
    fireEvent.click(primary())
    expect(await screen.findByText('Maya Chen is already on the team')).toBeInTheDocument()
    expect(fns.toastSuccess).not.toHaveBeenCalled()
  })

  it('shows a generic message when the call itself fails', async () => {
    fns.addTeamMembersFn.mockRejectedValue(new Error('{"status":500,"unhandled":true}'))
    renderDialog()
    fireEvent.focus(field())
    await pick(/Maya Chen/)
    fireEvent.click(primary())
    expect(await screen.findByText("Couldn't add people. Try again.")).toBeInTheDocument()
    expect(screen.queryByText(/unhandled/)).toBeNull()
  })

  it('takes only emails when the caller cannot search people', async () => {
    answers[''] = { canSearchPeople: false, people: [] }
    answers.maya = { canSearchPeople: false, people: [MAYA] }
    answers['new@acme.example'] = {
      canSearchPeople: false,
      people: [],
      email: { address: 'new@acme.example', status: 'new' },
    }
    renderDialog()
    expect(
      await screen.findByText('Type a full email to invite someone. You can paste several emails.')
    ).toBeInTheDocument()
    expect(field()).toHaveAttribute('placeholder', 'Email address')

    await type('maya')
    await waitFor(
      () => expect(fns.searchPeopleToAddFn).toHaveBeenCalledWith({ data: { query: 'maya' } }),
      { timeout: 5000 }
    )
    expect(screen.queryByRole('option', { name: /Maya Chen/ })).toBeNull()

    await type('new@acme.example')
    await pick(/^Invite new@acme\.example/)
    expect(screen.getByRole('button', { name: 'Remove new@acme.example' })).toBeInTheDocument()
  })
})
