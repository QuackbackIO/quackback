/**
 * The contract between the file viewer's shell and its format engines.
 *
 * The shell owns everything a person should find the same whatever the format:
 * the header (badge, name, sender, time, size), moving through the gallery,
 * Download, Close, the keyboard, loading, and every failure state. An engine
 * owns only the content area: it renders the file and reports which toolbar
 * controls make sense for it (zoom, pages, find, wrap, a one-line note), and
 * the shell draws them, so the same control looks and behaves the same in
 * every engine.
 */
import type { AttachmentPreview, ConversationAttachment } from '@/lib/shared/conversation/types'
import { familyFor, type FileFamily } from '@/lib/shared/files/file-types'

export interface ViewerFile {
  /** Stable identity within one gallery. */
  key: string
  url: string
  name: string
  contentType: string
  size: number
  family: FileFamily
  fileId?: string
  preview?: AttachmentPreview
  /** Who sent the file, for the header. */
  senderName?: string
  /** ISO time the file was sent. */
  sentAt?: string
  /** The message the file came from, so the header can jump back to it. */
  messageId?: string
}

export function toViewerFile(
  a: ConversationAttachment,
  context: { senderName?: string; sentAt?: string; messageId?: string; index?: number } = {}
): ViewerFile {
  const { index, ...rest } = context
  return {
    key: a.fileId ?? `${a.url}#${index ?? 0}`,
    url: a.url,
    name: a.name || 'File',
    contentType: a.contentType,
    size: a.size,
    family: a.family ?? familyFor(a.name, a.contentType),
    fileId: a.fileId,
    preview: a.preview,
    ...rest,
  }
}

/** Controls an engine offers. The shell renders them in one place, one way. */
export interface EngineToolbar {
  zoom?: { value: number; min: number; max: number; set: (value: number) => void }
  page?: { current: number; total: number; go: (page: number) => void }
  /** Opens the engine's own find bar (Cmd/Ctrl+F routes here). */
  find?: { open: () => void }
  wrap?: { on: boolean; toggle: () => void }
  /** One quiet line of context: "1,248 rows", "16 files · 2.4 MB unpacked". */
  note?: string
}

/**
 * Why an engine could not show a file. The shell turns each into the same
 * fallback (what happened, plus Download), so no engine draws its own error.
 */
export type EngineFailure = 'unsupported' | 'corrupt' | 'too_large' | 'unavailable'

export interface ViewerEngineProps {
  file: ViewerFile
  /**
   * The file's bytes, fetched once by the shell through this origin, or null
   * for engines that load by URL (images, audio, video). For text the shell
   * may hand over only the head of the file; `truncated` says so.
   */
  data: ArrayBuffer | null
  truncated: boolean
  /** Same-origin URL for the bytes, for engines that stream (media). */
  src: string
  onToolbar: (toolbar: EngineToolbar) => void
  onError: (failure: EngineFailure) => void
  /** Narrow surfaces (the widget's sheet): engines drop side rails. */
  compact: boolean
}

/** How the shell gets a file's bytes before handing them to its engine. */
export type FetchMode = 'none' | 'head' | 'full'
