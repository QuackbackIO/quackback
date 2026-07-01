import { useCallback, useRef, useState } from 'react'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'
import { MAX_CONVERSATION_ATTACHMENTS } from '@/lib/shared/conversation/types'

/**
 * Manages pending attachments for a chat composer: uploads picked files via the
 * provided upload fn (which returns a public URL), tracks them with their
 * name/type/size for the send payload, and exposes add/remove/clear + an
 * uploading flag.
 */
export function useChatComposerAttachments(upload: (file: File) => Promise<string>) {
  const [pending, setPending] = useState<ConversationAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  // Mirror pending in a ref so addFiles reads the live count (for the remaining
  // slot calculation) without a stale closure or re-creating the callback.
  const pendingRef = useRef<ConversationAttachment[]>([])
  pendingRef.current = pending

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      // Only take as many as still fit, so we don't upload files we'd then have
      // to silently drop past the cap.
      const slotsLeft = MAX_CONVERSATION_ATTACHMENTS - pendingRef.current.length
      const list = Array.from(files).slice(0, Math.max(0, slotsLeft))
      if (list.length === 0) return
      setUploading(true)
      try {
        const uploaded = await Promise.all(
          list.map(async (f) => ({
            url: await upload(f),
            name: f.name,
            contentType: f.type,
            size: f.size,
          }))
        )
        setPending((prev) => [...prev, ...uploaded].slice(0, MAX_CONVERSATION_ATTACHMENTS))
      } catch {
        // The upload fn's onError handler (when the caller wires one) surfaces
        // the failure to the user; either way, drop the failed batch.
      } finally {
        setUploading(false)
      }
    },
    [upload]
  )

  const remove = useCallback((index: number) => {
    setPending((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clear = useCallback(() => setPending([]), [])
  // Re-populate the composer, e.g. to restore a snapshot after a failed send so
  // the already-uploaded files aren't lost.
  const restore = useCallback((items: ConversationAttachment[]) => setPending(items), [])

  return { pending, addFiles, remove, clear, restore, uploading }
}
