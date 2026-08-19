// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

vi.mock('@/lib/server/functions/assistant-settings', () => ({
  getAssistantSettingsFn: vi.fn(),
  updateAssistantIdentityFn: vi.fn(),
  updateAssistantVoiceFn: vi.fn(),
  updateWidgetAssistantDeploymentFn: vi.fn(),
}))

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
