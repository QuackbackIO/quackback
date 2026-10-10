// @vitest-environment happy-dom
/**
 * The service picker tells a failed load apart from an empty list: "No
 * services yet" would send the admin off to create services that exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

let choices: { data: unknown; isLoading: boolean; isError: boolean }
const refetch = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({ ...choices, refetch }),
}))
vi.mock('@/lib/client/queries/status', () => ({
  statusComponentQueries: { choices: () => ({ queryKey: ['status', 'choices'] }) },
  statusTemplateQueries: { list: () => ({ queryKey: ['status', 'templates'] }) },
}))

import { AffectedComponentsField } from '../status-incident-fields'

beforeEach(() => {
  refetch.mockReset()
})
afterEach(cleanup)

describe('AffectedComponentsField', () => {
  it('offers a retry when the services fail to load', () => {
    choices = { data: undefined, isLoading: false, isError: true }
    render(<AffectedComponentsField kind="incident" value={[]} onChange={vi.fn()} />)

    expect(screen.getByText(/Couldn't load services/)).toBeTruthy()
    expect(screen.queryByText(/No services yet/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('says there are no services only when the list loaded empty', () => {
    choices = { data: { groups: [], ungrouped: [] }, isLoading: false, isError: false }
    render(<AffectedComponentsField kind="incident" value={[]} onChange={vi.fn()} />)

    expect(screen.getByText(/No services yet/)).toBeTruthy()
  })
})
