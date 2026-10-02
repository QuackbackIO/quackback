// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { ComposerAttachmentTray } from '../composer-attachment-tray'
import type { ComposerAttachmentItem } from '@/lib/client/hooks/use-conversation-composer-attachments'

const open = vi.fn()
vi.mock('@/components/shared/files/file-viewer-context', () => ({
  useFileViewer: () => ({ open }),
}))

function render(node: React.ReactNode, messages: Record<string, string> = {}, locale = 'en-US') {
  return rtlRender(
    <IntlProvider locale={locale} messages={messages}>
      {node}
    </IntlProvider>
  )
}

function item(overrides: Partial<ComposerAttachmentItem> = {}): ComposerAttachmentItem {
  return {
    localId: 'att_1',
    name: 'report.pdf',
    size: 1024,
    family: 'pdf',
    status: 'ready',
    progress: 1,
    file: {
      fileId: 'file_1',
      url: '/api/storage/files/report.pdf',
      name: 'report.pdf',
      contentType: 'application/pdf',
      size: 1024,
      family: 'pdf',
    },
    ...overrides,
  }
}

describe('ComposerAttachmentTray', () => {
  it('renders nothing for an empty tray', () => {
    const { container } = render(
      <ComposerAttachmentTray items={[]} onRemove={vi.fn()} onRetry={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the file size once a tile is ready', () => {
    render(<ComposerAttachmentTray items={[item()]} onRemove={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('1 KB')).toBeInTheDocument()
  })

  it('opens the viewer on a ready file tile, with every ready tile as the gallery', () => {
    open.mockClear()
    const image = item({
      localId: 'att_img',
      name: 'shot.png',
      family: 'image',
      file: {
        fileId: 'file_img',
        url: '/api/storage/files/shot.png',
        name: 'shot.png',
        contentType: 'image/png',
        size: 10,
        family: 'image',
      },
    })
    const uploading = item({
      localId: 'att_up',
      name: 'still-going.pdf',
      status: 'uploading',
      progress: 0.5,
      file: undefined,
    })
    render(
      <ComposerAttachmentTray
        items={[image, item(), uploading]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open report.pdf' }))
    expect(open).toHaveBeenCalledTimes(1)
    const [files, index] = open.mock.calls[0]!
    // Only the two ready tiles form the gallery; the still-uploading one
    // carries no file yet and is left out.
    expect(files.map((f: { name: string }) => f.name)).toEqual(['shot.png', 'report.pdf'])
    expect(index).toBe(1)
  })

  it('does not open the viewer from an uploading or failed tile', () => {
    open.mockClear()
    render(
      <ComposerAttachmentTray
        items={[item({ status: 'uploading', progress: 0.2, file: undefined })]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Open report.pdf' })).not.toBeInTheDocument()
    expect(open).not.toHaveBeenCalled()
  })

  it('renders an uploading tile with a progress bar instead of a size', () => {
    render(
      <ComposerAttachmentTray
        items={[item({ status: 'uploading', progress: 0.4, file: undefined })]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />
    )
    expect(screen.queryByText('1 KB')).not.toBeInTheDocument()
    const bar = document.querySelector('[data-progress]')
    expect(bar).not.toBeNull()
    expect(bar?.getAttribute('data-progress')).toBe('40')
  })

  it('renders an image tile as a thumbnail using the local preview while uploading', () => {
    render(
      <ComposerAttachmentTray
        items={[
          item({
            family: 'image',
            name: 'shot.png',
            status: 'uploading',
            file: undefined,
            previewUrl: 'blob:shot.png',
          }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />
    )
    const img = screen.getByRole('img', { name: 'shot.png' })
    expect(img).toHaveAttribute('src', 'blob:shot.png')
  })

  it('switches an image tile to the server URL once ready', () => {
    const { container } = render(
      <ComposerAttachmentTray
        items={[
          item({
            family: 'image',
            name: 'shot.png',
            previewUrl: 'blob:shot.png',
            file: {
              fileId: 'file_1',
              url: '/api/storage/files/shot.png',
              name: 'shot.png',
              contentType: 'image/png',
              size: 10,
              family: 'image',
            },
          }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />
    )
    // Ready, so the image sits inside the "Open shot.png" button, which
    // already carries the accessible name; the <img> itself goes decorative.
    expect(screen.getByRole('button', { name: 'Open shot.png' })).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/storage/files/shot.png')
  })

  it('shows the error text on a failed tile and offers Retry only when retryable', () => {
    render(
      <ComposerAttachmentTray
        items={[
          item({
            localId: 'att_err_1',
            name: 'huge.csv',
            family: 'csv',
            status: 'error',
            file: undefined,
            error: 'Over 25 MB',
            retryable: false,
          }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />
    )
    expect(screen.getByText('Over 25 MB')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it('offers Retry on a network-failure tile and calls onRetry with its id', () => {
    const onRetry = vi.fn()
    render(
      <ComposerAttachmentTray
        items={[
          item({
            localId: 'att_err_2',
            name: 'flaky.txt',
            family: 'text',
            status: 'error',
            file: undefined,
            error: 'Upload failed',
            retryable: true,
          }),
        ]}
        onRemove={vi.fn()}
        onRetry={onRetry}
      />
    )
    screen.getByRole('button', { name: /retry/i }).click()
    expect(onRetry).toHaveBeenCalledWith('att_err_2')
  })

  it('shows the cap notice as a single line, not a file tile', () => {
    const onRemove = vi.fn()
    render(
      <ComposerAttachmentTray
        items={[
          item(),
          item({
            localId: 'cap_1',
            name: '',
            size: 0,
            family: 'other',
            status: 'error',
            file: undefined,
            errorReason: 'cap',
            retryable: false,
          }),
        ]}
        onRemove={onRemove}
        onRetry={vi.fn()}
      />
    )
    expect(screen.getByText('You can attach up to 10 files')).toBeInTheDocument()
    // No badge/name/retry chrome for the notice — it is text, not a tile.
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    screen.getByRole('button', { name: /dismiss/i }).click()
    expect(onRemove).toHaveBeenCalledWith('cap_1')
  })

  it('removes a tile via its accessible remove button', () => {
    const onRemove = vi.fn()
    render(<ComposerAttachmentTray items={[item()]} onRemove={onRemove} onRetry={vi.fn()} />)
    screen.getByRole('button', { name: /remove report\.pdf/i }).click()
    expect(onRemove).toHaveBeenCalledWith('att_1')
  })

  describe('error reason mapping', () => {
    it('maps a too_large reason to a localized message instead of the raw server text', () => {
      render(
        <ComposerAttachmentTray
          items={[
            item({
              name: 'huge.csv',
              family: 'csv',
              status: 'error',
              file: undefined,
              error: 'Over 25.0 MB', // the raw server text, deliberately different
              errorReason: 'too_large',
              retryable: false,
            }),
          ]}
          onRemove={vi.fn()}
          onRetry={vi.fn()}
        />
      )
      expect(screen.getByText('Over 25 MB')).toBeInTheDocument()
      expect(screen.queryByText('Over 25.0 MB')).not.toBeInTheDocument()
    })

    it('maps empty and blocked reasons to their localized messages', () => {
      render(
        <ComposerAttachmentTray
          items={[
            item({
              localId: 'a',
              name: 'empty.txt',
              status: 'error',
              file: undefined,
              error: 'server said something else',
              errorReason: 'empty',
              retryable: false,
            }),
            item({
              localId: 'b',
              name: 'blocked.exe',
              status: 'error',
              file: undefined,
              error: 'server said something else',
              errorReason: 'blocked',
              retryable: false,
            }),
          ]}
          onRemove={vi.fn()}
          onRetry={vi.fn()}
        />
      )
      expect(screen.getByText('The file is empty')).toBeInTheDocument()
      expect(screen.getByText("This file type can't be sent")).toBeInTheDocument()
    })

    it('maps a rate_limited reason to a localized message instead of the raw server text', () => {
      render(
        <ComposerAttachmentTray
          items={[
            item({
              name: 'shot.png',
              family: 'image',
              status: 'error',
              file: undefined,
              error: 'Too many uploads, slow down',
              errorReason: 'rate_limited',
              retryable: true,
            }),
          ]}
          onRemove={vi.fn()}
          onRetry={vi.fn()}
        />
      )
      expect(screen.getByText('Too many uploads. Try again in a minute.')).toBeInTheDocument()
      expect(screen.queryByText('Too many uploads, slow down')).not.toBeInTheDocument()
    })

    it('falls back to the raw message for an unrecognized or missing reason', () => {
      render(
        <ComposerAttachmentTray
          items={[
            item({
              name: 'flaky.txt',
              family: 'text',
              status: 'error',
              file: undefined,
              error: 'connection reset',
              errorReason: undefined,
              retryable: true,
            }),
          ]}
          onRemove={vi.fn()}
          onRetry={vi.fn()}
        />
      )
      expect(screen.getByText('connection reset')).toBeInTheDocument()
    })

    it('renders the too_large message in German when the viewer locale is German', () => {
      render(
        <ComposerAttachmentTray
          items={[
            item({
              name: 'huge.csv',
              family: 'csv',
              status: 'error',
              file: undefined,
              error: 'Over 25.0 MB',
              errorReason: 'too_large',
              retryable: false,
            }),
          ]}
          onRemove={vi.fn()}
          onRetry={vi.fn()}
        />,
        { 'files.upload.error.tooLarge': 'Über {size} MB' },
        'de'
      )
      expect(screen.getByText('Über 25 MB')).toBeInTheDocument()
    })
  })
})
