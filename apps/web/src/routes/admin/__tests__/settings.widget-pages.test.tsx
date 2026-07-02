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
  updateWidgetConfigMutate: vi.fn(async () => ({})),
  regenerateSecretMutate: vi.fn(async () => 'new-widget-secret-1234'),
  portalUpdateWidgetConfigFn: vi.fn(async () => ({})),
  portalRegenerateWidgetSecretFn: vi.fn(async () => 'new-portal-secret-1234'),
  upsertWidgetApplicationFn: vi.fn(async () => ({
    id: 'app-new',
    key: 'mobile-app',
    name: 'Mobile App',
  })),
  upsertWidgetEnvironmentProfileFn: vi.fn(async () => ({
    id: 'profile-saved',
    environment: 'production',
  })),
  writeText: vi.fn(async () => undefined),
  routeContext: {
    baseUrl: 'https://quackback.test',
    settings: {
      featureFlags: { helpCenter: true },
    },
  },
  queryData: {} as Record<string, unknown>,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useRouter: () => ({ invalidate: mocks.invalidate }),
  useRouteContext: () => mocks.routeContext,
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: (query: { queryKey: string }) => ({ data: mocks.queryData[query.queryKey] }),
}))

vi.mock('@/lib/server/functions/workspace-utils', () => ({
  requireWorkspaceRole: mocks.requireWorkspaceRole,
}))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    widgetConfig: () => ({ queryKey: 'widgetConfig' }),
    widgetSecret: () => ({ queryKey: 'widgetSecret' }),
    helpCenterConfig: () => ({ queryKey: 'helpCenterConfig' }),
    widgetApplications: () => ({ queryKey: 'widgetApplications' }),
  },
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    boards: () => ({ queryKey: 'boards' }),
  },
}))

vi.mock('@/lib/client/queries/help-center', () => ({
  helpCenterQueries: {
    categories: () => ({ queryKey: 'helpCategories' }),
  },
}))

vi.mock('@/lib/client/queries/changelog', () => ({
  changelogQueries: {
    taxonomy: () => ({ queryKey: 'changelogTaxonomy' }),
  },
}))

vi.mock('@/lib/client/queries/inboxes', () => ({
  inboxQueries: {
    list: () => ({ queryKey: 'inboxes' }),
  },
}))

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateWidgetConfig: () => ({ mutateAsync: mocks.updateWidgetConfigMutate }),
  useRegenerateWidgetSecret: () => ({ mutateAsync: mocks.regenerateSecretMutate }),
}))

vi.mock('@/lib/server/functions/settings', () => ({
  updateWidgetConfigFn: mocks.portalUpdateWidgetConfigFn,
  regenerateWidgetSecretFn: mocks.portalRegenerateWidgetSecretFn,
}))

vi.mock('@/lib/server/functions/widget-profiles', () => ({
  upsertWidgetApplicationFn: mocks.upsertWidgetApplicationFn,
  upsertWidgetEnvironmentProfileFn: mocks.upsertWidgetEnvironmentProfileFn,
}))

vi.mock('@/components/admin/settings/widget/highlighted-code', () => ({
  HighlightedCode: ({ code, lang }: { code: string; lang: string }) => (
    <pre data-lang={lang}>{code}</pre>
  ),
}))

vi.mock('@/components/admin/settings/widget/widget-ticketing-toggle', () => ({
  WidgetTicketingToggle: ({
    initialEnabled,
    onEnabledChange,
  }: {
    initialEnabled: boolean
    onEnabledChange?: (enabled: boolean) => void
  }) => (
    <button type="button" onClick={() => onEnabledChange?.(!initialEnabled)}>
      Ticketing {initialEnabled ? 'enabled' : 'disabled'}
    </button>
  ),
}))

vi.mock('@/components/admin/settings/branding/branding-layout', () => ({
  BrandingLayout: ({ children }: ComponentProps) => <div>{children}</div>,
  BrandingControlsPanel: ({ children }: ComponentProps) => <div>{children}</div>,
  BrandingPreviewPanel: ({ children, label }: ComponentProps & { label: string }) => (
    <section aria-label={label}>{children}</section>
  ),
}))

vi.mock('@/components/admin/settings/widget/widget-preview', () => ({
  WidgetPreview: ({
    position,
    ticketingEnabled,
  }: {
    position: string
    ticketingEnabled?: boolean
  }) => (
    <div>
      Preview {position} {ticketingEnabled ? 'tickets on' : 'tickets off'}
    </div>
  ),
}))

vi.mock('@/components/admin/settings/inline-spinner', () => ({
  InlineSpinner: ({ visible }: { visible: boolean }) => (visible ? <span>Saving</span> : null),
}))

vi.mock('@/components/shared/page-header', () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <header>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  ),
}))

