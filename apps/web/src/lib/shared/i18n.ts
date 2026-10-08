export const DEFAULT_LOCALE = 'en' as const

export const SUPPORTED_LOCALES = [
  'en',
  'de',
  'fr',
  'es',
  'ar',
  'ru',
  'pt-br',
  'zh-cn',
  'zh-tw',
  'nl',
  'pl',
] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur'])

/**
 * Normalizes a locale string to a supported locale, stripping region subtags
 * and lowercasing. Returns null if the locale is not supported.
 */
export function normalizeLocale(locale: string): SupportedLocale | null {
  if (!locale) return null

  const lower = locale.toLowerCase()

  // Try exact match first
  if ((SUPPORTED_LOCALES as readonly string[]).includes(lower)) {
    return lower as SupportedLocale
  }

  // Strip region subtag (e.g. "fr-FR" -> "fr"), but only accept 2-letter base codes
  const parts = lower.split('-')

  // Chinese is script-sensitive: Simplified (zh-cn) and Traditional (zh-tw) are
  // separate catalogs, so the generic "strip to base" rule below would wrongly
  // collapse them to a non-existent "zh". Infer the script from CLDR's
  // likely-subtags data via Intl.Locale.maximize(): an explicit "Hant" script
  // or a Traditional region (TW/HK/MO, etc.) yields "Hant" → zh-tw; everything
  // else under "zh" (bare zh, Hans, CN, SG) maximizes to "Hans" → zh-cn.
  if (parts[0] === 'zh') {
    try {
      return new Intl.Locale(lower).maximize().script === 'Hant' ? 'zh-tw' : 'zh-cn'
    } catch {
      // Irregular tag Intl can't parse (e.g. "zh-min-nan") → Simplified default.
      return 'zh-cn'
    }
  }

  if (parts.length >= 2) {
    const base = parts[0]
    // Only treat as a locale if the base is a 2–3 letter code
    if (base.length >= 2 && base.length <= 3 && /^[a-z]+$/.test(base)) {
      if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) {
        return base as SupportedLocale
      }
    }
  }

  return null
}

/**
 * Parses an Accept-Language header and returns the best matching supported
 * locale. An explicit locale override takes precedence when supported.
 * Falls back to DEFAULT_LOCALE if nothing matches.
 */
export function resolveLocale(
  acceptLanguage: string | null | undefined,
  explicitLocale?: string
): SupportedLocale {
  // Explicit locale wins if it's supported
  if (explicitLocale) {
    const normalized = normalizeLocale(explicitLocale)
    if (normalized !== null) return normalized
  }

  // Parse Accept-Language header
  if (!acceptLanguage) return DEFAULT_LOCALE

  const entries = acceptLanguage
    .split(',')
    .map((entry) => {
      const [tag, qPart] = entry.trim().split(';')
      const q = qPart ? parseFloat(qPart.replace('q=', '').trim()) : 1.0
      return { tag: tag.trim(), q: isNaN(q) ? 1.0 : q }
    })
    // q=0 means "not acceptable" (RFC 7231), so drop those entries entirely.
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q)

  for (const { tag } of entries) {
    const normalized = normalizeLocale(tag)
    if (normalized !== null) return normalized
  }

  return DEFAULT_LOCALE
}

/**
 * Returns true if the given locale is written right-to-left.
 */
export function isRtlLocale(locale: string): boolean {
  return RTL_LOCALES.has(locale.toLowerCase())
}

/**
 * Returns true if the `?rtl=1` debug query param is set.
 * Safe to call during SSR (returns false when `window` is unavailable).
 * Result is computed once and cached for the lifetime of the page.
 */
export const isRtlForced = (() => {
  let cached: boolean | undefined
  return (): boolean => {
    if (cached !== undefined) return cached
    cached =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('rtl') === '1'
    return cached
  }
})()

const messageCache = new Map<SupportedLocale, Promise<Record<string, string>>>()

