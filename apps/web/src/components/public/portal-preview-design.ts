/**
 * The admin preview's design channel: reading a draft design from a message
 * and setting its attributes on <html>. Only the preview frame needs it, so
 * the listener loads it when the first design arrives and no visitor
 * downloads it. It imports nothing from the app, so splitting it out moves no
 * shared code into a chunk of its own.
 */

/** A page headline by locale; the same shape the preview context carries. */
type Headline = { title: Record<string, string>; subtitle: Record<string, string> } | null

/** A draft portal design, resolved by the admin with the code the server uses. */
export interface DesignPreview {
  css: string
  attributes: Record<string, string>
  fontIds: string[]
  headline: Headline
}

const isTextByLocale = (value: unknown): value is Record<string, string> =>
  !!value && typeof value === 'object' && Object.values(value).every((v) => typeof v === 'string')

function readHeadline(value: unknown): Headline {
  if (!value || typeof value !== 'object') return null
  const { title, subtitle } = value as Record<string, unknown>
  return isTextByLocale(title) && isTextByLocale(subtitle) ? { title, subtitle } : null
}

const DESIGN_ATTRIBUTE = /^data-qb-[a-z]+$/
const DESIGN_VALUE = /^[a-z_]+$/

/** The message's design, keeping only the structural attributes a design sets. */
export function readDesignPreview(value: unknown): DesignPreview | null {
  if (!value || typeof value !== 'object') return null
  const { css, attributes, fontIds, headline } = value as Record<string, unknown>
  if (typeof css !== 'string') return null
  const safe = Object.fromEntries(
    Object.entries((attributes as Record<string, unknown>) ?? {}).filter(
      ([name, v]) => DESIGN_ATTRIBUTE.test(name) && typeof v === 'string' && DESIGN_VALUE.test(v)
    )
  ) as Record<string, string>
  const fonts = Array.isArray(fontIds) ? fontIds.filter((id) => typeof id === 'string') : []
  return { css, attributes: safe, fontIds: fonts, headline: readHeadline(headline) }
}

/** Sets the attributes on <html> and returns what puts each one's saved value back. */
export function applyDesignAttributes(attributes: Record<string, string>): () => void {
  const root = document.documentElement
  const saved = Object.keys(attributes).map((name) => [name, root.getAttribute(name)] as const)
  for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value)
  return () => {
    for (const [name, value] of saved) {
      if (value === null) root.removeAttribute(name)
      else root.setAttribute(name, value)
    }
  }
}
