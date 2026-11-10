/**
 * Matching a brand from screenshots, in Ask AI: a message with images of a
 * site or app, or brand guidelines, that asks to match the brand or says
 * nothing else. The words the chat shows for it, and the checks an image
 * passes before it is sent.
 */

export const MATCH_BRAND = {
  dimmed: 'This one looks dimmed by a pop-up. A clean screenshot works better.',
  banner: 'A cookie banner covers part of this one. A clean screenshot works better.',
  keep: 'Use it anyway',
  /** Under a capture of the brand's site, in the conversation. */
  captured: (host: string) => `Captured from ${host}`,
  captureAgain: 'Capture again',
  captureAgainLater: 'You can capture it again a day after the last capture.',
  ownScreenshot: 'Paste a screenshot to use your own.',
  checking: 'Checking your images…',
  icon: 'Icon and title',
  logo: 'Full logo',
  adjust: 'Adjust',
  asFullLogo: 'Use as full logo',
  asIcon: 'Use as icon and title',
  adjustTitle: 'Adjust the crop',
  adjustHint: 'Drag the box around your logo; drag its corner to size it.',
  save: 'Save',
  cancel: 'Cancel',
  /** A follow-up chip, and the hero panel's prompt, when the site leads with a photo. */
  addHeroPhoto: 'Add a hero photo',
  /** A follow-up chip when a match wrote Home words but Home is off. */
  addHome: 'Add a Home page',
  /** Under a hero photo cut from a screenshot. */
  fromScreenshot: 'From your screenshot: replace with the original for best quality',
  adjustCrop: 'Adjust crop',
  adjustCropHint: 'Drag the box over the part of the photo to show; drag its corner to size it.',
} as const

/**
 * The brand's own face a match could only draw in the nearest bundled one,
 * and the slot it is for, so the reply can offer its upload.
 */
export interface UnmatchedFont {
  family: string
  slot: 'heading' | 'body' | 'both'
}

/** Words that ask to start from the images, rather than to change something in them. */
const ASKS_TO_MATCH =
  /\b(match|brand|branding|look like|looks like|like (our|my) (site|website|app)|from (these|this|my|our)|use (these|this)|screenshots?)\b/i
/** Words about one part of the portal, which an image only illustrates. */
const ABOUT_A_PART =
  /\b(buttons?|header|fonts?|menu|cards?|headline|hero|rounder|bigger|smaller|darker|lighter)\b/i

/**
 * Whether a message starts a brand from its images: it carries images and
 * asks to match the brand, or carries nothing else. Words about one part
 * ("match the button style") never start the whole match, even with "match".
 */
export function isBrandStart(text: string, images: number): boolean {
  if (images === 0) return false
  const words = text.trim()
  if (!words) return true
  if (ABOUT_A_PART.test(words)) return false
  return ASKS_TO_MATCH.test(words)
}

/** A website in a message: a URL or a bare domain (never an email address), as typed. */
const WEBSITE =
  /(?<![@\w.-])((?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::\d{2,5})?(?:\/[^\s<>"')]*)?)(?![\w@-])/i

/** The website a message names, as typed, or null. */
export function websiteIn(text: string): string | null {
  const found = WEBSITE.exec(text)?.[1]
  return found ? found.replace(/[.,;:!?]+$/, '') : null
}

/**
 * Whether a message asks to match the website it names: a website alone (a
 * few words around it at most), or a website and words that ask to match it,
 * never a request about one part that only mentions a site.
 */
export function isSiteStart(text: string): boolean {
  const site = websiteIn(text)
  if (!site) return false
  const rest = text.replace(site, ' ').trim()
  if (ABOUT_A_PART.test(rest)) return false
  if (rest.split(/\s+/).filter(Boolean).length <= 2) return true
  return ASKS_TO_MATCH.test(rest)
}

export type ShotWarning = 'dimmed' | 'banner'

/**
 * Each image's warning: dimmed by a pop-up, as its pixels or the read say,
 * or partly under a cookie banner; none once a person keeps it anyway.
 */
export function shotWarnings(
  shots: ReadonlyArray<{ dimmed: boolean }>,
  read: { banners: ReadonlyArray<{ image: number }>; dimmed: readonly number[] } | null,
  kept: ReadonlySet<number>
): Array<ShotWarning | null> {
  return shots.map((shot, index) => {
    if (kept.has(index)) return null
    if (shot.dimmed || read?.dimmed.includes(index)) return 'dimmed'
    if (read?.banners.some((banner) => banner.image === index)) return 'banner'
    return null
  })
}

/**
 * The title a brand start writes: the name read or typed, or none where it
 * is the workspace's own name, which the header shows anyway. A logo set in
 * lower case reads as "acme"; the workspace keeps its "Acme".
 */
export function titleToSet(title: string, workspaceName: string): string | null {
  const clean = title.trim()
  if (!clean || clean.toLowerCase() === workspaceName.trim().toLowerCase()) return null
  // One letter is a mark drawn as a letter (an "R" in a square), never a name.
  if (letters(clean) < 2) return null
  return clean
}

const letters = (text: string) => (text.match(/\p{L}|\p{N}/gu) ?? []).length

/**
 * The title beside a logo cut as a mark: the words in the logo, unless they
 * are only the mark's letter or initials ("R" beside an R mark), where the
 * brand's name read from the screenshot is the title; none where neither is
 * a name, so the header shows the workspace's.
 */
export function logoTitle(
  logoText: string,
  readName: string | null,
  workspaceName: string
): string | null {
  const text = logoText.trim()
  const name = (readName ?? '').trim()
  const initials = letters(text) < 3 && letters(name) >= 3
  return titleToSet(initials || !text ? name : text, workspaceName)
}

/** Wider than this, a mark is a name set as a logo, not a square icon. */
const WORDMARK_ASPECT = 2.2

/** Whether the logo read is a wordmark: the name as a logo, said so or much wider than tall. */
export function readAsWordmark(mark: {
  wordmark: boolean
  width: number
  height: number
}): boolean {
  return mark.wordmark || mark.width > mark.height * WORDMARK_ASPECT
}