/**
 * Dynamically imports the message catalog for the given locale.
 * Falls back to English on error (e.g. locale file doesn't exist yet).
 * Results are cached per locale for the lifetime of the page.
 */
export function loadMessages(locale: SupportedLocale): Promise<Record<string, string>> {
  const cached = messageCache.get(locale)
  if (cached) return cached

  const promise = (async () => {
    try {
      const messages = await import(`../../locales/${locale}.json`)
      return messages.default as Record<string, string>
    } catch {
      // Locale catalog missing/unparseable — degrade to English rather than crash.
      const fallback = await import('../../locales/en.json')
      return fallback.default as Record<string, string>
    }
  })()

  messageCache.set(locale, promise)
  return promise
}

/**
 * Key prefixes only the file viewer renders. The viewer is a lazy chunk that
 * opens on a click, so no page seeds these strings into its document; the
 * viewer loads them as it opens (see `ViewerMessages`).
 */
export const VIEWER_MESSAGE_PREFIXES = [
  'files.viewer.',
  'files.find.',
  'files.archive.',
  'files.sheet.',
  'files.pdf.',
] as const

export function isViewerMessage(key: string): boolean {
  return VIEWER_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/**
 * Copilot and search strings. Their chunks (the Home chat and the search
 * dialog) load them as they open (see `AskMessages`); only the sidebar Search
 * row renders on every page, so its strings stay in the seed.
 */
export function isAskMessage(key: string): boolean {
  return key.startsWith('ask.') && !key.startsWith('ask.search.')
}

/** A catalog without the viewer's strings, for seeding a page. */
export function withoutViewerMessages(all: Record<string, string>): Record<string, string> {
  const subset: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    if (!isViewerMessage(key)) subset[key] = value
  }
  return subset
}

/** The Copilot and search strings in a locale. */
export async function loadAskMessages(locale: SupportedLocale): Promise<Record<string, string>> {
  const all = await loadMessages(locale)
  const subset: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    if (isAskMessage(key)) subset[key] = value
  }
  return subset
}

/** The file viewer's strings in a locale. */
export async function loadViewerMessages(locale: SupportedLocale): Promise<Record<string, string>> {
  const all = await loadMessages(locale)
  const subset: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    if (isViewerMessage(key)) subset[key] = value
  }
  return subset
}

/**
 * Key prefixes only the product tour's overlay renders. The tour opens on a
 * click, so admin pages leave these out of the catalog they seed and the tour
 * loads them as it starts (see `ProductTourProvider`). The tour's entry points
 * (`onboarding.tour.replay`, `.offer`, `.notNow`) stay seeded.
 */
export const TOUR_MESSAGE_PREFIXES = [
  'onboarding.tour.stop.',
  'onboarding.tour.end.',
  'onboarding.tour.count',
  'onboarding.tour.skipTour',
  'onboarding.tour.back',
  'onboarding.tour.next',
  'onboarding.tour.finish',
] as const

export function isTourMessage(key: string): boolean {
  return TOUR_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/** The product tour overlay's strings in a locale. */
export async function loadTourMessages(locale: SupportedLocale): Promise<Record<string, string>> {
  const all = await loadMessages(locale)
  const subset: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    if (isTourMessage(key)) subset[key] = value
  }
  return subset
}

/**
 * Key prefixes only the onboarding wizard renders (it seeds its own slice,
 * see {@link loadOnboardingMessages}); no admin page shows them.
 */
const WIZARD_ONLY_MESSAGE_PREFIXES = [
  'onboarding.goals.',
  'onboarding.workspace.',
  'onboarding.error.',
] as const

/**
 * Strings only the invite-the-team sheet renders. The sheet is a lazy chunk
 * opened on a click, so admin pages leave these out of the catalog they seed
 * and the sheet loads them as it opens (see `SheetMessages`).
 */
const SHEET_MESSAGE_PREFIXES = ['onboarding.live.'] as const

