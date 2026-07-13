// @vitest-environment happy-dom

import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SupportAccessConfig } from '@/lib/server/domains/settings/settings.types'

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
  updateWidgetConfig: vi.fn(async () => undefined),
  updatePortalConfig: vi.fn(async () => undefined),
  getEmailChannelStatusFn: vi.fn(async () => null as unknown),
  navigateTo: undefined as string | undefined,
  // Keyed by joined queryKey -> data for both useSuspenseQuery and useQuery.
  queryData: {} as Record<string, unknown>,
  segmentsData: undefined as unknown,
  settings: { featureFlags: { supportInbox: true } } as Record<string, unknown> | undefined,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ settings: mocks.settings }),
  }),
  useRouter: () => ({ invalidate: mocks.invalidate }),
  Navigate: ({ to }: { to: string }) => {
    mocks.navigateTo = to
    return <div data-testid="navigate" data-to={to} />
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: (query: { queryKey: unknown[] }) => ({
    data: mocks.queryData[query.queryKey.join('|')],
  }),
  useQuery: (query: { queryKey: unknown[] }) => ({
    data: mocks.queryData[query.queryKey.join('|')],
  }),
}))

vi.mock('@/lib/server/functions/workspace-utils', () => ({
  requireWorkspaceRole: mocks.requireWorkspaceRole,
}))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    widgetConfig: () => ({ queryKey: ['settings', 'widgetConfig'] }),
    portalConfig: () => ({ queryKey: ['settings', 'portalConfig'] }),
  },
}))

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateWidgetConfig: () => ({ mutateAsync: mocks.updateWidgetConfig }),
  useUpdatePortalConfig: () => ({ mutateAsync: mocks.updatePortalConfig }),
}))

vi.mock('@/lib/server/functions/settings', () => ({
  getEmailChannelStatusFn: mocks.getEmailChannelStatusFn,
}))

vi.mock('@/lib/client/hooks/use-segments-queries', () => ({
  useSegments: () => ({ data: mocks.segmentsData }),
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
    <section aria-label={title}>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, className, htmlFor }: ComponentProps & { htmlFor?: string }) => (
    <label className={className} htmlFor={htmlFor}>
      {children}
    </label>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
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
    id,
  }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    disabled?: boolean
    id?: string
  }) => (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked ? 'true' : 'false'}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}))

vi.mock('@/components/admin/segments/segment-multi-select', () => ({
  SegmentMultiSelect: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string[]
    onChange: (next: string[]) => void
    ariaLabel?: string
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      data-value={value.join(',')}
      onClick={() => onChange([...value, 'seg-added'])}
    >
      segment-multi-select
    </button>
  ),
}))

vi.mock('@/components/admin/shared/principal-picker', () => ({
  PrincipalPicker: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value: string[]
    onValueChange: (next: string[]) => void
    placeholder?: string
  }) => (
    <button
      type="button"
      aria-label={placeholder}
      data-value={value.join(',')}
      onClick={() => onValueChange([...value, 'prin-added'])}
    >
      principal-picker
    </button>
  ),
}))

vi.mock('@heroicons/react/24/solid', () => ({
  ChatBubbleLeftRightIcon: () => <span />,
  ArrowPathIcon: () => <span data-testid="spinner" />,
}))

vi.mock('@heroicons/react/24/outline', () => ({
  PlusIcon: () => <span />,
  TrashIcon: () => <span />,
}))

const { Route } = await import('../settings.conversations')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function selected(overrides: Partial<SupportAccessConfig> = {}): SupportAccessConfig {
  return { mode: 'selected', segmentIds: [], principalIds: [], ...overrides } as SupportAccessConfig
}

