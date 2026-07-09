// @vitest-environment happy-dom
import { IntlProvider } from 'react-intl'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TicketAttachments } from '../ticket-attachments'

type Attachment = Parameters<typeof TicketAttachments>[0]['attachments'][number]

function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    id: 'att_1',
    filename: 'report.txt',
    mimeType: 'text/plain',
    sizeBytes: 0,
    publicUrl: 'https://cdn.example.com/report.txt',
    createdAt: '2026-06-20T10:00:00.000Z',
    ...overrides,
  }
}

function renderAttachments(attachments: Attachment[], isLoading = false) {
  return render(
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      <TicketAttachments attachments={attachments} isLoading={isLoading} />
    </IntlProvider>
  )
}

describe('TicketAttachments', () => {
  it('renders loading and empty states without attachment cards', () => {
    const { rerender, container } = render(
      <IntlProvider locale="en" defaultLocale="en" messages={{}}>
        <TicketAttachments attachments={[]} isLoading />
      </IntlProvider>
    )

    expect(screen.getByText('Loading attachments...')).toBeInTheDocument()

    rerender(
      <IntlProvider locale="en" defaultLocale="en" messages={{}}>
        <TicketAttachments attachments={[]} />
      </IntlProvider>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders file metadata, download links and preview controls only for previewable files', () => {
    renderAttachments([
      attachment({
        id: 'image',
        filename: 'screenshot.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
        publicUrl: 'https://cdn.example.com/screenshot.png',
      }),
      attachment({
        id: 'pdf',
        filename: 'invoice.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1048576,
        publicUrl: 'https://cdn.example.com/invoice.pdf',
      }),
      attachment({
        id: 'audio',
        filename: 'call.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 0,
        publicUrl: 'https://cdn.example.com/call.mp3',
      }),
      attachment({
        id: 'zip',
        filename: 'archive.zip',
        mimeType: 'application/zip',
        sizeBytes: 512,
        publicUrl: null,
      }),
    ])

    expect(screen.getByText('Attachments (4)')).toBeInTheDocument()
    expect(screen.getByText('screenshot.png')).toBeInTheDocument()
    expect(screen.getByText('2 KB')).toBeInTheDocument()
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument()
    expect(screen.getByText('1 MB')).toBeInTheDocument()
    expect(screen.getByText('call.mp3')).toBeInTheDocument()
    expect(screen.getByText('0 B')).toBeInTheDocument()
    expect(screen.getByText('archive.zip')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Preview/ })).toHaveLength(2)
    const downloadLinks = screen.getAllByRole('link', { name: /Download/ })
    expect(downloadLinks).toHaveLength(3)
    expect(downloadLinks[0]).toHaveAttribute('download', 'screenshot.png')
  })

  it('toggles image, video, pdf and fallback previews', () => {
    const { container } = renderAttachments([
      attachment({
        id: 'image',
        filename: 'screenshot.png',
        mimeType: 'image/png',
        publicUrl: 'https://cdn.example.com/screenshot.png',
      }),
      attachment({
        id: 'video',
        filename: 'demo.mp4',
        mimeType: 'video/mp4',
        publicUrl: 'https://cdn.example.com/demo.mp4',
      }),
      attachment({
        id: 'pdf',
        filename: 'invoice.pdf',
        mimeType: 'application/pdf',
        publicUrl: 'about:blank',
      }),
      attachment({
        id: 'csv',
        filename: 'export.csv',
        mimeType: 'text/csv',
        publicUrl: 'https://cdn.example.com/export.csv',
      }),
    ])

    const previewButtons = screen.getAllByRole('button', { name: /Preview/ })

    fireEvent.click(previewButtons[0])
    expect(screen.getByAltText('screenshot.png')).toHaveAttribute(
      'src',
      'https://cdn.example.com/screenshot.png'
    )

    fireEvent.click(previewButtons[0])
    expect(screen.queryByAltText('screenshot.png')).not.toBeInTheDocument()

    fireEvent.click(previewButtons[1])
    expect(container.querySelector('video[src="https://cdn.example.com/demo.mp4"]')).not.toBeNull()

    fireEvent.click(previewButtons[2])
    expect(container.querySelector('iframe[title="invoice.pdf"]')).toHaveAttribute(
      'src',
      'about:blank#toolbar=0'
    )

    fireEvent.click(previewButtons[3])
    expect(screen.getByText('Preview not available')).toBeInTheDocument()
  })
})
