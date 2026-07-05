// @vitest-environment happy-dom
/**
 * Test for the assistant identity card: enable, respond, name, avatar, and AI label toggle
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockUpdateWidgetConfig = vi.fn()

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateWidgetConfig: () => ({
    mutateAsync: mockUpdateWidgetConfig,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

import { AssistantIdentityCard } from '../assistant-identity-card'

afterEach(() => {
  cleanup()
  mockUpdateWidgetConfig.mockClear()
})

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('AssistantIdentityCard', () => {
  const defaultProps = {
    initial: {
      enabled: true,
      respond: false,
      name: 'Quinn',
      avatarUrl: '',
      showAiLabel: false,
    },
  }

  it('renders the assistant identity card with all sections', () => {
    renderWithClient(<AssistantIdentityCard {...defaultProps} />)
    expect(screen.getByText('AI Agent')).toBeInTheDocument()
    expect(screen.getByText('Enable AI agent')).toBeInTheDocument()
  })

  it('displays the name input field', () => {
    renderWithClient(<AssistantIdentityCard {...defaultProps} />)
    const nameInput = screen.getByDisplayValue('Quinn')
    expect(nameInput).toBeInTheDocument()
  })

  it('saves showAiLabel when the toggle is clicked', async () => {
    mockUpdateWidgetConfig.mockResolvedValue({})
    renderWithClient(<AssistantIdentityCard {...defaultProps} />)

    // Find the "Show AI label" switch
    const switches = screen.getAllByRole('switch')
    const showAiLabelSwitch = switches[switches.length - 1] // Last switch should be the AI label toggle

    fireEvent.click(showAiLabelSwitch)

    await waitFor(() => {
      expect(mockUpdateWidgetConfig).toHaveBeenCalledWith({
        messenger: {
          assistant: {
            showAiLabel: true,
          },
        },
      })
    })
  })

  it('displays the Show AI label toggle when assistant is enabled', () => {
    renderWithClient(<AssistantIdentityCard {...defaultProps} />)
    expect(screen.getByText(/Show AI label/i)).toBeInTheDocument()
  })

  it('displays the helper text for the AI label toggle', () => {
    renderWithClient(<AssistantIdentityCard {...defaultProps} />)
    expect(
      screen.getByText(/Adds an AI label after the assistant name/i)
    ).toBeInTheDocument()
  })
})
