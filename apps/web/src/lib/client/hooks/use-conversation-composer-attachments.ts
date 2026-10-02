import { useCallback, useRef, useState } from 'react'
import type { ConversationAttachment, UploadedFile } from '@/lib/shared/conversation/types'
import { MAX_CONVERSATION_ATTACHMENTS } from '@/lib/shared/conversation/types'
import { familyFor, type FileFamily } from '@/lib/shared/files/file-types'
import { checkFileBeforeUpload, UploadError } from '@/lib/client/files/upload-file'

/** A tray tile. `error`/`retryable` only matter while `status === 'error'`;
 *  `file`/`previewUrl` are populated once there is something to show. */
export interface ComposerAttachmentItem {
  localId: string
  name: string
  size: number
  family: FileFamily
  status: 'uploading' | 'ready' | 'error'
  /** 0..1. Meaningless once the item leaves 'uploading'. */
  progress: number
  /** The server's (or the pre-check's) English message — the tray only shows
   *  it verbatim when `errorReason` is absent or not one it recognizes. */
  error?: string
  /** `UploadError.reason` (empty | too_large | blocked | rate_limited) when
   *  the rejection is definitive, so the tray can show a localized message
   *  instead of `error`. Undefined for a transient failure (network,
   *  abort-adjacent, a 500) or a reason the tray doesn't have a translation
   *  for. `cap` marks the one synthetic notice tile `addFiles` adds when a
   *  file is refused for being over the attachment cap — it never carries a
   *  real file (`file`/`previewUrl` stay unset) and never counts toward the
   *  cap itself. */
  errorReason?: string
  /** False for a definitive rejection (too large, blocked type, empty) — the
   *  tray only offers Retry when a failure might succeed on a second try. */
  retryable?: boolean
  file?: UploadedFile
  /** Local object URL for an image thumbnail, live until the server's own URL
   *  takes over (or the item is removed). */
  previewUrl?: string
}

export type ComposerUploadFn = (
  file: File,
  opts: { onProgress: (progress: number) => void; signal: AbortSignal }
) => Promise<UploadedFile>

export interface UseConversationComposerAttachmentsOptions {
  /** An extra rejection run after the universal size/empty checks — e.g. the
   *  widget's blocked-extension check for an anonymous visitor. Returning an
   *  UploadError skips the upload entirely, same as the universal checks. */
  precheck?: (file: File) => UploadError | null
}

let nextLocalId = 0
function createLocalId(): string {
  nextLocalId += 1
  return `att_${nextLocalId}`
}

function toAttachment(file: UploadedFile): ConversationAttachment {
  return {
    fileId: file.fileId,
    url: file.url,
    name: file.name,
    contentType: file.contentType,
    size: file.size,
    family: file.family,
  }
}

function makeItem(file: File, previewUrl: string | undefined): ComposerAttachmentItem {
  return {
    localId: createLocalId(),
    name: file.name,
    size: file.size,
    family: familyFor(file.name, file.type),
    status: 'uploading',
    progress: 0,
    previewUrl,
  }
}

/** The one tile `addFiles` shows when it refuses files for being over the
 *  cap — not a real file, so it carries no size/progress worth showing and
 *  is never retryable. */
function makeCapNoticeItem(): ComposerAttachmentItem {
  return {
    localId: createLocalId(),
    name: '',
    size: 0,
    family: 'other',
    status: 'error',
    progress: 0,
    errorReason: 'cap',
    retryable: false,
  }
}

/**
 * Manages pending attachments for a conversation composer: stages every added
 * file as a tray tile immediately (so progress/errors render per-file), runs
 * it through the injected `upload` fn, and tracks the result.
 *
 * `uploading` is true while any tile is still uploading (not an in-flight
 * count), so two overlapping paste/drops keep Send disabled until both land.
 * Slot math also reserves files already uploading so two near-cap pastes
 * cannot both claim the last seat — a file's reservation is released exactly
 * once, when ITS OWN upload settles, never on a retry (a retry re-runs an
 * existing tile, it never claims a new slot). `clear` bumps a generation so a
 * dialog reset drops in-flight results instead of leaking them onto the next
 * compose, and aborts every in-flight request. A failed upload stays as an
 * error tile (never dropped, never sent) until the person removes it or
 * retries it; `retry` only makes sense for a transient failure, so the hook
 * marks each failure `retryable` based on whether it carries a definitive
 * server/pre-check reason.
 */
