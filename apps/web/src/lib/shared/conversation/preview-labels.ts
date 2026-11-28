/**
 * The fixed words the server writes as a message's preview when it has no
 * text of its own: an inline image, a shared post or update, an attachment.
 * The server stores them in English; the inbox list words a preview that is
 * exactly one of them in the teammate's language.
 */
export const PREVIEW_LABELS = {
  image: 'Image',
  post: 'Shared a post',
  update: 'Shared an update',
  attachment: 'Attachment',
} as const

export type PreviewLabelKind = keyof typeof PREVIEW_LABELS

/** Which fixed preview word a stored preview is, if it is one. */
export function previewLabelKind(preview: string | null | undefined): PreviewLabelKind | null {
  for (const [kind, label] of Object.entries(PREVIEW_LABELS)) {
    if (preview === label) return kind as PreviewLabelKind
  }
  return null
}
