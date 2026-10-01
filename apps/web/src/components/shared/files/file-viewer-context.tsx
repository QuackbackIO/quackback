/**
 * Opening the file viewer from anywhere: a message's cards, a conversation's
 * file list, a composer tray. Surfaces call `useFileViewer().open(files, i)`
 * with every file of the gallery and the one to show first; the provider,
 * mounted once per app root (inbox, widget, portal), owns the single viewer.
 *
 * The viewer itself is a lazy chunk: a surface pays for it only once someone
 * opens a file.
 */
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { ViewerFile } from './types'

export interface FileViewerApi {
  /** Show `files[index]`, with the rest of `files` one arrow key away. */
  open: (files: ViewerFile[], index: number) => void
}

const noop: FileViewerApi = { open: () => {} }

export const FileViewerContext = createContext<FileViewerApi>(noop)

export function useFileViewer(): FileViewerApi {
  return useContext(FileViewerContext)
}

const FileViewer = lazy(() => import('./file-viewer'))

interface ViewerSession {
  id: number
  files: ViewerFile[]
  index: number
  opener: HTMLElement | null
  open: boolean
}

/**
 * Scrolls a conversation message into view by its `data-message-id`, for
 * surfaces whose threads mark their messages that way.
 */
export function scrollToMessage(messageId: string): void {
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

export function FileViewerProvider({
  children,
  compact = false,
  onJumpToMessage,
}: {
  children: ReactNode
  /** The widget's full-height sheet instead of a dialog. */
  compact?: boolean
  /** Lets the viewer's header jump back to the message a file came from. */
  onJumpToMessage?: (messageId: string) => void
}) {
  const [session, setSession] = useState<ViewerSession | null>(null)

  const api = useMemo<FileViewerApi>(
    () => ({
      open: (files, index) => {
        if (files.length === 0) return
        const focused = document.activeElement
        setSession((previous) => ({
          id: (previous?.id ?? 0) + 1,
          files,
          index: Math.min(Math.max(0, index), files.length - 1),
          opener: focused instanceof HTMLElement && focused !== document.body ? focused : null,
          open: true,
        }))
      },
    }),
    []
  )

  const close = useCallback(() => {
    setSession((current) => (current ? { ...current, open: false } : current))
  }, [])
  const closed = useCallback(() => {
    setSession((current) => (current && !current.open ? null : current))
  }, [])

  return (
    <FileViewerContext.Provider value={api}>
      {children}
      {session && (
        <Suspense fallback={null}>
          <FileViewer
            key={session.id}
            files={session.files}
            index={session.index}
            open={session.open}
            opener={session.opener}
            compact={compact}
            onJumpToMessage={onJumpToMessage}
            onClose={close}
            onClosed={closed}
          />
        </Suspense>
      )}
    </FileViewerContext.Provider>
  )
}
