// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const updateOfficeHours = vi.fn()

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
vi.mock('@/lib/server/functions/settings', () => ({
  fetchOfficeHoursFn: vi.fn(),
  updateOfficeHoursFn: (...a: unknown[]) => updateOfficeHours(...a),
}))

const { Route } = await import('../settings.office-hours')

const SCHEDULE = {
  enabled: true,
  timezone: 'UTC',
  intervals: [{ day: 1, start: '09:00', end: '17:00' }],
  holidays: [{ date: '2027-12-25', name: 'Christmas' }],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(['settings', 'officeHours'], SCHEDULE)
  const Page = Route.options.component as React.ComponentType
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  updateOfficeHours.mockReset()
  updateOfficeHours.mockImplementation(async ({ data }: { data: unknown }) => data)
})
afterEach(cleanup)

describe('removing office hours entries', () => {
  it('asks before removing a window and saves only on confirm', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Monday window' }))
    expect(updateOfficeHours).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete window' }))
    await waitFor(() =>
      expect(updateOfficeHours).toHaveBeenCalledWith({
        data: expect.objectContaining({ intervals: [] }),
      })
    )
  })

  it('cancelling keeps the window', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Monday window' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(updateOfficeHours).not.toHaveBeenCalled()
  })

  it('asks before removing a holiday and saves only on confirm', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Remove holiday 1' }))
    expect(updateOfficeHours).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete holiday' }))
    await waitFor(() =>
      expect(updateOfficeHours).toHaveBeenCalledWith({
        data: expect.objectContaining({ holidays: [] }),
      })
    )
  })
})
