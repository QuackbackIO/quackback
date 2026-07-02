// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PortalTicketThreadFeed, type PortalThread } from '../portal-ticket-thread-feed'

type AttachmentState = {
  data?: Array<{ id: string; filename: string }>
  isLoading?: boolean
  isError?: boolean
}

const mocks = vi.hoisted(() => ({
  uploadImage: vi.fn(),
  attachmentsByThread: {} as Record<string, AttachmentState>,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    const threadId = String(options.queryKey[2])
    const state = mocks.attachmentsByThread[threadId] ?? {}
    return {
      data: state.data,
      isLoading: state.isLoading ?? false,
      isError: state.isError ?? false,
    }
  },
}))

vi.mock('react-intl', () => ({
  FormattedMessage: ({ defaultMessage }: { id: string; defaultMessage: string }) => (
    <>{defaultMessage}</>
  ),
  useIntl: () => ({
    formatMessage: ({ defaultMessage }: { id: string; defaultMessage: string }) => defaultMessage,
  }),
}))

vi.mock('date-fns', () => ({
  formatDistanceToNow: (date: Date) => `distance:${date.toISOString()}`,
}))

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextContent: ({ content, className }: { content: { type: string }; className?: string }) => (
    <div data-class-name={className}>rich:{content.type}</div>
  ),
  RichTextEditor: ({
    placeholder,
    onChange,
    onImageUpload,
  }: {
    value?: unknown
    onChange: (json: { type: string }, html: string, markdown: string) => void
    placeholder: string
    minHeight?: string
    features?: Record<string, boolean>
    onImageUpload?: (file: File) => Promise<unknown>
  }) => (
    <div>
      <div>{placeholder}</div>
      <button
        type="button"
        onClick={() => onChange({ type: 'doc' }, '<p>Updated</p>', 'Updated markdown')}
      >
        Change draft
      </button>
      <button
        type="button"
        onClick={() => onImageUpload?.(new File(['image'], 'image.png', { type: 'image/png' }))}
      >
        Upload image
      </button>
    </div>
  ),
  isRichTextContent: (value: unknown) =>
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type?: unknown }).type === 'doc',
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = 'button',
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    size?: string
    variant?: string
    className?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('lucide-react', () => ({
  Pencil: () => <span aria-hidden="true">pencil</span>,
}))

vi.mock('@/components/tickets/ticket-attachments', () => ({
  TicketAttachments: ({
    attachments,
    isLoading,
  }: {
    attachments: Array<{ id: string; filename: string }>
    isLoading: boolean
  }) => (
    <div>
      {isLoading
        ? 'Loading attachments'
        : `Attachments:${attachments.map((a) => a.filename).join(',')}`}
    </div>
  ),
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

function thread(overrides: Partial<PortalThread>): PortalThread {
  return {
    id: 'thread_1' as never,
    ticketId: 'ticket_1' as never,
    principalId: 'principal_viewer' as never,
    bodyJson: null,
    bodyText: 'Plain reply',
    createdAt: new Date('2026-06-18T12:00:00.000Z'),
    editedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.attachmentsByThread = {}
  mocks.uploadImage.mockResolvedValue({ url: 'https://example.com/image.png' })
})

describe('PortalTicketThreadFeed', () => {
  it('renders a no-replies empty state when there is no description or edit callback', () => {
    render(<PortalTicketThreadFeed threads={[]} principalNames={{}} viewerPrincipalId={null} />)

    expect(screen.getByText('No replies yet.')).toBeInTheDocument()
  })

  it('adds and edits the ticket description using rich-text drafts', () => {
    const onDescriptionUpdate = vi.fn()
    const { rerender } = render(
      <PortalTicketThreadFeed
        threads={[]}
        principalNames={{}}
        viewerPrincipalId={'principal_viewer' as never}
        description={null}
        onDescriptionUpdate={onDescriptionUpdate}
      />
    )

    fireEvent.click(screen.getByText('+ Add a description…'))
    expect(screen.getByText('Add a description…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onDescriptionUpdate).toHaveBeenCalledWith({ type: 'doc' }, 'Updated markdown')
    expect(mocks.uploadImage).toHaveBeenCalledTimes(1)

    onDescriptionUpdate.mockClear()
    rerender(
      <PortalTicketThreadFeed
        threads={[]}
        principalNames={{}}
        viewerPrincipalId={'principal_viewer' as never}
        description={{ text: 'Existing plain description', json: null }}
        onDescriptionUpdate={onDescriptionUpdate}
      />
    )

    expect(screen.getByText('Existing plain description')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Existing plain description')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Change draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onDescriptionUpdate).toHaveBeenCalledWith({ type: 'doc' }, 'Updated markdown')
  })

  it('renders rich descriptions and disables save actions while a description is saving', () => {
    render(
      <PortalTicketThreadFeed
        threads={[]}
        principalNames={{}}
        viewerPrincipalId={'principal_viewer' as never}
        description={{ text: null, json: { type: 'doc' } }}
        onDescriptionUpdate={vi.fn()}
        isDescriptionSaving
      />
    )

    expect(screen.getByText('rich:doc')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  })

  it('labels viewer and support replies, shows edited state and loads attachments', () => {
    mocks.attachmentsByThread = {
      thread_viewer: {
        data: [{ id: 'attachment_1', filename: 'screen.png' }],
      },
      thread_support: {
        data: [],
      },
      thread_loading: {
        isLoading: true,
      },
      thread_error: {
        isError: true,
      },
    }

    render(
      <PortalTicketThreadFeed
        threads={[
          thread({
            id: 'thread_viewer' as never,
            principalId: 'principal_viewer' as never,
            bodyJson: { type: 'doc' },
            bodyText: 'Viewer reply',
          }),
          thread({
            id: 'thread_support' as never,
            principalId: 'principal_staff' as never,
            bodyText: 'Staff reply',
            editedAt: new Date('2026-06-18T12:30:00.000Z'),
          }),
          thread({
            id: 'thread_loading' as never,
            principalId: null,
            bodyText: 'Masked support reply',
          }),
          thread({
            id: 'thread_error' as never,
            principalId: null,
            bodyText: 'No attachment render',
          }),
        ]}
        principalNames={{ principal_viewer: 'Viewer Name', principal_staff: 'Staff Name' }}
        viewerPrincipalId={'principal_viewer' as never}
      />
    )

    expect(screen.getByLabelText('Reply from You')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Reply from Support team')).toHaveLength(3)
    expect(screen.getByText('rich:doc')).toBeInTheDocument()
    expect(screen.getByText('Staff reply')).toBeInTheDocument()
    expect(screen.getByText('(edited)')).toBeInTheDocument()
    expect(screen.getAllByText(/distance:2026-06-18T12:00:00.000Z/)).toHaveLength(4)
    expect(screen.getByText('Attachments:screen.png')).toBeInTheDocument()
    expect(screen.getByText('Loading attachments')).toBeInTheDocument()
  })
})