function seedQueries(
  overrides: {
    widget?: Record<string, unknown>
    portal?: Record<string, unknown>
  } = {}
) {
  mocks.queryData = {
    'settings|widgetConfig': {
      enabled: true,
      chat: {
        enabled: true,
        access: { mode: 'anonymous', segmentIds: [], principalIds: [] },
        ...overrides.widget,
      },
    },
    'settings|portalConfig': {
      support: {
        enabled: true,
        access: { mode: 'authenticated', segmentIds: [], principalIds: [] },
        ...overrides.portal,
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings = { featureFlags: { supportInbox: true } }
  mocks.navigateTo = undefined
  mocks.segmentsData = [
    { id: 'seg-1', name: 'Enterprise', memberCount: 5 },
    { id: 'seg-2', name: 'Trial', memberCount: 0 },
  ]
  seedQueries()
})

describe('admin settings.conversations route — loader & gate', () => {
  it('requires admin access and prefetches widget + portal config', async () => {
    await routeOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })
    expect(mocks.requireWorkspaceRole).toHaveBeenCalledWith({ data: { allowedRoles: ['admin'] } })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(2)
  })

  it('redirects to settings when the supportInbox flag is off', () => {
    mocks.settings = { featureFlags: { supportInbox: false } }
    render(<RouteComponent />)
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/admin/settings')
  })

  it('redirects when settings/featureFlags are entirely absent', () => {
    mocks.settings = undefined
    render(<RouteComponent />)
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/admin/settings')
  })
})

const RouteComponent = (): ReactElement => {
  const Component = routeOptions().component
  return <Component />
}

describe('admin settings.conversations page — render & SupportAccessEditor', () => {
  it('renders both access cards with segment options mapped from the segments query', () => {
    render(<RouteComponent />)
    expect(screen.getByText('Live Chat Access')).toBeInTheDocument()
    expect(screen.getByText('Portal Support Access')).toBeInTheDocument()
    // Widget editor includes the "Anyone" option; portal editor does not.
    const accessSelects = screen.getAllByLabelText('Access')
    expect(accessSelects).toHaveLength(2)
    const widgetSelect = screen.getByLabelText('Access', {
      selector: '#widget-chat-access',
    }) as HTMLSelectElement
    expect(Array.from(widgetSelect.options).map((o) => o.value)).toContain('anonymous')
    const portalSelect = screen.getByLabelText('Access', {
      selector: '#portal-support-access',
    }) as HTMLSelectElement
    expect(Array.from(portalSelect.options).map((o) => o.value)).not.toContain('anonymous')
  })

  it('falls back to default access configs when config omits them', () => {
    seedQueries({ widget: { enabled: true }, portal: { enabled: true } })
    render(<RouteComponent />)
    const widgetSelect = screen.getByLabelText('Access', {
      selector: '#widget-chat-access',
    }) as HTMLSelectElement
    // DEFAULT_WIDGET_SUPPORT_ACCESS.mode === 'anonymous'
    expect(widgetSelect.value).toBe('anonymous')
    const portalSelect = screen.getByLabelText('Access', {
      selector: '#portal-support-access',
    }) as HTMLSelectElement
    // DEFAULT_PORTAL_SUPPORT_ACCESS.mode === 'authenticated'
    expect(portalSelect.value).toBe('authenticated')
  })

  it('shows segment/user pickers and the empty-selection warning in "selected" mode', () => {
    seedQueries({ widget: { enabled: true, access: selected() } })
    render(<RouteComponent />)
    expect(screen.getByLabelText('Support segment allowlist')).toBeInTheDocument()
    expect(screen.getByLabelText('Select portal users...')).toBeInTheDocument()
    expect(
      screen.getByText('Select at least one segment or user before this access mode can be saved.')
    ).toBeInTheDocument()
  })

  it('shows the "no segments defined" hint when there are no segments', () => {
    mocks.segmentsData = []
    seedQueries({ widget: { enabled: true, access: selected() } })
    render(<RouteComponent />)
    expect(
      screen.getByText('No segments defined yet. Create segments in Customers.')
    ).toBeInTheDocument()
  })

  it('does not show the empty warning when a selected config already has members', () => {
    seedQueries({ widget: { enabled: true, access: selected({ segmentIds: ['seg-1'] as never }) } })
    render(<RouteComponent />)
    expect(
      screen.queryByText(
        'Select at least one segment or user before this access mode can be saved.'
      )
    ).not.toBeInTheDocument()
  })
})

