// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const updateWidgetConfig = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useRouter: () => ({ invalidate: vi.fn() }),
}))
vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateWidgetConfig: () => ({ mutateAsync: updateWidgetConfig }),
  useUpdatePortalConfig: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/components/admin/settings/settings-page', () => ({
  SettingsPage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const { MessengerChannelPage } = await import('../messenger-channel-page')
const { settingsQueries } = await import('@/lib/client/queries/settings')

let client: QueryClient

function renderPage(messenger: Record<string, unknown>) {
  client.setQueryData(settingsQueries.widgetConfig().queryKey, {
    enabled: true,
    messenger: { enabled: true, ...messenger },
  } as never)
  client.setQueryData(settingsQueries.portalConfig().queryKey, {} as never)
  return render(
    <QueryClientProvider client={client}>
      <MessengerChannelPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  updateWidgetConfig.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
})
afterEach(cleanup)

describe('MessengerChannelPage usual reply time', () => {
  it('shows under an hour when the workspace never set it', () => {
    renderPage({})
    const trigger = screen.getByRole('combobox', { name: 'Usual reply time' })
    expect(trigger.textContent).toContain('Under an hour')
  })

  it('shows the stored choice', () => {
    renderPage({ replyTime: 'day' })
    const trigger = screen.getByRole('combobox', { name: 'Usual reply time' })
    expect(trigger.textContent).toContain('Within a day')
  })
})
