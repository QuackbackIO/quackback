/**
 * The Ask request and response shapes alone. The server function that takes
 * the request validates with this module, and every admin page that loads
 * the settings mutations loads that function's module, so this stays small:
 * the replies and the local fast path live in ask.ts.
 */
import { z } from 'zod'
import { CARD_STYLES } from '@/lib/shared/theme/types'
import type { PortalDraftPatch } from './draft-patch'

/** What the header shows: the uploaded logo alone, or the icon with the name beside it. */
export const HEADER_SHOWS = ['logo', 'icon_and_name'] as const
export type HeaderShows = (typeof HEADER_SHOWS)[number]

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

const colourSummary = z
  .object({
    main: z.string().max(16).optional(),
    background: z.string().max(16).optional(),
    text: z.string().max(16).optional(),
    /** The header bar's own colour; left out while it is the page's. */
    header: z.string().max(16).optional(),
  })
  .strict()

/**
 * What the server is told about the draft: only what the prompt and the fast
 * path need. Never Advanced CSS, logo keys or uploaded font files.
 */
export const askDraftContextSchema = z
  .object({
    themeMode: z.enum(['light', 'dark', 'user']),
    buttonShape: z.enum(['pill', 'corners']),
    /** The corner radius in rem. */
    corners: z.number().min(0).max(10),
    /** A listed font id, or null for an uploaded or unlisted font. */
    font: z.string().max(64).nullable(),
    /** A listed font id, "same_as_text", or null for an uploaded or unlisted headings font. */
    headingFont: z.string().max(64).nullable(),
    cardStyle: z.enum(CARD_STYLES),
    /** The name the header shows: its own, else the workspace's. */
    portalName: z.string().max(100),
    /** The workspace's name, which an empty portal name puts back. */
    workspaceName: z.string().max(100),
    headerShows: z.enum(HEADER_SHOWS),
    /** Whether a logo is uploaded, so the header can show it. Never its key. */
    hasLogo: z.boolean(),
    colours: z.object({ light: colourSummary, dark: colourSummary }).strict(),
    tabs: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            type: z.enum(['feedback', 'roadmap', 'changelog', 'help', 'support', 'status', 'link']),
            label: z.string().max(30).optional(),
            enabled: z.boolean(),
          })
          .strict()
      )
      .max(20),
    welcomeMessage: z.string().max(2000),
    /** Null when the person cannot edit the Help Center home. */
    helpCenter: z
      .object({
        homepageTitle: z.string().max(200),
        homepageDescription: z.string().max(500),
        headerLinks: z
          .array(z.object({ label: z.string().max(60), url: z.string().max(500) }).strict())
          .max(3),
      })
      .strict()
      .nullable(),
  })
  .strict()

export type AskDraftContext = z.infer<typeof askDraftContextSchema>

/** The page the preview shows, so "this page" requests land on the right section. */
export const ASK_PAGES = ['feedback', 'roadmap', 'changelog', 'help'] as const
export type AskPage = (typeof ASK_PAGES)[number]

export const askPortalCustomiseSchema = z
  .object({
    request: z.string().trim().min(1).max(500),
    draft: askDraftContextSchema,
    page: z.enum(ASK_PAGES).optional(),
  })
  .strict()

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export type PortalAskResponse =
  /** Apply `patch` to the draft (see `applyDraftPatch`) and show `reply` with Undo. */
  | { outcome: 'patch'; handled: 'local' | 'model'; patch: PortalDraftPatch; reply: string }
  /** Step the editor's history back. */
  | { outcome: 'undo'; handled: 'local'; reply: string }
  /** Run Import your brand for `host`. */
  | { outcome: 'import'; handled: 'local' | 'model'; host: string; reply: string }
  /** Nothing to change; show `reply`. */
  | { outcome: 'refused'; handled: 'local' | 'refused'; reply: string }
  /** AI is off or the allowance is used up; show `reply`. */
  | { outcome: 'unavailable'; handled: 'refused'; reply: string }
