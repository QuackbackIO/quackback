// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BusinessHoursDialog } from '../business-hours-dialog'

type MutationOptions = {
  mutationFn: () => Promise<unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  createBusinessHoursFn: vi.fn(),
  updateBusinessHoursFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useMutation: (options: MutationOptions) => ({
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

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode; className?: string }) => (
    <section>{children}</section>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
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
    'aria-label'?: string
    variant?: string
    size?: string
    className?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick} aria-label={ariaLabel}>
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
    type = 'text',
  }: {
    id?: string
    value?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    type?: string
    step?: number
    className?: string
  }) => <input id={id} type={type} value={value} placeholder={placeholder} onChange={onChange} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('@heroicons/react/24/outline', () => ({
  TrashIcon: () => <span />,
  PlusIcon: () => <span />,
}))

vi.mock('@/lib/server/functions/sla', () => ({
  createBusinessHoursFn: mocks.createBusinessHoursFn,
  updateBusinessHoursFn: mocks.updateBusinessHoursFn,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function renderDialog(props: Partial<React.ComponentProps<typeof BusinessHoursDialog>> = {}) {
  const onOpenChange = vi.fn()
  const view = render(<BusinessHoursDialog open onOpenChange={onOpenChange} {...props} />)
  return { ...view, onOpenChange }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createBusinessHoursFn.mockResolvedValue({ id: 'business_hours_new' })
  mocks.updateBusinessHoursFn.mockResolvedValue({ id: 'business_hours_1' })
})

describe('BusinessHoursDialog', () => {
  it('does not render dialog content when closed', () => {
    render(<BusinessHoursDialog open={false} onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('validates create input and submits a trimmed create payload', async () => {
    const { container, onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Name is required')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  EU support  ' } })
    fireEvent.change(screen.getByLabelText('Timezone (IANA)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Timezone is required')

    fireEvent.change(screen.getByLabelText('Timezone (IANA)'), {
      target: { value: '  Europe/Stockholm  ' },
    })
    const timeInputs = Array.from(container.querySelectorAll('input[type="time"]'))
    fireEvent.change(timeInputs[0], { target: { value: '18:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Mon: range start must be before end')

    fireEvent.change(timeInputs[0], { target: { value: '09:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add holiday' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Holiday date must be YYYY-MM-DD')

    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: '2026-12-24' },
    })
    fireEvent.change(screen.getByPlaceholderText('Label (optional)'), {
      target: { value: 'Christmas Eve' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(mocks.createBusinessHoursFn).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'EU support',
          timezone: 'Europe/Stockholm',
          holidays: [{ date: '2026-12-24', label: 'Christmas Eve' }],
        }),
      })
    })
    expect(mocks.createBusinessHoursFn.mock.calls[0][0].data.schedule.mon).toEqual([
      { start: '09:30', end: '17:00' },
    ])
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Calendar created')
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['business-hours'] })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('supports adding and removing ranges and holidays in edit mode', async () => {
    const { container, onOpenChange } = renderDialog({
      row: {
        id: 'business_hours_1',
        name: 'Existing calendar',
        timezone: 'America/New_York',
        schedule: {
          mon: [],
          tue: [{ start: '10:00', end: '16:00' }],
          wed: [],
          thu: [],
          fri: [],
          sat: [],
          sun: [],
        },
        holidays: [{ date: '2026-01-01', label: 'New year' }],
      } as never,
    })

    expect(screen.getByRole('heading', { name: 'Edit calendar' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Existing calendar')).toBeInTheDocument()
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated calendar' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Range' })[0])
    const timeInputs = Array.from(container.querySelectorAll('input[type="time"]'))
    fireEvent.change(timeInputs[0], { target: { value: '08:00' } })
    fireEvent.change(timeInputs[1], { target: { value: '12:00' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove holiday' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.updateBusinessHoursFn).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'business_hours_1',
          name: 'Updated calendar',
          timezone: 'America/New_York',
          holidays: [],
        }),
      })
    })
    expect(mocks.updateBusinessHoursFn.mock.calls[0][0].data.schedule.mon).toEqual([
      { start: '08:00', end: '12:00' },
    ])
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Calendar updated')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('removes schedule ranges, cancels, and reports server errors', async () => {
    mocks.createBusinessHoursFn.mockRejectedValueOnce(new Error('Calendar already exists'))
    const { container, onOpenChange } = renderDialog()

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove range' })[0])
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'EU support' } })
    const timeInputs = Array.from(container.querySelectorAll('input[type="time"]'))
    fireEvent.change(timeInputs[0], { target: { value: '09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Calendar already exists')
    })
  })
})
