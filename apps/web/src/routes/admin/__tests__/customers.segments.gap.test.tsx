// @vitest-environment happy-dom
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

type RouteOptions = {
  loader: (input: {
    context: { queryClient: { ensureQueryData: (query: unknown) => unknown } }
  }) => Promise<unknown>
  component: () => ReactElement
}

const mocks = vi.hoisted(() => ({
  ensureQueryData: vi.fn(async () => undefined),
  userAttributesQuery: vi.fn(() => ({ queryKey: ['admin', 'user-attributes'] })),
  segmentsQuery: vi.fn(() => ({ queryKey: ['admin', 'segments'] })),
  useSuspenseQuery: vi.fn(() => ({ data: [{ id: 'attr_1', key: 'plan' }] })),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: mocks.useSuspenseQuery,
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    userAttributes: mocks.userAttributesQuery,
    segments: mocks.segmentsQuery,
  },
}))

vi.mock('@/components/admin/settings/user-attributes/user-attributes-list', () => ({
  UserAttributesList: ({ initialAttributes }: { initialAttributes: unknown }) => (
    <div data-testid="attrs-list" data-attrs={JSON.stringify(initialAttributes)} />
  ),
}))

vi.mock('@/components/admin/segments/segment-list', () => ({
  SegmentList: () => <div data-testid="segment-list" />,
}))

const { Route } = await import('../customers.segments')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useSuspenseQuery.mockReturnValue({ data: [{ id: 'attr_1', key: 'plan' }] })
})

describe('admin customers.segments route — loader', () => {
  it('prefetches user attributes and segments', async () => {
    const result = await routeOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.userAttributesQuery).toHaveBeenCalledTimes(1)
    expect(mocks.segmentsQuery).toHaveBeenCalledTimes(1)
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(2)
    expect(result).toEqual({})
  })
})

describe('admin customers.segments route — component', () => {
  it('renders the attributes list with suspense data and the segment list', () => {
    const Component = routeOptions().component
    render(<Component />)
    const attrs = screen.getByTestId('attrs-list')
    expect(attrs.getAttribute('data-attrs')).toBe(JSON.stringify([{ id: 'attr_1', key: 'plan' }]))
    expect(screen.getByTestId('segment-list')).toBeInTheDocument()
  })
})
