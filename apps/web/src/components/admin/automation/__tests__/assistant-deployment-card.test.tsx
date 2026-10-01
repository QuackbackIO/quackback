// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { createAutosaveMutationCache } from '@/lib/client/autosave'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

vi.mock('@/lib/client/use-permissions', () => ({ useHasPermission: () => true }))
vi.mock('@/lib/server/functions/assistant-settings', () => ({
  getAssistantSettingsFn: vi.fn(),
  updateAssistantIdentityFn: vi.fn(),
  updateAssistantVoiceFn: vi.fn(),
  updateWidgetAssistantDeploymentFn: vi.fn(),
}))

import { updateWidgetAssistantDeploymentFn } from '@/lib/server/functions/assistant-settings'
import {
  AgentPauseControl,
  useAgentStatusLine,
  type WidgetAssistantDeployment,
} from '../assistant-deployment-card'

afterEach(() => {
  cleanup()
  toastError.mockReset()
  vi.mocked(updateWidgetAssistantDeploymentFn).mockReset()
})

function Harness({
  deployment,
  available,
  onChange = () => {},
}: {
  deployment: WidgetAssistantDeployment
  available?: boolean
  onChange?: (next: WidgetAssistantDeployment) => void
}) {
  const line = useAgentStatusLine(deployment, available)
  return (
    <>
      <p data-testid="line">{line}</p>
      <AgentPauseControl deployment={deployment} available={available} onChange={onChange} />
    </>
  )
}

function renderHarness(props: Parameters<typeof Harness>[0]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    mutationCache: createAutosaveMutationCache(),
  })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>
        <Harness {...props} />
      </QueryClientProvider>
    </IntlProvider>
  )
}

describe('Agent pause control', () => {
  it('offers Pause Agent with a quiet status line while replying', () => {
    renderHarness({ deployment: { enabled: true, respond: true } })
    expect(screen.getByRole('button', { name: 'Pause Agent' })).toBeInTheDocument()
    expect(screen.getByTestId('line')).toHaveTextContent('Replying in Messenger')
  })

  it('offers Resume when paused', () => {
    renderHarness({ deployment: { enabled: true, respond: false } })
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause Agent' })).not.toBeInTheDocument()
    expect(screen.getByTestId('line')).toHaveTextContent('Paused, not replying in Messenger')
  })

  it('explains that Support must be on when it is not', () => {
    function LineOnly() {
      return <p data-testid="line">{useAgentStatusLine({ enabled: true, respond: true }, false)}</p>
    }
    render(
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <LineOnly />
      </IntlProvider>
    )
    expect(screen.getByTestId('line')).toHaveTextContent(/Turn on Support/)
  })

  it('names the Support inbox for a tickets-only workspace', () => {
    function LineOnly() {
      return (
        <p data-testid="line">
          {useAgentStatusLine({ enabled: true, respond: true }, false, true)}
        </p>
      )
    }
    render(
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <LineOnly />
      </IntlProvider>
    )
    expect(screen.getByTestId('line')).toHaveTextContent(/need the Support inbox/)
    expect(screen.getByTestId('line')).not.toHaveTextContent('Replying in Messenger')
  })

  it('pauses after confirming, sending only respond: false', async () => {
    vi.mocked(updateWidgetAssistantDeploymentFn).mockResolvedValueOnce(undefined as never)
    const onChange = vi.fn()
    renderHarness({ deployment: { enabled: true, respond: true }, onChange })
    fireEvent.click(screen.getByRole('button', { name: 'Pause Agent' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(updateWidgetAssistantDeploymentFn).not.toHaveBeenCalled()
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Pause Agent')!
    )
    await waitFor(() =>
      expect(updateWidgetAssistantDeploymentFn).toHaveBeenCalledWith({
        data: { enabled: true, respond: false },
      })
    )
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ enabled: true, respond: false }))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('resumes after confirming, turning both flags on', async () => {
    vi.mocked(updateWidgetAssistantDeploymentFn).mockResolvedValueOnce(undefined as never)
    const onChange = vi.fn()
    renderHarness({ deployment: { enabled: false, respond: false }, onChange })
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Resume')!
    )
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ enabled: true, respond: true }))
  })

  it('shows the one autosave toast on failure and keeps the dialog open', async () => {
    vi.mocked(updateWidgetAssistantDeploymentFn).mockRejectedValueOnce(new Error('boom'))
    const onChange = vi.fn()
    renderHarness({ deployment: { enabled: true, respond: true }, onChange })
    fireEvent.click(screen.getByRole('button', { name: 'Pause Agent' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Pause Agent')!
    )
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again.")
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
