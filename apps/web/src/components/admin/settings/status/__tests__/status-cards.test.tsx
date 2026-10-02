// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StatusVisibilityCard } from '../status-visibility-card'
import { StatusDangerCard } from '../status-danger-card'
import { DEFAULT_STATUS_SETTINGS } from '@/lib/shared/status-settings'

const { clearMutateAsync } = vi.hoisted(() => ({
  clearMutateAsync: vi.fn().mockResolvedValue({ incidents: 2 }),
}))

vi.mock('@/lib/client/hooks/use-segments-queries', () => ({
  useSegments: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/components/admin/segments/segment-multi-select', () => ({
  SegmentMultiSelect: () => <div data-testid="segment-select" />,
}))
vi.mock('@/lib/client/mutations/status', () => ({
  useClearStatusHistory: () => ({ mutateAsync: clearMutateAsync, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

afterEach(() => {
  cleanup()
  clearMutateAsync.mockClear()
})

describe('StatusVisibilityCard', () => {
  it('uses the shared visibility vocabulary', () => {
    render(<StatusVisibilityCard settings={DEFAULT_STATUS_SETTINGS} onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: /Everyone/ }).getAttribute('aria-checked')).toBe(
      'true'
    )
    expect(screen.getByRole('radio', { name: /Signed-in users/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Specific segments/ })).toBeTruthy()
    expect(screen.queryByText('Logged-in users')).toBeNull()
  })

  it('maps tiles to the stored audience values', () => {
    const onChange = vi.fn()
    render(<StatusVisibilityCard settings={DEFAULT_STATUS_SETTINGS} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: /Signed-in users/ }))
    expect(onChange).toHaveBeenLastCalledWith({ audience: 'authenticated' })
    fireEvent.click(screen.getByRole('radio', { name: /Specific segments/ }))
    expect(onChange).toHaveBeenLastCalledWith({ audience: 'segments' })
  })

  it('shows the segment picker only for the segments audience', () => {
    const { rerender } = render(
      <StatusVisibilityCard settings={DEFAULT_STATUS_SETTINGS} onChange={() => {}} />
    )
    expect(screen.queryByTestId('segment-select')).toBeNull()
    rerender(
      <StatusVisibilityCard
        settings={{ ...DEFAULT_STATUS_SETTINGS, audience: 'segments' }}
        onChange={() => {}}
      />
    )
    expect(screen.getByTestId('segment-select')).toBeTruthy()
  })
})

describe('StatusDangerCard', () => {
  it('does not clear until the confirm dialog is accepted', () => {
    render(<StatusDangerCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }))
    expect(clearMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('Delete incident history?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete incident history' }))
    expect(clearMutateAsync).toHaveBeenCalledTimes(1)
  })
})
