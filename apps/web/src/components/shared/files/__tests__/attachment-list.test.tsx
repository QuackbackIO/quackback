// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { AttachmentList } from '../attachment-list'
import { ConversationGalleryProvider, type GalleryMessage } from '../conversation-gallery'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'

function render(node: React.ReactNode) {
  return rtlRender(
    <IntlProvider locale="en-US" messages={{}}>
      {node}
    </IntlProvider>
  )
}

const open = vi.fn()
vi.mock('../file-viewer-context', () => ({
  useFileViewer: () => ({ open }),
}))

function pdf(name: string): ConversationAttachment {
  return { url: `/f/${name}`, name, contentType: 'application/pdf', size: 10, family: 'pdf' }
}
function image(name: string): ConversationAttachment {
  return { url: `/f/${name}`, name, contentType: 'image/png', size: 10, family: 'image' }
}

describe('AttachmentList', () => {
  it("lines attachments up with their own message's side", () => {
    const own = render(<AttachmentList attachments={[pdf('a.pdf')]} align="end" />)
    expect(own.container.firstElementChild!.className).toContain('items-end')
    const peer = render(<AttachmentList attachments={[pdf('a.pdf')]} />)
    expect(peer.container.firstElementChild!.className).toContain('items-start')
  })

  it('renders nothing for an empty list', () => {
    const { container } = render(<AttachmentList attachments={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders images before file cards regardless of input order', () => {
    const { container } = render(<AttachmentList attachments={[pdf('a.pdf'), image('shot.png')]} />)
    const img = container.querySelector('img')
    const card = container.querySelector('[aria-label="Open a.pdf, PDF, 10 B"]')
    expect(img).not.toBeNull()
    expect(card).not.toBeNull()
    // The image row's DOM position precedes the file-cards grid.
    expect(img!.compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('drops unsafe attachment URLs (defense in depth)', () => {
    const { container, queryByText } = render(
      <AttachmentList
        attachments={[
          { url: 'javascript:alert(1)', name: 'x', contentType: 'image/png', size: 0 },
          pdf('safe.pdf'),
        ]}
      />
    )
    expect(container.querySelector('img')).toBeNull()
    expect(queryByText('safe.pdf')).not.toBeNull()
  })

  it('renders a legacy attachment with no family/fileId, deriving the family from name/type', () => {
    const { getByText } = render(
      <AttachmentList
        attachments={[
          { url: '/f/old.pdf', name: 'old.pdf', contentType: 'application/pdf', size: 10 },
        ]}
      />
    )
    expect(getByText('old.pdf')).toBeTruthy()
  })

  it('opens the whole-conversation gallery at this attachment’s global index', () => {
    open.mockClear()
    const messages: GalleryMessage[] = [
      {
        id: 'm1',
        isInternal: false,
        attachments: [pdf('a.pdf')],
        createdAt: '2026-01-01T00:00:00.000Z',
        senderType: 'visitor',
        isAssistant: false,
        author: null,
      },
      {
        id: 'm2',
        isInternal: false,
        attachments: [pdf('b.pdf'), pdf('c.pdf')],
        createdAt: '2026-01-01T00:01:00.000Z',
        senderType: 'agent',
        isAssistant: false,
        author: { displayName: 'Priya' },
      },
    ]
    const { getByLabelText } = render(
      <ConversationGalleryProvider messages={messages}>
        <AttachmentList attachments={messages[1]!.attachments} context={{ messageId: 'm2' }} />
      </ConversationGalleryProvider>
    )
    fireEvent.click(getByLabelText('Open c.pdf, PDF, 10 B'))
    expect(open).toHaveBeenCalledTimes(1)
    const [files, index] = open.mock.calls[0]!
    expect(files.map((f: { name: string }) => f.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])
    expect(index).toBe(2)
  })

  it('without a matching gallery, falls back to just this message’s own attachments', () => {
    open.mockClear()
    const { getByLabelText } = render(
      <AttachmentList
        attachments={[pdf('x.pdf'), pdf('y.pdf')]}
        context={{ messageId: 'orphan', senderName: 'Dana', sentAt: '2026-01-01T00:00:00.000Z' }}
      />
    )
    fireEvent.click(getByLabelText('Open y.pdf, PDF, 10 B'))
    expect(open).toHaveBeenCalledTimes(1)
    const [files, index] = open.mock.calls[0]!
    expect(files.map((f: { name: string }) => f.name)).toEqual(['x.pdf', 'y.pdf'])
    expect(index).toBe(1)
  })

  it('spans a video card across both columns', () => {
    const video: ConversationAttachment = {
      url: '/f/v.mp4',
      name: 'v.mp4',
      contentType: 'video/mp4',
      size: 10,
      family: 'video',
    }
    const { getByLabelText } = render(<AttachmentList attachments={[video]} />)
    const button = getByLabelText('Open v.mp4, Video, 10 B')
    expect(button.closest('.col-span-2')).not.toBeNull()
  })

  it('uses the compact row for non-image files on narrow surfaces', () => {
    const { getByLabelText, queryByText } = render(
      <AttachmentList attachments={[pdf('note.pdf')]} compact />
    )
    expect(getByLabelText('Open note.pdf, PDF, 10 B')).toBeTruthy()
    // FileIconCard/FilePreviewCard don't exist here; FileRow has no "col-span-2".
    expect(queryByText('Contains macros')).toBeNull()
  })
})