describe('admin settings.conversations page — widget access persistence', () => {
  it('persists immediately when switching to a non-selected mode', async () => {
    render(<RouteComponent />)
    const widgetSelect = screen.getByLabelText('Access', {
      selector: '#widget-chat-access',
    }) as HTMLSelectElement
    fireEvent.change(widgetSelect, { target: { value: 'team' } })
    await waitFor(() => {
      expect(mocks.updateWidgetConfig).toHaveBeenCalledWith({
        chat: { access: { mode: 'team', segmentIds: [], principalIds: [] } },
      })
    })
    expect(mocks.invalidate).toHaveBeenCalled()
  })

  it('skips persistence when switching to "selected" with no members', () => {
    render(<RouteComponent />)
    const widgetSelect = screen.getByLabelText('Access', {
      selector: '#widget-chat-access',
    }) as HTMLSelectElement
    fireEvent.change(widgetSelect, { target: { value: 'selected' } })
    expect(mocks.updateWidgetConfig).not.toHaveBeenCalled()
    // The warning now shows because the local state is selected + empty.
    expect(
      screen.getByText('Select at least one segment or user before this access mode can be saved.')
    ).toBeInTheDocument()
  })

  it('persists once a segment is added in selected mode, then reverts on failure', async () => {
    mocks.updateWidgetConfig.mockRejectedValueOnce(new Error('save failed'))
    seedQueries({ widget: { enabled: true, access: selected() } })
    render(<RouteComponent />)
    fireEvent.click(screen.getByLabelText('Support segment allowlist'))
    await waitFor(() => {
      expect(mocks.updateWidgetConfig).toHaveBeenCalledWith({
        chat: { access: { mode: 'selected', segmentIds: ['seg-added'], principalIds: [] } },
      })
    })
    // Reverted on failure -> warning reappears for the empty selected state.
    await waitFor(() => {
      expect(
        screen.getByText(
          'Select at least one segment or user before this access mode can be saved.'
        )
      ).toBeInTheDocument()
    })
  })
})

describe('admin settings.conversations page — portal access persistence', () => {
  it('persists portal access when switching to a non-selected mode', async () => {
    render(<RouteComponent />)
    const portalSelect = screen.getByLabelText('Access', {
      selector: '#portal-support-access',
    }) as HTMLSelectElement
    fireEvent.change(portalSelect, { target: { value: 'team' } })
    await waitFor(() => {
      expect(mocks.updatePortalConfig).toHaveBeenCalledWith({
        support: { access: { mode: 'team', segmentIds: [], principalIds: [] } },
      })
    })
    expect(mocks.invalidate).toHaveBeenCalled()
  })

  it('skips portal persistence for an empty "selected" mode', () => {
    render(<RouteComponent />)
    const portalSelect = screen.getByLabelText('Access', {
      selector: '#portal-support-access',
    }) as HTMLSelectElement
    fireEvent.change(portalSelect, { target: { value: 'selected' } })
    expect(mocks.updatePortalConfig).not.toHaveBeenCalled()
  })

  it('reverts portal access when the save call rejects', async () => {
    mocks.updatePortalConfig.mockRejectedValueOnce(new Error('portal save failed'))
    render(<RouteComponent />)
    const portalSelect = screen.getByLabelText('Access', {
      selector: '#portal-support-access',
    }) as HTMLSelectElement
    fireEvent.change(portalSelect, { target: { value: 'team' } })
    await waitFor(() => {
      expect(mocks.updatePortalConfig).toHaveBeenCalled()
    })
    // After revert the select returns to its previous value.
    await waitFor(() => {
      expect(
        (
          screen.getByLabelText('Access', {
            selector: '#portal-support-access',
          }) as HTMLSelectElement
        ).value
      ).toBe('authenticated')
    })
  })
})
