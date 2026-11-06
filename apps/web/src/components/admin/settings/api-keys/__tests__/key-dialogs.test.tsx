// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PORTAL_KEY_MESSAGES } from '@/components/settings/api-keys/portal-key-messages'

vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }))

const { RotateApiKeyDialog, RevokeApiKeyDialog } = await import('../key-dialogs')

afterEach(cleanup)

const apiKey = { id: 'api_key_1', name: 'Order export' } as never

function wrap(node: React.ReactNode, messages: Record<string, string> = {}) {
  return render(
    <IntlProvider locale="de" defaultLocale="en" messages={messages} onError={() => {}}>
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </IntlProvider>
  )
}

describe('key dialogs', () => {
  it('shows a refusal in catalogue words, not the server text', async () => {
    const rotate = vi.fn().mockResolvedValue({
      ok: false,
      code: 'GRANT_CEILING',
      message: 'server text: member.manage',
    })
    wrap(
      <RotateApiKeyDialog
        open
        onOpenChange={vi.fn()}
        apiKey={apiKey}
        rotate={rotate}
        onKeyRotated={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Rotate key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can only manage keys whose role you could give.'
    )
  })

  it('reads its words from the set it is given', () => {
    wrap(
      <RevokeApiKeyDialog
        open
        onOpenChange={vi.fn()}
        apiKey={apiKey}
        revoke={vi.fn()}
        messages={PORTAL_KEY_MESSAGES}
      />,
      {
        'portal.settings.apiKeys.revoke.title': 'API-Schlüssel widerrufen',
        'portal.settings.apiKeys.revoke.confirm': 'Schlüssel widerrufen',
      }
    )
    expect(screen.getByText('API-Schlüssel widerrufen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schlüssel widerrufen' })).toBeInTheDocument()
  })
})
