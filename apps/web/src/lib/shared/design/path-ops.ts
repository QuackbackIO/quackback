/**
 * A change written by its design field, as the brand match and the MCP patch
 * write them today, read as the operation that makes it, where one does. The
 * brand match pipeline (brand-decide, hero-family, words-family) can adopt
 * the operations through this without rewriting its decisions: a change with
 * an operation goes through applyOp's checks and labels, one without stays a
 * field change through applyDesignChanges.
 */
import { HERO_PATHS, type HeroKey } from './hero'
import type { FlatOp } from './design-ops'
import { THEME_KEYS } from './theme-keys'

const THEME_BY_PATH = new Map<string, string>(
  Object.entries(THEME_KEYS).map(([name, key]) => [key.path, name])
)

/** Hero settings that store one field each, by that field. */
const HERO_BY_PATH = new Map<string, HeroKey>(
  (Object.entries(HERO_PATHS) as Array<[HeroKey, readonly string[]]>)
    .filter(([key, paths]) => paths.length === 1 && key !== 'image')
    .map(([key, paths]) => [paths[0]!, key])
)

const PAGE_CHOICE =
  /^pages\.(changelog|help|roadmap|support)\.(entries|images|subscribe|shipped|topics|popular|search|helpful|related|contact|board|votes|suggest)$/
const WORDS =
  /^pages\.(?:(home|feedback)\.headline|titles\.(roadmap|changelog|help|support))\.(title|subtitle)$/

const text = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value))

/** The operation a field change is, or null where none is (Home's layout, images, CSS). */
export function pathChangeAsOp(path: string, value: unknown): FlatOp | null {
  const theme = THEME_BY_PATH.get(path)
  if (theme) return { op: 'theme', key: theme, value: text(value) }
  if (/^style(Dark)?\.\w+\.\w+\.\w+$/.test(path))
    return { op: 'theme', key: path, value: text(value) }
  const tuned = /^tune\.(\w+\.\w+)$/.exec(path)
  if (tuned) return { op: 'theme', key: tuned[1]!, value: text(value) }
  const hero = HERO_BY_PATH.get(path)
  if (hero) return { op: 'set', target: 'hero', key: hero, value: text(value) }
  const choice = PAGE_CHOICE.exec(path)
  if (choice) return { op: 'set', target: `${choice[1]} page`, key: choice[2]!, value: text(value) }
  if (path === 'pages.feedback.defaultSort')
    return { op: 'set', target: 'feedback page', key: 'sort', value: text(value) }
  const words = WORDS.exec(path)
  if (words && typeof value === 'string')
    return { op: 'words', target: words[1] ?? words[2]!, key: words[3]!, value }
  return null
}