export function isSheetMessage(key: string): boolean {
  return SHEET_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/** The setup sheets' strings in a locale. */
export async function loadSheetMessages(locale: SupportedLocale): Promise<Record<string, string>> {
  const all = await loadMessages(locale)
  const subset: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    if (isSheetMessage(key)) subset[key] = value
  }
  return subset
}

/**
 * Strings only Home and the Launch plan page render: the plan and its steps,
 * the next step and first win cards, the greeting, Home's counts. Those two
 * routes load them as they load (see `LaunchMessages`), so every other admin
 * page leaves them out of its seed. The sidebar dock and the tour's end card,
 * on every page, keep the few they render.
 */
const LAUNCH_MESSAGE_PREFIXES = [
  'onboarding.task.',
  'onboarding.win.',
  'onboarding.home.',
  'onboarding.path.',
  'onboarding.launch.',
  'onboarding.branding.',
  'admin.overview.',
] as const
const SEEDED_LAUNCH_MESSAGES: ReadonlySet<string> = new Set([
  'onboarding.launch.name',
  'onboarding.launch.stepOf',
  'onboarding.launch.done',
  'onboarding.launch.error',
])

export function isLaunchMessage(key: string): boolean {
  return (
    LAUNCH_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix)) &&
    !SEEDED_LAUNCH_MESSAGES.has(key)
  )
}

/** Home's and the Launch plan page's strings in a locale. */
export async function loadLaunchMessages(locale: SupportedLocale): Promise<Record<string, string>> {
  const all = await loadMessages(locale)
  const subset: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    if (isLaunchMessage(key)) subset[key] = value
  }
  return subset
}

/** The prefix of the unsubscribe page's strings, which no other page renders. */
const UNSUBSCRIBE_MESSAGE_PREFIX = 'unsubscribe.'

/** The unsubscribe page's strings in a locale: the one page that seeds them. */
export async function loadUnsubscribeMessages(
  locale: SupportedLocale
): Promise<Record<string, string>> {
  const all = await loadMessages(locale)
  const subset: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(UNSUBSCRIBE_MESSAGE_PREFIX)) subset[key] = value
  }
  return subset
}

/**
 * The catalog an admin page seeds: everything but the strings that load with
 * a lazy surface (the file viewer, the product tour, Copilot and search, the
 * setup sheets) or with their own page (Home and the Launch plan, the wizard,
 * the unsubscribe and Try Messenger pages), and email copy (formatted on the
 * server, never rendered).
 */
export function adminSeedMessages(all: Record<string, string>): Record<string, string> {
  const subset: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    if (isViewerMessage(key) || isTourMessage(key) || isAskMessage(key)) continue
    if (isSheetMessage(key) || isLaunchMessage(key)) continue
    if (key.startsWith('email.') || key.startsWith(UNSUBSCRIBE_MESSAGE_PREFIX)) continue
    if (WIZARD_ONLY_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
    subset[key] = value
  }
  return subset
}

/**
 * Key prefixes the widget surface renders (widget views plus the shared
 * Ask-AI / ui / common / files strings they embed). Everything else in the
 * catalog is portal/admin copy the iframe never shows.
 */
const WIDGET_MESSAGE_PREFIXES = ['widget.', 'helpAskAi.', 'ui.', 'common.', 'files.']

/**
 * The widget's slice of the message catalog. Loaded in the widget layout
 * loader (server-side) and serialized into loader data so the iframe's first
 * client render is already translated — the widget route is `ssr:
 * 'data-only'`, so without this seed the IntlProvider mounts empty, flashes
 * English defaults, and pays a post-mount catalog-chunk fetch. Filtering
 * keeps the serialized payload to the ~200 keys the widget can actually show.
 */
export async function loadWidgetMessages(locale: SupportedLocale): Promise<Record<string, string>> {
  const all = await loadMessages(locale)
  const subset: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    if (isViewerMessage(key)) continue
    if (WIDGET_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) subset[key] = value
  }
  return subset
}

