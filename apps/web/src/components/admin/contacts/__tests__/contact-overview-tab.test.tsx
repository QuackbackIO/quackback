// @vitest-environment happy-dom
import type { ChangeEvent, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContactOverviewTab } from '../contact-overview-tab'

type ContactProp = Parameters<typeof ContactOverviewTab>[0]['contact']

type MutationOptions<T> = {
  mutationFn: () => Promise<T>
  onSuccess?: (result: T) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  updateContactFn: vi.fn(),
  archiveContactFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  permissionAllowed: true,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useMutation: <T,>(options: MutationOptions<T>) => ({
    isPending: false,
    mutate: async () => {
      try {
        const result = await options.mutationFn()
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
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    id,
    type = 'text',
    value,
    onChange,
  }: {
    id?: string
    type?: string
    value?: string
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void
    maxLength?: number
    className?: string
  }) => <input id={id} type={type} value={value} onChange={onChange} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
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

vi.mock('@/components/admin/shared/org-picker', () => ({
  OrgPicker: ({
    value,
    onValueChange,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
    allowClear?: boolean
  }) => (
    <select
      aria-label="Organization"
      value={value ?? ''}
      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
        onValueChange(event.currentTarget.value || null)
      }
    >
      <option value="">No organization</option>
      <option value="org_acme">Acme</option>
      <option value="org_beta">Beta</option>
    </select>
  ),
}))

vi.mock('@/lib/server/functions/contacts', () => ({
  updateContactFn: mocks.updateContactFn,
  archiveContactFn: mocks.archiveContactFn,
}))

vi.mock('@/lib/client/queries/contacts', () => ({
  contactQueries: {
    detail: (contactId: string) => ({ queryKey: ['contacts', 'detail', contactId] }),
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

function contact(overrides: Partial<ContactProp> = {}): ContactProp {
  return {
    id: 'contact_1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '+1 555 1000',
    title: 'Engineer',
    externalId: 'crm-123',
    organizationId: 'org_acme',
    archivedAt: null,
    ...overrides,
  } as ContactProp
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.permissionAllowed = true
  mocks.updateContactFn.mockResolvedValue({ id: 'contact_1' })
  mocks.archiveContactFn.mockResolvedValue({ id: 'contact_1' })
})

describe('ContactOverviewTab', () => {
  it('saves trimmed contact fields, invalidates detail/list queries and shows success', async () => {
    render(<ContactOverviewTab contact={contact()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Grace Hopper  ' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '  grace@example.com  ' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Admiral  ' } })
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 'org_beta' } })
    fireEvent.change(screen.getByLabelText('External ID'), { target: { value: '  crm-456  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.updateContactFn).toHaveBeenCalledWith({
        data: {
          contactId: 'contact_1',
          name: 'Grace Hopper',
          email: 'grace@example.com',
          phone: null,
          title: 'Admiral',
          externalId: 'crm-456',
          organizationId: 'org_beta',
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['contacts', 'detail', 'contact_1'],
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contacts'] })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Contact updated')
  })

  it('requires at least a name or email before saving and reports save failures', async () => {
    render(<ContactOverviewTab contact={contact()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mocks.toastError).toHaveBeenCalledWith('Name or email is required')
    expect(mocks.updateContactFn).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    mocks.updateContactFn.mockRejectedValueOnce(new Error('Duplicate contact'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Duplicate contact')
    })
  })

  it('resets local fields when the contact prop changes', () => {
    const { rerender } = render(<ContactOverviewTab contact={contact()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved edit' } })
    expect(screen.getByLabelText('Name')).toHaveValue('Unsaved edit')

    rerender(
      <ContactOverviewTab
        contact={contact({
          id: 'contact_2',
          name: null,
          email: 'new@example.com',
          phone: null,
          title: null,
          externalId: null,
          organizationId: null,
        })}
      />
    )

    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Email')).toHaveValue('new@example.com')
    expect(screen.getByLabelText('Phone')).toHaveValue('')
    expect(screen.getByLabelText('Title')).toHaveValue('')
    expect(screen.getByLabelText('External ID')).toHaveValue('')
    expect(screen.getByLabelText('Organization')).toHaveValue('')
  })

  it('archives active contacts and reports archive failures', async () => {
    render(<ContactOverviewTab contact={contact()} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[1])

    await waitFor(() => {
      expect(mocks.archiveContactFn).toHaveBeenCalledWith({
        data: { contactId: 'contact_1' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Contact archived')

    mocks.archiveContactFn.mockRejectedValueOnce(new Error('Archive denied'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[1])

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Archive denied')
    })
  })

  it('renders archived and denied-management states without mutation controls', () => {
    const { rerender } = render(
      <ContactOverviewTab contact={contact({ archivedAt: new Date('2026-06-01T00:00:00.000Z') })} />
    )

    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(
      screen.getByText('This contact is archived. Restoring is not currently supported.')
    ).toBeInTheDocument()

    mocks.permissionAllowed = false
    rerender(<ContactOverviewTab contact={contact()} />)

    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
  })
})
