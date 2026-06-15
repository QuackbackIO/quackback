import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { JSONContent } from '@tiptap/react'
import { TicketThreadFeed } from '../ticket-thread-feed'

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
    render(
      <TicketThreadFeed threads={[]} description={{ text: 'Original description', json: null }} />
    )

    expect(screen.getByText('Original description')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })

  it('calls onDescriptionUpdate with edited rich text content', () => {
    const onDescriptionUpdate = vi.fn()
    render(
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
})

describe('TicketThreadFeed author labels', () => {
  it('renders principal display names instead of raw principal IDs', () => {
    render(
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
    render(
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
})
