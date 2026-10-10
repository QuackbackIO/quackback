// @vitest-environment happy-dom
/**
 * The incident editor must not spin forever: a failed detail load shows an
 * error with a retry, and an incident that no longer exists (the detail fn
 * returns null) shows "not found".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

let detail: { data: unknown; isLoading: boolean; isError: boolean; isFetching: boolean }
const refetch = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({ ...detail, refetch }),
}))
vi.mock('@/lib/client/hooks/use-url-modal', () => ({
  useUrlModal: () => ({ open: true, validatedId: 'status_incident_test', close: vi.fn() }),
}))
vi.mock('@/lib/client/queries/status', () => ({
  statusIncidentQueries: { detail: (id: string) => ({ queryKey: ['status', 'detail', id] }) },
}))
vi.mock('@/lib/client/mutations/status', () => ({
  useUpdateStatusIncident: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePostStatusIncidentUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

import { StatusIncidentModal } from '../status-incident-editor'

beforeEach(() => {
  refetch.mockReset()
})
afterEach(cleanup)

describe('StatusIncidentModal load states', () => {
  it('shows an error with a retry when the detail fails to load', () => {
    detail = { data: undefined, isLoading: false, isError: true, isFetching: false }
    render(<StatusIncidentModal incidentId="status_incident_test" />)

    expect(screen.getAllByText("Couldn't load this incident").length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows not found when the incident no longer exists', () => {
    detail = { data: null, isLoading: false, isError: false, isFetching: false }
    render(<StatusIncidentModal incidentId="status_incident_test" />)

    expect(screen.getAllByText('Incident not found').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
})
