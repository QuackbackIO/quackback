// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { JSONContent } from '@tiptap/react'
import { TicketThreadFeed } from '../ticket-thread-feed'

// Thread rows render a `ThreadAttachmentsLoader` that calls
// `useQuery(ticketQueries.attachments(...))`. Stub the query options so the
// loader resolves to an empty attachment list (and renders nothing) instead of
// hitting a real server function.
vi.mock('@/lib/client/queries/tickets', () => ({
  ticketQueries: {
    attachments: vi.fn((ticketId: string, threadId: string) => ({
      queryKey: ['tickets', ticketId, 'threads', threadId, 'attachments'],
      queryFn: async () => [],
    })),
  },
}))

// TicketAttachments uses react-intl <FormattedMessage>, which needs an
// IntlProvider this test doesn't supply. The attachment list is not under
// test here (these tests assert on author labels), so stub it out.
vi.mock('@/components/tickets/ticket-attachments', () => ({
  TicketAttachments: () => null,
}))

function renderWithClient(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

vi.mock('@/components/ui/rich-text-editor', () => {
  function textFromDoc(content: unknown): string {
    if (!content || typeof content !== 'object') return ''
    let out = ''
    const walk = (node: { type?: string; text?: unknown; content?: unknown[] }) => {
      if (node.type === 'text' && typeof node.text === 'string') out += node.text
      node.content?.forEach((child) => walk(child as never))
    }
    walk(content as never)
    return out
  }

  return {
    isRichTextContent: (content: unknown) =>
      typeof content === 'object' &&
      content !== null &&
      'type' in content &&
      (content as { type?: string }).type === 'doc',
    RichTextContent: ({ content }: { content: unknown }) => (
      <div data-testid="rich-text-content">{textFromDoc(content)}</div>
    ),
    RichTextEditor: ({
      value,
      onChange,
      placeholder,
    }: {
      value?: JSONContent
      onChange: (json: JSONContent, html: string, markdown: string) => void
      placeholder: string
    }) => (
      <textarea
        aria-label={placeholder}
        defaultValue={textFromDoc(value)}
        onChange={(event) => {
          const text = event.currentTarget.value
          onChange(
            {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: text ? [{ type: 'text', text }] : [],
                },
              ],
            },
            '',
            text
          )
        }}
      />
    ),
  }
})

describe('TicketThreadFeed description editing', () => {
  it('renders a read-only description when no update callback is provided', () => {
    renderWithClient(
      <TicketThreadFeed threads={[]} description={{ text: 'Original description', json: null }} />
    )

    expect(screen.getByText('Original description')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })

  it('calls onDescriptionUpdate with edited rich text content', () => {
    const onDescriptionUpdate = vi.fn()
    renderWithClient(
      <TicketThreadFeed threads={[]} description={null} onDescriptionUpdate={onDescriptionUpdate} />
    )

    fireEvent.click(screen.getByRole('button', { name: /add a description/i }))
    fireEvent.change(screen.getByLabelText('Add a description...'), {
      target: { value: 'Updated description' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onDescriptionUpdate).toHaveBeenCalledWith(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Updated description' }],
          },
        ],
      },
      'Updated description'
    )
  })

  it('seeds the editor from plain text when editing an existing description', () => {
    const onDescriptionUpdate = vi.fn()
    renderWithClient(
      <TicketThreadFeed
        threads={[]}
        description={{ text: 'Line one\nLine two', json: null }}
        onDescriptionUpdate={onDescriptionUpdate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(screen.getByLabelText('Add a description...')).toHaveValue('Line oneLine two')
  })

  it('saves existing rich text by deriving fallback plain text from JSON', () => {
    const onDescriptionUpdate = vi.fn()
    const descriptionJson: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'JSON description' }],
        },
      ],
    }

    renderWithClient(
      <TicketThreadFeed
        threads={[]}
        description={{ text: null, json: descriptionJson }}
        onDescriptionUpdate={onDescriptionUpdate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onDescriptionUpdate).toHaveBeenCalledWith(descriptionJson, 'JSON description')
  })

  it('treats media-only rich text as a visible description', () => {
    renderWithClient(
      <TicketThreadFeed
        threads={[]}
        description={{
          text: null,
          json: {
            type: 'doc',
            content: [{ type: 'horizontalRule' }],
          },
        }}
      />
    )

    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.getByTestId('rich-text-content')).toBeInTheDocument()
  })
})

describe('TicketThreadFeed author labels', () => {
  it('renders principal display names instead of raw principal IDs', () => {
    renderWithClient(
      <TicketThreadFeed
        threads={[
          {
            id: 'ticket_thread_1',
            ticketId: 'ticket_1' as never,
            principalId: 'principal_01ktxq7sh1fevtx68ee59xpvx0' as never,
            audience: 'public',
            bodyJson: null,
            bodyText: 'Reply body',
            sharedWithTeamId: null,
            createdAt: '2026-06-12T10:00:00.000Z',
            editedAt: null,
          },
        ]}
        principalNames={{
          principal_01ktxq7sh1fevtx68ee59xpvx0: 'Meli Sunbul',
        }}
      />
    )

    expect(screen.getByText('Meli Sunbul')).toBeInTheDocument()
    expect(screen.queryByText(/principal_01ktxq7/i)).not.toBeInTheDocument()
  })

  it('does not expose raw principal IDs when a display name is missing', () => {
    renderWithClient(
      <TicketThreadFeed
        threads={[
          {
            id: 'ticket_thread_1',
            ticketId: 'ticket_1' as never,
            principalId: 'principal_missing_name' as never,
            audience: 'public',
            bodyJson: null,
            bodyText: 'Reply body',
            sharedWithTeamId: null,
            createdAt: '2026-06-12T10:00:00.000Z',
            editedAt: null,
          },
        ]}
      />
    )

    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByText('principal_missing_name')).not.toBeInTheDocument()
  })

  it('renders audience labels, team names, system authors, and edited markers', () => {
    renderWithClient(
      <TicketThreadFeed
        threads={[
          {
            id: 'ticket_thread_1',
            ticketId: 'ticket_1' as never,
            principalId: null,
            audience: 'internal',
            bodyJson: null,
            bodyText: 'Private note',
            sharedWithTeamId: null,
            createdAt: '2026-06-12T10:00:00.000Z',
            editedAt: '2026-06-12T10:30:00.000Z',
          },
          {
            id: 'ticket_thread_2',
            ticketId: 'ticket_1' as never,
            principalId: 'principal_agent' as never,
            audience: 'shared_team',
            bodyJson: null,
            bodyText: 'Escalated to billing',
            sharedWithTeamId: 'team_billing' as never,
            createdAt: '2026-06-12T11:00:00.000Z',
            editedAt: null,
          },
        ]}
        teamNames={{ team_billing: 'Billing' }}
        principalNames={{ principal_agent: 'Agent Smith' }}
      />
    )

    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getByText('Internal note')).toBeInTheDocument()
    expect(screen.getByText('(edited)')).toBeInTheDocument()
    expect(screen.getByText('Agent Smith')).toBeInTheDocument()
    expect(screen.getByText(/Shared with team/)).toBeInTheDocument()
    expect(screen.getByText(/Billing/)).toBeInTheDocument()
  })
})
