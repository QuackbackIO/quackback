// @vitest-environment happy-dom
/**
 * Smoke coverage for the generic DestinationPicker (IF WO-7): it fetches an
 * integration's destinations of a kind and renders them as selectable options,
 * and a dependent kind stays disabled (query disabled) until a parent is
 * chosen.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'

const fetchMock = vi.fn(async (_input: unknown) => [
  { id: 'team_1', name: 'Engineering' },
  { id: 'team_2', name: 'Design' },
])

vi.mock('@/lib/server/functions/integration-destinations', () => ({
  fetchIntegrationDestinationsFn: (input: unknown) => fetchMock(input),
}))

import { DestinationPicker } from '../destination-picker'

afterEach(() => {
  cleanup()
  fetchMock.mockClear()
})

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('DestinationPicker', () => {
  it('lists fetched destinations and reports the chosen id + name', async () => {
    const onSelect = vi.fn()
    renderWithClient(
      <DestinationPicker
        integrationType="linear"
        kind="team"
        value=""
        onSelect={onSelect}
        placeholder="Select a team"
      />
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('combobox'))
    const option = await screen.findByText('Engineering')
    fireEvent.click(option)
    expect(onSelect).toHaveBeenCalledWith('team_1', 'Engineering')
  })

  it('does not fetch a dependent kind until a parent is selected', async () => {
    renderWithClient(
      <DestinationPicker
        integrationType="trello"
        kind="list"
        value=""
        onSelect={vi.fn()}
        parentId=""
      />
    )
    // parentId is an empty string → query disabled → no fetch.
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
