/**
 * The element finder prompt. Plain observation: no persona, closed choices,
 * values left to the image tools. Boxes are written in whole pixels of the
 * image as sent, which located elements better than fractions.
 *
 * Bump FINDER_VERSION on any change to the prompt or the examples: the
 * offline harness caches model calls by image hash and version, and its
 * parity check compares this text with the evaluated prompt.
 */
import type { FinderOutput } from './finder-schema'

export const FINDER_VERSION = 'finder-v5-type'

/**
 * Few-shot example outputs, boxes as fractions of the image (scaled to the
 * image's pixels in the prompt). A test parses each with finderSchema.
 */
export const FINDER_EXAMPLES: { note: string; output: FinderOutput }[] = [
  {
    note: 'A light marketing page: logo top left, menu links beside it, a filled button at top right, a big sans headline on a plain white background with a product screenshot to its right, and the next section’s heading at the bottom.',
    output: {
      headline_text: 'Plan, track and ship your work',
      subtitle_text:
        'The project tool for teams who build software, from the first idea to the release.',
      logo_text: 'Acme',
      primary_button_text: 'Get started',
      section_heading_text: 'Built for every team',
      logo: '0.040 0.030 0.118 0.068',
      nav_row: '0.150 0.034 0.420 0.064',
      headline: '0.070 0.270 0.480 0.470',
      subtitle: '0.070 0.500 0.430 0.560',
      primary_button: '0.070 0.610 0.170 0.665',
      secondary_button: '0.180 0.610 0.290 0.665',
      link: '0.880 0.035 0.920 0.062',
      card: 'none',
      input_field: 'none',
      hero: '0.000 0.100 1.000 0.880',
      header: '0.000 0.000 1.000 0.100',
      product_screenshot: '0.530 0.200 0.960 0.840',
      section_heading: '0.070 0.920 0.400 0.965',
      behind_headline_evidence: 'white page background, nothing behind the text',
      behind_headline: 'plain',
      nav_style: 'plain',
      text_case: 'normal',
      logo_kind: 'icon_and_name',
      headline_type: 'sans',
      body_type: 'sans',
      cookie_banner: false,
      dimmed: false,
      main_cta_visible: true,
      product_screenshot_visible: true,
    },
  },
  {
    note: 'A page with a full-width photo behind a centred white serif headline, and a cookie notice at the bottom with a dark scrim over the page.',
    output: {
      headline_text: 'Homes for every season',
      subtitle_text: '',
      logo_text: 'NORDHUS',
      primary_button_text: '',
      section_heading_text: '',
      logo: '0.030 0.025 0.150 0.075',
      nav_row: '0.400 0.035 0.640 0.065',
      headline: '0.250 0.330 0.750 0.440',
      subtitle: 'none',
      primary_button: 'none',
      secondary_button: 'none',
      link: 'none',
      card: 'none',
      input_field: '0.700 0.030 0.900 0.072',
      hero: '0.000 0.100 1.000 1.000',
      header: '0.000 0.000 1.000 0.100',
      product_screenshot: 'none',
      section_heading: 'none',
      behind_headline_evidence: 'a photograph of a living room fills the band',
      behind_headline: 'photo',
      nav_style: 'underline',
      text_case: 'upper',
      logo_kind: 'wordmark',
      headline_type: 'serif',
      body_type: 'not_visible',
      cookie_banner: true,
      dimmed: true,
      main_cta_visible: false,
      product_screenshot_visible: false,
    },
  },
]

/** The box fields in the order the examples list them. */
const BOX_FIELDS = [
  'logo',
  'nav_row',
  'headline',
  'subtitle',
  'primary_button',
  'secondary_button',
  'link',
  'card',
  'input_field',
  'hero',
  'header',
  'product_screenshot',
  'section_heading',
] as const