export function useConversationComposerAttachments(
  upload: ComposerUploadFn,
  options: UseConversationComposerAttachmentsOptions = {}
) {
  const { precheck } = options
  const [items, setItems] = useState<ComposerAttachmentItem[]>([])
  const generationRef = useRef(0)
  // The authoritative slot count: every real tile `addFiles` stages counts
  // here the instant it's queued, and the count only drops on remove/clear —
  // never when an upload settles, since the tile still occupies a slot
  // whether it ends up ready or failed. Kept separate from `items.length`
  // (which lags a render behind a synchronous state update, and which also
  // includes the cap-notice tile below, never a real slot) so two addFiles
  // calls in the same tick, or a call made before React has re-rendered the
  // last one, both see the true count instead of double- or under-counting
  // tiles that are still uploading.
  const countRef = useRef(0)
  // The original File per tile (kept for the lifetime of the tile, so a
  // failed upload can be retried) and the controller for whichever attempt is
  // currently in flight (replaced on retry, so remove() aborts the live one).
  const filesRef = useRef(new Map<string, File>())
  const controllersRef = useRef(new Map<string, AbortController>())

  const patchItem = useCallback((localId: string, patch: Partial<ComposerAttachmentItem>) => {
    setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, ...patch } : it)))
  }, [])

  const runUpload = useCallback(
    (localId: string, file: File, generation: number): Promise<void> => {
      const failure = checkFileBeforeUpload(file) ?? precheck?.(file) ?? null
      if (failure) {
        patchItem(localId, {
          status: 'error',
          error: failure.message,
          errorReason: failure.reason,
          retryable: !failure.reason,
        })
        return Promise.resolve()
      }
      const controller = new AbortController()
      controllersRef.current.set(localId, controller)
      return upload(file, {
        onProgress: (progress) => {
          if (generationRef.current !== generation) return
          patchItem(localId, { progress })
        },
        signal: controller.signal,
      }).then(
        (uploaded) => {
          controllersRef.current.delete(localId)
          if (generationRef.current !== generation) return
          patchItem(localId, {
            status: 'ready',
            progress: 1,
            file: uploaded,
            error: undefined,
            errorReason: undefined,
            retryable: undefined,
          })
        },
        (err: unknown) => {
          controllersRef.current.delete(localId)
          if (generationRef.current !== generation) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          const message = err instanceof Error ? err.message : 'Upload failed'
          const errorReason = err instanceof UploadError ? err.reason : undefined
          const retryable = !(err instanceof UploadError && !!err.reason)
          patchItem(localId, { status: 'error', error: message, errorReason, retryable })
        }
      )
    },
    [upload, precheck, patchItem]
  )

  const addFiles = useCallback(
    (files: FileList | File[]): Promise<void> => {
      const generation = generationRef.current
      const incoming = Array.from(files)
      const slotsLeft = Math.max(0, MAX_CONVERSATION_ATTACHMENTS - countRef.current)
      const list = incoming.slice(0, slotsLeft)
      const refused = incoming.length - list.length

      const newItems = list.map((file) => {
        const previewUrl =
          familyFor(file.name, file.type) === 'image' ? URL.createObjectURL(file) : undefined
        const item = makeItem(file, previewUrl)
        filesRef.current.set(item.localId, file)
        return item
      })
      countRef.current += newItems.length

      setItems((prev) => {
        // Drop any earlier cap notice so a repeated refusal shows one line,
        // not a stack of them.
        const withoutCapNotice = prev.filter((it) => it.errorReason !== 'cap')
        const next = [...withoutCapNotice, ...newItems]
        return refused > 0 ? [...next, makeCapNoticeItem()] : next
      })

      if (newItems.length === 0) return Promise.resolve()
      const settled = newItems.map((item, i) => runUpload(item.localId, list[i]!, generation))
      return Promise.all(settled).then(() => undefined)
    },
    [runUpload]
  )

  const retry = useCallback(
    (localId: string): Promise<void> => {
      const file = filesRef.current.get(localId)
      if (!file) return Promise.resolve()
      const generation = generationRef.current
      patchItem(localId, {
        status: 'uploading',
        progress: 0,
        error: undefined,
        errorReason: undefined,
        retryable: undefined,
      })
      return runUpload(localId, file, generation)
    },
    [runUpload, patchItem]
  )

  const remove = useCallback((localId: string) => {
    controllersRef.current.get(localId)?.abort()
    controllersRef.current.delete(localId)
    filesRef.current.delete(localId)
    setItems((prev) => {
      const found = prev.find((it) => it.localId === localId)
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl)
      // The cap notice never claimed a slot, so removing it never frees one.
      if (found && found.errorReason !== 'cap') {
        countRef.current = Math.max(0, countRef.current - 1)
      }
      return prev.filter((it) => it.localId !== localId)
    })
  }, [])

  const clear = useCallback(() => {
    generationRef.current += 1
    countRef.current = 0
    controllersRef.current.forEach((controller) => controller.abort())
    controllersRef.current.clear()
    filesRef.current.clear()
    setItems((prev) => {
      prev.forEach((it) => {
        if (it.previewUrl) URL.revokeObjectURL(it.previewUrl)
      })
      return []
    })
  }, [])

  // Re-populate the composer, e.g. to restore a snapshot after a failed send
  // so the already-uploaded files aren't lost. Replaces the tray wholesale —
  // any abandoned tiles release their resources first.
  const restore = useCallback((attachments: ConversationAttachment[]) => {
    controllersRef.current.forEach((controller) => controller.abort())
    controllersRef.current.clear()
    filesRef.current.clear()
    countRef.current = attachments.length
    setItems((prev) => {
      prev.forEach((it) => {
        if (it.previewUrl) URL.revokeObjectURL(it.previewUrl)
      })
      return attachments.map((a) => {
        const family = a.family ?? familyFor(a.name, a.contentType)
        return {
          localId: createLocalId(),
          name: a.name,
          size: a.size,
          family,
          status: 'ready',
          progress: 1,
          file: {
            fileId: a.fileId ?? '',
            url: a.url,
            name: a.name,
            contentType: a.contentType,
            size: a.size,
            family,
          },
        }
      })
    })
  }, [])

  const uploading = items.some((it) => it.status === 'uploading')
  const hasErrors = items.some((it) => it.status === 'error')
  const attachments = items.flatMap((it) =>
    it.status === 'ready' && it.file ? [toAttachment(it.file)] : []
  )

  return { items, attachments, addFiles, remove, retry, clear, restore, uploading, hasErrors }
}