vi.mock('@/components/ui/back-link', () => ({
  BackLink: ({ children }: ComponentProps) => <a href="/admin/settings">{children}</a>,
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

vi.mock('@/components/shared/warning-box', () => ({
  WarningBox: ({ title }: { title: string }) => <aside>{title}</aside>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: ComponentProps & { type?: 'button' | 'submit' }) => (
    <button type={type ?? 'button'} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor, className }: ComponentProps & { htmlFor?: string }) => (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    id,
    'aria-label': ariaLabel,
  }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    disabled?: boolean
    id?: string
    'aria-label'?: string
  }) => (
    <button
      id={id}
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked ? 'true' : 'false'}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}))

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void
    disabled?: boolean
  }>({})

  return {
    Select: ({
      value,
      onValueChange,
      disabled,
      children,
    }: {
      value?: string
      onValueChange?: (value: string) => void
      disabled?: boolean
      children?: ReactNode
    }) => (
      <SelectContext.Provider value={{ onValueChange, disabled }}>
        <div data-value={value}>{children}</div>
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: ComponentProps) => <div>{children}</div>,
    SelectTrigger: ({ children, onClear }: ComponentProps & { onClear?: () => void }) => (
      <div>
        {children}
        {onClear ? (
          <button type="button" aria-label="Clear" onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    SelectItem: ({ value, children }: ComponentProps & { value: string }) => {
      const context = React.useContext(SelectContext)
      return (
        <button
          type="button"
          disabled={context.disabled}
          onClick={() => context.onValueChange?.(value)}
        >
          {children}
        </button>
      )
    },
  }
})

vi.mock('@/lib/shared/utils', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

const [{ Route: WidgetRoute }, { Route: PortalWidgetRoute }] = await Promise.all([
  import('../settings.widget'),
  import('../settings.portal-widget'),
])

function widgetOptions(): RouteOptions {
  return WidgetRoute.options as unknown as RouteOptions
}

function portalWidgetOptions(): RouteOptions {
  return PortalWidgetRoute.options as unknown as RouteOptions
}

function seedQueries(overrides: Record<string, unknown> = {}) {
  mocks.queryData = {
    widgetConfig: {
      enabled: true,
      defaultBoard: 'ideas',
      position: 'bottom-right',
      tabs: { home: true, feedback: true, changelog: true, help: true },
      ticketing: { enabled: false },
      identifyVerification: false,
    },
    widgetSecret: 'secret-1234567890',
    helpCenterConfig: { enabled: true },
    widgetApplications: [
      {
        id: 'app-1',
        key: 'customer-app',
        name: 'Customer App',
        description: null,
        profiles: [
          {
            id: 'profile-1',
            environment: 'production',
            displayName: 'Production',
            enabled: true,
            allowedOrigins: ['https://app.example.com'],
            configOverrides: {
              tabs: { home: true, feedback: true, changelog: true, help: true, chat: false },
            },
            contentFilters: {
              feedback: { boardIds: ['board-1'] },
              help: { categoryIds: ['cat-child'] },
              changelog: {
                mode: 'selected_entries',
                categoryIds: ['cl-cat-1'],
                productIds: ['product-1'],
              },
            },
            supportConfig: {
              categories: [
                {
                  categoryKey: 'billing',
                  label: 'Billing',
                  description: 'Invoices and plan questions',
                  icon: 'credit-card',
                  inboxId: 'inbox-1',
                  defaultPriority: 'high',
                  visible: true,
                  display: { showPrioritySelector: false },
                },
              ],
            },
          },
        ],
      },
      {
        id: 'app-2',
        key: 'docs-app',
        name: 'Docs App',
        description: null,
        profiles: [],
      },
    ],
    inboxes: [
      { id: 'inbox-1', name: 'Support inbox' },
      { id: 'inbox-2', name: 'Billing inbox' },
    ],
    boards: [
      { id: 'board-1', name: 'Ideas', slug: 'ideas' },
      { id: 'board-2', name: 'Bugs', slug: 'bugs' },
    ],
    helpCategories: [
      { id: 'cat-parent', parentId: null, name: 'Guides', isPublic: true },
      { id: 'cat-child', parentId: 'cat-parent', name: 'Billing help', isPublic: false },
    ],
    changelogTaxonomy: {
      categories: [{ id: 'cl-cat-1', name: 'Announcements' }],
      products: [{ id: 'product-1', name: 'Dashboard' }],
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  seedQueries()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mocks.writeText },
    configurable: true,
  })
})

