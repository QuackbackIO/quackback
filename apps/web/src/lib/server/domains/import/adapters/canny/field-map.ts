/**
 * Canny field mappings (§I3). Canny's board statuses are admin-configurable
 * freeform strings, but the common ones ("open", "under review", "planned",
 * "in progress", "complete", "closed") already match Quackback's default
 * status names once title-cased, so the wizard's status-mapping step
 * auto-matches on a fresh instance.
 */

export function normalizeStatus(status: string): string {
  return status
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/** Appends image URLs as markdown image links so uploaded images aren't silently dropped. */
export function embedImages(body: string, imageURLs: string[] | undefined): string {
  if (!imageURLs || imageURLs.length === 0) return body
  const imageMarkdown = imageURLs.map((url, i) => `![image ${i + 1}](${url})`).join('\n')
  return body ? `${body}\n\n${imageMarkdown}` : imageMarkdown
}
