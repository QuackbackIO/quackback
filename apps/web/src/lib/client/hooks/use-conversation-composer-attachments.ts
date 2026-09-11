import { useCallback, useRef, useState } from 'react'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'
import { MAX_CONVERSATION_ATTACHMENTS } from '@/lib/shared/conversation/types'

/**
 * Manages pending attachments for a conversation composer: uploads picked files via the
 * provided upload fn (which returns a public URL), tracks them with their
 * name/type/size for the send payload, and exposes add/remove/clear + an
 * uploading flag.
 *
 * `uploading` is an in-flight count (not a boolean flip), so two overlapping
 * paste/drops keep Send disabled until both finish. Slot math also reserves
 * files already uploading so two near-cap pastes cannot both claim the last
 * seat. `clear` bumps a generation so a dialog reset drops in-flight results
 * instead of leaking them onto the next compose. A mixed multi-file pick keeps
 * the files that uploaded; failures stay dropped (the upload fn reports them).
 */
export function useConversationComposerAttachments(upload: (file: File) => Promise<string>) {
  const [pending, setPending] = useState<ConversationAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  // Mirror pending in a ref so addFiles reads the live count (for the remaining
  // slot calculation) without a stale closure or re-creating the callback.
  const pendingRef = useRef<ConversationAttachment[]>([])
  pendingRef.current = pending
  const generationRef = useRef(0)
  const inFlightBatchesRef = useRef(0)
  const reservedSlotsRef = useRef(0)

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      // Only take as many as still fit, so we don't upload files we'd then have
      // to silently drop past the cap. Reserved slots are in-flight files from
      // overlapping addFiles calls that have not landed in `pending` yet.
      const generation = generationRef.current
      const slotsLeft =
        MAX_CONVERSATION_ATTACHMENTS - pendingRef.current.length - reservedSlotsRef.current
      const list = Array.from(files).slice(0, Math.max(0, slotsLeft))
      if (list.length === 0) return
      reservedSlotsRef.current += list.length
      inFlightBatchesRef.current += 1
      setUploading(true)
      try {
        const results = await Promise.allSettled(
          list.map(async (f) => ({
            url: await upload(f),
            name: f.name,
            contentType: f.type,
            size: f.size,
          }))
        )
        if (generation !== generationRef.current) return
        const uploaded = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
        if (uploaded.length === 0) return
        setPending((prev) => [...prev, ...uploaded].slice(0, MAX_CONVERSATION_ATTACHMENTS))
      } finally {
        if (generation !== generationRef.current) return
        reservedSlotsRef.current = Math.max(0, reservedSlotsRef.current - list.length)
        inFlightBatchesRef.current = Math.max(0, inFlightBatchesRef.current - 1)
        setUploading(inFlightBatchesRef.current > 0)
      }
    },
    [upload]
  )

  const remove = useCallback((index: number) => {
    setPending((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clear = useCallback(() => {
    generationRef.current += 1
    inFlightBatchesRef.current = 0
    reservedSlotsRef.current = 0
    setUploading(false)
    setPending([])
  }, [])
  // Re-populate the composer, e.g. to restore a snapshot after a failed send so
  // the already-uploaded files aren't lost.
  const restore = useCallback((items: ConversationAttachment[]) => setPending(items), [])

  return { pending, addFiles, remove, clear, restore, uploading }
}
