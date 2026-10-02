// @vitest-environment happy-dom
/**
 * Coverage for the inbox detail panel's attributes editor: renders one
 * typed control per live definition and shows a visible "AI" badge next to
 * the value for src:'ai' envelopes — the AI attributes parity Phase 1
 * upgrade from hover-only provenance. Other sources keep the hover title and
 * get no badge; once a teammate edit lands (src becomes 'teammate' on
 * refetch), the badge disappears.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversationId } from '@quackback/ids'

const DEFINITIONS = [
  {
    id: 'conversation_attribute_1',
    key: 'issue_type',
    label: 'Issue type',
    description: null,
    fieldType: 'select',
    options: [
      { id: 'opt_billing', label: 'Billing', description: null },
      { id: 'opt_bug', label: 'Bug', description: null },
    ],
    requiredToClose: false,
    sourceHint: null,
    aiDetect: true,
    detectOnClose: false,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'conversation_attribute_2',
    key: 'priority',
    label: 'Priority',
    description: null,
    fieldType: 'text',
    options: null,
    requiredToClose: false,
    sourceHint: null,
    aiDetect: false,
    detectOnClose: false,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
]

const hoisted = vi.hoisted(() => ({
  setConversationAttributeValueFn: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { error: hoisted.toastError } }))

vi.mock('@/lib/server/functions/conversation-attributes', () => ({
  setConversationAttributeValueFn: hoisted.setConversationAttributeValueFn,
}))

vi.mock('@/lib/client/queries/conversation-attributes', () => ({
  conversationAttributeQueries: {
    live: () => ({
      queryKey: ['test', 'conversation-attributes', 'live'],
      queryFn: async () => DEFINITIONS,
    }),
  },
}))

import { ConversationAttributesEditor } from '../conversation-attributes-editor'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <IntlProvider
      locale="fr"
      messages={{ 'conversationAttributes.reservedKey': 'Attribut réservé.' }}
    >
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </IntlProvider>
  )
}

const TARGET = { conversationId: 'conversation_1' as ConversationId }

describe('ConversationAttributesEditor', () => {
  it('localizes a reserved-key refusal without showing its diagnostic message', async () => {
    hoisted.toastError.mockClear()
    hoisted.setConversationAttributeValueFn.mockImplementation(async ({ data }) => {
      expect(data).toEqual({ ...TARGET, key: 'priority', value: 'Acme' })
      throw Object.assign(new Error('Raw diagnostic'), { code: 'ATTRIBUTE_RESERVED' })
    })
    renderWithClient(
      <ConversationAttributesEditor target={TARGET} customAttributes={{}} onChanged={() => {}} />
    )
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'Acme' } })
    fireEvent.blur(input)
    await waitFor(() => expect(hoisted.toastError).toHaveBeenCalledWith('Attribut réservé.'))
    expect(hoisted.toastError).not.toHaveBeenCalledWith('Raw diagnostic')
  })

  it('shows a visible AI badge next to a value written by the AI classifier', async () => {
    renderWithClient(
      <ConversationAttributesEditor
        target={TARGET}
        customAttributes={{
          issue_type: { v: 'opt_billing', src: 'ai', at: '2026-07-01T00:00:00Z' },
        }}
        onChanged={() => {}}
      />
    )

    expect(await screen.findByText('Issue type')).toBeInTheDocument()
    expect(screen.getByText('AI')).toBeInTheDocument()
  })

  it('does not show the AI badge for teammate-set values, keeping the hover title instead', async () => {
    renderWithClient(
      <ConversationAttributesEditor
        target={TARGET}
        customAttributes={{
          issue_type: { v: 'opt_billing', src: 'teammate', at: '2026-07-01T00:00:00Z' },
        }}
        onChanged={() => {}}
      />
    )

    expect(await screen.findByText('Issue type')).toBeInTheDocument()
    expect(screen.queryByText('AI')).not.toBeInTheDocument()
    const row = screen.getByText('Issue type').closest('div')!.parentElement as HTMLElement
    expect(row).toHaveAttribute('title', 'Set by teammate')
  })

  it('does not show a badge for an unset attribute', async () => {
    renderWithClient(
      <ConversationAttributesEditor target={TARGET} customAttributes={{}} onChanged={() => {}} />
    )

    expect(await screen.findByText('Issue type')).toBeInTheDocument()
    expect(screen.queryByText('AI')).not.toBeInTheDocument()
  })
})
