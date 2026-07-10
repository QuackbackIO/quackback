/**
 * Dynamic-variable interpolation for workflow message blocks (§ workflow
 * message actions). Pure and dependency-free so both the server-side action
 * executor and the client-side block editor (live preview, insert-variable
 * menu) can share one implementation.
 *
 * Token syntax: `{token_name}` or `{token_name|fallback text}`.
 *   - `{first_name}` substitutes the resolved value verbatim.
 *   - `{first_name|there}` substitutes the resolved value, or the literal
 *     text "there" when the value is missing or an empty string.
 *   - A token whose name is not in `values` behaves exactly like a token
 *     whose value is missing: it renders the fallback, or "" with no
 *     fallback. Unknown token names are never an error.
 *   - A resolved value is substituted as plain text; it is never re-parsed,
 *     so a value can never inject another token or any rich-text structure
 *     into the output.
 *
 * Escaping: doubled braces render a literal single brace, so a template
 * that needs to show `{` or `}` without triggering a token writes `{{` or
 * `}}`. For example `{{first_name}}` renders the literal text
 * "{first_name}" (not a substitution): the pattern is not itself a valid
 * token because it's wrapped by the escape, not merely braced.
 *
 * A raw `{token}` must never reach a customer: every well-formed token is
 * replaced by something (value, fallback, or empty string). Text that
 * merely contains a stray, unmatched `{` or `}` (not a well-formed token
 * and not a doubled escape) is left untouched, since it was never a token
 * to begin with.
 *
 * `interpolateTiptapContent` extends the same substitution to a TipTap rich
 * doc (a workflow message block's authored body): each text node's `text` is
 * interpolated independently, so a token never crosses a text-run boundary
 * (matching how the editor keeps a `{token}` inside one run). Everything else
 * (marks, node type, attrs, non-text nodes) passes through unchanged.
 */
import type { TiptapContent } from '@/lib/shared/db-types'

/** Token name: starts with a letter or underscore, then word characters. */
const TOKEN_NAME = '[a-zA-Z_][a-zA-Z0-9_]*'

/**
 * Matches, in priority order at each position: an escaped `{{`, an escaped
 * `}}`, or a well-formed `{name}` / `{name|fallback}` token. Fallback text
 * may contain spaces and punctuation but not `{` or `}` (those must be
 * expressed via the doubled-brace escape).
 */
const TOKEN_PATTERN = new RegExp(`\\{\\{|\\}\\}|\\{(${TOKEN_NAME})(?:\\|([^{}]*))?\\}`, 'g')

/** Values a workflow message template can interpolate. */
export type InterpolationValues = Record<string, string | null | undefined>

/**
 * Substitute `{token}` / `{token|fallback}` placeholders in `template`
 * against `values`. See the module docblock for the full contract.
 */
export function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(TOKEN_PATTERN, (match, name?: string, fallback?: string) => {
    if (match === '{{') return '{'
    if (match === '}}') return '}'
    const value = values[name as string]
    // Non-empty, non-nullish values win; everything else (missing key,
    // undefined, null, "") falls back, matching the documented contract
    // that a missing value and an empty value behave identically.
    if (value) return value
    return fallback ?? ''
  })
}

/**
 * Interpolate every text node of a TipTap doc in place (a new tree; the input
 * is never mutated). Non-text nodes recurse through `content`; a node with
 * neither `text` nor `content` (an image, a hard break, ...) passes through
 * unchanged. See the module docblock for why this interpolates per text node
 * rather than serializing the whole doc to one string first.
 */
export function interpolateTiptapContent(
  doc: TiptapContent,
  values: InterpolationValues
): TiptapContent {
  if (typeof doc.text === 'string') {
    return { ...doc, text: interpolate(doc.text, values) }
  }
  if (doc.content) {
    return { ...doc, content: doc.content.map((child) => interpolateTiptapContent(child, values)) }
  }
  return doc
}
