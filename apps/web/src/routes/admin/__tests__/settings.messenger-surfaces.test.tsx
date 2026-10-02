// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const updateWidget = vi.fn()
let prevent = false
let assistant: Record<string, unknown> | undefined

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    useRouter: () => ({ invalidate: vi.fn() }),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  }
})

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useSuspenseQuery: (opts: { queryKey: string[] }) => {
      if (opts.queryKey.includes('widgetConfig')) {
        return {
          data: {
            tabs: { messenger: true },
            messenger: {
              welcomeMessage: 'Hi',
              offlineMessage: 'Away',
              teamName: 'Support',
              preventRepliesWhenClosed: prevent,
              assistant,
            },
            translations: {},
          },
        }
      }
      return { data: { support: { enabled: true } } }
    },
  }
})

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    widgetConfig: () => ({ queryKey: ['settings', 'widgetConfig'] }),
    portalConfig: () => ({ queryKey: ['settings', 'portalConfig'] }),
  },
}))

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateWidgetConfig: () => ({ mutateAsync: updateWidget }),
  useUpdatePortalConfig: () => ({ mutateAsync: vi.fn() }),
}))

const { MessengerChannelPage } = await import('@/components/admin/settings/messenger-channel-page')

function renderPage() {
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={new QueryClient()}>
        <MessengerChannelPage />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  updateWidget.mockReset()
  updateWidget.mockResolvedValue({})
  prevent = false
  assistant = undefined
})
afterEach(cleanup)

describe('Messenger Surfaces', () => {
  it('owns Widget and Portal chats switches', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Surfaces' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Widget' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Portal chats' })).toBeInTheDocument()
    expect(screen.getByText('Show the Messages tab in the widget.')).toBeInTheDocument()
    expect(
      screen.getByText(
        "Let signed-in customers start new conversations from the portal's Support tab."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('Widget settings')).not.toBeInTheDocument()
    expect(screen.queryByText('Portal Support')).not.toBeInTheDocument()
    expect(screen.getByText('Translations')).toBeInTheDocument()
  })

  it('shows the Support / Channels / Messenger breadcrumb', () => {
    renderPage()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(crumbs.textContent).toMatch(/Support\s*\/\s*Channels\s*\/\s*Messenger/)
    expect(crumbs.querySelector('a[href="/admin/settings/channels"]')).toBeTruthy()
    expect(crumbs.querySelector('a[href="/admin/settings/support"]')).toBeTruthy()
  })
})

describe('Closed conversations reopen switch', () => {
  it('is on when the stored prevent-replies flag is false', () => {
    prevent = false
    renderPage()
    expect(screen.getByRole('heading', { name: 'Closed conversations' })).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Reopen when a visitor replies' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText('Prevent replies to closed conversations')).toBeNull()
  })

  it('is off when the stored prevent-replies flag is true', () => {
    prevent = true
    renderPage()
    const toggle = screen.getByRole('switch', { name: 'Reopen when a visitor replies' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('turning it off stores preventRepliesWhenClosed true', async () => {
    prevent = false
    renderPage()
    fireEvent.click(screen.getByRole('switch', { name: 'Reopen when a visitor replies' }))
    await waitFor(() =>
      expect(updateWidget).toHaveBeenCalledWith({ messenger: { preventRepliesWhenClosed: true } })
    )
  })

  it('turning it on stores preventRepliesWhenClosed false', async () => {
    prevent = true
    renderPage()
    fireEvent.click(screen.getByRole('switch', { name: 'Reopen when a visitor replies' }))
    await waitFor(() =>
      expect(updateWidget).toHaveBeenCalledWith({ messenger: { preventRepliesWhenClosed: false } })
    )
  })

  it('says email replies always reopen', () => {
    renderPage()
    expect(screen.getByText(/Email replies always reopen/)).toBeInTheDocument()
  })
})

describe('Quinn row', () => {
  it('reads "Quinn answers first" with a Configure link', () => {
    assistant = { enabled: true, respond: true }
    renderPage()
    expect(screen.getByText('Quinn answers first')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Configure' }).getAttribute('href')).toBe(
      '/admin/settings/agent'
    )
    expect(screen.queryByText(/Fronting conversations/)).toBeNull()
  })

  it('reads "Quinn is off" when answering is off or unset', () => {
    for (const value of [{ enabled: true, respond: false }, { enabled: true }]) {
      assistant = value
      const { unmount } = renderPage()
      expect(screen.getByText('Quinn is off')).toBeInTheDocument()
      expect(screen.queryByText('Quinn answers first')).toBeNull()
      expect(screen.queryByText('Answering is off.')).toBeNull()
      unmount()
    }
  })
})

describe('Translation chips', () => {
  it('mark the selected locale with the primary style, not green', () => {
    renderPage()
    const selected = screen.getByRole('button', { name: 'English' })
    expect(selected.className.split(' ')).toContain('border-primary')
    expect(selected.className).not.toMatch(/green|emerald/)
  })
})
