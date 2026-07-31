// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const updateIdentity = vi.fn()
const config = {
  version: 2 as const,
  identity: { name: 'Quinn', avatarUrl: null },
  voice: {
    tone: 'balanced' as const,
    responseLength: 'balanced' as const,
    additionalInstructions: '',
  },
}

vi.mock('@/lib/server/functions/assistant-settings', () => ({
  getAssistantSettingsFn: vi.fn(async () => ({ config, revision: 3, managedFieldPaths: [] })),
  updateAssistantIdentityFn: (input: { data: unknown }) => updateIdentity(input),
  updateAssistantVoiceFn: vi.fn(),
  updateWidgetAssistantDeploymentFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/uploads', () => ({
  getAssistantAvatarUploadUrlFn: vi.fn(),
}))

import { AssistantIdentityCard } from '../assistant-identity-card'

afterEach(() => {
  cleanup()
  updateIdentity.mockReset()
})

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>
        <AssistantIdentityCard />
      </QueryClientProvider>
    </IntlProvider>
  )
}

describe('AssistantIdentityCard', () => {
  it('loads the V2 identity with an upload flow instead of a URL input', async () => {
    renderCard()
    expect(await screen.findByDisplayValue('Quinn')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upload image/ })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Avatar URL/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Avatar URL/i })).not.toBeInTheDocument()
    // No image set yet, so there is nothing to remove.
    expect(screen.queryByRole('button', { name: /Remove image/ })).not.toBeInTheDocument()
  })

  it('uses an explicit save and sends the complete identity with its revision', async () => {
    updateIdentity.mockResolvedValue({
      config: { ...config, identity: { ...config.identity, name: 'Scout' } },
      revision: 4,
    })
    renderCard()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Scout' } })
    expect(updateIdentity).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(updateIdentity).toHaveBeenCalledWith({
        data: {
          expectedRevision: 3,
          identity: { name: 'Scout', avatarUrl: null },
        },
      })
    )
  })
})
