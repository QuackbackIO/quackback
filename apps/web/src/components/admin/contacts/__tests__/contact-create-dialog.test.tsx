// @vitest-environment happy-dom
import type { ChangeEvent, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContactCreateDialog } from '../contact-create-dialog'

type MutationOptions<T> = {
  mutationFn: () => Promise<T>
  onSuccess?: (result: T) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  createContactFn: vi.fn(),
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

vi.mock('@/lib/server/functions/contacts', () => ({
  createContactFn: mocks.createContactFn,
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
      <option value="org_default">Default org</option>
      <option value="org_beta">Beta</option>
    </select>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createContactFn.mockResolvedValue({ id: 'contact_created' })
})

describe('ContactCreateDialog', () => {
  it('requires either a name or an email before creating a contact', () => {
    render(<ContactCreateDialog trigger={<button type="button">Open</button>} />)

    fireEvent.submit(screen.getByRole('button', { name: 'Create' }).closest('form')!)

    expect(mocks.toastError).toHaveBeenCalledWith('Name or email is required')
    expect(mocks.createContactFn).not.toHaveBeenCalled()
  })

  it('submits trimmed fields, invalidates the list, resets and navigates to the contact', async () => {
    render(
      <ContactCreateDialog
        trigger={<button type="button">Open</button>}
        defaultOrganizationId={'org_default' as never}
      />
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Ada Lovelace  ' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '  ada@example.com  ' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Engineer  ' } })
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 'org_beta' } })
    fireEvent.change(screen.getByLabelText('External ID'), { target: { value: '  crm-42  ' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.createContactFn).toHaveBeenCalledWith({
        data: {
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          phone: null,
          title: 'Engineer',
          externalId: 'crm-42',
          organizationId: 'org_beta',
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contacts'] })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Contact created')
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/admin/contacts/people/$contactId',
      params: { contactId: 'contact_created' },
    })
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Organization')).toHaveValue('org_default')
  })

  it('reports create failures from the server function', async () => {
    mocks.createContactFn.mockRejectedValueOnce(new Error('Duplicate contact'))
    render(<ContactCreateDialog trigger={<button type="button">Open</button>} />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Duplicate contact')
    })
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})
