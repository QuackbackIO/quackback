/**
 * Which strings are allowed to accuse a workspace.
 *
 * A marker only means something if its appearance in the other workspace's output
 * has no innocent explanation. An earlier version harvested every string leaf of
 * every settings JSON column plus every `#rrggbb`, and discarded a token only if
 * the other workspace's *settings row* also contained it. That let `#ffffff`, a
 * workspace named `Support`, and — worst — the board title this suite writes
 * into BOTH workspaces itself, all become accusations. Three correctly isolated
 * fleets exited 2.
 *
 * Two independent filters now stand between a stored value and a verdict.
 *
 * 1. **Genericity** (this file). A token that could plausibly appear in any
 *    workspace's output on its own is never admitted: achromatic or near-universal
 *    colours, short strings, strings built entirely from common product
 *    vocabulary, and anything this suite's own fixture writes.
 *
 * 2. **Own-identity corroboration** (`probes/p06-settings-cache.ts`). Even an
 *    admitted token only accuses when the host serving it shows NONE of its own
 *    identity on that surface. If bravo renders bravo's name and also contains
 *    a word that happens to be in alpha's settings, bravo is plainly rendering
 *    itself and the overlap is incidental.
 *
 * The second filter is what keeps recall: under a real cache serve the host
 * shows the other workspace's identity INSTEAD of its own, which no amount of
 * incidental overlap reproduces — and unlike byte-comparison it is unaffected
 * by a per-request nonce.
 */

import { CANARY, FIXTURE } from './fixtures'

/**
 * Below this, a token is too short to be evidence of anything. Set against real
 * settings values: `Support` (7) and `none` (4) must not qualify, while a
 * distinctive workspace name or a hex colour must.
 */
const MIN_WORD_TOKEN_LENGTH = 8

/**
 * Product vocabulary that appears in ordinary UI chrome regardless of workspace.
 *
 * The rule is deliberately conservative: a token is rejected only when EVERY
 * one of its words is on this list, so `Alpha Workspace` survives while
 * `Feature Requests` and `Support` do not. Being incomplete only costs
 * precision on an unusual name, and the own-identity filter still covers that.
 */
const COMMON_PRODUCT_WORDS = new Set([
  'admin',
  'analytics',
  'and',
  'app',
  'article',
  'articles',
  'blog',
  'board',
  'boards',
  'bug',
  'bugs',
  'center',
  'centre',
  'changelog',
  'chat',
  'comment',
  'comments',
  'community',
  'company',
  'contact',
  'content',
  'dark',
  'dashboard',
  'default',
  'docs',
  'documentation',
  'else',
  'everything',
  'faq',
  'features',
  'feature',
  'feedback',
  'general',
  'guide',
  'help',
  'helpdesk',
  'home',
  'idea',
  'ideas',
  'improvement',
  'improvements',
  'inbox',
  'integration',
  'integrations',
  'internal',
  'issue',
  'issues',
  'knowledge',
  'light',
  'main',
  'messages',
  'messenger',
  'none',
  'notes',
  'other',
  'page',
  'pages',
  'paragraph',
  'planned',
  'portal',
  'post',
  'posts',
  'primary',
  'private',
  'product',
  'progress',
  'public',
  'question',
  'questions',
  'release',
  'releases',
  'request',
  'requests',
  'roadmap',
  'secondary',
  'settings',
  'setup',
  'shipped',
  'site',
  'status',
  'support',
  'team',
  'ticket',
  'tickets',
  'update',
  'updates',
  'user',
  'users',
  'welcome',
  'widget',
  'workspace',
])

/** Colours so common that their presence means nothing. */
const UNIVERSAL_COLOURS = new Set([
  '#fff',
  '#ffffff',
  '#000',
  '#000000',
  '#fafafa',
  '#f5f5f5',
  '#eeeeee',
  '#cccccc',
  '#999999',
  '#666666',
  '#333333',
  '#111111',
])

/**
 * Channel spread below which a hex colour counts as greyscale.
 *
 * Greys are structural — borders, backgrounds, muted text — and appear in every
 * stylesheet ever written. Only a colour with real chroma can identify a brand.
 */
const ACHROMATIC_SPREAD = 24

/** Chroma below which an `oklch(...)` value is achromatic. */
const ACHROMATIC_CHROMA = 0.02

function parseHex(token: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(token.trim())
  if (!match) return null
  let hex = match[1]
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  }
}

/** Strings this suite writes into BOTH workspaces, so they can never distinguish them. */
export function fixtureStrings(): string[] {
  return [FIXTURE.boardName, FIXTURE.boardSlug, FIXTURE.postTitle, CANARY.alpha, CANARY.bravo]
}

/**
 * True when a token could turn up in any workspace's output on its own merits, and
 * therefore must never be treated as one workspace's identity.
 */
export function isGenericToken(raw: string): boolean {
  const token = raw.trim()
  if (token.length === 0) return true

  // The fixture writes these into both workspaces; finding one on the "wrong"
  // host is this suite observing its own handiwork.
  const lower = token.toLowerCase()
  for (const fixture of fixtureStrings()) {
    if (lower === fixture.toLowerCase() || lower.includes(fixture.toLowerCase())) return true
  }

  const hex = parseHex(token)
  if (hex) {
    if (UNIVERSAL_COLOURS.has(lower)) return true
    const spread = Math.max(hex.r, hex.g, hex.b) - Math.min(hex.r, hex.g, hex.b)
    return spread < ACHROMATIC_SPREAD
  }

  const oklch = /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/i.exec(token)
  if (oklch) return Number(oklch[2]) < ACHROMATIC_CHROMA

  // Anything else that is not word-like (booleans, enum slugs, css keywords,
  // numbers, single short identifiers) is structural noise.
  if (token.length < MIN_WORD_TOKEN_LENGTH) return true

  const words = lower.match(/[a-z]+/g) ?? []
  if (words.length === 0) return true
  return words.every((word) => COMMON_PRODUCT_WORDS.has(word))
}

/** Keep only the tokens that are allowed to accuse. */
export function admissibleTokens(values: Iterable<string>): string[] {
  const out = new Set<string>()
  for (const value of values) {
    const token = value.trim()
    if (!isGenericToken(token)) out.add(token)
  }
  return [...out]
}

/**
 * Extract candidate identity values from a stored settings column.
 *
 * Only colour values are mined out of the theme columns. Structural and enum
 * leaves (`paragraph`, `public`, `none`, layout keys) carry no workspace identity
 * and were the single largest source of false accusations.
 */
export function colourTokens(raw: string | null | undefined): string[] {
  if (!raw) return []
  const hexes = raw.match(/#[0-9a-fA-F]{6}\b/g) ?? []
  const oklches = raw.match(/oklch\([^)]*\)/gi) ?? []
  return [...hexes, ...oklches]
}
