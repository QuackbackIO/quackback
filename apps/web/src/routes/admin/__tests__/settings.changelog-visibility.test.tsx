// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

type ComponentProps = {
  children?: ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
}

type RouteOptions = {
  loader: (input: {
    context: { queryClient: { ensureQueryData: (query: unknown) => unknown } }
  }) => Promise<unknown>
  component: () => ReactElement
}

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  ensureQueryData: vi.fn(async () => undefined),
  requireWorkspaceRole: vi.fn(async () => undefined),
  updateOrgChangelogVisibilityFn: vi.fn(async () => ({})),
  updateSegmentChangelogVisibilityFn: vi.fn(async () => ({})),
  deleteSegmentChangelogVisibilityFn: vi.fn(async () => ({})),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  queryData: {} as Record<string, unknown>,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useRouter: () => ({ invalidate: mocks.invalidate }),
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: (query: { queryKey: string }) => ({ data: mocks.queryData[query.queryKey] }),
}))

vi.mock('@/lib/server/functions/workspace-utils', () => ({
  requireWorkspaceRole: mocks.requireWorkspaceRole,
}))

vi.mock('@/lib/server/functions/changelog', () => ({
  updateOrgChangelogVisibilityFn: mocks.updateOrgChangelogVisibilityFn,
  updateSegmentChangelogVisibilityFn: mocks.updateSegmentChangelogVisibilityFn,
  deleteSegmentChangelogVisibilityFn: mocks.deleteSegmentChangelogVisibilityFn,
}))

vi.mock('@/lib/client/queries/admin', () => ({
  changelogVisibilityQueries: {
    adminData: () => ({ queryKey: 'adminData' }),
  },
  adminQueries: {
    segmentList: () => ({ queryKey: 'segments' }),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

vi.mock('@/components/ui/back-link', () => ({
  BackLink: ({ children }: ComponentProps) => <a href="/admin/settings">{children}</a>,
}))

vi.mock('@/components/shared/page-header', () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <header>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  ),
}))

vi.mock('@/components/admin/settings/settings-card', () => ({
  SettingsCard: ({
    title,
    description,
    children,
  }: ComponentProps & { title: string; description?: string }) => (
    <section>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, className }: ComponentProps) => (
    <label className={className}>{children}</label>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: ComponentProps) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant, className }: ComponentProps & { variant?: string }) => (
    <span className={className} data-variant={variant}>
      {children}
    </span>
  ),
}))

vi.mock('@/components/shared/spinner', () => ({
  Spinner: ({ className }: { className?: string }) => <span className={className}>Loading</span>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    disabled?: boolean
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}))

const { Route } = await import('../settings.changelog-visibility')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function seedQueries(overrides: Record<string, unknown> = {}) {
  mocks.queryData = {
    adminData: {
      orgConfig: {
        restrictCategories: true,
        allowedCategoryIds: ['cat-1'],
        restrictProducts: false,
        allowedProductIds: [],
      },
      segmentVisibilities: [
        {
          segmentId: 'seg-1',
          config: {
            restrictCategories: false,
            allowedCategoryIds: [],
            restrictProducts: true,
            allowedProductIds: ['prod-2'],
          },
        },
      ],
      taxonomy: {
        categories: [
          { id: 'cat-1', name: 'Announcements', slug: 'announcements' },
          { id: 'cat-2', name: 'Fixes', slug: 'fixes' },
        ],
        products: [
          { id: 'prod-1', name: 'Dashboard', slug: 'dashboard' },
          { id: 'prod-2', name: 'Inbox', slug: 'inbox' },
        ],
      },
    },
    segments: [
      { id: 'seg-1', name: 'Enterprise', description: 'Paid customers' },
      { id: 'seg-2', name: 'Trial', description: null },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  seedQueries()
})

describe('settings.changelog-visibility route', () => {
  it('requires admin access and prefetches visibility data', async () => {
    await routeOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })

    expect(mocks.requireWorkspaceRole).toHaveBeenCalledWith({
      data: { allowedRoles: ['admin'] },
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(2)
  })

  it('renders default visibility, segment overrides, and taxonomy selections', () => {
    const Component = routeOptions().component
    render(<Component />)

    expect(screen.getByText('Changelog Visibility')).toBeTruthy()
    expect(screen.getByText('Default Visibility')).toBeTruthy()
    expect(screen.getByText('Segment Overrides')).toBeTruthy()
    expect(screen.getByText('Enterprise')).toBeTruthy()
    expect(screen.getByText('Override active')).toBeTruthy()
    expect(screen.getByText('Trial')).toBeTruthy()
    expect(screen.getByText('No description')).toBeTruthy()
    expect(screen.getAllByText('Announcements').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Inbox').length).toBeGreaterThan(0)
  })

  it('saves org defaults after toggling product restrictions', async () => {
    const Component = routeOptions().component
    render(<Component />)

    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[1])
    fireEvent.click(screen.getAllByRole('button', { name: 'Dashboard' })[0])
    fireEvent.click(screen.getByRole('button', { name: /Save Defaults/ }))

    await waitFor(() =>
      expect(mocks.updateOrgChangelogVisibilityFn).toHaveBeenCalledWith({
        data: {
          restrictCategories: true,
          allowedCategoryIds: ['cat-1'],
          restrictProducts: true,
          allowedProductIds: ['prod-1'],
        },
      })
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Saved', {
      description: 'Changelog visibility defaults updated',
    })
    expect(mocks.invalidate).toHaveBeenCalledTimes(1)
  })

  it('saves and resets segment overrides', async () => {
    const Component = routeOptions().component
    render(<Component />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Save Override' })[0])

    await waitFor(() =>
      expect(mocks.updateSegmentChangelogVisibilityFn).toHaveBeenCalledWith({
        data: {
          segmentId: 'seg-1',
          restrictCategories: false,
          allowedCategoryIds: [],
          restrictProducts: true,
          allowedProductIds: ['prod-2'],
        },
      })
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Saved', {
      description: 'Segment changelog visibility updated',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Reset to Defaults' }))

    await waitFor(() =>
      expect(mocks.deleteSegmentChangelogVisibilityFn).toHaveBeenCalledWith({
        data: { segmentId: 'seg-1' },
      })
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Reset', {
      description: 'Segment reverted to org defaults',
    })
  })

  it('shows empty taxonomy messages when restrictions have no taxonomy to pick from', () => {
    seedQueries({
      adminData: {
        orgConfig: {
          restrictCategories: true,
          allowedCategoryIds: [],
          restrictProducts: true,
          allowedProductIds: [],
        },
        segmentVisibilities: [],
        taxonomy: { categories: [], products: [] },
      },
      segments: [],
    })
    const Component = routeOptions().component
    render(<Component />)

    expect(screen.getByText('No categories defined yet')).toBeTruthy()
    expect(screen.getByText('No products defined yet')).toBeTruthy()
    expect(screen.queryByText('Segment Overrides')).toBeNull()
  })

  it('surfaces save failures through toast errors', async () => {
    mocks.updateOrgChangelogVisibilityFn.mockRejectedValueOnce(new Error('nope'))
    const Component = routeOptions().component
    render(<Component />)

    fireEvent.click(screen.getByRole('button', { name: /Save Defaults/ }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Error', {
        description: 'Failed to save changelog visibility defaults',
      })
    )
  })
})
