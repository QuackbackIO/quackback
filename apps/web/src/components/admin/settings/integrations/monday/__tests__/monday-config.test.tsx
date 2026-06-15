// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockMutate = vi.fn()

vi.mock('@/lib/client/mutations', () => ({
  useUpdateIntegration: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

vi.mock('@/lib/server/integrations/monday/functions', () => ({
  fetchMondayBoardsFn: vi.fn().mockResolvedValue([{ id: '1234567890', name: 'Roadmap' }]),
}))

vi.mock('@/components/admin/settings/integrations/on-delete-config', () => ({
  OnDeleteConfig: () => null,
}))

// Replace the Radix Select with a native <select> so we can fire change events.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
  }) => (
    <select
      data-testid="board-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

import { MondayConfig } from '../monday-config'

describe('<MondayConfig> board selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saves the chosen board as both boardId and channelId', async () => {
    render(
      <MondayConfig
        integrationId="integration_1"
        initialConfig={{}}
        initialEventMappings={[]}
        enabled
      />
    )

    await waitFor(() => expect(screen.getByText('Roadmap')).toBeTruthy())

    fireEvent.change(screen.getByTestId('board-select'), { target: { value: '1234567890' } })

    expect(mockMutate).toHaveBeenCalledWith({
      id: 'integration_1',
      config: { boardId: '1234567890', channelId: '1234567890' },
    })
  })
})
