// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

vi.mock('@/lib/server/functions/assistant-settings', () => ({
  getAssistantSettingsFn: vi.fn(),
  updateAssistantIdentityFn: vi.fn(),
  updateAssistantVoiceFn: vi.fn(),
  updateWidgetAssistantDeploymentFn: vi.fn(),
}))

import { updateWidgetAssistantDeploymentFn } from '@/lib/server/functions/assistant-settings'
import { AssistantDeploymentCard } from '../assistant-deployment-card'

afterEach(cleanup)

it('shows deployment as a compact channel-level control', () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>
        <AssistantDeploymentCard
          deployment={{ enabled: true, respond: false }}
          onChange={() => {}}
        />
      </QueryClientProvider>
    </IntlProvider>
  )

  expect(screen.getByRole('heading', { name: 'Messenger replies' })).toBeInTheDocument()
  expect(screen.getByText('Paused')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Enable automatic replies' })).toBeInTheDocument()
})

// The error styling used to be chosen by searching the message for the English
// words "could not", so a translated error rendered as a neutral status line.
it('announces a failed change as an alert in any locale', async () => {
  vi.mocked(updateWidgetAssistantDeploymentFn).mockRejectedValueOnce(new Error('boom'))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <IntlProvider
      locale="nl"
      messages={{ 'automation.agent.deployment.error': 'Wijzigen mislukt. Probeer het opnieuw.' }}
      onError={() => {}}
    >
      <QueryClientProvider client={queryClient}>
        <AssistantDeploymentCard
          deployment={{ enabled: true, respond: false }}
          onChange={() => {}}
        />
      </QueryClientProvider>
    </IntlProvider>
  )

  fireEvent.click(screen.getByRole('button', { name: 'Enable automatic replies' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Enable replies' }))

  // The confirm dialog stays open on failure, so the card behind it is aria-hidden.
  const alert = await screen.findByRole('alert', { hidden: true })
  expect(alert).toHaveTextContent('Wijzigen mislukt. Probeer het opnieuw.')
  expect(alert).toHaveClass('text-destructive')
})

it('keeps a successful change a polite status line', async () => {
  vi.mocked(updateWidgetAssistantDeploymentFn).mockResolvedValueOnce(undefined as never)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>
        <AssistantDeploymentCard
          deployment={{ enabled: true, respond: false }}
          onChange={() => {}}
        />
      </QueryClientProvider>
    </IntlProvider>
  )

  fireEvent.click(screen.getByRole('button', { name: 'Enable automatic replies' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Enable replies' }))

  const status = await screen.findByRole('status')
  expect(status).toHaveTextContent('Automatic replies are enabled in Messenger.')
  expect(status).toHaveClass('text-muted-foreground')
  expect(screen.queryByRole('alert', { hidden: true })).not.toBeInTheDocument()
})
