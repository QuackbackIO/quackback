// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import messages from '@/locales/en.json'

const state = vi.hoisted(() => ({
  save: vi.fn(),
  get: vi.fn(),
  request: vi.fn(),
  resume: undefined as undefined | ((action: string) => void),
}))
vi.mock('@/lib/server/functions/support-agents', () => ({
  updateAnsweringFn: state.save,
  getAnsweringFn: state.get,
  getSupportAgentConfigFn: vi.fn(),
}))
vi.mock('@/lib/client/hooks/use-sign-in-again', () => ({
  useSignInAgain: ({ onSignedIn }: { onSignedIn: (action: string) => void }) => {
    state.resume = onSignedIn
    return { request: state.request, dialog: {} }
  },
}))
vi.mock('@/components/auth/sign-in-again-dialog', () => ({ SignInAgainDialog: () => null }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
import { AnsweringModeCard } from '../answering-mode-card'

beforeEach(() => {
  vi.resetAllMocks()
  state.get.mockResolvedValue({ mode: 'quackback_ai', ownAgentReady: true })
})
function mount() {
  return render(
    <IntlProvider locale="en" messages={messages}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AnsweringModeCard />
      </QueryClientProvider>
    </IntlProvider>
  )
}
it('preserves a failed answerer choice', async () => {
  state.save.mockRejectedValue(new Error('Save failed'))
  mount()
  fireEvent.click(await screen.findByRole('radio', { name: 'Your AI agent' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed')
  expect(screen.getByRole('radio', { name: 'Your AI agent' })).toBeChecked()
})
it('resumes the exact requested answerer after verified sign-in', async () => {
  state.save.mockResolvedValueOnce({
    ok: false,
    code: 'RECENT_SIGN_IN_REQUIRED',
    message: 'Sign in again',
  })
  state.save.mockResolvedValueOnce({ mode: 'own_agent' })
  mount()
  fireEvent.click(await screen.findByRole('radio', { name: 'Your AI agent' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(state.request).toHaveBeenCalledWith('own-agent-answering:own_agent'))
  fireEvent.click(screen.getByRole('radio', { name: 'Human team' }))
  state.resume?.('own-agent-answering:own_agent')
  await waitFor(() => expect(state.save).toHaveBeenLastCalledWith({ data: { mode: 'own_agent' } }))
})
