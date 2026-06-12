/**
 * Link preview card rendered below a chat message bubble.
 *
 * - Fetches preview data via the `unfurlLinkFn` server fn (auth-gated,
 *   rate-limited, cached). Renders nothing while loading or when null.
 * - Image is proxied server-side (never hotlinked).
 * - All outbound links carry rel="noopener noreferrer nofollow".
 * - No dangerouslySetInnerHTML anywhere in this component.
 */

import { useQuery } from '@tanstack/react-query'
import type { TiptapContent } from '@/lib/shared/db-types'
import { extractPreviewableUrls } from '@/lib/shared/chat/extract-urls'
import { unfurlLinkFn } from '@/lib/server/functions/link-preview'

interface LinkPreviewCardProps {
  url: string
  /** Widget surfaces pass this to forward the widget Bearer token. */
  getAuthHeaders?: () => Record<string, string>
}

/**
 * A single link preview card. Renders nothing while loading or when the
 * server returns null (bad URL, flag off, no OG data, rate-limited, etc.).
 */
export function LinkPreviewCard({ url, getAuthHeaders }: LinkPreviewCardProps) {
  const { data: preview } = useQuery({
    queryKey: ['link-preview', url],
    queryFn: () =>
      unfurlLinkFn({
        data: { url },
        ...(getAuthHeaders ? { headers: getAuthHeaders() } : {}),
      }),
    staleTime: 5 * 60 * 1000,
  })

  if (!preview) return null

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mt-1 block overflow-hidden rounded-lg border border-border bg-card no-underline transition-colors hover:bg-muted/40"
    >
      {/* Text section with left accent bar */}
      <div className="flex">
        <div className="w-[3px] shrink-0 self-stretch bg-primary/80" />
        <div className="min-w-0 flex-1 p-2.5">
          {(preview.faviconUrl || preview.siteName) && (
            <div className="mb-1 flex items-center gap-1.5">
              {preview.faviconUrl && (
                <img
                  src={preview.faviconUrl}
                  alt=""
                  className="h-4 w-4 shrink-0 rounded-sm object-contain"
                />
              )}
              {preview.siteName && (
                <span className="truncate text-[11px] font-medium text-muted-foreground">
                  {preview.siteName}
                </span>
              )}
            </div>
          )}
          {preview.title && (
            <p className="line-clamp-2 text-xs font-semibold text-primary">{preview.title}</p>
          )}
          {preview.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
              {preview.description}
            </p>
          )}
        </div>
      </div>
      {/* OG image at bottom, full-width */}
      {preview.imageUrl && (
        <img
          src={preview.imageUrl}
          alt=""
          className="block w-full max-h-48 object-cover"
          loading="lazy"
        />
      )}
    </a>
  )
}

interface LinkPreviewsProps {
  content: string
  contentJson?: TiptapContent | null
  /** Widget surfaces pass this to forward the widget Bearer token. */
  getAuthHeaders?: () => Record<string, string>
}

/**
 * Render up to 3 link preview cards below a message bubble.
 * Extracts previewable URLs from both plain text and TipTap link marks.
 */
export function LinkPreviews({ content, contentJson, getAuthHeaders }: LinkPreviewsProps) {
  const urls = extractPreviewableUrls(content, contentJson)
  if (urls.length === 0) return null

  return (
    <div className="mt-1 space-y-1">
      {urls.map((url) => (
        <LinkPreviewCard key={url} url={url} getAuthHeaders={getAuthHeaders} />
      ))}
    </div>
  )
}
