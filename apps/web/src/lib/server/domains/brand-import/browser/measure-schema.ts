/**
 * The shape of a measure the browser sidecar may send (page-measure.types.ts),
 * for the app to check a reply against: nothing the sidecar sends is trusted,
 * so every string and list is capped. Fields a newer sidecar adds are
 * optional, so an older one's reply still reads.
 */
import { z } from 'zod'
import type { PageMeasure } from './page-measure.types'

const css = z.string().max(2_000)
const count = z.number().finite().nonnegative()
/** The page palette's raw lists (newer sidecars only, so optional). */
const paletteSchema = {
  surfaces: z
    .array(
      z.object({
        bg: css,
        chars: count,
        rounded: z.boolean(),
        bordered: z.boolean(),
        shadowed: z.boolean(),
        wide: z.boolean(),
      })
    )
    .max(12)
    .optional(),
  cards: z
    .object({
      border: count,
      shadow: count,
      flat: count,
      flats: z
        .array(z.object({ bg: css, chars: count }))
        .max(8)
        .optional(),
    })
    .optional(),
  texts: z
    .array(z.object({ color: css, chars: count }))
    .max(8)
    .optional(),
  borders: z
    .array(z.object({ color: css, count }))
    .max(8)
    .optional(),
}
const candidateSchema = z.object({
  bg: css,
  fg: css,
  radius: css,
  h: z.number().finite(),
  w: z.number().finite(),
  top: z.number().finite(),
  text: z.string().max(200),
  header: z.boolean(),
  overlay: z.boolean(),
})
const buttonSchema = z.object({ bg: css, fg: css, radius: css, h: z.number().finite() })
const buttonSchemas = {
  candidates: z.array(candidateSchema).max(40).optional(),
  buttons: z.array(buttonSchema).max(6).optional(),
}
/** One family's files as the browser has them: at most two, base64, 400 KB each. */
const fontFilesSchema = z.object({
  family: z.string().min(1).max(200),
  service: z.boolean().optional(),
  tooLarge: z.boolean().optional(),
  files: z
    .array(
      z.object({
        url: z.string().max(2_048),
        weight: z.number().int().min(100).max(900),
        weightTo: z.number().int().min(100).max(900).optional(),
        data: z.string().max(560_000),
      })
    )
    .max(2),
})
/** One ink of a logo: its colour, its share of the pixels, and the box round where it is drawn. */
const inkSchema = z.object({
  color: css,
  share: z.number().finite().min(0).max(1),
  box: z.array(z.number().finite().min(0).max(1)).length(4).optional(),
  plate: z.boolean().optional(),
})

export const measureSchema = z.object({
  title: z.string().max(2_000),
  themeColor: css.nullable(),
  bg: css,
  text: css,
  bodyFont: css,
  h1: z.object({ font: css, minPx: z.number().finite().positive().optional() }).nullable(),
  buttons: z.array(buttonSchema).max(6),
  // A newer sidecar's: optional, so an older one's reply still reads.
  candidates: buttonSchemas.candidates,
  wall: z.boolean().optional(),
  page: z
    .object({
      status: z.number().int().nullable(),
      heading: z.string().max(200),
      lead: z.string().max(1_500),
      words: count,
      links: z.array(z.object({ href: z.string().max(2_048), text: z.string().max(80) })).max(150),
    })
    .optional(),
  // Images the browser itself loaded (or fetched in the page), base64.
  assets: z
    .array(
      z.object({
        url: z.string().max(2_048),
        mime: z.string().max(100),
        data: z.string().max(1_400_000),
      })
    )
    .max(6)
    .optional(),
  icons: z
    .array(
      z.object({
        url: z.string().max(2_048),
        size: z.number().finite().nullable(),
        type: z.string().max(100).nullable(),
        from: z.enum(['icon', 'apple-touch-icon']),
      })
    )
    .max(20)
    .optional(),
  textFont: css.optional(),
  textColor: css.optional(),
  // The text font's files as the browser has them, base64 (400 KB each).
  siteFont: fontFilesSchema.optional(),
  // The headings font's likewise, when it is another family.
  headingFont: fontFilesSchema.optional(),
  siteName: z.string().max(200).nullable().optional(),
  names: z.array(z.string().max(200)).max(6).optional(),
  nameWritten: z.string().max(200).nullable().optional(),
  header: z
    .object({ bg: css, text: css.optional(), tall: z.boolean().optional() })
    .nullable()
    .optional(),
  ...paletteSchema,
  dark: z
    .object({
      bg: css,
      text: css,
      textColor: css.optional(),
      // The page was also loaded afresh under a dark system (newer sidecars only).
      loaded: z.boolean().optional(),
      ...buttonSchemas,
      ...paletteSchema,
    })
    .optional(),
  darkLogo: z
    .object({
      tag: z.string().max(16),
      src: z.string().max(8_192).nullable(),
      w: z.number().finite().nonnegative(),
      h: z.number().finite().nonnegative(),
      svg: z.string().max(300_000).optional(),
      color: css.optional(),
      inks: z.array(inkSchema).max(8).optional(),
      from: z.enum(['scheme', 'picture', 'pair']),
    })
    .optional(),
  logo: z
    .object({
      tag: z.string().max(16),
      src: z.string().max(8_192).nullable(),
      w: z.number().finite().nonnegative(),
      h: z.number().finite().nonnegative(),
      svg: z.string().max(300_000).optional(),
      color: css.optional(),
      label: z.string().max(200).optional(),
      inks: z.array(inkSchema).max(8).optional(),
    })
    .nullable(),
}) satisfies z.ZodType<PageMeasure>
