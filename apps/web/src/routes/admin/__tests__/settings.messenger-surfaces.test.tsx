// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    useRouter: () => ({ invalidate: vi.fn() }),
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  }
})

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: (opts: { queryKey: string[] }) => {
    if (opts.queryKey.includes('widgetConfig')) {
      return {
        data: {
          tabs: { messenger: true },
          messenger: {
            welcomeMessage: 'Hi',
            offlineMessage: 'Away',
            teamName: 'Support',
            preventRepliesWhenClosed: false,
          },
          translations: {},
        },
      }
    }
    return { data: { support: { enabled: true } } }
  },
}))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    widgetConfig: () => ({ queryKey: ['settings', 'widgetConfig'] }),
    portalConfig: () => ({ queryKey: ['settings', 'portalConfig'] }),
  },
}))

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateWidgetConfig: () => ({ mutateAsync: vi.fn() }),
  useUpdatePortalConfig: () => ({ mutateAsync: vi.fn() }),
}))

const { MessengerChannelPage } = await import('../settings.channels_.messenger')

describe('Messenger Surfaces', () => {
  it('owns Widget and Portal chats switches', () => {
    render(<MessengerChannelPage />)

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
})