/** An example's fractional box in whole pixels of a width by height image. */
function exampleBox(b: string, w: number, h: number): string {
  if (b === 'none') return b
  const n = b.split(' ').map(Number)
  return [n[0]! * w, n[1]! * h, n[2]! * w, n[3]! * h].map(Math.round).join(' ')
}

/** The examples as the prompt shows them for an image of this size. */
export function examplesFor(width: number, height: number): FinderOutput[] {
  return FINDER_EXAMPLES.map((e) => ({
    ...e.output,
    ...Object.fromEntries(BOX_FIELDS.map((k) => [k, exampleBox(e.output[k], width, height)])),
  }))
}

export function finderPrompt(width: number, height: number): string {
  const examples = examplesFor(width, height)
  return `You are looking at a screenshot of a website's home page (${width}x${height} pixels, the top of the page as a visitor first sees it).
Find these elements and give each a tight bounding box around what you can see of it. Write each box as "x0 y0 x1 y1": the left, top, right and bottom edges in whole pixels of this ${width}x${height} image (x from 0 at the left to ${width} at the right, y from 0 at the top to ${height} at the bottom). Write "none" when the element is not visible.

- logo: the brand's logo in the header (symbol and/or name), only its drawn pixels.
- nav_row: the main group of navigation menu links in the header, from the first to the last link of that group. Not the logo, not filled buttons, not a separate "Log in" link far to the right.
- headline: the largest, most prominent heading near the top, all of its lines.
- subtitle: the smaller text directly under the headline, all of its lines.
- primary_button: the main call-to-action button: the most prominent filled button, preferring one in the hero over one in the header.
- secondary_button: another button beside it or in the header (outlined, or a different fill).
- link: a text link outside the header menu (in the content), or "none".
- card: one card or tile (a panel with a border, shadow or its own fill) in the content, or "none".
- input_field: a text input or search field, or "none".
- hero: the top section of the page that contains the headline, from just below the header down to where the next section starts (or the bottom of the screenshot), usually full width.
- header: the page's top chrome, full width: from the very top of the image down to the bottom edge of the bar holding the logo and the menu (include any thin announcement bar above it).
- product_screenshot: a picture of the product's own app or interface (a UI mockup or screenshot) shown on the page, or "none". Photos of people or things are not product screenshots.
- section_heading: the heading of the next section below the hero (smaller than the headline, larger than body text), all of its lines, or "none" when no such heading is fully visible. Not a card's title, not a menu item, not a logo.

Then observe, choosing from the given options only:
- behind_headline: what is directly behind the headline text: plain (the same white, light or dark background as the rest of the page), tinted (a pale colour, such as beige, cream or light grey, that differs from the page's main background), solid_colour (a strong, saturated brand colour), gradient, photo, illustration.
- nav_style: how the header menu items look: plain text, underline (one is underlined), pills (rounded filled shapes behind items), tabs, or not_visible.
- text_case: the headline in normal case or upper (ALL CAPITALS).
- headline_type and body_type: the letters of the headline, and of the body text (the subtitle, or other paragraphs): sans (no serifs), serif (small strokes finishing the ends of letters, as in a newspaper or a book), mono (every letter the same width, as in code), not_visible.
- logo_kind: icon (a symbol only, no readable name), wordmark (the brand name drawn as lettering, even when the letters sit inside a coloured shape or box), icon_and_name (a separate symbol placed beside the name), not_visible.
- cookie_banner: a cookie, consent or privacy notice is on screen.
- dimmed: a dark or white see-through layer covers the page (behind a pop-up).
- main_cta_visible: a main call-to-action button is visible.
- product_screenshot_visible: a product screenshot is visible.

Read before you locate: fill headline_text, subtitle_text, logo_text, primary_button_text and section_heading_text first, then the boxes, then behind_headline_evidence (a few words), then the choices.
Answer with ONLY one JSON object with exactly these fields, no commentary and no code fences.

${FINDER_EXAMPLES.map((e, i) => `Example ${i + 1} (${e.note}):\n${JSON.stringify(examples[i])}`).join('\n\n')}`
}
