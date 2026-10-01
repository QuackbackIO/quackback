// @vitest-environment happy-dom
/**
 * The provider every app root mounts: `open(files, index)` shows the one
 * viewer (loaded on first use), and closing it hands focus back.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileViewerProvider, useFileViewer } from '../file-viewer-context'
import type { ViewerFile } from '../types'

const deck: ViewerFile = {
  key: 'deck',
  url: '/api/storage/files/q4.pptx',
  name: 'q4.pptx',
  contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  size: 3_200_000,
  family: 'presentation',
  messageId: 'msg_9',
  senderName: 'Priya',
}
const legacyDoc: ViewerFile = {
  key: 'doc',
  url: '/api/storage/files/notes.doc',
  name: 'notes.doc',
  contentType: 'application/msword',
  size: 48_000,
  family: 'document',
}

function Opener({ files, index }: { files: ViewerFile[]; index: number }) {
  const { open } = useFileViewer()
  return (
    <button type="button" onClick={() => open(files, index)}>
      Open files
    </button>
  )
}

// The provider loads the viewer lazily; transform it once up front so the
// first open in a busy run is not timed against the module transform.
beforeAll(async () => {
  await import('../file-viewer')
})

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 204 }))
  )
  Object.defineProperty(navigator, 'sendBeacon', { value: vi.fn(() => true), configurable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FileViewerProvider', () => {
  it('opens the viewer on the chosen file and restores focus when it closes', async () => {
    render(
      <FileViewerProvider>
        <Opener files={[legacyDoc, deck]} index={1} />
      </FileViewerProvider>
    )
    const opener = screen.getByRole('button', { name: 'Open files' })
    opener.focus()
    fireEvent.click(opener)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('q4.pptx')
    expect(screen.getByText('2 of 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('opens again after closing', async () => {
    render(
      <FileViewerProvider>
        <Opener files={[legacyDoc]} index={0} />
      </FileViewerProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open files' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Open files' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('notes.doc')
  })

  it('shows the widget sheet when compact', async () => {
    render(
      <FileViewerProvider compact>
        <Opener files={[deck]} index={0} />
      </FileViewerProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open files' }))
    expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('passes the jump to the message through to the header', async () => {
    const onJumpToMessage = vi.fn()
    render(
      <FileViewerProvider onJumpToMessage={onJumpToMessage}>
        <Opener files={[deck]} index={0} />
      </FileViewerProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open files' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Priya · 3\.1 MB$/ }))
    expect(onJumpToMessage).toHaveBeenCalledWith('msg_9')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('ignores an empty gallery', async () => {
    render(
      <FileViewerProvider>
        <Opener files={[]} index={0} />
      </FileViewerProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open files' }))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
