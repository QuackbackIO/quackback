/**
 * Whether a site's robots.txt lets Quackback's reader visit a page. The group
 * naming the reader applies, else the one for every agent; within it the
 * longest matching rule wins and Allow wins a tie, as crawlers read it.
 */

/** The name the reader goes by in robots.txt. */
export const READER_TOKEN = 'QuackbackBrandReader'

interface Rule {
  allow: boolean
  pattern: string
}

function groups(text: string): Array<{ agents: string[]; rules: Rule[] }> {
  const out: Array<{ agents: string[]; rules: Rule[] }> = []
  let current: { agents: string[]; rules: Rule[] } | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (key === 'user-agent') {
      // Consecutive agent lines share the rules that follow them.
      if (!current || current.rules.length) out.push((current = { agents: [], rules: [] }))
      current.agents.push(value.toLowerCase())
    } else if ((key === 'allow' || key === 'disallow') && current) {
      // An empty Disallow allows everything, so it adds no rule.
      if (value) current.rules.push({ allow: key === 'allow', pattern: value })
    }
  }
  return out
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const regex = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${regex}${anchored ? '$' : ''}`).test(path)
}

export function robotsAllows(text: string, path: string, token = READER_TOKEN): boolean {
  const all = groups(text)
  const name = token.toLowerCase()
  const group =
    all.find((g) => g.agents.some((agent) => agent !== '*' && name.includes(agent))) ??
    all.find((g) => g.agents.includes('*'))
  if (!group) return true
  let best: Rule | null = null
  for (const rule of group.rules) {
    if (!matches(rule.pattern, path)) continue
    const length = rule.pattern.length
    if (
      !best ||
      length > best.pattern.length ||
      (length === best.pattern.length && rule.allow && !best.allow)
    )
      best = rule
  }
  return best ? best.allow : true
}
