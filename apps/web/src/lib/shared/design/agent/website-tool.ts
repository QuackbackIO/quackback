/**
 * The edit loop's website tools, as the model calls them (two fields of its
 * step answer, step-schema.ts) and as their results come back to it:
 *
 * - read_website: the site's facts (its name, language, description, colours
 *   with where each was named, the fonts its CSS sets for headings and body
 *   with how the portal draws them, and its logo, favicon and share picture,
 *   each stored with its size and kind) and a capture of it, which the model
 *   sees as a picture. From the capture cache first; a new capture only
 *   within the workspace's limits. A refusal or a limit is a value the model
 *   explains, never an error.
 * - match_website: the whole brand match on the capture and the facts, its
 *   summary as a brand match reports it.
 *
 * The result's schema and the example the model is shown are kept in step
 * by a test.
 */
import { z } from 'zod'

const asset = z.object({
  /** Where it came from: an icon link, the header, structured data, the share picture. */
  from: z.string().max(40),
  kind: z.enum(['svg', 'png', 'jpeg', 'webp', 'gif', 'ico', 'avif']),
  /** Its storage key, for an operation that sets it; null when it could not be stored. */
  key: z.string().max(512).nullable(),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
  /** Whether it is the logo the capture shows: known once the site is matched. */
  agrees: z.boolean().nullable(),
})

const font = z.object({
  family: z.string().max(80),
  /** Where the CSS sets it: a selector or a custom property. */
  from: z.string().max(80),
  /** bundled: drawn as itself; open: an open-licence face drawn in the nearest bundled one; nearest: a licensed face, likewise; unknown: no near face known. */
  how: z.enum(['bundled', 'open', 'nearest', 'unknown']),
  /** The bundled face the portal draws it in, for Theme fonts. */
  id: z.string().max(40).nullable(),
  why: z.string().max(300),
})

export const WEBSITE_FALLBACKS = [
  'not_configured',
  'limit',
  'quota',
  'challenge',
  'capture_failed',
  'recapture_too_soon',
  'invalid_url',
  'blocked_url',
  'fetch_failed',
] as const

export const websiteReadingSchema = z.object({
  ok: z.boolean(),
  host: z.string().max(253).nullable(),
  status: z.object({
    /** cache: a capture kept from before (free); capture: captured now; none: no capture. */
    source: z.enum(['cache', 'capture', 'none']),
    /** Why there is no capture, or none. */
    fallback: z.enum(WEBSITE_FALLBACKS).nullable(),
    /** One sentence to say to the person about it, or null. */
    message: z.string().max(300).nullable(),
    /** New sites the workspace may still capture today, or null when unknown. */
    capturesLeftToday: z.number().int().nullable(),
  }),
  facts: z
    .object({
      name: z.string().max(120).nullable(),
      language: z.string().max(20).nullable(),
      description: z.string().max(300).nullable(),
      themeColour: z.string().max(9).nullable(),
      colours: z.array(z.object({ hex: z.string().max(9), from: z.string().max(80) })).max(12),
      fonts: z.object({ heading: font.nullable(), body: font.nullable() }),
      logo: asset.nullable(),
      favicon: asset.nullable(),
      shareImage: asset.nullable(),
    })
    .nullable(),
})
export type WebsiteReading = z.infer<typeof websiteReadingSchema>

/** What a match of a website did, as the next step reads it. */
export interface WebsiteMatch {
  ok: boolean
  host: string
  reply: string
  /** The fields it set. */
  changed: string[]
  notes: string[]
}

/** The example the model is shown of a reading (fictional brand). */
export const WEBSITE_READING_EXAMPLE: WebsiteReading = {
  ok: true,
  host: 'acme.test',
  status: { source: 'cache', fallback: null, message: null, capturesLeftToday: 4 },
  facts: {
    name: 'Acme Parcel',
    language: 'en-gb',
    description: 'Parcels delivered the same day, across the city.',
    themeColour: '#123c69',
    colours: [
      { hex: '#123c69', from: '--brand-primary' },
      { hex: '#f2a541', from: 'button background' },
    ],
    fonts: {
      heading: {
        family: 'Acme Display',
        from: 'h1',
        how: 'nearest',
        id: 'archivo',
        why: 'your site sets it in Acme Display, which is licensed to your site; Archivo is the bundled face nearest it',
      },
      body: {
        family: 'Inter',
        from: 'body',
        how: 'bundled',
        id: 'inter',
        why: 'your site sets it in Inter',
      },
    },
    logo: {
      from: 'header-svg',
      kind: 'svg',
      key: 'logos/site/acme.test/1-logo.svg',
      width: 120,
      height: 32,
      agrees: null,
    },
    favicon: {
      from: 'icon',
      kind: 'png',
      key: 'logos/site/acme.test/1-favicon.png',
      width: 64,
      height: 64,
      agrees: null,
    },
    shareImage: null,
  },
}

/** The tools as the model is told them. */
export const WEBSITE_TOOLS_TEXT = `Websites:
- read_website: a website's address when the person gives or mentions one, or says to match their site; "" otherwise. Its result (the site's name, colours, fonts and how the portal draws them, its logo, favicon and share picture with their storage keys, and a capture you will see) comes in the next step. Read a site once: never read one whose result is already below or in the conversation, and never the same site twice.
- match_website: a website's address to match the whole portal to (its colours, fonts, logo, favicon and words), once read, when the person asks to match it; "" otherwise. Then make only what they asked for beyond it with ops. A logo, favicon or share picture from a reading is set by its key (op theme, key favicon, logo, wordmark or shareImage, value {"key":"..."}); a font by its id (Theme fonts).
Example reading: ${JSON.stringify(WEBSITE_READING_EXAMPLE)}`

/** A reading, as the next step's text says it. */
export const readingText = (reading: WebsiteReading) =>
  `Website read (${reading.host ?? 'unknown'}): ${JSON.stringify(reading)}`

/** A match, as the next step's text says it. */
export const matchText = (match: WebsiteMatch) =>
  `Website matched (${match.host}): ${match.ok ? `changed ${match.changed.length} fields. ${match.reply}` : match.reply}${match.notes.length ? ` ${match.notes.join(' ')}` : ''}`

/** The host of an address, as tools key their calls. */
export function hostKey(url: string): string | null {
  try {
    const u = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`
    )
    return u.hostname.toLowerCase().replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** What a reading found, in a line for the conversation. */
export function readingSummary(reading: WebsiteReading): string {
  const host = reading.host ?? 'the site'
  const f = reading.facts
  if (!f) return reading.status.message ?? `I could not read ${host}.`
  const fonts = [f.fonts.heading, f.fonts.body]
    .filter((x): x is NonNullable<typeof x> => !!x)
    .filter((x, i, all) => all.findIndex((y) => y.family === x.family) === i)
    .map((x) =>
      x.how === 'bundled' || !x.id ? x.family : `${x.family} (drawn in the nearest bundled face)`
    )
  const found = [
    f.name,
    fonts.length ? `fonts ${fonts.join(' and ')}` : null,
    f.colours.length ? `${f.colours.length} colour${f.colours.length === 1 ? '' : 's'}` : null,
    f.logo ? 'a logo' : null,
    f.favicon ? 'a favicon' : null,
  ].filter((x): x is string => !!x)
  const lead = found.length ? `Read ${host}: ${found.join(', ')}.` : `Read ${host}.`
  return reading.status.message ? `${lead} ${reading.status.message}` : lead
}
