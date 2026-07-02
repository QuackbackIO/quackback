// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TicketThreadComposer } from '../ticket-thread-composer'

type MutationOptions = {
  mutationFn: () => Promise<{ id?: string }>
  onSuccess?: (result: { id?: string }) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  addThreadFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  uploadImage: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useMutation: (options: MutationOptions) => ({
    isPending: false,
    mutate: async () => {
      try {
        const result = await options.mutationFn()
        options.onSuccess?.(result)
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }),
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
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/tabs', () => {
  let changeTab: (value: string) => void = () => undefined

  return {
    Tabs: ({
      children,
      onValueChange,
    }: {
      children: ReactNode
      value: string
      onValueChange: (value: string) => void
      className?: string
    }) => {
      changeTab = onValueChange
      return <div>{children}</div>
    },
    TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ children, value }: { children: ReactNode; value: string }) => (
      <button type="button" onClick={() => changeTab(value)}>
        {children}
      </button>
    ),
  }
})

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({
    onChange,
    placeholder,
    onImageUpload,
  }: {
    onChange: (json: { type: 'doc'; content?: unknown[] }, html: string, markdown: string) => void
    placeholder: string
    onImageUpload?: (file: File) => Promise<unknown>
  }) => (
    <div>
      <textarea
        aria-label={placeholder}
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
      <button
        type="button"
        onClick={() =>
          onChange(
            {
              type: 'doc',
              content: [
                {
                  type: 'heading',
                  content: [{ type: 'text', text: 'From rich json' }],
                },
              ],
            },
            '',
            ''
          )
        }
      >
        Set JSON body
      </button>
      <button type="button" onClick={() => void onImageUpload?.(new File(['image'], 'inline.png'))}>
        Upload inline image
      </button>
    </div>
  ),
}))

vi.mock('@/components/admin/shared/team-picker', () => ({
  TeamPicker: ({ onValueChange }: { onValueChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onValueChange('team_success')}>
      Pick sharing team
    </button>
  ),
}))

vi.mock('@/lib/server/functions/tickets', () => ({
  addThreadFn: mocks.addThreadFn,
}))

vi.mock('@/lib/client/queries/tickets', () => ({
  ticketQueries: {
    attachments: (ticketId: string, threadId: string) => ({
      queryKey: ['tickets', ticketId, 'threads', threadId, 'attachments'],
    }),
    threads: (ticketId: string) => ({ queryKey: ['tickets', ticketId, 'threads'] }),
    detail: (ticketId: string) => ({ queryKey: ['tickets', ticketId, 'detail'] }),
  },
}))

vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: ({ prefix }: { prefix: string }) => ({
    upload: (file: File) => mocks.uploadImage({ prefix, file }),
  }),
}))

vi.mock('lucide-react', () => ({
  X: () => <span>Remove attachment</span>,
  Upload: () => <span>Upload icon</span>,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function renderComposer(props: Partial<React.ComponentProps<typeof TicketThreadComposer>> = {}) {
  return render(
    <TicketThreadComposer
      ticketId={'ticket_1' as never}
      canPublic
      canInternal
      canShared
      {...props}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.addThreadFn.mockResolvedValue({ id: 'ticket_thread_1' })
  mocks.uploadImage.mockResolvedValue({ url: 'https://cdn.test/inline.png' })
  mocks.fetchMock.mockResolvedValue({
    ok: true,
    text: async () => '',
  })
  vi.stubGlobal('fetch', mocks.fetchMock)
})

describe('TicketThreadComposer', () => {
  it('renders a permission-denied state when no audience is allowed', () => {
    renderComposer({ canPublic: false, canInternal: false, canShared: false })

    expect(
      screen.getByText("You don't have permission to reply on this ticket.")
    ).toBeInTheDocument()
  })

  it('posts a public reply and invalidates ticket queries', async () => {
    const onPosted = vi.fn()
    renderComposer({ onPosted })

    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Reply to customer/), {
      target: { value: 'Customer-visible reply' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(mocks.addThreadFn).toHaveBeenCalledWith({
        data: {
          ticketId: 'ticket_1',
          audience: 'public',
          bodyJson: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Customer-visible reply' }],
              },
            ],
          },
          bodyText: 'Customer-visible reply',
          sharedWithTeamId: null,
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['tickets', 'ticket_1', 'threads'],
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['tickets', 'ticket_1', 'detail'],
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tickets', 'list'] })
    expect(onPosted).toHaveBeenCalled()
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Reply posted')
  })

  it('posts an internal note using plain text extracted from rich JSON', async () => {
    renderComposer({ canPublic: false, canShared: false })

    fireEvent.click(screen.getByRole('button', { name: 'Set JSON body' }))
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(mocks.addThreadFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            audience: 'internal',
            bodyText: 'From rich json',
            sharedWithTeamId: null,
          }),
        })
      )
    })
  })

  it('requires a selected team before posting a shared-team note', async () => {
    renderComposer({ canPublic: false, canInternal: false })

    fireEvent.change(screen.getByLabelText(/Visible to your team/), {
      target: { value: 'Shared note' },
    })
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Pick sharing team' }))
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(mocks.addThreadFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            audience: 'shared_team',
            bodyText: 'Shared note',
            sharedWithTeamId: 'team_success',
          }),
        })
      )
    })
  })

  it('uploads selected attachments and reports per-file upload failures', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce({ ok: true, text: async () => '' })
      .mockResolvedValueOnce({ ok: false, text: async () => 'storage down' })
    const { container } = renderComposer()

    fireEvent.change(screen.getByLabelText(/Reply to customer/), {
      target: { value: 'Reply with files' },
    })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [
          new File(['one'], 'one.txt', { type: 'text/plain' }),
          new File(['two'], 'two.txt', { type: 'text/plain' }),
        ],
      },
    })

    expect(screen.getByText('Attachments (2)')).toBeInTheDocument()
    expect(screen.getByText('one.txt')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenCalledTimes(2)
    })
    expect(mocks.fetchMock).toHaveBeenCalledWith(
      '/api/v1/tickets/ticket_1/threads/ticket_thread_1/attachments',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      })
    )
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Failed to upload two.txt: Upload failed: storage down'
    )
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['tickets', 'ticket_1', 'threads', 'ticket_thread_1', 'attachments'],
    })
  })

  it('can remove selected attachments before posting', () => {
    const { container } = renderComposer()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [new File(['one'], 'one.txt'), new File(['two'], 'two.txt')],
      },
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove attachment' })[0])

    expect(screen.queryByText('one.txt')).not.toBeInTheDocument()
    expect(screen.getByText('two.txt')).toBeInTheDocument()
    expect(screen.getByText('Attachments (1)')).toBeInTheDocument()
  })

  it('reports posting failures and wires inline image uploads', async () => {
    mocks.addThreadFn.mockRejectedValueOnce(new Error('Cannot reply to closed ticket'))
    renderComposer()

    fireEvent.click(screen.getByRole('button', { name: 'Upload inline image' }))
    expect(mocks.uploadImage).toHaveBeenCalledWith({
      prefix: 'uploads',
      file: expect.objectContaining({ name: 'inline.png' }),
    })

    fireEvent.change(screen.getByLabelText(/Reply to customer/), {
      target: { value: 'Reply fails' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    expect(await screen.findByText('Post')).toBeInTheDocument()
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Cannot reply to closed ticket')
    })
  })
})
