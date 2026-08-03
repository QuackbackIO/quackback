// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SlaTickTrigger } from '../sla-tick-trigger'

type MutationOptions = {
  mutationFn: () => Promise<unknown>
  onSuccess?: (result: unknown) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  runSlaTickFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  isPending: false,
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: MutationOptions) => ({
    isPending: mocks.isPending,
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

vi.mock('@/lib/server/functions/sla', () => ({
  runSlaTickFn: mocks.runSlaTickFn,
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

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    variant?: string
    size?: string
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@heroicons/react/24/outline', () => ({
  BoltIcon: () => <span aria-hidden="true">bolt</span>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isPending = false
  mocks.runSlaTickFn.mockResolvedValue({ processed: 3, fired: 2 })
})

describe('SlaTickTrigger', () => {
  it('runs the SLA tick and reports processed/fired counts', async () => {
    render(<SlaTickTrigger />)

    fireEvent.click(screen.getByRole('button', { name: 'Run tick now' }))

    await waitFor(() => {
      expect(mocks.runSlaTickFn).toHaveBeenCalledWith({ data: {} })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Tick ran — processed 3, fired 2')
  })

  it('uses zero fallback counts and reports failures', async () => {
    const { rerender } = render(<SlaTickTrigger />)

    mocks.runSlaTickFn.mockResolvedValueOnce(null)
    fireEvent.click(screen.getByRole('button', { name: 'Run tick now' }))

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Tick ran — processed 0, fired 0')
    })

    mocks.runSlaTickFn.mockRejectedValueOnce(new Error('Tick failed'))
    rerender(<SlaTickTrigger />)
    fireEvent.click(screen.getByRole('button', { name: 'Run tick now' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Tick failed')
    })
  })

  it('disables the trigger while pending', () => {
    mocks.isPending = true
    render(<SlaTickTrigger />)

    expect(screen.getByRole('button', { name: 'Run tick now' })).toBeDisabled()
  })
})
