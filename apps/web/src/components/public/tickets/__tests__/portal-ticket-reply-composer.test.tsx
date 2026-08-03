// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PortalTicketReplyComposer } from '../portal-ticket-reply-composer'

type ReplyPayload = {
  bodyJson: unknown
  bodyText: string
}

type FetchResponse = {
  ok: boolean
  text: () => Promise<string>
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  ensureQueryData: vi.fn(),
  mutateAsync: vi.fn(),
  uploadImage: vi.fn(),
  fetch: vi.fn(),
  replyPending: false,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
    ensureQueryData: mocks.ensureQueryData,
  }),
}))

vi.mock('react-intl', () => ({
  FormattedMessage: ({ defaultMessage }: { id: string; defaultMessage: string }) => (
    <>{defaultMessage}</>
  ),
  useIntl: () => ({
    formatMessage: ({ defaultMessage }: { id: string; defaultMessage: string }) => defaultMessage,
  }),
}))

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    value,
    placeholder,
    onChange,
    onImageUpload,
  }: {
    value?: unknown
    onChange: (json: unknown) => void
    placeholder: string
    minHeight?: string
    features?: Record<string, boolean>
    onImageUpload?: (file: File) => Promise<unknown>
  }) => (
    <div>
      <div>{placeholder}</div>
      <div>editor-value:{value ? 'set' : 'empty'}</div>
      <button
        type="button"
        onClick={() =>
          onChange({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Hello support' }],
              },
            ],
          })
        }
      >
        Set reply text
      </button>
      <button
        type="button"
        onClick={() =>
          onChange({
            type: 'doc',
            content: [{ type: 'heading', content: [] }],
          })
        }
      >
        Set empty heading
      </button>
      <button
        type="button"
        onClick={() => onImageUpload?.(new File(['image'], 'inline.png', { type: 'image/png' }))}
      >
        Upload inline image
      </button>
    </div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = 'button',
    'aria-busy': ariaBusy,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    size?: string
    variant?: string
    'aria-busy'?: boolean
  }) => (
    <button type={type} disabled={disabled} onClick={onClick} aria-busy={ariaBusy}>
      {children}
    </button>
  ),
}))

vi.mock('lucide-react', () => ({
  Upload: () => <span aria-hidden="true">upload</span>,
  X: () => <span aria-hidden="true">remove</span>,
}))

vi.mock('@/lib/client/queries/portal-tickets', () => ({
  useReplyToMyTicket: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: mocks.replyPending,
  }),
  portalTicketQueries: {
    detail: (ticketId: string) => ({
      queryKey: ['portal-ticket', 'detail', ticketId],
    }),
  },
}))

vi.mock('@/lib/client/queries/tickets', () => ({
  ticketQueries: {
    attachments: (ticketId: string, threadId: string) => ({
      queryKey: ['ticket-attachments', ticketId, threadId],
    }),
  },
}))

vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePortalImageUpload: () => ({
    upload: mocks.uploadImage,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.replyPending = false
  mocks.mutateAsync.mockResolvedValue(undefined)
  mocks.uploadImage.mockResolvedValue({ url: 'https://example.com/inline.png' })
  mocks.ensureQueryData.mockResolvedValue({
    threads: [{ id: 'thread_created' }],
  })
  mocks.fetch.mockResolvedValue({
    ok: true,
    text: async () => '',
  } satisfies FetchResponse)
  vi.stubGlobal('fetch', mocks.fetch)
})

describe('PortalTicketReplyComposer', () => {
  it('renders the closed ticket state without reply controls', () => {
    render(<PortalTicketReplyComposer ticketId={'ticket_1' as never} isClosed />)

    expect(
      screen.getByText('This ticket is closed. Open a new one to follow up.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send reply' })).not.toBeInTheDocument()
  })

  it('keeps send disabled for empty editor content and shows pending state', () => {
    const { rerender } = render(
      <PortalTicketReplyComposer ticketId={'ticket_1' as never} isClosed={false} />
    )

    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Set empty heading' }))
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled()

    mocks.replyPending = true
    fireEvent.click(screen.getByRole('button', { name: 'Set reply text' }))
    rerender(<PortalTicketReplyComposer ticketId={'ticket_1' as never} isClosed={false} />)

    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sending…' })).toHaveAttribute('aria-busy', 'true')
  })

  it('submits a rich-text reply, uploads inline images and resets after success', async () => {
    render(<PortalTicketReplyComposer ticketId={'ticket_1' as never} isClosed={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Upload inline image' }))
    expect(mocks.uploadImage).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Set reply text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        bodyJson: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Hello support' }],
            },
          ],
        },
        bodyText: 'Hello support',
      } satisfies ReplyPayload)
    })
    expect(screen.getByText('editor-value:empty')).toBeInTheDocument()
  })

  it('uploads selected attachments to the created thread and invalidates attachment queries', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      } satisfies FetchResponse)
      .mockResolvedValueOnce({
        ok: false,
        text: async () => 'upload failed',
      } satisfies FetchResponse)

    const { container } = render(
      <PortalTicketReplyComposer ticketId={'ticket_1' as never} isClosed={false} />
    )

    const input = container.querySelector('input[type="file"]')
    expect(input).not.toBeNull()
    fireEvent.change(input!, {
      target: {
        files: [
          new File(['one'], 'one.png', { type: 'image/png' }),
          new File(['two'], 'two.png', { type: 'image/png' }),
        ],
      },
    })
    expect(screen.getByText('Attachments (2)')).toBeInTheDocument()
    expect(screen.getByText('one.png')).toBeInTheDocument()
    expect(screen.getByText('two.png')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '' })[0])
    expect(screen.queryByText('one.png')).not.toBeInTheDocument()
    expect(screen.getByText('Attachments (1)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Set reply text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))

    await waitFor(() => {
      expect(mocks.ensureQueryData).toHaveBeenCalledWith({
        queryKey: ['portal-ticket', 'detail', 'ticket_1'],
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['portal-ticket', 'detail', 'ticket_1'],
    })
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/tickets/ticket_1/threads/thread_created/attachments',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      })
    )
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['ticket-attachments', 'ticket_1', 'thread_created'],
    })
  })

  it('keeps reply failures and best-effort upload failures from escaping the composer', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(new Error('Reply denied'))
    const { rerender } = render(
      <PortalTicketReplyComposer ticketId={'ticket_1' as never} isClosed={false} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Set reply text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalled()
    })
    expect(screen.getByText('editor-value:set')).toBeInTheDocument()

    mocks.mutateAsync.mockResolvedValue(undefined)
    mocks.fetch.mockRejectedValueOnce(new Error('Upload failed'))
    const input = document.querySelector('input[type="file"]')
    fireEvent.change(input!, {
      target: {
        files: [new File(['one'], 'one.png', { type: 'image/png' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalled()
    })
    rerender(<PortalTicketReplyComposer ticketId={'ticket_1' as never} isClosed={false} />)
    expect(screen.getByText('editor-value:empty')).toBeInTheDocument()
  })
})
