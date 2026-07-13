// @vitest-environment happy-dom
import type { ChangeEvent, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OrganizationCreateDialog } from '../organization-create-dialog'

type MutationOptions<T> = {
  mutationFn: () => Promise<T>
  onSuccess?: (result: T) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  createOrganizationFn: vi.fn(),
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
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

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: mocks.navigate,
  }),
}))

vi.mock('@/lib/server/functions/organizations', () => ({
  createOrganizationFn: mocks.createOrganizationFn,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
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
    placeholder,
  }: {
    id?: string
    value?: string
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void
    required?: boolean
    maxLength?: number
    placeholder?: string
    className?: string
  }) => <input id={id} value={value} onChange={onChange} placeholder={placeholder} />,
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

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
  }: {
    children: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode; className?: string }) => (
    <section>{children}</section>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createOrganizationFn.mockResolvedValue({ id: 'org_created' })
})

describe('OrganizationCreateDialog', () => {
  it('requires a name before creating an organization', () => {
    render(<OrganizationCreateDialog trigger={<button type="button">Open</button>} />)

    fireEvent.submit(screen.getByRole('button', { name: 'Create' }).closest('form')!)

    expect(mocks.toastError).toHaveBeenCalledWith('Name is required')
    expect(mocks.createOrganizationFn).not.toHaveBeenCalled()
  })

  it('submits trimmed fields, invalidates organizations and navigates on success', async () => {
    render(<OrganizationCreateDialog trigger={<button type="button">Open</button>} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Acme  ' } })
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: '  acme.com  ' } })
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('External ID'), { target: { value: '  crm-acme  ' } })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '  Enterprise  ' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.createOrganizationFn).toHaveBeenCalledWith({
        data: {
          name: 'Acme',
          domain: 'acme.com',
          website: null,
          externalId: 'crm-acme',
          notes: 'Enterprise',
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['organizations'] })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Organization created')
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/admin/contacts/organizations/$organizationId',
      params: { organizationId: 'org_created' },
    })
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Domain')).toHaveValue('')
  })

  it('turns empty optional fields into null and reports create failures', async () => {
    mocks.createOrganizationFn.mockRejectedValueOnce(new Error('Duplicate organization'))
    render(<OrganizationCreateDialog trigger={<button type="button">Open</button>} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('External ID'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '   ' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.createOrganizationFn).toHaveBeenCalledWith({
        data: {
          name: 'Acme',
          domain: null,
          website: null,
          externalId: null,
          notes: null,
        },
      })
    })
    expect(mocks.toastError).toHaveBeenCalledWith('Duplicate organization')
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})
