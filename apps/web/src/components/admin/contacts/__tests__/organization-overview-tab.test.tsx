// @vitest-environment happy-dom
import type { ChangeEvent, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OrganizationOverviewTab } from '../organization-overview-tab'

type OrganizationProp = Parameters<typeof OrganizationOverviewTab>[0]['organization']

type MutationOptions<T> = {
  mutationFn: () => Promise<T>
  onSuccess?: (result: T) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  updateOrganizationFn: vi.fn(),
  archiveOrganizationFn: vi.fn(),
  unarchiveOrganizationFn: vi.fn(),
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
    value,
    onChange,
  }: {
    id?: string
    value?: string
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void
    required?: boolean
    maxLength?: number
    className?: string
  }) => <input id={id} value={value} onChange={onChange} />,
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: ({
    id,
    value,
    onChange,
    rows,
  }: {
    id?: string
    value?: string
    onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void
    rows?: number
    maxLength?: number
  }) => <textarea id={id} value={value} onChange={onChange} rows={rows} />,
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

vi.mock('@/lib/server/functions/organizations', () => ({
  updateOrganizationFn: mocks.updateOrganizationFn,
  archiveOrganizationFn: mocks.archiveOrganizationFn,
  unarchiveOrganizationFn: mocks.unarchiveOrganizationFn,
}))

vi.mock('@/lib/client/queries/organizations', () => ({
  organizationQueries: {
    detail: (organizationId: string) => ({
      queryKey: ['organizations', 'detail', organizationId],
    }),
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

function organization(overrides: Partial<OrganizationProp> = {}): OrganizationProp {
  return {
    id: 'org_acme',
    name: 'Acme',
    domain: 'acme.example',
    website: 'https://acme.example',
    externalId: 'crm-acme',
    notes: 'Important account',
    archivedAt: null,
    ...overrides,
  } as OrganizationProp
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.permissionAllowed = true
  mocks.updateOrganizationFn.mockResolvedValue({ id: 'org_acme' })
  mocks.archiveOrganizationFn.mockResolvedValue({ id: 'org_acme' })
  mocks.unarchiveOrganizationFn.mockResolvedValue({ id: 'org_acme' })
})

describe('OrganizationOverviewTab', () => {
  it('saves trimmed organization fields and invalidates detail/list queries', async () => {
    render(<OrganizationOverviewTab organization={organization()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Beta Corp  ' } })
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Website'), {
      target: { value: '  https://beta.example  ' },
    })
    fireEvent.change(screen.getByLabelText('External ID'), { target: { value: '  crm-beta  ' } })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '  Renewal soon  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.updateOrganizationFn).toHaveBeenCalledWith({
        data: {
          organizationId: 'org_acme',
          name: 'Beta Corp',
          domain: null,
          website: 'https://beta.example',
          externalId: 'crm-beta',
          notes: 'Renewal soon',
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['organizations', 'detail', 'org_acme'],
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['organizations'] })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Organization updated')
  })

  it('validates name and reports save failures', async () => {
    render(<OrganizationOverviewTab organization={organization()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mocks.toastError).toHaveBeenCalledWith('Name is required')
    expect(mocks.updateOrganizationFn).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme' } })
    mocks.updateOrganizationFn.mockRejectedValueOnce(new Error('Duplicate organization'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Duplicate organization')
    })
  })

  it('resets local fields when the organization prop changes', () => {
    const { rerender } = render(<OrganizationOverviewTab organization={organization()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved' } })
    expect(screen.getByLabelText('Name')).toHaveValue('Unsaved')

    rerender(
      <OrganizationOverviewTab
        organization={organization({
          id: 'org_beta',
          name: 'Beta',
          domain: null,
          website: null,
          externalId: null,
          notes: null,
        })}
      />
    )

    expect(screen.getByLabelText('Name')).toHaveValue('Beta')
    expect(screen.getByLabelText('Domain')).toHaveValue('')
    expect(screen.getByLabelText('Website')).toHaveValue('')
    expect(screen.getByLabelText('External ID')).toHaveValue('')
    expect(screen.getByLabelText('Notes')).toHaveValue('')
  })

  it('archives and unarchives organizations and reports archive failures', async () => {
    const { rerender } = render(<OrganizationOverviewTab organization={organization()} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[1])
    await waitFor(() => {
      expect(mocks.archiveOrganizationFn).toHaveBeenCalledWith({
        data: { organizationId: 'org_acme' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Organization archived')

    mocks.archiveOrganizationFn.mockRejectedValueOnce(new Error('Archive denied'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[1])
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Archive denied')
    })

    rerender(
      <OrganizationOverviewTab
        organization={organization({ archivedAt: new Date('2026-06-01T00:00:00.000Z') })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }))
    await waitFor(() => {
      expect(mocks.unarchiveOrganizationFn).toHaveBeenCalledWith({
        data: { organizationId: 'org_acme' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Organization unarchived')

    mocks.unarchiveOrganizationFn.mockRejectedValueOnce(new Error('Unarchive denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Unarchive denied')
    })
  })

  it('hides mutation controls when organization management permission is denied', () => {
    mocks.permissionAllowed = false

    render(<OrganizationOverviewTab organization={organization()} />)

    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Acme')
  })
})
