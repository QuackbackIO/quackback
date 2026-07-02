// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BusinessHoursId } from '@quackback/ids'
import { BusinessHoursList } from '../business-hours-list'

type BusinessHoursRow = {
  id: BusinessHoursId
  name: string
  timezone: string
  holidays: unknown[] | null
  archivedAt: string | null
}

type MutationOptions = {
  mutationFn: (id: BusinessHoursId) => Promise<unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  rows: [] as BusinessHoursRow[],
  archiveBusinessHoursFn: vi.fn(),
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useSuspenseQuery: () => ({
    data: mocks.rows,
  }),
  useMutation: (options: MutationOptions) => ({
    mutate: async (id: BusinessHoursId) => {
      try {
        const result = await options.mutationFn(id)
        options.onSuccess?.(result)
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }),
}))

vi.mock('@/lib/client/queries/business-hours', () => ({
  businessHoursQueries: {
    list: (params: unknown) => ({ queryKey: ['business-hours', params] }),
  },
}))

vi.mock('@/lib/server/functions/sla', () => ({
  archiveBusinessHoursFn: mocks.archiveBusinessHoursFn,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

vi.mock('@/components/admin/shared/permission-gate', () => ({
  PermissionGate: ({ children }: { children: ReactNode; permission: string }) => <>{children}</>,
}))

vi.mock('../business-hours-dialog', () => ({
  BusinessHoursDialog: ({
    open,
    onOpenChange,
    row,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    row?: BusinessHoursRow
  }) =>
    open ? (
      <section>
        Editing {row?.name}
        <button type="button" onClick={() => onOpenChange(false)}>
          Close editor
        </button>
      </section>
    ) : null,
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

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string; className?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode; variant?: string; className?: string }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    'aria-label': ariaLabel,
  }: {
    children?: ReactNode
    onClick?: () => void
    variant?: string
    size?: string
    className?: string
    'aria-label'?: string
  }) => (
    <button type="button" onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
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

vi.mock('@heroicons/react/24/outline', () => ({
  ArchiveBoxIcon: () => <span aria-hidden="true">archive</span>,
  PencilSquareIcon: () => <span aria-hidden="true">edit</span>,
}))

function row(overrides: Partial<BusinessHoursRow> = {}): BusinessHoursRow {
  return {
    id: 'business_hours_1' as BusinessHoursId,
    name: 'EU support',
    timezone: 'Europe/Stockholm',
    holidays: [{ date: '2026-12-24' }],
    archivedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.archiveBusinessHoursFn.mockResolvedValue({ ok: true })
  mocks.rows = [
    row(),
    row({
      id: 'business_hours_archived' as BusinessHoursId,
      name: 'Legacy hours',
      timezone: 'UTC',
      holidays: null,
      archivedAt: '2026-06-20T10:00:00.000Z',
    }),
  ]
})

describe('BusinessHoursList', () => {
  it('renders active calendars by default, reveals archived rows, and opens edit', () => {
    render(<BusinessHoursList />)

    expect(screen.getByText('EU support')).toBeInTheDocument()
    expect(screen.getByText('Europe/Stockholm')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('Legacy hours')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Show archived'))

    expect(screen.getByText('Legacy hours')).toBeInTheDocument()
    expect(screen.getByText('UTC')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit calendar' })[0])
    expect(screen.getByText(/Editing EU support/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    expect(screen.queryByText(/Editing EU support/)).not.toBeInTheDocument()
  })

  it('archives active calendars and refreshes the list', async () => {
    render(<BusinessHoursList />)

    expect(screen.getByText('Archive this calendar?')).toBeInTheDocument()
    expect(
      screen.getByText(
        "SLA policies referencing it will continue to work, but it won't appear in pickers for new policies."
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      expect(mocks.archiveBusinessHoursFn).toHaveBeenCalledWith({
        data: { id: 'business_hours_1' },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['business-hours'] })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Calendar archived')
  })

  it('reports archive failures and renders the empty state', async () => {
    mocks.archiveBusinessHoursFn.mockRejectedValueOnce(new Error('Cannot archive default calendar'))
    const { rerender } = render(<BusinessHoursList />)

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Cannot archive default calendar')
    })

    mocks.rows = []
    rerender(<BusinessHoursList />)

    expect(screen.getByText('No calendars yet.')).toBeInTheDocument()
  })
})
