/**
 * Which engine shows which file, and how the shell fetches its bytes. Each
 * engine is its own lazy chunk, so a surface pays for a format's library only
 * when someone opens a file of that format, and the widget's eager bundle
 * carries none of them.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { fileExtension, isPreviewable } from '@/lib/shared/files/file-types'
import type { FetchMode, ViewerEngineProps, ViewerFile } from '../types'

export type EngineKind = 'pdf' | 'document' | 'sheet' | 'text' | 'media' | 'archive'

export const ENGINES: Record<EngineKind, LazyExoticComponent<ComponentType<ViewerEngineProps>>> = {
  pdf: lazy(() => import('./pdf-engine')),
  document: lazy(() => import('./document-engine')),
  sheet: lazy(() => import('./sheet-engine')),
  text: lazy(() => import('./text-engine')),
  media: lazy(() => import('./media-engine')),
  archive: lazy(() => import('./archive-engine')),
}

/** The engine for a file, or null when no browser engine can show it. */
export function engineFor(file: ViewerFile): EngineKind | null {
  if (!isPreviewable(file.name, file.family)) return null
  switch (file.family) {
    case 'pdf':
      return 'pdf'
    case 'document':
      return 'document'
    case 'spreadsheet':
    case 'csv':
      return 'sheet'
    case 'text':
    case 'code':
      return 'text'
    case 'image':
    case 'video':
    case 'audio':
      return 'media'
    case 'archive':
      return fileExtension(file.name) === 'zip' ? 'archive' : null
    default:
      return null
  }
}

export function fetchModeFor(kind: EngineKind): FetchMode {
  if (kind === 'media') return 'none'
  if (kind === 'text') return 'head'
  return 'full'
}

/** Bytes the text engine reads from the head of a file. */
export const TEXT_HEAD_BYTES = 256 * 1024