/**
 * Key prefixes the onboarding wizard renders. Ids authored under
 * `routes/onboarding` and `components/onboarding` live under `onboarding.`;
 * `portal.auth.` joins them because the account step renders the shared
 * sign-in form rather than a second copy of it, and those strings are
 * already translated. A unit test (onboarding-message-coverage.test.ts)
 * re-derives the ids from source and fails if one falls outside this list,
 * so a new key can't silently render its English fallback.
 */
const ONBOARDING_MESSAGE_PREFIXES = ['onboarding.', 'portal.auth.'] as const

/** The prefix allowlist as a plain string[], for tests and iteration. */
export const ONBOARDING_MESSAGE_PREFIX_LIST: readonly string[] = ONBOARDING_MESSAGE_PREFIXES

/**
 * The onboarding wizard's slice of the message catalog, loaded in the
 * `/onboarding` layout loader. Mirrors {@link loadPortalMessages} and
 * {@link loadWidgetMessages}: the wizard renders only `onboarding.` ids, so
 * seeding the whole (portal + admin + widget) catalog would add ~80KB to the
 * SSR document of the first screen a new workspace ever sees. Slicing keeps
 * that at the handful of keys the wizard can actually show, and the moment
 * translated onboarding copy lands in the catalogs it is picked up here with no
 * further change.
 */
export async function loadOnboardingMessages(
  locale: SupportedLocale
): Promise<Record<string, string>> {
  const all = await loadMessages(locale)
  const subset: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    if (ONBOARDING_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) subset[key] = value
  }
  return subset
}

/**
 * Key prefixes the portal surfaces render. Derived from the transitive import
 * closure of the `_portal` route tree plus the standalone `/auth/*` pages and
 * the portal access gate — every react-intl id reachable from those pages
 * lives under one of these prefixes:
 *
 * - `portal.` — the bulk of portal/feedback/roadmap/tickets/help-center copy;
 * - `widget.` — the shared conversation-thread components (messenger/CSAT/
 *   assistant strings) reused on the portal support & ticket pages;
 * - `helpAskAi.` — the help-center Ask-AI search surface under `_portal/hc`;
 * - `ui.` — shared UI primitives (e.g. combobox) embedded in portal forms;
 * - `common.` — cross-surface strings (e.g. common.cancel) used on auth pages;
 * - `files.` — the shared file viewer/card/composer-tray components (gallery
 *   viewer, attachment cards) reused on the portal support & ticket pages.
 *
 * Everything else in the catalog is admin/inbox copy the portal never renders.
 * A unit test (portal-message-coverage.test.ts) statically re-derives the ids
 * referenced by the portal source and fails CI if any fall outside this list,
 * so a future key can't silently render its English fallback in production.
 */
const PORTAL_MESSAGE_PREFIXES = [
  'portal.',
  'widget.',
  'helpAskAi.',
  'ui.',
  'common.',
  'files.',
] as const

/** The prefix allowlist as a plain string[], for tests and iteration. */
export const PORTAL_MESSAGE_PREFIX_LIST: readonly string[] = PORTAL_MESSAGE_PREFIXES

/**
 * The portal's slice of the message catalog. Loaded in the portal layout loader
 * (server-side) and serialized into loader data so the portal's first render is
 * already translated during SSR. Mirrors {@link loadWidgetMessages}: filtering
 * to the portal prefixes keeps the serialized payload to the strings the portal
 * can actually show, instead of the whole (admin-inclusive) catalog — a large
 * chunk of the portal SSR HTML. See {@link PORTAL_MESSAGE_PREFIXES}.
 */
export async function loadPortalMessages(locale: SupportedLocale): Promise<Record<string, string>> {
  const all = await loadMessages(locale)
  const subset: Record<string, string> = {}
  for (const [key, value] of Object.entries(all)) {
    if (isViewerMessage(key)) continue
    if (PORTAL_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) subset[key] = value
  }
  return subset
}
