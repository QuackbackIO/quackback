// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import messages from '@/locales/en.json'
const state = vi.hoisted(() => ({ manage: vi.fn(), get: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/server/functions/support-agents', () => ({
  manageSupportAgentFn: state.manage,
  getSupportAgentConfigFn: state.get,
  getAnsweringFn: vi.fn(),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useFeatureFlags: () => ({ ownAgent: true }),
}))
vi.mock('@/lib/client/hooks/use-sign-in-again', () => ({
  useSignInAgain: () => ({ request: state.request, dialog: {} }),
}))
vi.mock('@/components/auth/sign-in-again-dialog', () => ({ SignInAgainDialog: () => null }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
import { OwnAgentSettings } from '../own-agent-settings'
const agent = {
  id: 'support_agent_1',
  name: 'Acme AI',
  kind: 'external' as const,
  status: 'active' as const,
  endpointUrl: 'https://agent.acme.test/turn',
  credentialPrefix: 'qba_123',
  replyDeadlineSeconds: 20,
  fallback: 'team' as const,
  lastDeliveredAt: null,
  lastError: null,
}
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <IntlProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <OwnAgentSettings />
      </QueryClientProvider>
    </IntlProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  state.get.mockResolvedValue({ agent: null, answering: { mode: 'quackback_ai' } })
})
async function fill() {
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme AI' } })
  fireEvent.change(screen.getByLabelText(/Webhook URL/), {
    target: { value: 'https://agent.acme.test/turn' },
  })
}
it('preserves a failed registration draft', async () => {
  state.manage.mockRejectedValue(new Error('Registration failed'))
  mount()
  await fill()
  fireEvent.click(screen.getByRole('button', { name: 'Connect agent' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Registration failed')
  expect(screen.getByLabelText('Name')).toHaveValue('Acme AI')
  expect(screen.getByLabelText(/Webhook URL/)).toHaveValue('https://agent.acme.test/turn')
})
it('shows newly issued secrets once and clears them when Done is pressed', async () => {
  state.manage.mockResolvedValue({
    ok: true,
    agent,
    credential: 'qba_one_time',
    signingSecret: 'whsec_one_time',
  })
  state.get
    .mockResolvedValueOnce({ agent: null, answering: { mode: 'quackback_ai' } })
    .mockResolvedValue({ agent, answering: { mode: 'quackback_ai' } })
  mount()
  await fill()
  fireEvent.click(screen.getByRole('button', { name: 'Connect agent' }))
  expect(await screen.findByText('qba_one_time')).toBeInTheDocument()
  expect(screen.getByText('whsec_one_time')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByText('qba_one_time')).not.toBeInTheDocument()
})
it('requests verified sign-in before retrying a credential change', async () => {
  state.manage.mockResolvedValue({
    ok: false,
    code: 'RECENT_SIGN_IN_REQUIRED',
    message: 'Sign in again',
  })
  mount()
  await fill()
  fireEvent.click(screen.getByRole('button', { name: 'Connect agent' }))
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(expect.stringMatching(/^own-agent:/))
  )
  expect(state.manage).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('Name')).toHaveValue('Acme AI')
})
it('requires a separate confirmation before removing the registered agent', async () => {
  state.get.mockResolvedValue({ agent, answering: { mode: 'quackback_ai' } })
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Remove agent' }))
  expect(state.manage).not.toHaveBeenCalled()
  expect(screen.getAllByRole('button', { name: 'Remove agent' })).toHaveLength(2)
})
