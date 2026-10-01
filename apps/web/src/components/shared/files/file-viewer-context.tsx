/**
 * Opening the file viewer from anywhere: a message's cards, a conversation's
 * file list, a composer tray. Surfaces call `useFileViewer().open(files, i)`
 * with every file of the gallery and the one to show first; the provider,
 * mounted once per app root (inbox, widget, portal), owns the single viewer.
 */
import { createContext, useContext, type ReactNode } from 'react'
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

export function FileViewerProvider({ children }: { children: ReactNode }) {
  return <FileViewerContext.Provider value={noop}>{children}</FileViewerContext.Provider>
}
