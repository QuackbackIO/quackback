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
