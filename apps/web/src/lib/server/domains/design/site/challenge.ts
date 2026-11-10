/**
 * Whether a fetched page is a bot wall or interstitial rather than the site.
 * A wall's page names nothing of the brand (its title is the wall's), so the
 * reader keeps its facts out of the brand match. Cheap: a few string checks.
 */

/** Phrases a wall puts in its title. */
const TITLE_MARKERS = [
  'client challenge',
  'just a moment',
  'attention required',
  'checking your browser',
  'access denied',
  'verify you are human',
  'pardon our interruption',
  'are you a robot',
  'you have been blocked',
  'request unsuccessful',
  'security check',
]

/** Markup or phrases only a wall carries, wherever they appear. */
const PAGE_MARKERS = [
  'cf-challenge',
  'cf_chl_',
  'checking your browser before accessing',
  'please enable js and disable any ad blocker',
  'request unsuccessful. incapsula',
  'pardon our interruption',
  'you have been blocked',
]

/** Phrases that mean a wall only on a page with little else on it. */
const SHORT_PAGE_MARKERS = [
  'just a moment',
  'attention required',
  'access denied',
  'verify you are human',
  'are you a robot',
  'captcha',
]

/** Visible text below this many characters is a page with little else on it. */
const SHORT_PAGE_CHARS = 2_000
/** A refusal status makes a wall likelier, so a longer page still counts as short. */
const SHORT_REFUSAL_PAGE_CHARS = 5_000
const MAX_SCAN = 300_000

function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isBotChallenge(html: string, status?: number): boolean {
  try {
    const page = html.slice(0, MAX_SCAN).toLowerCase()
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(page)?.[1].replace(/\s+/g, ' ').trim()
    if (title && TITLE_MARKERS.some((marker) => title.includes(marker))) return true
    if (PAGE_MARKERS.some((marker) => page.includes(marker))) return true
    // Accepted, not served: an empty page that only runs a script to fetch the real one.
    if (status === 202 && !title && visibleText(page).length < SHORT_PAGE_CHARS) return true
    const refused = status === 403 || status === 429 || status === 503
    const limit = refused ? SHORT_REFUSAL_PAGE_CHARS : SHORT_PAGE_CHARS
    const text = visibleText(page)
    return text.length < limit && SHORT_PAGE_MARKERS.some((marker) => text.includes(marker))
  } catch {
    return false
  }
}
