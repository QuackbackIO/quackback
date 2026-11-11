/**
 * A shared preview link: the portal drawn with a design not yet live, for
 * someone without admin access. The link carries its token in one search
 * parameter, kept across navigation within the portal.
 */
export const PREVIEW_LINK_PARAM = 'share'

/** How long a preview link lasts. */
export const PREVIEW_LINK_DAYS = 7

/** A preview link's token: a prefix, then 32 random bytes in base64url. */
const PREVIEW_TOKEN_PATTERN = /^qbp_[A-Za-z0-9_-]{43}$/

export function isPreviewToken(value: unknown): value is string {
  return typeof value === 'string' && PREVIEW_TOKEN_PATTERN.test(value)
}

/** What a shared preview link showed: the design, or that the link has ended. */
export type SharedPreviewState = 'shown' | 'ended'

/**
 * What the root route asks the bootstrap for, from the page's search: the
 * switch preview, the saved draft (the publish review's After frame), a
 * preview link's design, or nothing more. The key keeps each answer apart in
 * the route context memo.
 */
export function rootContextRequest(search: Record<string, unknown>): {
  data: { designPreview: 'switch' | 'draft' } | { previewToken: string } | undefined
  key: string
} {
  if (search.design === 'switch') return { data: { designPreview: 'switch' }, key: 'switch' }
  if (search.design === 'draft') return { data: { designPreview: 'draft' }, key: 'draft' }
  const token = search[PREVIEW_LINK_PARAM]
  if (isPreviewToken(token)) return { data: { previewToken: token }, key: `share:${token}` }
  return { data: undefined, key: '' }
}
