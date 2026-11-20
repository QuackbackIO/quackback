// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ConversationId, ConversationMessageId } from '@quackback/ids'
import type { FlaggedMessageDTO } from '@/lib/shared/conversation/types'

// The column fetches through a server fn; stub the module so no server code loads.
vi.mock('@/lib/server/functions/conversation', () => ({ listFlaggedMessagesFn: vi.fn() }))

import { SavedMessagesColumn } from '../saved-messages-column'

function flag(id: string, authorName: string, authorViaApi?: boolean): FlaggedMessageDTO {
  return {
    messageId: `conversation_msg_${id}` as ConversationMessageId,
    conversationId: `conversation_${id}` as ConversationId,
    ticketId: null,
    preview: `Preview ${id}`,
    authorName,
    ...(authorViaApi ? { authorViaApi } : {}),
    conversationLabel: 'Priya Sharma',
    flaggedAt: '2026-11-19T10:00:00.000Z',
  }
}

function renderColumn(rows: FlaggedMessageDTO[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['admin', 'inbox', 'flagged'], rows)
  render(
    <IntlProvider locale="en" messages={{}}>
      <QueryClientProvider client={qc}>
        <SavedMessagesColumn selectedId={null} onSelect={vi.fn()} />
      </QueryClientProvider>
    </IntlProvider>
  )
}

afterEach(cleanup)

describe('SavedMessagesColumn via API mark', () => {
  it('marks a saved message an API key wrote under its own name', () => {
    renderColumn([flag('a', 'ops-bot', true)])
    const row = screen.getByRole('button', { name: /ops-bot/ })
    expect(row).toHaveTextContent('via API')
  })

  it('leaves a teammate unmarked', () => {
    renderColumn([flag('b', 'Dana Ivers')])
    expect(screen.getByText('Dana Ivers')).toBeInTheDocument()
    expect(screen.queryByText('via API')).not.toBeInTheDocument()
  })
})
