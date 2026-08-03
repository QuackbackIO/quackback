// @vitest-environment happy-dom
import type { ChangeEvent, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeamCreateDialog } from '../team-create-dialog'

type MutationOptions<T> = {
  mutationFn: () => Promise<T>
  onSuccess?: (result: T) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  createTeamFn: vi.fn(),
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

vi.mock('@/lib/server/functions/teams', () => ({
  createTeamFn: mocks.createTeamFn,
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
    placeholder,
  }: {
    id?: string
    type?: string
    value?: string
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void
    required?: boolean
    maxLength?: number
    placeholder?: string
    className?: string
  }) => <input id={id} type={type} value={value} onChange={onChange} placeholder={placeholder} />,
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
  mocks.createTeamFn.mockResolvedValue({ id: 'team_created' })
})

describe('TeamCreateDialog', () => {
  it('requires slug and name and validates the slug format before creating', () => {
    render(<TeamCreateDialog trigger={<button type="button">Open</button>} />)

    fireEvent.submit(screen.getByRole('button', { name: 'Create team' }).closest('form')!)
    expect(mocks.toastError).toHaveBeenCalledWith('Slug and name are required')

    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'sales_team' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sales' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create team' }).closest('form')!)

    expect(mocks.toastError).toHaveBeenCalledWith(
      'Slug must be lowercase letters, numbers, or hyphens'
    )
    expect(mocks.createTeamFn).not.toHaveBeenCalled()
  })

  it('normalizes slug input, submits trimmed optional fields and navigates on success', async () => {
    render(<TeamCreateDialog trigger={<button type="button">Open</button>} />)

    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'Tier-1' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Tier 1  ' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '  First line  ' } })
    fireEvent.change(screen.getByLabelText('Short label'), { target: { value: '  T1  ' } })
    fireEvent.change(screen.getByPlaceholderText('#6366f1'), { target: { value: '  #22c55e  ' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create team' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.createTeamFn).toHaveBeenCalledWith({
        data: {
          slug: 'tier-1',
          name: 'Tier 1',
          description: 'First line',
          shortLabel: 'T1',
          color: '#22c55e',
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['teams'] })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Team created')
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/admin/settings/teams/$teamId',
      params: { teamId: 'team_created' },
    })
    expect(screen.getByLabelText('Slug')).toHaveValue('')
    expect(screen.getByLabelText('Description')).toHaveValue('')
  })

  it('turns empty optional values into null and reports create failures', async () => {
    mocks.createTeamFn.mockRejectedValueOnce(new Error('Duplicate team'))
    render(<TeamCreateDialog trigger={<button type="button">Open</button>} />)

    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'support' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Support' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Short label'), { target: { value: '   ' } })
    fireEvent.change(screen.getByPlaceholderText('#6366f1'), { target: { value: '   ' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create team' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.createTeamFn).toHaveBeenCalledWith({
        data: {
          slug: 'support',
          name: 'Support',
          description: null,
          shortLabel: null,
          color: null,
        },
      })
    })
    expect(mocks.toastError).toHaveBeenCalledWith('Duplicate team')
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})