describe('widget settings routes', () => {
  it('requires admin access and prefetches the widget settings data', async () => {
    await widgetOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })

    expect(mocks.requireWorkspaceRole).toHaveBeenCalledWith({
      data: { allowedRoles: ['admin'] },
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(8)
  })

  it('renders widget application scoping, content filters, support routing, and install snippets', () => {
    const Component = widgetOptions().component
    render(<Component />)

    expect(screen.getByText('Feedback Widget')).toBeTruthy()
    expect(screen.getByText('Applications & environments')).toBeTruthy()
    expect(screen.getByText('Customer App')).toBeTruthy()
    expect(screen.getByDisplayValue('Billing')).toBeTruthy()
    expect(screen.getByDisplayValue('billing')).toBeTruthy()
    expect(screen.getByText('Guides')).toBeTruthy()
    expect(screen.getByText('Billing help')).toBeTruthy()
    expect(screen.getByText('Announcements')).toBeTruthy()
    expect(screen.getByText('Dashboard')).toBeTruthy()
    expect(screen.getByText(/dataset.applicationKey/)).toBeTruthy()
    expect(screen.getAllByText(/Quackback\("init"/).length).toBeGreaterThan(0)
  })

  it('persists widget toggles, appearance, install security, and secret actions', async () => {
    const Component = widgetOptions().component
    render(<Component />)

    fireEvent.click(screen.getByRole('switch', { name: 'Feedback Widget' }))
    await waitFor(() =>
      expect(mocks.updateWidgetConfigMutate).toHaveBeenCalledWith({ enabled: false })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Bottom Left' }))
    await waitFor(() =>
      expect(mocks.updateWidgetConfigMutate).toHaveBeenCalledWith({ position: 'bottom-left' })
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Require verified widget identity' }))
    await waitFor(() =>
      expect(mocks.updateWidgetConfigMutate).toHaveBeenCalledWith({
        identifyVerification: true,
      })
    )
    expect(screen.getByText('Widget secret')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(mocks.regenerateSecretMutate).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledWith(expect.stringContaining('/api/widget/sdk.js'))
    )
  })

  it('saves applications and environment profile restrictions', async () => {
    const Component = widgetOptions().component
    render(<Component />)

    fireEvent.click(screen.getByRole('button', { name: 'Save environment' }))

    await waitFor(() =>
      expect(mocks.upsertWidgetEnvironmentProfileFn).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'profile-1',
          applicationId: 'app-1',
          environment: 'production',
          enabled: true,
          allowedOrigins: ['https://app.example.com'],
          configOverrides: {
            tabs: { home: true, feedback: true, changelog: true, help: true, chat: false },
          },
          contentFilters: {
            feedback: { boardIds: ['board-1'] },
            changelog: {
              mode: 'selected_entries',
              categoryIds: ['cl-cat-1'],
              productIds: ['product-1'],
            },
            help: { categoryIds: ['cat-child'] },
          },
          supportConfig: {
            ticketListScope: 'requester_owned',
            categories: [
              expect.objectContaining({
                categoryKey: 'billing',
                label: 'Billing',
                inboxId: 'inbox-1',
                defaultPriority: 'high',
                visible: true,
                display: { showPrioritySelector: false },
              }),
            ],
          },
        }),
      })
    )

    fireEvent.change(screen.getByPlaceholderText('customer-dashboard'), {
      target: { value: 'mobile-app' },
    })
    fireEvent.change(screen.getByPlaceholderText('Customer dashboard'), {
      target: { value: 'Mobile App' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add app' }))

    await waitFor(() =>
      expect(mocks.upsertWidgetApplicationFn).toHaveBeenCalledWith({
        data: { key: 'mobile-app', name: 'Mobile App' },
      })
    )
  })

  it('covers the empty widget application state without rendering profile editors', () => {
    seedQueries({
      widgetApplications: [],
      helpCategories: [],
      changelogTaxonomy: { categories: [], products: [] },
    })
    const Component = widgetOptions().component
    render(<Component />)

    expect(screen.getByText('Applications & environments')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save environment' })).toBeNull()
  })
})

describe('portal widget settings route', () => {
  it('requires admin access and prefetches portal widget data', async () => {
    await portalWidgetOptions().loader({
      context: { queryClient: { ensureQueryData: mocks.ensureQueryData } },
    })

    expect(mocks.requireWorkspaceRole).toHaveBeenCalledWith({
      data: { allowedRoles: ['admin'] },
    })
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(4)
  })

  it('renders the portal widget page and uses direct server functions for mutations', async () => {
    seedQueries({
      widgetConfig: {
        enabled: false,
        defaultBoard: '',
        position: 'bottom-left',
        tabs: { feedback: true, changelog: false, help: false },
        ticketing: { enabled: true },
        identifyVerification: true,
      },
      widgetSecret: null,
    })
    const Component = portalWidgetOptions().component
    render(<Component />)

    expect(screen.getByText('Feedback Widget')).toBeTruthy()
    expect(screen.getByText('Click regenerate to create a secret')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(mocks.portalRegenerateWidgetSecretFn).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('switch', { name: 'Feedback Widget' }))
    await waitFor(() =>
      expect(mocks.portalUpdateWidgetConfigFn).toHaveBeenCalledWith({
        data: { enabled: true },
      })
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Require verified widget identity' }))
    await waitFor(() =>
      expect(mocks.portalUpdateWidgetConfigFn).toHaveBeenCalledWith({
        data: { identifyVerification: false },
      })
    )
  })
})
