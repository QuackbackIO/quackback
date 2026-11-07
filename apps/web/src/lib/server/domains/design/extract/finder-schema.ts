/**
 * The element finder's answer. Flat fields only, as nested objects grow the
 * grammar a strict answer is held to. Evidence first (the words it reads),
 * then boxes, then closed observations. A box is "x0 y0 x1 y1" in whole
 * pixels of the image sent, or "none".
 */
import { z } from 'zod'
import { BEHIND, LOGO_KIND, NAV_STYLE, TEXT_CASE, TYPE_KIND } from './kinds'

const box = z.string().describe('"x0 y0 x1 y1" or "none"')

export const finderSchema = z.object({
  headline_text: z.string().describe('the main headline words as written, or ""'),
  subtitle_text: z
    .string()
    .describe('the words of the smaller text under the headline as written, or ""'),
  logo_text: z.string().describe('the words in the logo, or "" for a symbol only'),
  primary_button_text: z.string().describe('the main call-to-action button label, or ""'),
  section_heading_text: z
    .string()
    .describe('the words of the first section heading below the hero as written, or ""'),
  logo: box,
  nav_row: box,
  headline: box,
  subtitle: box,
  primary_button: box,
  secondary_button: box,
  link: box,
  card: box,
  input_field: box,
  hero: box,
  header: box,
  product_screenshot: box,
  section_heading: box,
  behind_headline_evidence: z
    .string()
    .describe('a few words on what is directly behind the headline'),
  behind_headline: z.enum(BEHIND),
  nav_style: z.enum(NAV_STYLE),
  text_case: z.enum(TEXT_CASE),
  logo_kind: z.enum(LOGO_KIND),
  headline_type: z.enum(TYPE_KIND),
  body_type: z.enum(TYPE_KIND),
  cookie_banner: z.boolean(),
  dimmed: z.boolean(),
  main_cta_visible: z.boolean(),
  product_screenshot_visible: z.boolean(),
})
export type FinderOutput = z.infer<typeof finderSchema>

/**
 * A box answer as fractions of the image [x0, y0, x1, y1], or null. With
 * `pixels` (the size of the image sent) the numbers are read as pixels.
 * Tolerates commas, brackets, swapped corners and answers in per mille or
 * percent; a box with no area is null.
 */
export function parseBox(s: string, pixels?: [number, number]): number[] | null {
  if (!s || /none|null|n\/a/i.test(s)) return null
  const n = (s.match(/-?\d*\.?\d+/g) ?? []).map(Number)
  if (n.length < 4) return null
  let [x0, y0, x1, y1] = n as [number, number, number, number]
  if (pixels) {
    x0 /= pixels[0]
    x1 /= pixels[0]
    y0 /= pixels[1]
    y1 /= pixels[1]
  }
  const mx = Math.max(x0, y0, x1, y1)
  const div = mx > 100 ? 1000 : mx > 1.5 ? 100 : 1
  x0 /= div
  y0 /= div
  x1 /= div
  y1 /= div
  if (x1 < x0) [x0, x1] = [x1, x0]
  if (y1 < y0) [y0, y1] = [y1, y0]
  const c = (v: number) => Math.min(1, Math.max(0, v))
  ;[x0, y0, x1, y1] = [c(x0), c(y0), c(x1), c(y1)]
  return x1 - x0 > 0.001 && y1 - y0 > 0.001 ? [x0, y0, x1, y1] : null
}

/** The JSON schema a strict structured answer is held to (for callers outside TanStack AI). */
export function finderJsonSchema(): Record<string, unknown> {
  const js = z.toJSONSchema(finderSchema) as Record<string, unknown>
  delete js.$schema
  return js
}
