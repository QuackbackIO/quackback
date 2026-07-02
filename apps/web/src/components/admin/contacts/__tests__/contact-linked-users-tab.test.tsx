// @vitest-environment happy-dom
import type { ChangeEvent, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContactLinkedUsersTab } from '../contact-linked-users-tab'

type QueryOptions<T> = {
  queryKey: readonly unknown[]
  queryFn: () => T
  staleTime?: number
}

type MutationOptions<TVars, TResult> = {
  mutationFn: (vars: TVars) => Promise<TResult>
  onSuccess?: (result: TResult) => void
  onError?: (error: Error) => void
}

type Link = {
  id: string
  userId: string
  linkedAt: string
}

type Principal = {
  id: string
  userId: string | null
  displayName: string | null
  email: string | null
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  linkContactToUserFn: vi.fn(),
  unlinkContactFromUserFn: vi.fn(),
  searchPrincipalsFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  permissionAllowed: true,
  links: [] as Link[],
  principals: [] as Principal[],
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useSuspenseQuery: () => ({
    data: mocks.links,
  }),
  useQuery: <T,>(options: QueryOptions<T>) => ({
    data: options.queryFn(),
  }),
  useMutation: <TVars, TResult>(options: MutationOptions<TVars, TResult>) => ({
    isPending: false,
    mutate: async (vars: TVars) => {
      try {
        const result = await options.mutationFn(vars)
        options.onSuccess?.(result)
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }),
}))

vi.mock('@/components/admin/shared/permission-gate', () => ({
  PermissionGate: ({
    children,
    fallback = null,
  }: {
    children: ReactNode
    fallback?: ReactNode
    permission: string
  }) => (mocks.permissionAllowed ? <>{children}</> : <>{fallback}</>),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = 'button',
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
    className?: string
    'aria-label'?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: ReactNode; className?: string }) => <span>{children}</span>,
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({
    children,
    colSpan,
  }: {
    children?: ReactNode
    colSpan?: number
    className?: string
  }) => <td colSpan={colSpan}>{children}</td>,
  TableHead: ({ children }: { children?: ReactNode; className?: string }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
  AlertDialogTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>,
}))

vi.mock('@/components/admin/shared/principal-picker', () => ({
  PrincipalPicker: ({
    value,
    onValueChange,
    excludeIds,
    placeholder,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
    roleFilter?: string[]
    excludeIds: string[]
    placeholder?: string
  }) => (
    <select
      aria-label="Add user"
      value={value ?? ''}
      data-exclude-ids={excludeIds.join(',')}
      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
        onValueChange(event.currentTarget.value || null)
      }
    >
      <option value="">{placeholder ?? 'Pick user'}</option>
      <option value="principal_new">New user</option>
      <option value="principal_without_user">Principal without user</option>
    </select>
  ),
}))

vi.mock('@heroicons/react/24/outline', () => ({
  TrashIcon: () => <span aria-hidden="true">trash</span>,
}))

vi.mock('@/lib/server/functions/contacts', () => ({
  linkContactToUserFn: mocks.linkContactToUserFn,
  unlinkContactFromUserFn: mocks.unlinkContactFromUserFn,
}))

vi.mock('@/lib/server/functions/principals', () => ({
  searchPrincipalsFn: mocks.searchPrincipalsFn,
}))

vi.mock('@/lib/client/queries/contacts', () => ({
  contactQueries: {
    links: (contactId: string) => ({ queryKey: ['contacts', contactId, 'links'] }),
  },
}))

vi.mock('@/lib/server/domains/authz', () => ({
  PERMISSIONS: {
    ORG_MANAGE: 'org.manage',
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.permissionAllowed = true
  mocks.links = [
    { id: 'link_1', userId: 'user_existing', linkedAt: '2026-06-18T12:00:00.000Z' },
    { id: 'link_2', userId: 'user_unknown', linkedAt: '2026-06-18T13:00:00.000Z' },
  ]
  mocks.principals = [
    {
      id: 'principal_existing',
      userId: 'user_existing',
      displayName: 'Existing User',
      email: 'existing@example.com',
    },
    {
      id: 'principal_new',
      userId: 'user_new',
      displayName: 'New User',
      email: 'new@example.com',
    },
    {
      id: 'principal_without_user',
      userId: null,
      displayName: 'No User',
      email: null,
    },
  ]
  mocks.searchPrincipalsFn.mockImplementation(() => mocks.principals)
  mocks.linkContactToUserFn.mockResolvedValue({ id: 'link_new' })
  mocks.unlinkContactFromUserFn.mockResolvedValue(undefined)
})

describe('ContactLinkedUsersTab', () => {
  it('renders linked users with principal enrichment and picker exclusions', () => {
    render(<ContactLinkedUsersTab contactId={'contact_1' as never} />)

    expect(mocks.searchPrincipalsFn).toHaveBeenCalledWith({
      data: { roleFilter: ['user'], limit: 50 },
    })
    expect(screen.getByText('Existing User')).toBeInTheDocument()
    expect(screen.getByText('existing@example.com')).toBeInTheDocument()
    expect(screen.getByText('user_unknown')).toBeInTheDocument()
    expect(screen.getByLabelText('Add user')).toHaveAttribute(
      'data-exclude-ids',
      'principal_existing'
    )
  })

  it('links a selected user and rejects principals that do not resolve to a user', async () => {
    render(<ContactLinkedUsersTab contactId={'contact_1' as never} />)

    expect(screen.getByRole('button', { name: 'Link' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Add user'), {
      target: { value: 'principal_without_user' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Selected principal has no associated user')
    expect(mocks.linkContactToUserFn).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Add user'), { target: { value: 'principal_new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))

    await waitFor(() => {
      expect(mocks.linkContactToUserFn).toHaveBeenCalledWith({
        data: {
          contactId: 'contact_1',
          userId: 'user_new',
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['contacts', 'contact_1', 'links'],
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('User linked')
  })

  it('unlinks existing users and reports link/unlink failures', async () => {
    mocks.linkContactToUserFn.mockRejectedValueOnce(new Error('Link denied'))
    mocks.unlinkContactFromUserFn.mockRejectedValueOnce(new Error('Unlink denied'))

    render(<ContactLinkedUsersTab contactId={'contact_1' as never} />)

    fireEvent.change(screen.getByLabelText('Add user'), { target: { value: 'principal_new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Link denied')
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Unlink' })[0])
    await waitFor(() => {
      expect(mocks.unlinkContactFromUserFn).toHaveBeenCalledWith({
        data: {
          contactId: 'contact_1',
          userId: 'user_existing',
        },
      })
    })
    expect(mocks.toastError).toHaveBeenCalledWith('Unlink denied')

    fireEvent.click(screen.getAllByRole('button', { name: 'Unlink' })[0])
    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith('User unlinked')
    })
  })

  it('renders empty and permission-denied states without mutation controls', () => {
    mocks.links = []
    render(<ContactLinkedUsersTab contactId={'contact_1' as never} />)

    expect(screen.getByText('No linked users yet.')).toBeInTheDocument()

    cleanup()
    mocks.links = [{ id: 'link_1', userId: 'user_existing', linkedAt: '2026-06-18T12:00:00.000Z' }]
    mocks.permissionAllowed = false
    render(<ContactLinkedUsersTab contactId={'contact_1' as never} />)

    expect(screen.queryByLabelText('Add user')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlink user' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlink' })).not.toBeInTheDocument()
    expect(screen.getByText('Existing User')).toBeInTheDocument()
  })
})
