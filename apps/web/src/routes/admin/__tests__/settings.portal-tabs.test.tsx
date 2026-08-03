// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

type RouteOptions = {
  loader: (input: {
    context: { queryClient: { ensureQueryData: (query: unknown) => unknown } }
  }) => Promise<unknown>
  component: () => ReactElement
}

type ComponentProps = {
  children?: ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
}

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  ensureQueryData: vi.fn(async () => undefined),
  requireWorkspaceRole: vi.fn(async () => undefined),
  updatePortalTabConfigFn: vi.fn(async () => undefined),
  updateSegmentTabOverridesFn: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  queryData: {} as Record<string, unknown>,
  settings: { featureFlags: { portalTabCustomization: true } } as Record<string, unknown>,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useRouter: () => ({ invalidate: mocks.invalidate }),
  useRouteContext: () => ({ settings: mocks.settings }),
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: (query: { queryKey: string }) => ({ data: mocks.queryData[query.queryKey] }),
}))

vi.mock('@/lib/server/functions/workspace-utils', () => ({
  requireWorkspaceRole: mocks.requireWorkspaceRole,
}))

vi.mock('@/lib/server/functions/settings', () => ({
  updatePortalTabConfigFn: mocks.updatePortalTabConfigFn,
  updateSegmentTabOverridesFn: mocks.updateSegmentTabOverridesFn,
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    portalTabConfig: () => ({ queryKey: 'portalConfig' }),
    segmentList: () => ({ queryKey: 'segments' }),
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

vi.mock('@/components/shared/spinner', () => ({
  Spinner: ({ className }: { className?: string }) => <span className={className}>Loading</span>,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  Cog6ToothIcon: () => <span />,
  CheckCircleIcon: () => <span />,
  LockClosedIcon: () => <span />,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

const { Route } = await import('../settings.portal-tabs')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function seedQueries(overrides: Record<string, unknown> = {}) {
  mocks.queryData = {
    portalConfig: {
      feedback: false,
      roadmap: true,
      changelog: true,
      myTickets: true,
      helpCenter: true,
      support: true,
    },
    segments: [
      { id: 'seg-1', name: 'Enterprise', description: 'Paid accounts' },
      { id: 'seg-2', name: 'Trial', description: null },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings = { featureFlags: { portalTabCustomization: true } }
  seedQueries()
})

describe('settings.portal-tabs route', () => {
  it('requires admin access and prefetches portal tab data', async () => {
    await routeOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })

    expect(mocks.requireWorkspaceRole).toHaveBeenCalledWith({
      data: { allowedRoles: ['admin'] },
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(2)
  })

  it('renders the plan-gated message when portal tab customization is disabled', () => {
    mocks.settings = { featureFlags: { portalTabCustomization: false } }
    const Component = routeOptions().component

    render(<Component />)

    expect(screen.getByText('Feature Not Available')).toBeInTheDocument()
    expect(
      screen.getByText('Portal tab customization is not available on your plan')
    ).toBeInTheDocument()
  })

  it('renders a spinner while config data is unavailable', () => {
    seedQueries({ portalConfig: null })
    const Component = routeOptions().component

    render(<Component />)

    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('saves organization defaults after toggling tabs', async () => {
    const Component = routeOptions().component
    render(<Component />)

    expect(screen.getByText('Default Tab Visibility')).toBeInTheDocument()
    expect(screen.getByText('Segment Overrides')).toBeInTheDocument()
    expect(screen.getByText('Enterprise')).toBeInTheDocument()
    expect(screen.getByText('No description')).toBeInTheDocument()

    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0])
    fireEvent.click(switches[1])
    fireEvent.click(screen.getByRole('button', { name: /Save Defaults/ }))

    await waitFor(() => {
      expect(mocks.updatePortalTabConfigFn).toHaveBeenCalledWith({
        data: {
          config: {
            feedback: true,
            roadmap: false,
            changelog: true,
            myTickets: true,
            helpCenter: true,
            support: true,
          },
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Saved', {
      description: 'Portal tab configuration updated',
    })
    expect(mocks.invalidate).toHaveBeenCalled()
  })

  it('saves segment overrides after a segment switch changes', async () => {
    const Component = routeOptions().component
    render(<Component />)

    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[6])
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Overrides' })[0])

    await waitFor(() => {
      expect(mocks.updateSegmentTabOverridesFn).toHaveBeenCalledWith({
        data: {
          segmentId: 'seg-1',
          overrides: {
            feedback: true,
            roadmap: true,
            changelog: true,
            myTickets: true,
            helpCenter: true,
            support: true,
          },
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Saved', {
      description: 'Segment tab configuration updated',
    })
  })

  it('shows save errors for defaults and segment overrides', async () => {
    mocks.updatePortalTabConfigFn.mockRejectedValueOnce(new Error('default failed'))
    mocks.updateSegmentTabOverridesFn.mockRejectedValueOnce(new Error('segment failed'))
    const Component = routeOptions().component
    render(<Component />)

    fireEvent.click(screen.getByRole('button', { name: /Save Defaults/ }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Error', {
        description: 'Failed to save portal tab configuration',
      })
    })

    fireEvent.click(screen.getAllByRole('switch')[6])
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Overrides' })[0])
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Error', {
        description: 'Failed to save segment tab configuration',
      })
    })
  })
})
