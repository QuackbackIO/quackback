/**
 * First-stage sanitizer for inbound email HTML.
 *
 * Layer 1 of a two-layer defense: this runs on the raw HTML straight out of
 * the mail parser, before it's handed to the HTML→markdown→contentJson
 * pipeline (see `./email-html-to-content.ts`, a sibling task). Layer 2 is
 * `sanitizeTiptapContent`, which runs on the resulting TipTap tree after
 * conversion. Belt and suspenders: even if something slips past this layer
 * (or the markdown conversion reintroduces something dangerous), layer 2
 * catches it before the content is persisted.
 *
 * The allowlist here is deliberately aligned with the TipTap node set the
 * conversion step can express — there's no point letting a tag through this
 * layer that the next stage can't represent anyway.
 *
 * Design choices (relevant to whoever builds the HTML→markdown step):
 *  - `div` / `span` are NOT in the allowed tag list. sanitize-html's default
 *    `disallowedTagsMode: 'discard'` drops the tag but keeps its inner
 *    content in place, i.e. they're unwrapped rather than stripped. This is
 *    simpler than rewriting them to `p`/`span`-equivalents via
 *    `transformTags`, but it means adjacent `<div>` siblings (the classic
 *    Gmail "one div per line" reply style) collapse together with **no**
 *    whitespace in between — `<div>foo</div><div>bar</div>` sanitizes to
 *    `foobar`, not `foo bar` or `foo\nbar`. Turndown has no default rule for
 *    bare `div`, so if the conversion step wants line breaks preserved for
 *    Gmail-style replies, it needs to inject them before this function runs
 *    (or before turndown runs) — this function will not do it.
 *  - `table` / `tr` / `td` / `th` are likewise not allowed tags, so they're
 *    unwrapped the same way: cell/row boundaries are lost entirely with no
 *    separator (`<table><tr><td>A</td><td>B</td></tr></table>` → `"AB"`).
 *    This is the stated-acceptable default sanitize-html behavior; a test
 *    below pins the exact output so a `sanitize-html` upgrade can't change
 *    it silently.
 *  - `h1`-`h6` ARE allowed and pass through as heading tags. Converting
 *    them to plain paragraphs is a later concern (the schema doesn't have a
 *    heading node, or the conversion step chooses not to use one) — that
 *    belongs to the markdown-conversion step, not here.
 *  - Protocol-relative URLs (`//evil.example/x`) are rejected on both
 *    `href` and `src` (`allowProtocolRelative: false`), on top of the
 *    scheme allowlist — an attacker can't dodge the scheme check by
 *    omitting the scheme.
 */

import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = [
  'p',
  'br',
  'a',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'img',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]

// Tags whose *content* must be discarded along with the tag, not just the
// tag itself. `script`/`style`/`textarea`/`option`/`xmp` are sanitize-html's
// own defaults (raw-text elements where leaving text behind could re-open
// an XSS bypass); `head`/`title`/`meta`/`link` cover full-document email
// HTML (`<html><head>...</head><body>...`) so a `<title>` doesn't leak into
// the visible body text; `iframe`/`object`/`embed`/`form`/`input`/`button`
// are explicitly called out by the spec (fallback/label text inside them is
// not real message content).
const NON_TEXT_TAGS = [
  'script',
  'style',
  'textarea',
  'option',
  'xmp',
  'head',
  'title',
  'meta',
  'link',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
]

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href'],
  img: ['src', 'alt', 'width', 'height'],
}

const ALLOWED_SCHEMES_BY_TAG: Record<string, string[]> = {
  a: ['http', 'https', 'mailto'],
  // `cid:` refs point at inline MIME attachments; a later task rewrites
  // them to rehosted storage URLs. Keep them here so that rewrite has
  // something to work with.
  img: ['http', 'https', 'cid'],
}

/** Tracking pixels: images with both `width` and `height` <= 2 (1x1/2x2 gifs). */
function isTrackingPixel(attribs: Record<string, string>): boolean {
  const width = Number(attribs.width)
  const height = Number(attribs.height)
  return !Number.isNaN(width) && !Number.isNaN(height) && width <= 2 && height <= 2
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  nonTextTags: NON_TEXT_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  // Global fallback scheme list for any attribute/tag not covered by
  // `allowedSchemesByTag` below (none of our allowed tags fall through to
  // it today, since both `a` and `img` — the only tags with URL-bearing
  // attributes in the allowlist — have explicit per-tag entries).
  allowedSchemes: ['http', 'https'],
  allowedSchemesByTag: ALLOWED_SCHEMES_BY_TAG,
  // Reject `//host/path` on top of the scheme allowlist above, so a bare
  // protocol-relative URL can't dodge the http/https/mailto/cid check.
  allowProtocolRelative: false,
  exclusiveFilter(frame) {
    if (frame.tag !== 'img') return false
    return isTrackingPixel(frame.attribs)
  },
}

/**
 * Sanitize inbound email HTML down to a safe, TipTap-alignable subset.
 * Empty or whitespace-only input returns ''.
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html || html.trim().length === 0) return ''
  return sanitizeHtml(html, SANITIZE_OPTIONS)
}
